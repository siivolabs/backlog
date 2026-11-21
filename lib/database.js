'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { importLegacyInventory } = require('./legacy-import');

function parseJson(value, fallback = null) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function asJson(value) { return JSON.stringify(value ?? null); }

class CoreDatabase {
  constructor(filename, options = {}) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.createSchema();
    if (options.autoImport !== false) this.ensureInventory(options.legacyPath);
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS games(
        app_id TEXT PRIMARY KEY,title TEXT NOT NULL,studio TEXT,genres TEXT,cover_url TEXT,description TEXT,
        playtime_minutes INTEGER,last_played_at TEXT,inventory_metadata_json TEXT NOT NULL DEFAULT '{}',
        source_table TEXT,imported_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_games_title ON games(title COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS work_batch(
        app_id TEXT PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,selected_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS enrichment_runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,status TEXT NOT NULL,selected_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,failed_count INTEGER NOT NULL DEFAULT 0,current_app_id TEXT,
        analysis_model TEXT,embedding_model TEXT,started_at TEXT NOT NULL DEFAULT (datetime('now')),completed_at TEXT,error TEXT
      );
      CREATE TABLE IF NOT EXISTS enrichment_items(
        run_id INTEGER NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,app_id TEXT NOT NULL REFERENCES games(app_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',step TEXT NOT NULL DEFAULT 'queued',error TEXT,started_at TEXT,completed_at TEXT,
        PRIMARY KEY(run_id,app_id)
      );
      CREATE TABLE IF NOT EXISTS profiles(
        app_id TEXT PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,schema_version TEXT NOT NULL,profile_json TEXT NOT NULL,
        embedding_json TEXT,source_json TEXT NOT NULL,analysis_model TEXT,embedding_model TEXT,confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS discovery_sessions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,reference_app_id TEXT NOT NULL,motivation_text TEXT NOT NULL,
        motivations_json TEXT NOT NULL,results_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS discovery_feedback(
        reference_app_id TEXT NOT NULL,candidate_app_id TEXT NOT NULL,motivation_key TEXT NOT NULL DEFAULT '',
        verdict TEXT NOT NULL CHECK(verdict IN ('relevant','not_relevant')),note TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(reference_app_id,candidate_app_id,motivation_key)
      );
    `);
    this.setMeta('schema_version', 'backlog-core/1.0');
  }

  close() { this.db.close(); }
  setMeta(key, value) { this.db.prepare("INSERT INTO meta(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, String(value)); }
  getMeta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null; }
  countGames() { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM games').get().n); }
  countProfiles() { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n); }

  ensureInventory(legacyPath) {
    if (this.countGames() > 0 || !legacyPath || path.resolve(legacyPath) === path.resolve(this.filename)) return null;
    const result = importLegacyInventory(this.db, legacyPath);
    this.setMeta('legacy_import_result', asJson(result));
    if (result.sourceTable) this.setMeta('legacy_source_table', result.sourceTable);
    return result;
  }

  reimportInventory(legacyPath) {
    const result = importLegacyInventory(this.db, legacyPath);
    this.setMeta('legacy_import_result', asJson(result));
    if (result.sourceTable) this.setMeta('legacy_source_table', result.sourceTable);
    return result;
  }

  libraryStatus() {
    const inventory = this.countGames();
    const analyzed = this.countProfiles();
    const selected = Number(this.db.prepare('SELECT COUNT(*) AS n FROM work_batch').get().n);
    const importResult = parseJson(this.getMeta('legacy_import_result'), null);
    return { inventory, analyzed, documented: analyzed, selected, selectionLimit: 50, aiKnowledgeFresh: true, historicalAiImported: false, importResult };
  }

  listGames({ q = '', status = 'all', limit = 48, offset = 0 } = {}) {
    limit = Math.min(100, Math.max(1, Number(limit) || 48)); offset = Math.max(0, Number(offset) || 0);
    const where = []; const params = [];
    if (q) { where.push('(g.title LIKE ? OR g.studio LIKE ? OR g.genres LIKE ? OR g.app_id LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like); }
    if (status === 'analyzed') where.push('p.app_id IS NOT NULL');
    if (status === 'inventoried') where.push('p.app_id IS NULL');
    if (status === 'selected') where.push('w.app_id IS NOT NULL');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN work_batch w ON w.app_id=g.app_id ${clause}`).get(...params).n);
    const items = this.db.prepare(`
      SELECT g.*,CASE WHEN p.app_id IS NULL THEN 'inventoried' ELSE 'analyzed' END AS status,
             CASE WHEN w.app_id IS NULL THEN 0 ELSE 1 END AS selected,p.confidence,p.updated_at AS profile_updated_at
      FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN work_batch w ON w.app_id=g.app_id
      ${clause} ORDER BY g.title COLLATE NOCASE LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(this.hydrateGame);
    return { items, total, limit, offset };
  }

  hydrateGame(row) { return { ...row, selected: Boolean(row.selected), inventoryMetadata: parseJson(row.inventory_metadata_json, {}) }; }
  getGame(appId) {
    const row = this.db.prepare(`SELECT g.*,CASE WHEN p.app_id IS NULL THEN 'inventoried' ELSE 'analyzed' END AS status,CASE WHEN w.app_id IS NULL THEN 0 ELSE 1 END AS selected,p.confidence,p.updated_at AS profile_updated_at FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN work_batch w ON w.app_id=g.app_id WHERE g.app_id=?`).get(String(appId));
    return row ? this.hydrateGame(row) : null;
  }

  getBatch() { return this.db.prepare('SELECT g.*,1 AS selected,CASE WHEN p.app_id IS NULL THEN \'inventoried\' ELSE \'analyzed\' END AS status FROM work_batch w JOIN games g ON g.app_id=w.app_id LEFT JOIN profiles p ON p.app_id=g.app_id ORDER BY w.selected_at').all().map(this.hydrateGame); }
  setBatchItem(appId, selected) {
    if (!this.getGame(appId)) throw Object.assign(new Error('Jeu introuvable'), { statusCode: 404 });
    if (selected) {
      if (this.getBatch().length >= 50 && !this.db.prepare('SELECT 1 FROM work_batch WHERE app_id=?').get(String(appId))) throw Object.assign(new Error('Le lot est limité à 50 jeux'), { statusCode: 409 });
      this.db.prepare("INSERT OR IGNORE INTO work_batch(app_id) VALUES(?)").run(String(appId));
    } else this.db.prepare('DELETE FROM work_batch WHERE app_id=?').run(String(appId));
    return this.getBatch();
  }
  clearBatch() { this.db.exec('DELETE FROM work_batch'); }

  createRun(config) {
    const batch = this.getBatch();
    if (!batch.length) throw Object.assign(new Error('Sélectionnez au moins un jeu'), { statusCode: 400 });
    const result = this.db.prepare("INSERT INTO enrichment_runs(status,selected_count,analysis_model,embedding_model) VALUES('running',?,?,?)").run(batch.length, config.analysisModel, config.embeddingModel);
    const id = Number(result.lastInsertRowid); const insert = this.db.prepare('INSERT INTO enrichment_items(run_id,app_id) VALUES(?,?)');
    for (const game of batch) insert.run(id, game.app_id);
    return this.getRun(id);
  }
  getRun(id) {
    const run = this.db.prepare('SELECT * FROM enrichment_runs WHERE id=?').get(Number(id));
    if (!run) return null;
    run.items = this.db.prepare('SELECT i.*,g.title,g.cover_url FROM enrichment_items i JOIN games g ON g.app_id=i.app_id WHERE i.run_id=? ORDER BY i.rowid').all(Number(id));
    return run;
  }
  latestRun() { const row = this.db.prepare('SELECT id FROM enrichment_runs ORDER BY id DESC LIMIT 1').get(); return row ? this.getRun(row.id) : null; }
  resumableRun() { const row = this.db.prepare("SELECT id FROM enrichment_runs WHERE status='paused' ORDER BY id DESC LIMIT 1").get(); return row ? this.getRun(row.id) : null; }
  setRunStatus(id, status, patch = {}) {
    const allowed = { current_app_id: patch.currentAppId ?? null, error: patch.error ?? null };
    const completedAt = ['completed','completed_with_errors','failed'].includes(status) ? "datetime('now')" : 'completed_at';
    this.db.prepare(`UPDATE enrichment_runs SET status=?,current_app_id=?,error=?,completed_at=${completedAt} WHERE id=?`).run(status, allowed.current_app_id, allowed.error, Number(id));
  }
  updateItem(runId, appId, patch) {
    const fields = []; const values = [];
    for (const [key, value] of Object.entries(patch)) { fields.push(`${key}=?`); values.push(value); }
    if (fields.length) this.db.prepare(`UPDATE enrichment_items SET ${fields.join(',')} WHERE run_id=? AND app_id=?`).run(...values, Number(runId), String(appId));
    const counts = this.db.prepare("SELECT SUM(status='completed') AS completed,SUM(status='failed') AS failed FROM enrichment_items WHERE run_id=?").get(Number(runId));
    this.db.prepare('UPDATE enrichment_runs SET completed_count=?,failed_count=? WHERE id=?').run(Number(counts.completed || 0), Number(counts.failed || 0), Number(runId));
  }

  saveProfile(appId, { profile, embedding, sources, analysisModel, embeddingModel }) {
    const confidence = Math.max(0, Math.min(1, Number(profile.confidence) || 0));
    this.db.prepare(`INSERT INTO profiles(app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET schema_version=excluded.schema_version,profile_json=excluded.profile_json,
      embedding_json=excluded.embedding_json,source_json=excluded.source_json,analysis_model=excluded.analysis_model,embedding_model=excluded.embedding_model,
      confidence=excluded.confidence,updated_at=datetime('now')`).run(String(appId), 'backlog-core-profile/1.0', asJson(profile), embedding ? asJson(embedding) : null, asJson(sources), analysisModel, embeddingModel, confidence);
  }
  getProfile(appId) { const row = this.db.prepare('SELECT * FROM profiles WHERE app_id=?').get(String(appId)); return row ? { ...row, profile: parseJson(row.profile_json, {}), embedding: parseJson(row.embedding_json, null), sources: parseJson(row.source_json, []) } : null; }
  allProfiles(excludeAppId) { return this.db.prepare('SELECT p.*,g.title,g.studio,g.genres,g.cover_url FROM profiles p JOIN games g ON g.app_id=p.app_id WHERE p.app_id<>?').all(String(excludeAppId)).map((r) => ({ ...r, profile: parseJson(r.profile_json, {}), embedding: parseJson(r.embedding_json, null) })); }
  feedback(referenceAppId) { return this.db.prepare('SELECT * FROM discovery_feedback WHERE reference_app_id=?').all(String(referenceAppId)); }
  saveFeedback(data) { this.db.prepare(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,note) VALUES(?,?,?,?,?) ON CONFLICT(reference_app_id,candidate_app_id,motivation_key) DO UPDATE SET verdict=excluded.verdict,note=excluded.note,updated_at=datetime('now')`).run(String(data.referenceAppId), String(data.candidateAppId), String(data.motivationKey || ''), data.verdict, data.note || null); return data; }
  saveDiscovery(referenceAppId, motivationText, motivations, results) { const r = this.db.prepare('INSERT INTO discovery_sessions(reference_app_id,motivation_text,motivations_json,results_json) VALUES(?,?,?,?)').run(String(referenceAppId), motivationText, asJson(motivations), asJson(results)); return Number(r.lastInsertRowid); }
}

module.exports = { CoreDatabase, parseJson };
