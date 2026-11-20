'use strict';

const { DatabaseSync } = require('node:sqlite');
const { buildPairs } = require('./network');
const { normalizeProfile } = require('./network-profile');
const { now, parseJson, round } = require('./network-utils');

const FAST_SCHEMA_VERSION = 'backlog-fast-semantic/1.0';
const FAST_PROMPT_VERSION = 'backlog-v0.9.5.0-fast-semantic-1';
const DIMENSIONS = Object.freeze([
  'gameplay', 'narrative', 'exploration', 'structure', 'pace', 'progression',
  'difficulty', 'atmosphere', 'mode', 'perspective', 'identity'
]);
const DIMENSION_LABELS = Object.freeze({
  gameplay: 'boucles, actions et décisions centrales',
  narrative: 'importance, structure et mode de narration',
  exploration: 'liberté, guidage et récompenses de l’exploration',
  structure: 'organisation du monde, des activités et des sessions',
  pace: 'rythme, intensité et contrôle du tempo',
  progression: 'systèmes, persistance et réinitialisations',
  difficulty: 'difficulté, friction, coût de l’échec et compétences demandées',
  atmosphere: 'ton, thèmes et style sensoriel',
  mode: 'solo, coopération, compétition et persistance multijoueur',
  perspective: 'point de vue, caméra et présentation',
  identity: 'éléments réellement distinctifs'
});

const FAST_PROFILE_FORMAT = {
  type: 'object',
  properties: {
    schema_version: { type: 'string', enum: [FAST_SCHEMA_VERSION] },
    summary: { type: 'string', minLength: 40, maxLength: 600 },
    dimensions: {
      type: 'object',
      properties: Object.fromEntries(DIMENSIONS.map((name) => [name, {
        type: 'array', maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 160 }
      }])),
      required: DIMENSIONS,
      additionalProperties: false
    },
    distinctive_signals: {
      type: 'array', maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 180 }
    }
  },
  required: ['schema_version', 'summary', 'dimensions', 'distinctive_signals'],
  additionalProperties: false
};

function json(value) { return JSON.stringify(value == null ? null : value); }
function uniqueStrings(values, maximum = 8, maximumLength = 180) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximumLength);
    const key = text.toLocaleLowerCase('fr-FR');
    if (text.length < 2 || seen.has(key)) continue;
    seen.add(key); normalized.push(text);
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

function normalizeFastProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Profil rapide absent ou invalide'), { code: 'INVALID_FAST_PROFILE' });
  const dimensions = {};
  for (const name of DIMENSIONS) dimensions[name] = uniqueStrings(value.dimensions?.[name], 8, 160);
  const profile = {
    schema_version: FAST_SCHEMA_VERSION,
    summary: String(value.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    dimensions,
    distinctive_signals: uniqueStrings(value.distinctive_signals, 8, 180)
  };
  const populatedDimensions = DIMENSIONS.filter((name) => profile.dimensions[name].length).length;
  const tokenCount = Object.values(profile.dimensions).flat().join(' ').split(/\s+/).filter(Boolean).length;
  const completeness = round(populatedDimensions / DIMENSIONS.length);
  if (profile.summary.length < 40) throw Object.assign(new Error('Profil rapide insuffisant : résumé trop court'), { code: 'FAST_SUMMARY_TOO_SHORT' });
  if (!profile.dimensions.gameplay.length) throw Object.assign(new Error('Profil rapide insuffisant : gameplay absent'), { code: 'FAST_GAMEPLAY_MISSING' });
  if (populatedDimensions < 6 || tokenCount < 24) throw Object.assign(new Error(`Profil rapide insuffisant : ${populatedDimensions}/11 dimensions et ${tokenCount} mots`), { code: 'FAST_PROFILE_INSUFFICIENT' });
  return { profile, populatedDimensions, tokenCount, completeness };
}

function fastProfileText(profile) {
  const lines = [`summary: ${profile.summary}`];
  for (const name of DIMENSIONS) if (profile.dimensions[name]?.length) lines.push(`${name}: ${profile.dimensions[name].join(' | ')}`);
  if (profile.distinctive_signals?.length) lines.push(`distinctive_signals: ${profile.distinctive_signals.join(' | ')}`);
  return lines.join('\n');
}

function dossierText(game, dossier, maximumCharacters = 28000) {
  const heading = `Jeu: ${game.name} (Steam AppID ${game.appId})`;
  const sources = (dossier.sources || []).map((source, index) => [
    `SOURCE ${index + 1} — ${source.title || source.source_key || source.source_type || 'source'}`,
    String(source.excerpt || '').trim()
  ].join('\n')).join('\n\n');
  return `${heading}\n\n${sources}`.slice(0, maximumCharacters);
}

function percentile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

class FastSemanticService {
  constructor({ filename, database, aiEngine, embeddingClient, env = process.env, logger = console, profileGenerator = null }) {
    this.filename = filename;
    this.database = database;
    this.aiEngine = aiEngine;
    this.embeddingClient = embeddingClient;
    this.env = env;
    this.logger = logger;
    this.profileGenerator = profileGenerator;
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    try { this.db.exec('PRAGMA journal_mode=WAL;'); } catch { /* keep host setting */ }
    this.running = false;
    this.pauseRequested = false;
    this.currentRunId = null;
    this.progress = null;
    this.migrate();
  }

  close() { this.db.close(); }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fast_semantic_runs_v095 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        selected_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        generated_count INTEGER NOT NULL DEFAULT 0,
        reused_count INTEGER NOT NULL DEFAULT 0,
        embedded_count INTEGER NOT NULL DEFAULT 0,
        pair_count INTEGER NOT NULL DEFAULT 0,
        analysis_model TEXT,
        embedding_model TEXT,
        prompt_version TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        summary_json TEXT,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS fast_semantic_items_v095 (
        run_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'generate',
        current_step TEXT,
        dossier_id INTEGER,
        source_fingerprint TEXT,
        profile_json TEXT,
        embedding_json TEXT,
        completeness REAL,
        populated_dimensions INTEGER,
        token_count INTEGER,
        analysis_duration_ms INTEGER,
        embedding_duration_ms INTEGER,
        duration_ms INTEGER,
        error_code TEXT,
        error_detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, app_id),
        FOREIGN KEY(run_id) REFERENCES fast_semantic_runs_v095(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fast_items_v095_status ON fast_semantic_items_v095(run_id,status);
      CREATE INDEX IF NOT EXISTS idx_fast_items_v095_fingerprint ON fast_semantic_items_v095(app_id,source_fingerprint,status);
      CREATE TABLE IF NOT EXISTS fast_semantic_edges_v095 (
        run_id INTEGER NOT NULL,
        left_app_id TEXT NOT NULL,
        right_app_id TEXT NOT NULL,
        score REAL NOT NULL,
        semantic_score REAL,
        structured_score REAL NOT NULL,
        mode TEXT NOT NULL,
        components_json TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        explanation_json TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY(run_id,left_app_id,right_app_id),
        FOREIGN KEY(run_id) REFERENCES fast_semantic_runs_v095(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fast_edges_v095_score ON fast_semantic_edges_v095(run_id,score DESC);
    `);
  }

  selectedAppIds() {
    const table = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='similarity_experiment_games'").get();
    if (table) {
      const values = this.db.prepare('SELECT app_id FROM similarity_experiment_games ORDER BY selected_at,CAST(app_id AS INTEGER),app_id').all().map((row) => String(row.app_id));
      if (values.length) return values;
    }
    return this.db.prepare('SELECT app_id FROM ai_document_dossiers GROUP BY app_id ORDER BY MAX(created_at) DESC,CAST(app_id AS INTEGER) LIMIT ?').all(Number(this.env.FAST_SEMANTIC_SIZE || 50)).map((row) => String(row.app_id));
  }

  hydrateRun(row) {
    if (!row) return null;
    const items = this.db.prepare('SELECT * FROM fast_semantic_items_v095 WHERE run_id=? ORDER BY rowid').all(Number(row.id)).map((item) => ({
      ...item, profile: parseJson(item.profile_json), embedding: parseJson(item.embedding_json)
    }));
    return { ...row, summary: parseJson(row.summary_json, null), items };
  }

  getRun(id) { return this.hydrateRun(this.db.prepare('SELECT * FROM fast_semantic_runs_v095 WHERE id=?').get(Number(id))); }
  latestRun() { return this.hydrateRun(this.db.prepare('SELECT * FROM fast_semantic_runs_v095 ORDER BY id DESC LIMIT 1').get()); }
  latestResumableRun() { return this.hydrateRun(this.db.prepare("SELECT * FROM fast_semantic_runs_v095 WHERE status='paused' ORDER BY id DESC LIMIT 1").get()); }
  history(limit = 20) { return this.db.prepare('SELECT * FROM fast_semantic_runs_v095 ORDER BY id DESC LIMIT ?').all(Math.min(100, Math.max(1, Number(limit) || 20))).map((row) => ({ ...row, summary: parseJson(row.summary_json, null) })); }

  status() { return { running: this.running, pauseRequested: this.pauseRequested, progress: this.progress, run: this.currentRunId ? this.getRun(this.currentRunId) : this.latestRun() }; }
  pause() { if (!this.running) throw Object.assign(new Error('Aucune campagne rapide en cours'), { statusCode: 409 }); this.pauseRequested = true; return this.status(); }

  reusableItem(appId, fingerprint) {
    if (!fingerprint) return null;
    return this.db.prepare(`SELECT i.* FROM fast_semantic_items_v095 i JOIN fast_semantic_runs_v095 r ON r.id=i.run_id
      WHERE i.app_id=? AND i.source_fingerprint=? AND i.status='completed' AND i.profile_json IS NOT NULL AND i.embedding_json IS NOT NULL
      AND r.embedding_model=? ORDER BY i.run_id DESC LIMIT 1`).get(String(appId), String(fingerprint), this.embeddingClient.model);
  }

  saveItem(runId, appId, patch) {
    const timestamp = now();
    const existing = this.db.prepare('SELECT 1 FROM fast_semantic_items_v095 WHERE run_id=? AND app_id=?').get(Number(runId), String(appId));
    if (!existing) this.db.prepare(`INSERT INTO fast_semantic_items_v095(run_id,app_id,status,action,current_step,created_at,updated_at) VALUES(?,?,?,'generate','queued',?,?)`).run(Number(runId), String(appId), patch.status || 'pending', timestamp, timestamp);
    const allowed = ['status','action','current_step','dossier_id','source_fingerprint','profile_json','embedding_json','completeness','populated_dimensions','token_count','analysis_duration_ms','embedding_duration_ms','duration_ms','error_code','error_detail'];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (entries.length) this.db.prepare(`UPDATE fast_semantic_items_v095 SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE run_id=? AND app_id=?`).run(...entries.map(([, value]) => value), timestamp, Number(runId), String(appId));
    return this.db.prepare('SELECT * FROM fast_semantic_items_v095 WHERE run_id=? AND app_id=?').get(Number(runId), String(appId));
  }

  async generateProfile(game, dossier) {
    if (this.profileGenerator) return this.profileGenerator(game, dossier);
    const system = `Tu produis une représentation sémantique compacte et discriminante d’un jeu vidéo. Utilise uniquement le dossier fourni. Ne fournis ni citations, ni field_status, ni explication hors JSON. Chaque dimension contient de courtes caractéristiques concrètes et comparables, pas des formulations génériques. Une information inconnue reste un tableau vide. Les dimensions sont: ${DIMENSIONS.map((name) => `${name} (${DIMENSION_LABELS[name]})`).join('; ')}.`;
    const user = `${dossierText(game, dossier, Number(this.env.FAST_SEMANTIC_MAX_INPUT_CHARS || 28000))}\n\nProduis le profil ${FAST_SCHEMA_VERSION}. Donne la priorité aux boucles de jeu, à la structure, à la progression, à la difficulté et aux éléments distinctifs.`;
    const payload = await this.aiEngine.streamJsonRequest(`${this.aiEngine.config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model: this.aiEngine.config.analysisModel, stream: true, think: false, format: FAST_PROFILE_FORMAT, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], options: { temperature: 0, num_predict: Number(this.env.FAST_SEMANTIC_MAX_TOKENS || 1200) } }),
      timeoutMs: Number(this.env.FAST_SEMANTIC_INACTIVITY_TIMEOUT_MS || 180000)
    }, 'Ollama/Qwen rapide');
    const content = payload?.message?.content || payload?.response;
    if (!content) throw Object.assign(new Error('Ollama n’a renvoyé aucun profil rapide'), { code: 'EMPTY_FAST_PROFILE' });
    if (typeof content === 'object') return content;
    try { return JSON.parse(content); } catch {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (!match) throw Object.assign(new Error('Profil rapide Qwen non JSON'), { code: 'INVALID_FAST_JSON' });
      return JSON.parse(match[0]);
    }
  }

  createRun(mode, appIds) {
    const result = this.db.prepare(`INSERT INTO fast_semantic_runs_v095(mode,status,selected_count,analysis_model,embedding_model,prompt_version,started_at,notes)
      VALUES(?,'running',?,?,?,?,?,?)`).run(mode, appIds.length, this.aiEngine.config.analysisModel, this.embeddingClient.model, FAST_PROMPT_VERSION, now(), 'Stockage expérimental séparé; aucun profil historique modifié');
    const runId = Number(result.lastInsertRowid);
    for (const appId of appIds) this.saveItem(runId, appId, { status: 'pending', action: mode === 'rebuild' ? 'generate' : 'smart', current_step: 'queued' });
    return runId;
  }

  async processItem(runId, appId, mode) {
    const started = Date.now();
    const game = this.database.getGame(appId);
    if (!game) throw Object.assign(new Error(`Jeu ${appId} introuvable`), { code: 'GAME_NOT_FOUND' });
    const dossier = this.database.getLatestDossier(appId);
    if (!dossier) throw Object.assign(new Error('Aucun dossier documentaire existant : le pipeline rapide ne lance pas de collecte web'), { code: 'MISSING_DOSSIER' });
    const fingerprint = dossier.source_fingerprint || `dossier:${dossier.id}`;
    this.saveItem(runId, appId, { status: 'running', current_step: 'profile', dossier_id: dossier.id, source_fingerprint: fingerprint, error_code: null, error_detail: null });
    if (mode === 'smart') {
      const reusable = this.reusableItem(appId, fingerprint);
      if (reusable) {
        this.saveItem(runId, appId, { status: 'completed', action: 'reuse', current_step: 'completed', profile_json: reusable.profile_json, embedding_json: reusable.embedding_json, completeness: reusable.completeness, populated_dimensions: reusable.populated_dimensions, token_count: reusable.token_count, analysis_duration_ms: 0, embedding_duration_ms: 0, duration_ms: Date.now() - started });
        return { action: 'reuse' };
      }
    }
    const analysisStarted = Date.now();
    const rawProfile = await this.generateProfile(game, dossier);
    const normalized = normalizeFastProfile(rawProfile);
    const analysisDuration = Date.now() - analysisStarted;
    this.saveItem(runId, appId, { current_step: 'embedding', profile_json: json(normalized.profile), completeness: normalized.completeness, populated_dimensions: normalized.populatedDimensions, token_count: normalized.tokenCount, analysis_duration_ms: analysisDuration });
    const embeddingStarted = Date.now();
    const embedding = await this.embeddingClient.embedText(fastProfileText(normalized.profile));
    if (this.aiEngine.checkEmbedding) this.aiEngine.checkEmbedding(embedding);
    const embeddingDuration = Date.now() - embeddingStarted;
    this.saveItem(runId, appId, { status: 'completed', action: 'generate', current_step: 'completed', embedding_json: json(embedding), embedding_duration_ms: embeddingDuration, duration_ms: Date.now() - started });
    return { action: 'generate' };
  }

  rebuildEdges(runId) {
    const rows = this.db.prepare("SELECT * FROM fast_semantic_items_v095 WHERE run_id=? AND status='completed' AND profile_json IS NOT NULL AND embedding_json IS NOT NULL").all(Number(runId));
    const profiles = rows.map((row) => {
      const profile = parseJson(row.profile_json, {});
      return { appId: String(row.app_id), versionId: Number(runId), normalized: normalizeProfile(profile), embedding: parseJson(row.embedding_json, []) };
    });
    const pairs = buildPairs(profiles);
    this.db.prepare('DELETE FROM fast_semantic_edges_v095 WHERE run_id=?').run(Number(runId));
    const insert = this.db.prepare(`INSERT INTO fast_semantic_edges_v095(run_id,left_app_id,right_app_id,score,semantic_score,structured_score,mode,components_json,dimensions_json,explanation_json,computed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const timestamp = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const pair of pairs) insert.run(Number(runId), pair.leftAppId, pair.rightAppId, pair.score, pair.semanticScore, pair.structuredScore, pair.mode, json(pair.components), json(pair.dimensions), json(pair.explanation), timestamp);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return pairs.length;
  }

  finishRun(runId, status) {
    const items = this.db.prepare('SELECT * FROM fast_semantic_items_v095 WHERE run_id=?').all(Number(runId));
    const run = this.db.prepare('SELECT * FROM fast_semantic_runs_v095 WHERE id=?').get(Number(runId));
    const completed = items.filter((item) => item.status === 'completed');
    const failed = items.filter((item) => item.status === 'failed');
    const durations = completed.map((item) => item.duration_ms).filter((value) => value != null);
    const analysisDurations = completed.map((item) => item.analysis_duration_ms).filter((value) => value != null && value > 0);
    const summary = {
      selected: items.length,
      completed: completed.length,
      failed: failed.length,
      generated: completed.filter((item) => item.action === 'generate').length,
      reused: completed.filter((item) => item.action === 'reuse').length,
      embedded: completed.filter((item) => item.embedding_json).length,
      pairCount: Number(run.pair_count || 0),
      durationMs: Date.now() - new Date(run.started_at).valueOf(),
      averageItemMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + Number(value), 0) / durations.length) : null,
      medianAnalysisMs: percentile(analysisDurations, 0.5),
      p95AnalysisMs: percentile(analysisDurations, 0.95),
      target: { games: 50, maximumDurationMs: 600000, baselineAnalysisMs: 109300 },
      errorCodes: Object.fromEntries([...new Set(failed.map((item) => item.error_code || 'Error'))].map((code) => [code, failed.filter((item) => (item.error_code || 'Error') === code).length]))
    };
    this.db.prepare(`UPDATE fast_semantic_runs_v095 SET status=?,completed_count=?,failed_count=?,generated_count=?,reused_count=?,embedded_count=?,completed_at=?,duration_ms=?,summary_json=? WHERE id=?`).run(status, summary.completed, summary.failed, summary.generated, summary.reused, summary.embedded, status === 'paused' ? null : now(), summary.durationMs, json(summary), Number(runId));
    return summary;
  }

  async run({ mode = 'smart', resumeRunId = null, onProgress = () => {} } = {}) {
    if (this.running) throw Object.assign(new Error('Une campagne sémantique rapide est déjà en cours'), { statusCode: 409 });
    this.running = true; this.pauseRequested = false;
    let runId = resumeRunId ? Number(resumeRunId) : null;
    let run = runId ? this.getRun(runId) : null;
    const appIds = run ? run.items.map((item) => String(item.app_id)) : this.selectedAppIds();
    if (!appIds.length) { this.running = false; throw Object.assign(new Error('Aucun jeu sélectionné et aucun dossier documentaire disponible'), { statusCode: 409 }); }
    if (!run) runId = this.createRun(mode, appIds);
    else { mode = run.mode; this.db.prepare("UPDATE fast_semantic_runs_v095 SET status='running',completed_at=NULL WHERE id=?").run(runId); }
    this.currentRunId = runId;
    try {
      for (let index = 0; index < appIds.length; index += 1) {
        if (this.pauseRequested) {
          this.finishRun(runId, 'paused');
          return { runId, status: 'paused', summary: this.getRun(runId).summary };
        }
        const appId = appIds[index];
        const existing = this.db.prepare('SELECT * FROM fast_semantic_items_v095 WHERE run_id=? AND app_id=?').get(runId, appId);
        if (existing?.status === 'completed') continue;
        this.progress = { runId, mode, current: index, total: appIds.length, appId, step: 'profile', message: 'Génération du profil sémantique compact' };
        onProgress(this.progress);
        try {
          await this.processItem(runId, appId, mode);
        } catch (error) {
          this.logger.error?.(`Pipeline rapide ${appId}:`, error);
          this.saveItem(runId, appId, { status: 'failed', current_step: 'failed', duration_ms: existing?.created_at ? Date.now() - new Date(existing.created_at).valueOf() : null, error_code: error.code || error.name || 'Error', error_detail: String(error.stack || error.message || error) });
        }
        this.progress = { runId, mode, current: index + 1, total: appIds.length, appId, step: 'completed', message: 'Jeu traité' };
        onProgress(this.progress);
      }
      this.progress = { runId, mode, current: appIds.length, total: appIds.length, step: 'network', message: 'Calcul du réseau indépendant' };
      onProgress(this.progress);
      const pairCount = this.rebuildEdges(runId);
      this.db.prepare('UPDATE fast_semantic_runs_v095 SET pair_count=? WHERE id=?').run(pairCount, runId);
      const failures = Number(this.db.prepare("SELECT COUNT(*) AS count FROM fast_semantic_items_v095 WHERE run_id=? AND status='failed'").get(runId).count);
      const status = failures ? 'completed_with_errors' : 'completed';
      const summary = this.finishRun(runId, status);
      return { runId, status, summary, run: this.getRun(runId) };
    } finally {
      this.running = false; this.currentRunId = null; this.progress = null;
    }
  }

  async resume(options = {}) {
    const run = this.latestResumableRun();
    if (!run) throw Object.assign(new Error('Aucune campagne rapide suspendue à reprendre'), { statusCode: 409 });
    return this.run({ ...options, resumeRunId: run.id, mode: run.mode });
  }

  recommendations(appId, limit = 5, runId = null) {
    const run = runId ? this.getRun(runId) : this.hydrateRun(this.db.prepare("SELECT * FROM fast_semantic_runs_v095 WHERE status IN ('completed','completed_with_errors') ORDER BY id DESC LIMIT 1").get());
    if (!run) return [];
    const edges = this.db.prepare(`SELECT * FROM fast_semantic_edges_v095 WHERE run_id=? AND (left_app_id=? OR right_app_id=?) ORDER BY score DESC LIMIT ?`).all(Number(run.id), String(appId), String(appId), Math.min(50, Math.max(1, Number(limit) || 5)));
    return edges.map((edge) => {
      const other = edge.left_app_id === String(appId) ? edge.right_app_id : edge.left_app_id;
      const game = this.database.getGame(other);
      return { appId: other, title: game?.name || `App ${other}`, score: edge.score, semanticScore: edge.semantic_score, structuredScore: edge.structured_score, mode: edge.mode, dimensions: parseJson(edge.dimensions_json, {}), explanation: parseJson(edge.explanation_json, {}) };
    });
  }

  dashboard() {
    const run = this.latestRun();
    if (!run) return { available: true, running: this.running, latestRun: null, metrics: { selected: this.selectedAppIds().length, completed: 0, failed: 0, embedded: 0, pairCount: 0 } };
    return { available: true, running: this.running, latestRun: { id: run.id, mode: run.mode, status: run.status, startedAt: run.started_at, completedAt: run.completed_at }, metrics: { selected: run.selected_count, completed: run.completed_count, failed: run.failed_count, generated: run.generated_count, reused: run.reused_count, embedded: run.embedded_count, pairCount: run.pair_count, durationMs: run.duration_ms, averageItemMs: run.summary?.averageItemMs ?? null, medianAnalysisMs: run.summary?.medianAnalysisMs ?? null, p95AnalysisMs: run.summary?.p95AnalysisMs ?? null }, target: run.summary?.target || { games: 50, maximumDurationMs: 600000, baselineAnalysisMs: 109300 } };
  }
}

module.exports = { FastSemanticService, FAST_SCHEMA_VERSION, FAST_PROMPT_VERSION, FAST_PROFILE_FORMAT, DIMENSIONS, normalizeFastProfile, fastProfileText };
