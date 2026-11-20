'use strict';

const { DatabaseSync } = require('node:sqlite');
const { parseJson } = require('./database');

const DISCOVERY_SCHEMA_VERSION = 'backlog-discovery/1.0';
const INTERPRET_PROMPT_VERSION = 'backlog-v0.9.6-motivations-1';
const RECOMMEND_PROMPT_VERSION = 'backlog-v0.9.6-resonance-1';
const STOP_WORDS = new Set('avec dans pour sans mais donc comme plus moins très cette ceci cela entre avoir être faire jeu jeux joueur joue aime aimé aimer expérience expériences monde univers une des les aux ses son sur par pas que qui quoi dont leur leurs elle elles ils nous vous votre notre tout tous toute quand alors afin ainsi ou et de du la le un au en se ce ces est sont'.split(' '));

function now() { return new Date().toISOString(); }
function json(value) { return JSON.stringify(value == null ? null : value); }
function qid(value) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Identifiant SQLite non sûr: ${value}`); return `"${value}"`; }
function clamp(value, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, Number(value) || 0)); }
function round(value, precision = 4) { const factor = 10 ** precision; return Math.round(Number(value) * factor) / factor; }
function text(value, maximum = 2000) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum); }
function uniqueStrings(values, maximum = 12, maximumLength = 400) {
  const seen = new Set(); const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const item = text(value, maximumLength); const key = item.toLocaleLowerCase('fr-FR');
    if (!item || seen.has(key)) continue; seen.add(key); result.push(item);
    if (result.length >= maximum) break;
  }
  return result;
}
function tokenize(value) {
  return new Set(text(value, 20000).toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g)?.filter((token) => !STOP_WORDS.has(token)) || []);
}
function lexicalScore(query, candidate) {
  const left = tokenize(query); const right = tokenize(candidate); if (!left.size || !right.size) return 0;
  let overlap = 0; for (const token of left) if (right.has(token)) overlap += 1;
  return round(overlap / Math.sqrt(left.size * right.size));
}
function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null;
  let dot = 0; let normLeft = 0; let normRight = 0;
  for (let index = 0; index < left.length; index += 1) { const a = Number(left[index]); const b = Number(right[index]); if (!Number.isFinite(a) || !Number.isFinite(b)) return null; dot += a * b; normLeft += a * a; normRight += b * b; }
  return normLeft && normRight ? dot / Math.sqrt(normLeft * normRight) : null;
}
function normalizeMotivations(values) {
  const seen = new Set(); const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const label = text(raw?.label || raw?.name, 120); const description = text(raw?.description, 700);
    if (!label || !description) continue;
    const key = `${label}|${description}`.toLocaleLowerCase('fr-FR'); if (seen.has(key)) continue; seen.add(key);
    result.push({
      label, description,
      mechanism_agnostic_reason: text(raw?.mechanism_agnostic_reason || raw?.reason, 700),
      evidence_from_player: text(raw?.evidence_from_player || raw?.evidence, 700),
      confidence: round(clamp(raw?.confidence ?? 0.5)),
      uncertainty: text(raw?.uncertainty, 500)
    });
    if (result.length >= 10) break;
  }
  if (!result.length) throw Object.assign(new Error('Aucune motivation exploitable n’a été produite'), { statusCode: 422, code: 'NO_MOTIVATIONS' });
  return result;
}

class DiscoveryService {
  constructor({ filename, database, aiEngine, embeddingClient, env = process.env, logger = console, motivationInterpreter = null, recommendationAnalyzer = null }) {
    this.filename = filename; this.database = database; this.aiEngine = aiEngine; this.embeddingClient = embeddingClient; this.env = env; this.logger = logger;
    this.motivationInterpreter = motivationInterpreter; this.recommendationAnalyzer = recommendationAnalyzer;
    this.db = new DatabaseSync(filename); this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    try { this.db.exec('PRAGMA journal_mode=WAL;'); } catch { /* host setting retained */ }
    this.migrate();
  }
  close() { this.db.close(); }
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discovery_interpretations_v096 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        source_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','confirmed','rejected')),
        interpreted_json TEXT NOT NULL,
        model TEXT,
        prompt_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_interpretations_app_v096 ON discovery_interpretations_v096(app_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS discovery_intentions_v096 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interpretation_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        mechanism_agnostic_reason TEXT,
        evidence_from_player TEXT,
        confidence REAL NOT NULL,
        uncertainty TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(interpretation_id) REFERENCES discovery_interpretations_v096(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_intentions_active_v096 ON discovery_intentions_v096(active,updated_at DESC);
      CREATE TABLE IF NOT EXISTS discovery_runs_v096 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_app_id TEXT NOT NULL,
        intention_ids_json TEXT NOT NULL,
        query_text TEXT,
        status TEXT NOT NULL,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        deep_candidate_count INTEGER NOT NULL DEFAULT 0,
        recommendation_count INTEGER NOT NULL DEFAULT 0,
        query_embedding_ms INTEGER,
        candidate_selection_ms INTEGER,
        analysis_ms INTEGER,
        duration_ms INTEGER,
        embedding_model TEXT,
        analysis_model TEXT,
        prompt_version TEXT NOT NULL,
        error_code TEXT,
        error_detail TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_runs_created_v096 ON discovery_runs_v096(created_at DESC);
      CREATE TABLE IF NOT EXISTS discovery_candidates_v096 (
        run_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        candidate_score REAL NOT NULL,
        embedding_score REAL,
        metadata_score REAL NOT NULL,
        source TEXT NOT NULL,
        deep_selected INTEGER NOT NULL DEFAULT 0 CHECK(deep_selected IN (0,1)),
        evidence_json TEXT NOT NULL,
        PRIMARY KEY(run_id,app_id),
        FOREIGN KEY(run_id) REFERENCES discovery_runs_v096(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS discovery_recommendations_v096 (
        run_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        resonance_score REAL NOT NULL,
        confidence TEXT NOT NULL,
        matched_intention_ids_json TEXT NOT NULL,
        presentation TEXT NOT NULL,
        explanation TEXT NOT NULL,
        difference_text TEXT NOT NULL,
        uncertainties_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        PRIMARY KEY(run_id,app_id),
        FOREIGN KEY(run_id) REFERENCES discovery_runs_v096(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS discovery_feedback_v096 (
        run_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK(verdict IN ('interested','not_for_me','reason_wrong')),
        correction_target TEXT CHECK(correction_target IN ('game','player','match','unknown')),
        comment TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id,app_id),
        FOREIGN KEY(run_id,app_id) REFERENCES discovery_recommendations_v096(run_id,app_id) ON DELETE CASCADE
      );
    `);
  }
  async aiJson({ system, user, format, label, maxTokens = 1800 }) {
    const payload = await this.aiEngine.streamJsonRequest(`${this.aiEngine.config.ollamaBaseUrl}/api/chat`, {
      method: 'POST', timeoutMs: Number(this.env.DISCOVERY_INACTIVITY_TIMEOUT_MS || 240000),
      body: JSON.stringify({ model: this.aiEngine.config.analysisModel, stream: true, think: false, format, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], options: { temperature: 0, num_predict: Number(maxTokens) } })
    }, label);
    const content = payload?.message?.content || payload?.response;
    if (content && typeof content === 'object') return content;
    try { return JSON.parse(String(content || '')); } catch {
      const match = String(content || '').match(/\{[\s\S]*\}/); if (match) return JSON.parse(match[0]);
      throw Object.assign(new Error(`${label}: réponse JSON inexploitable`), { code: 'INVALID_DISCOVERY_JSON' });
    }
  }
  async interpret({ appId, sourceText }) {
    const game = this.database.getGame(appId); if (!game) throw Object.assign(new Error('Jeu de référence introuvable'), { statusCode: 404 });
    const input = text(sourceText, 6000); if (input.length < 20) throw Object.assign(new Error('Expliquez plus précisément ce que vous avez aimé (20 caractères minimum)'), { statusCode: 400 });
    const format = { type: 'object', properties: { motivations: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
      label: { type: 'string', minLength: 3, maxLength: 120 }, description: { type: 'string', minLength: 15, maxLength: 700 }, mechanism_agnostic_reason: { type: 'string', maxLength: 700 }, evidence_from_player: { type: 'string', maxLength: 700 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, uncertainty: { type: 'string', maxLength: 500 }
    }, required: ['label','description','mechanism_agnostic_reason','evidence_from_player','confidence','uncertainty'], additionalProperties: false } } }, required: ['motivations'], additionalProperties: false };
    const result = this.motivationInterpreter ? await this.motivationInterpreter({ game, sourceText: input }) : await this.aiJson({
      label: 'Ollama/Qwen motivations', maxTokens: this.env.DISCOVERY_INTERPRET_MAX_TOKENS || 1600, format,
      system: 'Tu interprètes les raisons explicitement exprimées par un joueur. Distingue faits exprimés et hypothèses. Ne construis pas de profil psychologique figé. Formule des motivations expérientielles combinables, indépendantes des genres et mécanismes. Chaque motivation doit rester corrigeable et signaler son incertitude. Réponds uniquement en JSON.',
      user: `Jeu apprécié : ${game.name} (AppID ${game.appId}).\nExplication du joueur :\n${input}\n\nExtrais les motivations sans inventer de préférence non exprimée.`
    });
    const motivations = normalizeMotivations(result?.motivations || result);
    const inserted = this.db.prepare(`INSERT INTO discovery_interpretations_v096(app_id,source_text,status,interpreted_json,model,prompt_version,created_at) VALUES(?,?,'draft',?,?,?,?)`).run(String(appId), input, json(motivations), this.aiEngine.config.analysisModel, INTERPRET_PROMPT_VERSION, now());
    return this.getInterpretation(Number(inserted.lastInsertRowid));
  }
  getInterpretation(id) {
    const row = this.db.prepare('SELECT * FROM discovery_interpretations_v096 WHERE id=?').get(Number(id));
    return row ? { ...row, game: this.database.getGame(row.app_id), motivations: parseJson(row.interpreted_json, []) } : null;
  }
  confirmInterpretation(id, { motivations }) {
    const interpretation = this.getInterpretation(id); if (!interpretation) throw Object.assign(new Error('Interprétation introuvable'), { statusCode: 404 });
    if (interpretation.status !== 'draft') throw Object.assign(new Error('Cette interprétation a déjà été traitée'), { statusCode: 409 });
    const normalized = normalizeMotivations(motivations); const timestamp = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE discovery_interpretations_v096 SET status='confirmed',interpreted_json=?,confirmed_at=? WHERE id=?").run(json(normalized), timestamp, Number(id));
      const insert = this.db.prepare(`INSERT INTO discovery_intentions_v096(interpretation_id,app_id,label,description,mechanism_agnostic_reason,evidence_from_player,confidence,uncertainty,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`);
      for (const item of normalized) insert.run(Number(id), interpretation.app_id, item.label, item.description, item.mechanism_agnostic_reason, item.evidence_from_player, item.confidence, item.uncertainty, timestamp, timestamp);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { interpretation: this.getInterpretation(id), intentions: this.listIntentions({ interpretationId: id }) };
  }
  listIntentions({ interpretationId = null, active = true } = {}) {
    const where = []; const params = [];
    if (interpretationId != null) { where.push('i.interpretation_id=?'); params.push(Number(interpretationId)); }
    if (active != null) { where.push('i.active=?'); params.push(active ? 1 : 0); }
    return this.db.prepare(`SELECT i.* FROM discovery_intentions_v096 i ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.updated_at DESC,i.id DESC`).all(...params).map((row) => ({ ...row, game: this.database.getGame(row.app_id) }));
  }
  setIntentionActive(id, active) {
    this.db.prepare('UPDATE discovery_intentions_v096 SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, now(), Number(id));
    const row = this.db.prepare('SELECT * FROM discovery_intentions_v096 WHERE id=?').get(Number(id)); if (!row) throw Object.assign(new Error('Intention introuvable'), { statusCode: 404 }); return row;
  }
  libraryGames(limit = 5000) {
    const source = this.database.discoverLibrarySource(); if (!source) return [];
    const maximum = Math.min(10000, Math.max(1, Number(limit) || 5000));
    return this.database.db.prepare(`SELECT * FROM ${qid(source.table)} ORDER BY LOWER(${qid(source.name)}) LIMIT ?`).all(maximum).map((row) => this.database.normalizeGame(row, source));
  }
  semanticCandidates() {
    const candidates = new Map();
    const hasFastTables = this.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('fast_semantic_runs_v095','fast_semantic_items_v095')").get().count === 2;
    const fastRun = hasFastTables ? this.db.prepare("SELECT id FROM fast_semantic_runs_v095 WHERE status IN ('completed','completed_with_errors') ORDER BY id DESC LIMIT 1").get() : null;
    if (fastRun) for (const row of this.db.prepare("SELECT app_id,profile_json,embedding_json FROM fast_semantic_items_v095 WHERE run_id=? AND status='completed' AND embedding_json IS NOT NULL").all(fastRun.id)) candidates.set(String(row.app_id), { profile: parseJson(row.profile_json, {}), embedding: parseJson(row.embedding_json, []), source: 'fast_semantic' });
    for (const row of this.db.prepare("SELECT app_id,profile_json,embedding_json FROM ai_profile_versions WHERE lifecycle_state='active' AND embedding_json IS NOT NULL ORDER BY version_no DESC").all()) if (!candidates.has(String(row.app_id))) candidates.set(String(row.app_id), { profile: parseJson(row.profile_json, {}), embedding: parseJson(row.embedding_json, []), source: 'active_profile' });
    return candidates;
  }
  buildCandidates(referenceAppId, queryText, queryEmbedding) {
    const semantic = this.semanticCandidates(); const games = this.libraryGames(Number(this.env.DISCOVERY_LIBRARY_LIMIT || 5000)); const output = [];
    for (const game of games) {
      if (String(game.appId) === String(referenceAppId)) continue;
      const item = semantic.get(String(game.appId)); const profileText = item ? text(JSON.stringify(item.profile), 6000) : '';
      const metadataText = [game.name, ...(game.genres || []), ...(game.themes || []), ...(game.platforms || []), profileText].join(' ');
      const metadataScore = lexicalScore(queryText, metadataText); const similarity = item ? cosine(queryEmbedding, item.embedding) : null;
      const embeddingScore = similarity == null ? null : clamp((similarity + 1) / 2);
      const candidateScore = embeddingScore == null ? round(metadataScore * 0.35) : round((embeddingScore * 0.82) + (metadataScore * 0.18));
      output.push({ appId: String(game.appId), title: game.displayName || game.name, coverUrl: game.coverUrl, genres: game.genres || [], themes: game.themes || [], candidateScore, embeddingScore: embeddingScore == null ? null : round(embeddingScore), metadataScore, source: item?.source || 'metadata', profile: item?.profile || null });
    }
    return output.sort((a, b) => b.candidateScore - a.candidateScore || Number(b.embeddingScore || 0) - Number(a.embeddingScore || 0) || a.title.localeCompare(b.title, 'fr'));
  }
  async analyzeRecommendations({ referenceGame, intentions, queryText, candidates, target }) {
    if (this.recommendationAnalyzer) return this.recommendationAnalyzer({ referenceGame, intentions, queryText, candidates, target });
    const candidateIds = candidates.map((item) => item.appId); const intentionIds = intentions.map((item) => String(item.id));
    const format = { type: 'object', properties: { recommendations: { type: 'array', minItems: target, maxItems: target, items: { type: 'object', properties: {
      app_id: { type: 'string', enum: candidateIds }, resonance_score: { type: 'number', minimum: 0, maximum: 1 }, confidence: { type: 'string', enum: ['low','medium','high'] }, matched_intention_ids: { type: 'array', minItems: 1, items: { type: 'string', enum: intentionIds } }, presentation: { type: 'string', minLength: 20, maxLength: 600 }, explanation: { type: 'string', minLength: 40, maxLength: 1400 }, difference: { type: 'string', minLength: 20, maxLength: 900 }, uncertainties: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', maxLength: 400 } }, evidence: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 500 } }
    }, required: ['app_id','resonance_score','confidence','matched_intention_ids','presentation','explanation','difference','uncertainties','evidence'], additionalProperties: false } } }, required: ['recommendations'], additionalProperties: false };
    const compact = candidates.map((item) => ({ app_id: item.appId, title: item.title, genres: item.genres, themes: item.themes, candidate_score: item.candidateScore, known_profile: item.profile }));
    return this.aiJson({ label: 'Ollama/Qwen découverte ciblée', maxTokens: this.env.DISCOVERY_ANALYSIS_MAX_TOKENS || 3600, format,
      system: `Tu classes des jeux candidats selon leur résonance avec les motivations confirmées d’un joueur. La ressemblance avec le jeu de référence n’est pas le but. Une différence de genre ou de mécanique peut être un argument. Utilise uniquement les données candidates fournies. N’invente aucun fait. Sélectionne exactement ${target} jeux distincts. Pour chacun, explique le lien, la différence et au moins une incertitude. Réponds uniquement en JSON.`,
      user: `Jeu de référence : ${referenceGame.name} (${referenceGame.appId}).\nRecherche complémentaire : ${queryText || 'aucune'}\nMotivations confirmées :\n${JSON.stringify(intentions.map((item) => ({ id: String(item.id), label: item.label, description: item.description, reason: item.mechanism_agnostic_reason })))}\n\nCandidats présélectionnés par métadonnées et embeddings :\n${JSON.stringify(compact)}` });
  }
  normalizeRecommendations(raw, candidates, intentionIds, target) {
    const allowed = new Set(candidates.map((item) => String(item.appId))); const selectedIntentions = new Set(intentionIds.map(String)); const seen = new Set(); const output = [];
    for (const item of Array.isArray(raw?.recommendations) ? raw.recommendations : []) {
      const appId = String(item?.app_id || ''); if (!allowed.has(appId) || seen.has(appId)) continue; seen.add(appId);
      const matched = [...new Set((item.matched_intention_ids || []).map(String).filter((id) => selectedIntentions.has(id)))]; if (!matched.length) continue;
      const presentation = text(item.presentation, 600); const explanation = text(item.explanation, 1400); const difference = text(item.difference, 900); const uncertainties = uniqueStrings(item.uncertainties, 5, 400); const evidence = uniqueStrings(item.evidence, 8, 500);
      if (presentation.length < 20 || explanation.length < 40 || difference.length < 20 || !uncertainties.length || !evidence.length) continue;
      output.push({ appId, resonanceScore: round(clamp(item.resonance_score)), confidence: ['low','medium','high'].includes(item.confidence) ? item.confidence : 'low', matchedIntentionIds: matched, presentation, explanation, difference, uncertainties, evidence });
      if (output.length === target) break;
    }
    if (output.length !== target) throw Object.assign(new Error(`L’analyse ciblée devait produire ${target} recommandations valides, mais en a produit ${output.length}`), { code: 'INCOMPLETE_DISCOVERY_RESULT' });
    return output.sort((a, b) => b.resonanceScore - a.resonanceScore);
  }
  async discover({ referenceAppId, intentionIds, queryText = '' }) {
    const referenceGame = this.database.getGame(referenceAppId); if (!referenceGame) throw Object.assign(new Error('Jeu de référence introuvable'), { statusCode: 404 });
    const ids = [...new Set((Array.isArray(intentionIds) ? intentionIds : []).map(Number).filter(Number.isInteger))]; if (!ids.length) throw Object.assign(new Error('Sélectionnez au moins une intention confirmée'), { statusCode: 400 });
    const placeholders = ids.map(() => '?').join(','); const intentions = this.db.prepare(`SELECT * FROM discovery_intentions_v096 WHERE active=1 AND id IN (${placeholders}) ORDER BY id`).all(...ids);
    if (intentions.length !== ids.length) throw Object.assign(new Error('Une intention sélectionnée est introuvable ou inactive'), { statusCode: 400 });
    const createdAt = now(); const started = Date.now(); const insert = this.db.prepare(`INSERT INTO discovery_runs_v096(reference_app_id,intention_ids_json,query_text,status,embedding_model,analysis_model,prompt_version,created_at) VALUES(?,?,?,'running',?,?,?,?)`).run(String(referenceAppId), json(ids), text(queryText, 2000), this.embeddingClient.model, this.aiEngine.config.analysisModel, RECOMMEND_PROMPT_VERSION, createdAt); const runId = Number(insert.lastInsertRowid);
    try {
      const intentQuery = [text(queryText, 2000), ...intentions.flatMap((item) => [item.label, item.description, item.mechanism_agnostic_reason])].filter(Boolean).join('\n');
      const embeddingStarted = Date.now(); const queryEmbedding = await this.embeddingClient.embedText(intentQuery); const queryEmbeddingMs = Date.now() - embeddingStarted;
      const candidateStarted = Date.now(); const allCandidates = this.buildCandidates(referenceAppId, intentQuery, queryEmbedding); const candidateSelectionMs = Date.now() - candidateStarted;
      const candidateLimit = Math.min(100, Math.max(5, Number(this.env.DISCOVERY_CANDIDATE_LIMIT || 40))); const deepLimit = Math.min(candidateLimit, Math.max(5, Number(this.env.DISCOVERY_DEEP_CANDIDATES || 12))); const persisted = allCandidates.slice(0, candidateLimit); const deep = persisted.slice(0, deepLimit); const target = Math.min(5, deep.length);
      if (target < 5) throw Object.assign(new Error('Moins de cinq candidats sont disponibles. Exécutez le pipeline sémantique rapide ou enrichissez la bibliothèque.'), { statusCode: 409, code: 'INSUFFICIENT_CANDIDATES' });
      const candidateInsert = this.db.prepare('INSERT INTO discovery_candidates_v096(run_id,app_id,rank,candidate_score,embedding_score,metadata_score,source,deep_selected,evidence_json) VALUES(?,?,?,?,?,?,?,?,?)');
      this.db.exec('BEGIN IMMEDIATE'); try { persisted.forEach((item, index) => candidateInsert.run(runId, item.appId, index + 1, item.candidateScore, item.embeddingScore, item.metadataScore, item.source, index < deepLimit ? 1 : 0, json({ title: item.title, coverUrl: item.coverUrl, genres: item.genres, themes: item.themes, profile: item.profile }))); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      const analysisStarted = Date.now(); const raw = await this.analyzeRecommendations({ referenceGame, intentions, queryText: text(queryText, 2000), candidates: deep, target }); const analysisMs = Date.now() - analysisStarted;
      const recommendations = this.normalizeRecommendations(raw, deep, ids, target); const recommendationInsert = this.db.prepare('INSERT INTO discovery_recommendations_v096(run_id,app_id,rank,resonance_score,confidence,matched_intention_ids_json,presentation,explanation,difference_text,uncertainties_json,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      recommendations.forEach((item, index) => recommendationInsert.run(runId, item.appId, index + 1, item.resonanceScore, item.confidence, json(item.matchedIntentionIds), item.presentation, item.explanation, item.difference, json(item.uncertainties), json(item.evidence)));
      this.db.prepare("UPDATE discovery_runs_v096 SET status='completed',candidate_count=?,deep_candidate_count=?,recommendation_count=?,query_embedding_ms=?,candidate_selection_ms=?,analysis_ms=?,duration_ms=?,completed_at=? WHERE id=?").run(persisted.length, deep.length, recommendations.length, queryEmbeddingMs, candidateSelectionMs, analysisMs, Date.now() - started, now(), runId);
      return this.getRun(runId);
    } catch (error) {
      this.db.prepare("UPDATE discovery_runs_v096 SET status='failed',duration_ms=?,error_code=?,error_detail=?,completed_at=? WHERE id=?").run(Date.now() - started, error.code || error.name || 'Error', String(error.stack || error.message || error), now(), runId); throw error;
    }
  }
  getRun(id) {
    const row = this.db.prepare('SELECT * FROM discovery_runs_v096 WHERE id=?').get(Number(id)); if (!row) return null;
    const intentionsById = new Map(this.listIntentions({ active: null }).map((item) => [String(item.id), item]));
    const candidates = this.db.prepare('SELECT * FROM discovery_candidates_v096 WHERE run_id=? ORDER BY rank').all(Number(id)).map((item) => ({ ...item, evidence: parseJson(item.evidence_json, {}) }));
    const recommendations = this.db.prepare(`SELECT r.*,f.verdict,f.correction_target,f.comment AS feedback_comment FROM discovery_recommendations_v096 r LEFT JOIN discovery_feedback_v096 f ON f.run_id=r.run_id AND f.app_id=r.app_id WHERE r.run_id=? ORDER BY r.rank`).all(Number(id)).map((item) => { const game = this.database.getGame(item.app_id); const matchedIds = parseJson(item.matched_intention_ids_json, []); return { ...item, game, matchedIntentionIds: matchedIds, matchedIntentions: matchedIds.map((intentId) => intentionsById.get(String(intentId))).filter(Boolean), uncertainties: parseJson(item.uncertainties_json, []), evidence: parseJson(item.evidence_json, []) }; });
    return { ...row, referenceGame: this.database.getGame(row.reference_app_id), intentionIds: parseJson(row.intention_ids_json, []), candidates, recommendations };
  }
  saveFeedback({ runId, appId, verdict, correctionTarget = 'unknown', comment = '' }) {
    if (!['interested','not_for_me','reason_wrong'].includes(verdict)) throw Object.assign(new Error('Verdict de retour invalide'), { statusCode: 400 });
    const recommendation = this.db.prepare('SELECT 1 FROM discovery_recommendations_v096 WHERE run_id=? AND app_id=?').get(Number(runId), String(appId)); if (!recommendation) throw Object.assign(new Error('Recommandation introuvable'), { statusCode: 404 });
    const target = ['game','player','match','unknown'].includes(correctionTarget) ? correctionTarget : 'unknown';
    this.db.prepare(`INSERT INTO discovery_feedback_v096(run_id,app_id,verdict,correction_target,comment,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,app_id) DO UPDATE SET verdict=excluded.verdict,correction_target=excluded.correction_target,comment=excluded.comment,updated_at=excluded.updated_at`).run(Number(runId), String(appId), verdict, target, text(comment, 2000), now());
    return this.db.prepare('SELECT * FROM discovery_feedback_v096 WHERE run_id=? AND app_id=?').get(Number(runId), String(appId));
  }
  dashboard() {
    const counts = this.db.prepare(`SELECT (SELECT COUNT(*) FROM discovery_interpretations_v096 WHERE status='confirmed') AS confirmed_interpretations,(SELECT COUNT(*) FROM discovery_intentions_v096 WHERE active=1) AS active_intentions,(SELECT COUNT(*) FROM discovery_runs_v096) AS runs,(SELECT COUNT(*) FROM discovery_runs_v096 WHERE status='completed') AS completed_runs,(SELECT COUNT(*) FROM discovery_feedback_v096) AS feedback`).get();
    const latest = this.db.prepare('SELECT * FROM discovery_runs_v096 ORDER BY id DESC LIMIT 1').get() || null;
    const verdicts = Object.fromEntries(this.db.prepare('SELECT verdict,COUNT(*) AS count FROM discovery_feedback_v096 GROUP BY verdict').all().map((row) => [row.verdict, Number(row.count)]));
    const timings = this.db.prepare("SELECT ROUND(AVG(query_embedding_ms)) AS embedding_ms,ROUND(AVG(candidate_selection_ms)) AS candidate_ms,ROUND(AVG(analysis_ms)) AS analysis_ms,ROUND(AVG(duration_ms)) AS total_ms FROM discovery_runs_v096 WHERE status='completed'").get();
    return { schemaVersion: DISCOVERY_SCHEMA_VERSION, counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])), verdicts, averageTimings: timings, latestRun: latest ? { id: latest.id, status: latest.status, referenceAppId: latest.reference_app_id, recommendationCount: latest.recommendation_count, durationMs: latest.duration_ms, completedAt: latest.completed_at } : null };
  }
}

module.exports = { DiscoveryService, DISCOVERY_SCHEMA_VERSION, INTERPRET_PROMPT_VERSION, RECOMMEND_PROMPT_VERSION, normalizeMotivations, cosine, lexicalScore };
