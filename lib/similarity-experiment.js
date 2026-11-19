'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { normalizeProfile, PROFILE_ADAPTER_VERSION } = require('./network-profile');
const { buildPairs } = require('./network');
const { now, parseJson, round, stablePair } = require('./network-utils');

function qident(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Identifiant SQLite invalide: ${value}`);
  return `"${value}"`;
}

class SimilarityExperiment {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.experimentSize = Number(options.experimentSize || 50);
    this.useDraftProfiles = options.useDraftProfiles !== false;
    this.usableThreshold = Number(options.usableThreshold ?? process.env.NETWORK_USABLE_THRESHOLD ?? 0.45);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    try { this.db.exec('PRAGMA journal_mode=WAL;'); } catch { /* keep host setting */ }
    this.schema = this.discoverSchema();
    this.migrate();
    this.seedSelectionIfEmpty();
  }

  close() { this.db.close(); }

  tableInfo(name) {
    return this.db.prepare(`PRAGMA table_info(${qident(name)})`).all();
  }

  discoverSchema() {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    const info = Object.fromEntries(tables.map((name) => [name, this.tableInfo(name).map((column) => column.name)]));
    const profileTable = tables.includes('ai_profile_versions') ? 'ai_profile_versions' : null;
    let game = null;
    const preferred = ['games', 'steam_games', 'library_games', 'game_library', 'user_games'];
    for (const table of [...preferred.filter((name) => tables.includes(name)), ...tables]) {
      const columns = info[table] || [];
      const appId = ['app_id', 'appid', 'steam_app_id'].find((name) => columns.includes(name));
      const title = ['name', 'title', 'game_name', 'display_name'].find((name) => columns.includes(name));
      if (appId && title) { game = { table, appId, title, columns }; break; }
    }
    return { tables, info, profileTable, game };
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS similarity_experiment_games (
        app_id TEXT PRIMARY KEY,
        selected_at TEXT NOT NULL,
        selection_source TEXT NOT NULL DEFAULT 'manual'
      );
      CREATE TABLE IF NOT EXISTS similarity_edges_v094 (
        left_app_id TEXT NOT NULL,
        right_app_id TEXT NOT NULL,
        left_version_id INTEGER,
        right_version_id INTEGER,
        score REAL NOT NULL,
        semantic_score REAL,
        structured_score REAL NOT NULL,
        mode TEXT NOT NULL,
        components_json TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        explanation_json TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY(left_app_id, right_app_id)
      );
      CREATE INDEX IF NOT EXISTS idx_similarity_edges_v094_score ON similarity_edges_v094(score DESC);
      CREATE TABLE IF NOT EXISTS recommendation_feedback_v094 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_app_id TEXT NOT NULL,
        target_app_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('very_similar','partially_similar','slightly_similar','not_similar')),
        reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_app_id, target_app_id)
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_v094_source ON recommendation_feedback_v094(source_app_id);
      CREATE TABLE IF NOT EXISTS similarity_runs_v094 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        selected_count INTEGER NOT NULL,
        usable_count INTEGER NOT NULL,
        embedded_count INTEGER NOT NULL,
        pair_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS similarity_profile_adapters_v0941 (
        source_version_id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        comparable_json TEXT NOT NULL,
        completeness REAL NOT NULL,
        converted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_similarity_profile_adapters_v0941_app ON similarity_profile_adapters_v0941(app_id);
      CREATE TABLE IF NOT EXISTS similarity_completion_runs_v0941 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        selected_count INTEGER NOT NULL,
        reused_count INTEGER NOT NULL DEFAULT 0,
        converted_count INTEGER NOT NULL DEFAULT 0,
        embedded_count INTEGER NOT NULL DEFAULT 0,
        regenerated_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        pair_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS similarity_completion_items_v0941 (
        run_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        source_version_id INTEGER,
        result_version_id INTEGER,
        message TEXT,
        started_at TEXT,
        completed_at TEXT,
        PRIMARY KEY(run_id, app_id),
        FOREIGN KEY(run_id) REFERENCES similarity_completion_runs_v0941(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_similarity_completion_items_v0941_status ON similarity_completion_items_v0941(run_id, status);
    `);
    const interruptedAt = now();
    this.db.prepare("UPDATE similarity_completion_items_v0941 SET status='interrupted',completed_at=?,message=COALESCE(message,'Traitement interrompu par un redémarrage') WHERE status='running'").run(interruptedAt);
    this.db.prepare("UPDATE similarity_completion_runs_v0941 SET status='interrupted',completed_at=?,notes=COALESCE(notes,'Traitement interrompu par un redémarrage; relancez Compléter le réseau pour reprendre de façon idempotente') WHERE status='running'").run(interruptedAt);
  }

  hasProfileTable() { return Boolean(this.schema.profileTable); }

  seedSelectionIfEmpty() {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM similarity_experiment_games').get().count);
    if (count || !this.hasProfileTable()) return 0;
    const rows = this.db.prepare(`
      SELECT app_id, MAX(COALESCE(version_no, 0)) AS version_no
      FROM ai_profile_versions
      WHERE profile_json IS NOT NULL
      GROUP BY app_id
      ORDER BY MAX(CASE WHEN embedding_json IS NOT NULL THEN 1 ELSE 0 END) DESC,
               MAX(COALESCE(generated_at, '')) DESC,
               CAST(app_id AS INTEGER) ASC
      LIMIT ?
    `).all(this.experimentSize);
    const insert = this.db.prepare("INSERT OR IGNORE INTO similarity_experiment_games(app_id, selected_at, selection_source) VALUES(?, ?, 'auto-profiled')");
    const timestamp = now();
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const row of rows) insert.run(String(row.app_id), timestamp); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return rows.length;
  }

  getSelectedAppIds() {
    return this.db.prepare('SELECT app_id FROM similarity_experiment_games ORDER BY selected_at, CAST(app_id AS INTEGER), app_id').all().map((row) => String(row.app_id));
  }

  setSelection(appIds) {
    const unique = [...new Set((appIds || []).map(String).filter(Boolean))].slice(0, 5000);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM similarity_experiment_games');
      const insert = this.db.prepare("INSERT INTO similarity_experiment_games(app_id, selected_at, selection_source) VALUES(?, ?, 'manual')");
      const timestamp = now();
      for (const appId of unique) insert.run(appId, timestamp);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return unique.length;
  }

  gameNames(appIds = null) {
    const names = new Map();
    if (!this.schema.game) return names;
    const { table, appId, title } = this.schema.game;
    let rows;
    if (appIds && appIds.length) {
      const placeholders = appIds.map(() => '?').join(',');
      rows = this.db.prepare(`SELECT ${qident(appId)} AS app_id, ${qident(title)} AS title FROM ${qident(table)} WHERE CAST(${qident(appId)} AS TEXT) IN (${placeholders})`).all(...appIds.map(String));
    } else {
      rows = this.db.prepare(`SELECT ${qident(appId)} AS app_id, ${qident(title)} AS title FROM ${qident(table)}`).all();
    }
    for (const row of rows) names.set(String(row.app_id), row.title || `App ${row.app_id}`);
    return names;
  }

  libraryGames(limit = 5000) {
    const selected = new Set(this.getSelectedAppIds());
    if (!this.schema.game) {
      if (!this.hasProfileTable()) return [];
      return this.db.prepare('SELECT DISTINCT app_id FROM ai_profile_versions ORDER BY CAST(app_id AS INTEGER), app_id LIMIT ?').all(Number(limit)).map((row) => ({
        appId: String(row.app_id), title: `App ${row.app_id}`, selected: selected.has(String(row.app_id))
      }));
    }
    const { table, appId, title } = this.schema.game;
    return this.db.prepare(`SELECT ${qident(appId)} AS app_id, ${qident(title)} AS title FROM ${qident(table)} ORDER BY ${qident(title)} COLLATE NOCASE LIMIT ?`).all(Number(limit)).map((row) => ({
      appId: String(row.app_id), title: row.title || `App ${row.app_id}`, selected: selected.has(String(row.app_id))
    }));
  }

  rawProfileRows(appIds = this.getSelectedAppIds()) {
    if (!this.hasProfileTable() || !appIds.length) return [];
    const placeholders = appIds.map(() => '?').join(',');
    const columns = new Set(this.schema.info.ai_profile_versions || []);
    const pick = (name, fallback = 'NULL') => columns.has(name) ? qident(name) : `${fallback} AS ${qident(name)}`;
    const lifecycleFilter = columns.has('lifecycle_state')
      ? (this.useDraftProfiles ? "AND lifecycle_state IN ('active','draft')" : "AND lifecycle_state='active'") : '';
    return this.db.prepare(`
      SELECT ${pick('id')}, ${pick('app_id')}, ${pick('version_no', '0')}, ${pick('lifecycle_state', "'active'")},
             ${pick('profile_json')}, ${pick('embedding_json')}, ${pick('profile_completeness_score', '0')},
              ${pick('semantic_quality_score', '0')}, ${pick('generated_at', "''")}, ${pick('quality_status', "''")},
              ${pick('profile_schema_version', "'legacy'")}, ${pick('embedding_model', "''")},
              ${pick('document_quality', "''")}, ${pick('profile_quality', "''")}, ${pick('factual_quality', "''")}
      FROM ai_profile_versions
      WHERE CAST(app_id AS TEXT) IN (${placeholders}) AND profile_json IS NOT NULL ${lifecycleFilter}
    `).all(...appIds.map(String));
  }

  chooseProfiles(appIds = this.getSelectedAppIds()) {
    const grouped = new Map(appIds.map((appId) => [String(appId), []]));
    for (const row of this.rawProfileRows(appIds)) {
      const profile = parseJson(row.profile_json, null);
      if (!profile || typeof profile !== 'object') continue;
      const normalized = normalizeProfile(profile);
      const embedding = parseJson(row.embedding_json, null);
      const candidate = {
        appId: String(row.app_id), versionId: row.id == null ? null : Number(row.id), versionNo: Number(row.version_no || 0),
        lifecycleState: row.lifecycle_state || 'active', profile, normalized,
        embedding: Array.isArray(embedding) && embedding.length ? embedding : null,
        recordedCompleteness: Number(row.profile_completeness_score || 0),
        semanticQuality: Number(row.semantic_quality_score || 0), generatedAt: row.generated_at || '',
        qualityStatus: row.quality_status || '', profileSchemaVersion: row.profile_schema_version || profile.schema_version || 'legacy',
        embeddingModel: row.embedding_model || '', documentQuality: row.document_quality || '',
        profileQuality: row.profile_quality || '', factualQuality: row.factual_quality || ''
      };
      if (!grouped.has(candidate.appId)) grouped.set(candidate.appId, []);
      grouped.get(candidate.appId).push(candidate);
    }
    const chosen = [];
    for (const candidates of grouped.values()) {
      candidates.sort((a, b) =>
        ((b.documentQuality !== 'insufficient' && b.profileQuality !== 'insufficient' && b.factualQuality !== 'failed' ? 1 : 0) - (a.documentQuality !== 'insufficient' && a.profileQuality !== 'insufficient' && a.factualQuality !== 'failed' ? 1 : 0)) ||
        (b.normalized.completeness - a.normalized.completeness) ||
        ((b.embedding ? 1 : 0) - (a.embedding ? 1 : 0)) ||
        (b.recordedCompleteness - a.recordedCompleteness) ||
        (b.versionNo - a.versionNo) || String(b.generatedAt).localeCompare(String(a.generatedAt))
      );
      if (candidates[0]) chosen.push(candidates[0]);
    }
    return chosen;
  }

  qualityLevel(profile) {
    if (!profile || profile.normalized.completeness < 0.45) return 'C';
    if (profile.normalized.completeness >= 0.80 && profile.embedding) return 'A';
    return 'B';
  }

  needsComparableAdapter(profile) {
    if (!profile) return false;
    if (profile.versionId) {
      const cached = this.db.prepare('SELECT adapter_version FROM similarity_profile_adapters_v0941 WHERE source_version_id=?').get(Number(profile.versionId));
      if (cached?.adapter_version === PROFILE_ADAPTER_VERSION) return false;
    }
    return String(profile.profileSchemaVersion || profile.profile?.schema_version || 'legacy') !== '2.1' || Boolean(profile.normalized.adapted);
  }

  completionPlan() {
    const selected = this.getSelectedAppIds();
    const byId = new Map(this.chooseProfiles(selected).map((profile) => [profile.appId, profile]));
    return selected.map((appId) => {
      const profile = byId.get(appId) || null;
      const explicitlyInsufficient = profile && (profile.documentQuality === 'insufficient' || profile.profileQuality === 'insufficient' || profile.factualQuality === 'failed');
      if (!profile || profile.normalized.completeness < this.usableThreshold || explicitlyInsufficient) {
        return {
          appId, action: 'regenerate', sourceVersionId: profile?.versionId || null,
          completeness: profile?.normalized.completeness || 0,
          reason: profile ? (explicitlyInsufficient ? 'Profil marqué insuffisant ou factuellement invalide' : `Profil comparable insuffisant (${Math.round(profile.normalized.completeness * 100)} %)`) : 'Aucun profil disponible'
        };
      }
      const convert = this.needsComparableAdapter(profile);
      return {
        appId,
        action: profile.embedding ? (convert ? 'convert_reuse' : 'reuse') : (convert ? 'convert_embed' : 'embed'),
        sourceVersionId: profile.versionId,
        completeness: profile.normalized.completeness,
        reason: convert ? 'Ancien profil convertible vers le socle commun' : (profile.embedding ? 'Profil et embedding déjà exploitables' : 'Profil exploitable sans embedding'),
        profile
      };
    });
  }

  saveComparableAdapter(profile) {
    if (!profile?.versionId) return null;
    this.db.prepare(`
      INSERT INTO similarity_profile_adapters_v0941(source_version_id,app_id,adapter_version,comparable_json,completeness,converted_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(source_version_id) DO UPDATE SET adapter_version=excluded.adapter_version,
        comparable_json=excluded.comparable_json,completeness=excluded.completeness,converted_at=excluded.converted_at
    `).run(profile.versionId, profile.appId, PROFILE_ADAPTER_VERSION, JSON.stringify(profile.normalized), profile.normalized.completeness, now());
    return { sourceVersionId: profile.versionId, appId: profile.appId, adapterVersion: PROFILE_ADAPTER_VERSION, completeness: profile.normalized.completeness };
  }

  startCompletionRun(plan) {
    const result = this.db.prepare("INSERT INTO similarity_completion_runs_v0941(started_at,status,selected_count) VALUES(?,'running',?)").run(now(), plan.length);
    const runId = Number(result.lastInsertRowid);
    const insert = this.db.prepare("INSERT INTO similarity_completion_items_v0941(run_id,app_id,action,status,source_version_id,message) VALUES(?,?,?,'pending',?,?)");
    for (const item of plan) insert.run(runId, item.appId, item.action, item.sourceVersionId, item.reason || null);
    return runId;
  }

  updateCompletionItem(runId, appId, patch = {}) {
    const allowed = ['status','result_version_id','message','started_at','completed_at'];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (entries.length) {
      const sql = entries.map(([key]) => `${key}=?`).join(',');
      this.db.prepare(`UPDATE similarity_completion_items_v0941 SET ${sql} WHERE run_id=? AND app_id=?`).run(...entries.map(([, value]) => value), Number(runId), String(appId));
    }
    return this.db.prepare('SELECT * FROM similarity_completion_items_v0941 WHERE run_id=? AND app_id=?').get(Number(runId), String(appId));
  }

  finishCompletionRun(runId, { status, counts = {}, pairCount = 0, notes = null }) {
    this.db.prepare(`UPDATE similarity_completion_runs_v0941 SET completed_at=?,status=?,reused_count=?,converted_count=?,embedded_count=?,regenerated_count=?,failed_count=?,pair_count=?,notes=? WHERE id=?`).run(
      now(), status, Number(counts.reused || 0), Number(counts.converted || 0), Number(counts.embedded || 0), Number(counts.regenerated || 0), Number(counts.failed || 0), Number(pairCount || 0), notes, Number(runId)
    );
    return this.completionRun(runId);
  }

  completionRun(runId) {
    const run = this.db.prepare('SELECT * FROM similarity_completion_runs_v0941 WHERE id=?').get(Number(runId));
    if (!run) return null;
    return { ...run, items: this.db.prepare('SELECT * FROM similarity_completion_items_v0941 WHERE run_id=? ORDER BY rowid').all(Number(runId)) };
  }

  latestCompletionRun() {
    const row = this.db.prepare('SELECT id FROM similarity_completion_runs_v0941 ORDER BY id DESC LIMIT 1').get();
    return row ? this.completionRun(row.id) : null;
  }

  rebuildNetwork() {
    const selected = this.getSelectedAppIds();
    const profiles = this.chooseProfiles(selected).filter((profile) => profile.normalized.completeness >= 0.20);
    const embeddedCount = profiles.filter((profile) => profile.embedding).length;
    const startedAt = now();
    const run = this.db.prepare("INSERT INTO similarity_runs_v094(started_at, selected_count, usable_count, embedded_count, status) VALUES(?, ?, ?, ?, 'running')").run(startedAt, selected.length, profiles.length, embeddedCount);
    try {
      const pairs = buildPairs(profiles);
      const insert = this.db.prepare(`
        INSERT INTO similarity_edges_v094(left_app_id,right_app_id,left_version_id,right_version_id,score,semantic_score,structured_score,mode,components_json,dimensions_json,explanation_json,computed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(left_app_id,right_app_id) DO UPDATE SET
          left_version_id=excluded.left_version_id,right_version_id=excluded.right_version_id,score=excluded.score,
          semantic_score=excluded.semantic_score,structured_score=excluded.structured_score,mode=excluded.mode,
          components_json=excluded.components_json,dimensions_json=excluded.dimensions_json,
          explanation_json=excluded.explanation_json,computed_at=excluded.computed_at
      `);
      const validPairs = new Set(); const computedAt = now();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const pair of pairs) {
          const [left, right] = stablePair(pair.leftAppId, pair.rightAppId);
          validPairs.add(`${left}\u0000${right}`);
          insert.run(left, right, pair.leftVersionId, pair.rightVersionId, pair.score, pair.semanticScore,
            pair.structuredScore, pair.mode, JSON.stringify(pair.components), JSON.stringify(pair.dimensions),
            JSON.stringify(pair.explanation), computedAt);
        }
        const existing = this.db.prepare('SELECT left_app_id,right_app_id FROM similarity_edges_v094').all();
        const remove = this.db.prepare('DELETE FROM similarity_edges_v094 WHERE left_app_id=? AND right_app_id=?');
        for (const edge of existing) if (!validPairs.has(`${edge.left_app_id}\u0000${edge.right_app_id}`)) remove.run(edge.left_app_id, edge.right_app_id);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.db.prepare("UPDATE similarity_runs_v094 SET completed_at=?, pair_count=?, status='completed' WHERE id=?").run(now(), pairs.length, run.lastInsertRowid);
      return { selectedCount: selected.length, usableCount: profiles.length, embeddedCount, pairCount: pairs.length, mode: embeddedCount >= 2 ? 'hybrid' : 'structured-only' };
    } catch (error) {
      this.db.prepare("UPDATE similarity_runs_v094 SET completed_at=?, status='failed', notes=? WHERE id=?").run(now(), String(error.message || error), run.lastInsertRowid);
      throw error;
    }
  }

  recommendations(appId, limit = 5) {
    const id = String(appId); const names = this.gameNames();
    const rows = this.db.prepare(`
      SELECT *, CASE WHEN left_app_id=? THEN right_app_id ELSE left_app_id END AS target_app_id
      FROM similarity_edges_v094
      WHERE left_app_id=? OR right_app_id=?
      ORDER BY score DESC LIMIT ?
    `).all(id, id, id, Number(limit));
    const feedback = new Map(this.db.prepare('SELECT target_app_id,rating,reason FROM recommendation_feedback_v094 WHERE source_app_id=?').all(id).map((row) => [String(row.target_app_id), row]));
    return rows.map((row) => ({
      appId: String(row.target_app_id), title: names.get(String(row.target_app_id)) || `App ${row.target_app_id}`,
      score: row.score, semanticScore: row.semantic_score, structuredScore: row.structured_score, mode: row.mode,
      components: parseJson(row.components_json, {}), dimensions: parseJson(row.dimensions_json, {}),
      explanation: parseJson(row.explanation_json, {}), feedback: feedback.get(String(row.target_app_id)) || null,
      computedAt: row.computed_at
    }));
  }

  saveFeedback({ sourceAppId, targetAppId, rating, reason = '' }) {
    const allowed = new Set(['very_similar','partially_similar','slightly_similar','not_similar']);
    if (!allowed.has(rating)) throw new Error('Évaluation invalide');
    if (String(sourceAppId) === String(targetAppId)) throw new Error('Un jeu ne peut pas être évalué contre lui-même');
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO recommendation_feedback_v094(source_app_id,target_app_id,rating,reason,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(source_app_id,target_app_id) DO UPDATE SET rating=excluded.rating,reason=excluded.reason,updated_at=excluded.updated_at
    `).run(String(sourceAppId), String(targetAppId), rating, String(reason || '').slice(0, 2000), timestamp, timestamp);
    return { sourceAppId: String(sourceAppId), targetAppId: String(targetAppId), rating, reason: String(reason || '') };
  }

  dashboard() {
    const selected = this.getSelectedAppIds(); const profiles = this.chooseProfiles(selected);
    const names = this.gameNames(selected); const byId = new Map(profiles.map((profile) => [profile.appId, profile]));
    const levelCounts = { A: 0, B: 0, C: 0 };
    const missingByDimension = {};
    for (const dimension of Object.keys(normalizeProfile({}).dimensions)) missingByDimension[dimension] = 0;
    for (const profile of profiles) {
      levelCounts[this.qualityLevel(profile)] += 1;
      for (const [dimension, tokens] of Object.entries(profile.normalized.dimensions)) if (!tokens.length) missingByDimension[dimension] += 1;
    }
    const edgeCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM similarity_edges_v094').get().count);
    const feedbackRows = this.db.prepare('SELECT rating,COUNT(*) AS count FROM recommendation_feedback_v094 GROUP BY rating').all();
    const feedback = Object.fromEntries(feedbackRows.map((row) => [row.rating, Number(row.count)]));
    const evaluated = Object.values(feedback).reduce((sum, value) => sum + value, 0);
    const usefulness = evaluated ? ((feedback.very_similar || 0) + 0.65 * (feedback.partially_similar || 0) + 0.25 * (feedback.slightly_similar || 0)) / evaluated : null;
    const threshold = Number(process.env.USEFUL_SIMILARITY_THRESHOLD || 0.55);
    let gamesWithThreeNeighbors = 0;
    for (const appId of selected) {
      const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM similarity_edges_v094 WHERE (left_app_id=? OR right_app_id=?) AND score>=?').get(appId, appId, threshold).count);
      if (count >= 3) gamesWithThreeNeighbors += 1;
    }
    let libraryTotal = profiles.length;
    if (this.schema.game) libraryTotal = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${qident(this.schema.game.table)}`).get().count);
    else if (this.hasProfileTable()) libraryTotal = Number(this.db.prepare('SELECT COUNT(DISTINCT app_id) AS count FROM ai_profile_versions').get().count);
    const lastRun = this.db.prepare('SELECT * FROM similarity_runs_v094 ORDER BY id DESC LIMIT 1').get() || null;
    const completionPlan = this.completionPlan();
    const completionCounts = completionPlan.reduce((counts, item) => {
      counts[item.action] = (counts[item.action] || 0) + 1;
      return counts;
    }, {});
    const games = selected.map((appId) => {
      const profile = byId.get(appId);
      return {
        appId, title: names.get(appId) || `App ${appId}`, hasProfile: Boolean(profile),
        hasEmbedding: Boolean(profile?.embedding), qualityLevel: profile ? this.qualityLevel(profile) : null,
        completeness: profile?.normalized.completeness || 0, populatedDimensions: profile?.normalized.populatedDimensions || 0,
        versionNo: profile?.versionNo || null, lifecycleState: profile?.lifecycleState || null,
        recommendations: this.recommendations(appId, 5)
      };
    });
    return {
      version: '0.9.4.2', generatedAt: now(),
      coverage: {
        libraryTotal, selectedTotal: selected.length, profiled: profiles.length,
        usable: profiles.filter((profile) => this.qualityLevel(profile) !== 'C').length,
        embedded: profiles.filter((profile) => profile.embedding).length,
        networked: new Set(this.db.prepare('SELECT left_app_id AS app_id FROM similarity_edges_v094 UNION SELECT right_app_id AS app_id FROM similarity_edges_v094').all().map((row) => String(row.app_id))).size,
        pairCount: edgeCount, maximumPairs: selected.length * (selected.length - 1) / 2
      },
      quality: {
        levels: levelCounts,
        medianCompleteness: median(profiles.map((profile) => profile.normalized.completeness)),
        missingByDimension,
        gamesWithThreeUsefulNeighbors: gamesWithThreeNeighbors,
        usefulDensity: selected.length ? round(gamesWithThreeNeighbors / selected.length) : 0,
        usefulnessScore: usefulness === null ? null : round(usefulness), evaluatedRecommendations: evaluated,
        feedback
      },
      threshold, lastRun, games,
      completion: {
        usableThreshold: this.usableThreshold,
        pending: completionPlan.filter((item) => item.action !== 'reuse').length,
        actions: completionCounts,
        lastRun: this.latestCompletionRun()
      }
    };
  }

  profilesNeedingEmbeddings(limit = 50) {
    return this.chooseProfiles(this.getSelectedAppIds()).filter((profile) => !profile.embedding && profile.normalized.completeness >= 0.20).slice(0, Number(limit));
  }

  saveEmbedding(versionId, embedding, model) {
    if (!this.hasProfileTable()) throw new Error('Table ai_profile_versions absente');
    const columns = new Set(this.schema.info.ai_profile_versions || []);
    if (!columns.has('embedding_json')) throw new Error('Colonne embedding_json absente');
    if (columns.has('embedding_model')) this.db.prepare('UPDATE ai_profile_versions SET embedding_json=?,embedding_model=? WHERE id=?').run(JSON.stringify(embedding), model, Number(versionId));
    else this.db.prepare('UPDATE ai_profile_versions SET embedding_json=? WHERE id=?').run(JSON.stringify(embedding), Number(versionId));
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

module.exports = { SimilarityExperiment, median };
