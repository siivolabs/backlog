import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CORE_CONTRACT = Object.freeze({
  games: {
    app_id: 'TEXT', title: 'TEXT', studio: 'TEXT', genres: 'TEXT', cover_url: 'TEXT',
    description: 'TEXT', playtime_minutes: 'INTEGER', last_played_at: 'TEXT',
    inventory_metadata_json: 'TEXT', source_table: 'TEXT', imported_at: 'TEXT', updated_at: 'TEXT'
  },
  profiles: {
    app_id: 'TEXT', schema_version: 'TEXT', profile_json: 'TEXT', embedding_json: 'TEXT',
    source_json: 'TEXT', analysis_model: 'TEXT', embedding_model: 'TEXT', confidence: 'REAL',
    created_at: 'TEXT', updated_at: 'TEXT'
  },
  discovery_feedback: {
    reference_app_id: 'TEXT', candidate_app_id: 'TEXT', motivation_key: 'TEXT',
    verdict: 'TEXT', note: 'TEXT', updated_at: 'TEXT'
  },
  discovery_sessions: {
    id: 'INTEGER', reference_app_id: 'TEXT', motivation_text: 'TEXT',
    motivations_json: 'TEXT', results_json: 'TEXT', created_at: 'TEXT'
  }
});

const BASE_SCHEMA = `
  CREATE TABLE games (
    app_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    studio TEXT,
    genres TEXT,
    cover_url TEXT,
    description TEXT,
    playtime_minutes INTEGER,
    last_played_at TEXT,
    inventory_metadata_json TEXT NOT NULL DEFAULT '{}',
    source_table TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE profiles (
    app_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    embedding_json TEXT,
    source_json TEXT NOT NULL,
    analysis_model TEXT,
    embedding_model TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES games(app_id) ON DELETE CASCADE
  );
  CREATE TABLE discovery_feedback (
    reference_app_id TEXT NOT NULL,
    candidate_app_id TEXT NOT NULL,
    motivation_key TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL,
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (reference_app_id, candidate_app_id, motivation_key)
  );
  CREATE TABLE discovery_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_app_id TEXT NOT NULL,
    motivation_text TEXT NOT NULL,
    motivations_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const ADDITIVE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS autonomous_enrichment_control (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    desired_state TEXT NOT NULL DEFAULT 'paused' CHECK (desired_state IN ('paused','running')),
    lifecycle TEXT NOT NULL DEFAULT 'idle' CHECK (lifecycle IN ('idle','running','pausing','paused','completed','completed_with_errors')),
    current_app_id TEXT,
    current_step TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    heartbeat_at TEXT,
    last_error TEXT
  );
  INSERT OR IGNORE INTO autonomous_enrichment_control (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS autonomous_enrichment_items (
    app_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','error')),
    attempts INTEGER NOT NULL DEFAULT 0,
    current_step TEXT,
    last_error TEXT,
    queued_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (app_id) REFERENCES games(app_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_autonomous_items_status
    ON autonomous_enrichment_items(status, queued_at, app_id);
`;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function tableInfo(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all();
}

function validateTable(db, table, contract) {
  if (!tableExists(db, table)) throw new Error(`Base V1.0 incompatible : table ${table} absente.`);
  const actual = new Map(tableInfo(db, table).map((column) => [column.name, String(column.type || '').toUpperCase()]));
  const problems = [];
  for (const [name, type] of Object.entries(contract)) {
    if (!actual.has(name)) problems.push(`${name} absente`);
    else if (actual.get(name) !== type) problems.push(`${name} attendue ${type}, reçue ${actual.get(name) || '(sans type)'}`);
  }
  if (problems.length) throw new Error(`Base V1.0 incompatible — ${table}: ${problems.join(', ')}.`);
}

export function validateV1Contract(db) {
  for (const [table, columns] of Object.entries(CORE_CONTRACT)) validateTable(db, table, columns);
  return true;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function migrateAdditively(db) {
  const hasAnyCore = ['games', 'profiles', 'discovery_feedback', 'discovery_sessions'].some((name) => tableExists(db, name));
  if (!hasAnyCore) db.exec(BASE_SCHEMA);
  validateV1Contract(db);
  db.exec(ADDITIVE_SCHEMA);
  return { coreTablesPreserved: true, addedTables: ['autonomous_enrichment_control', 'autonomous_enrichment_items'] };
}

export function openDatabase(databasePath, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateAdditively(db);
  }
  return db;
}

export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function quickCheck(db) {
  const result = db.prepare('PRAGMA quick_check').all().map((row) => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  return { ok: result.length === 1 && result[0] === 'ok' && foreignKeys.length === 0, quickCheck: result, foreignKeyErrors: foreignKeys };
}
