import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const V1_REQUIRED = {
  games: ['app_id', 'title', 'studio', 'genres', 'cover_url', 'description', 'playtime_minutes', 'last_played_at', 'inventory_metadata_json', 'source_table', 'imported_at', 'updated_at'],
  profiles: ['app_id', 'schema_version', 'profile_json', 'embedding_json', 'source_json', 'analysis_model', 'embedding_model', 'confidence', 'created_at', 'updated_at'],
  discovery_feedback: ['reference_app_id', 'candidate_app_id', 'motivation_key', 'verdict', 'note', 'updated_at'],
  discovery_sessions: ['id', 'reference_app_id', 'motivation_text', 'motivations_json', 'results_json', 'created_at']
};

export function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function createV1Base(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
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
    CREATE TABLE IF NOT EXISTS profiles (
      app_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      embedding_json TEXT,
      source_json TEXT NOT NULL,
      analysis_model TEXT,
      embedding_model TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS discovery_feedback (
      reference_app_id TEXT NOT NULL,
      candidate_app_id TEXT NOT NULL,
      motivation_key TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(reference_app_id, candidate_app_id, motivation_key)
    );
    CREATE TABLE IF NOT EXISTS discovery_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_app_id TEXT NOT NULL,
      motivation_text TEXT NOT NULL,
      motivations_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
}

export function assertV1Compatibility(db) {
  for (const [table, expected] of Object.entries(V1_REQUIRED)) {
    if (!hasTable(db, table)) continue;
    const actual = columns(db, table);
    const missing = expected.filter((name) => !actual.includes(name));
    if (missing.length) {
      throw new Error(`Schéma SQLite incompatible pour ${table}. Colonnes V1.0 manquantes: ${missing.join(', ')}. Aucune donnée n’a été modifiée.`);
    }
  }
}

export function migrateAdditively(db) {
  assertV1Compatibility(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    createV1Base(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS core_background_campaign (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','pausing','paused','completed','completed_with_errors')),
        pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1)),
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        current_app_id TEXT,
        current_step TEXT,
        last_error TEXT
      );
      INSERT OR IGNORE INTO core_background_campaign (id, status) VALUES (1, 'idle');
      CREATE TABLE IF NOT EXISTS core_background_queue (
        app_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        current_step TEXT,
        error TEXT,
        queued_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_core_background_queue_status ON core_background_queue(status, queued_at);
    `);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrateAdditively(db);
  return db;
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function json(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || null;
}
