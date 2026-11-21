import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS games (
      app_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cover_url TEXT,
      developer TEXT,
      genres TEXT,
      playtime_minutes INTEGER,
      source TEXT NOT NULL DEFAULT 'legacy',
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      app_id INTEGER PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,
      schema_version TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      model TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      source_json TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enrichment_campaign (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','pausing','paused','completed','completed_with_errors')),
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      current_app_id INTEGER REFERENCES games(app_id),
      current_step TEXT,
      last_error TEXT
    );

    INSERT OR IGNORE INTO enrichment_campaign (id, status) VALUES (1, 'idle');

    CREATE TABLE IF NOT EXISTS enrichment_jobs (
      app_id INTEGER PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      error TEXT,
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS discovery_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES games(app_id) ON DELETE CASCADE,
      motivation TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('positive','negative','neutral')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON enrichment_jobs(status, queued_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_app ON discovery_feedback(app_id, created_at);
  `);
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function json(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function closeDatabase(db) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  db.close();
}
