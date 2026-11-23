import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function columns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); }
  catch { return new Set(); }
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      app_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      studio TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      playtime_minutes INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      inventory_json TEXT,
      steam_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS profiles (
      app_id TEXT PRIMARY KEY,
      profile_json TEXT,
      embedding_json TEXT,
      schema_version TEXT NOT NULL DEFAULT 'core-v1',
      analysis_model TEXT,
      embedding_model TEXT,
      confidence REAL,
      source_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS discovery_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_app_id TEXT NOT NULL DEFAULT '',
      candidate_app_id TEXT NOT NULL,
      motivation_key TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL CHECK(verdict IN ('positive','negative')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_candidate ON discovery_feedback(candidate_app_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS enrichment_queue (
      app_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','error')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      locked_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS game_user_state (
      app_id TEXT PRIMARY KEY,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS recommendation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_key TEXT NOT NULL,
      reference_app_id TEXT NOT NULL DEFAULT '',
      motivation_key TEXT NOT NULL DEFAULT '',
      candidate_app_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      similarity REAL,
      profile_quality REAL,
      presented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_app_id) REFERENCES games(app_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_history_candidate_date ON recommendation_history(candidate_app_id, presented_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_request ON recommendation_history(request_key, presented_at DESC);
  `);

  // Migrations additives pour les bases V1.1.x dont les tables existent déjà.
  for (const definition of [
    "studio TEXT NOT NULL DEFAULT ''", "genres TEXT NOT NULL DEFAULT ''", "cover_url TEXT NOT NULL DEFAULT ''",
    "description TEXT NOT NULL DEFAULT ''", 'playtime_minutes INTEGER NOT NULL DEFAULT 0', 'last_played_at TEXT',
    'inventory_json TEXT', 'steam_json TEXT', 'created_at TEXT', 'updated_at TEXT'
  ]) addColumn(db, 'games', definition);
  for (const definition of [
    'schema_version TEXT', 'analysis_model TEXT', 'embedding_model TEXT', 'confidence REAL', 'source_json TEXT',
    'created_at TEXT', 'updated_at TEXT'
  ]) addColumn(db, 'profiles', definition);
  for (const definition of [
    "reference_app_id TEXT NOT NULL DEFAULT ''", 'candidate_app_id TEXT', "motivation_key TEXT NOT NULL DEFAULT ''",
    'verdict TEXT', 'created_at TEXT'
  ]) addColumn(db, 'discovery_feedback', definition);
  for (const definition of [
    "status TEXT NOT NULL DEFAULT 'pending'", 'attempts INTEGER NOT NULL DEFAULT 0', 'last_error TEXT',
    'locked_at TEXT', 'updated_at TEXT'
  ]) addColumn(db, 'enrichment_queue', definition);

  // Reprend les corrections enregistrées par certaines préversions qui utilisaient la table `feedback`.
  const legacyFeedback = db.prepare("SELECT 1 found FROM sqlite_master WHERE type='table' AND name='feedback'").get();
  if (legacyFeedback) {
    const legacyColumns = columns(db, 'feedback');
    if (legacyColumns.has('candidate_app_id') && legacyColumns.has('verdict')) {
      const reference = legacyColumns.has('reference_app_id') ? "COALESCE(CAST(f.reference_app_id AS TEXT),'')" : "''";
      const motivation = legacyColumns.has('motivation_key') ? "COALESCE(f.motivation_key,'')" : "''";
      const created = legacyColumns.has('created_at') ? 'f.created_at' : 'CURRENT_TIMESTAMP';
      db.exec(`
        INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,created_at)
        SELECT ${reference},CAST(f.candidate_app_id AS TEXT),${motivation},f.verdict,${created}
        FROM feedback f
        WHERE f.verdict IN ('positive','negative')
          AND NOT EXISTS (
            SELECT 1 FROM discovery_feedback d
            WHERE d.reference_app_id=${reference} AND CAST(d.candidate_app_id AS TEXT)=CAST(f.candidate_app_id AS TEXT)
              AND d.motivation_key=${motivation} AND d.verdict=f.verdict
          );
      `);
    }
  }

  db.exec(`
    INSERT OR IGNORE INTO game_user_state(app_id, completed, updated_at)
      SELECT app_id, 0, CURRENT_TIMESTAMP FROM games;
    INSERT OR IGNORE INTO app_settings(key,value) VALUES ('enrichment_paused','0');
    UPDATE enrichment_queue SET status='pending', locked_at=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE status='running' AND (locked_at IS NULL OR datetime(locked_at) < datetime('now','-30 minutes'));
  `);
}

export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
