import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function temporaryDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-historical-hotfix-')); }
export function fileHash(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
export function businessHash(db) {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare('SELECT g.app_id,g.title,g.cover_url,g.description,p.profile_json,p.embedding_json,p.source_json FROM games g JOIN profiles p ON p.app_id=g.app_id ORDER BY CAST(g.app_id AS INTEGER)').iterate()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}
export function createHistorical114Fixture(filename, count = 4321) {
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE games (
      app_id TEXT PRIMARY KEY,title TEXT NOT NULL,studio TEXT,genres TEXT,cover_url TEXT,description TEXT,
      playtime_minutes INTEGER,last_played_at TEXT,inventory_metadata_json TEXT NOT NULL DEFAULT '{}',source_table TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE profiles (
      app_id TEXT PRIMARY KEY,schema_version TEXT NOT NULL,profile_json TEXT NOT NULL,embedding_json TEXT,
      source_json TEXT NOT NULL,analysis_model TEXT,embedding_model TEXT,confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE discovery_feedback (
      reference_app_id TEXT NOT NULL,candidate_app_id TEXT NOT NULL,motivation_key TEXT NOT NULL DEFAULT '',verdict TEXT NOT NULL,
      note TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(reference_app_id,candidate_app_id,motivation_key)
    );
    CREATE TABLE discovery_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,reference_app_id TEXT NOT NULL,motivation_text TEXT NOT NULL,
      motivations_json TEXT NOT NULL,results_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE core_background_campaign (id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE core_background_queue (app_id TEXT PRIMARY KEY,status TEXT,attempts INTEGER,current_step TEXT,error TEXT,queued_at TEXT,started_at TEXT,finished_at TEXT,duration_ms INTEGER);
  `);
  const game = db.prepare('INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,inventory_metadata_json,source_table) VALUES (?,?,?,?,?,?,?,?,?)');
  const profile = db.prepare('INSERT INTO profiles(app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence) VALUES (?,\'core-v1\',?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 1; i <= count; i += 1) {
    const id = String(100000 + i);
    const storedCover = i === 2 ? `https://example.invalid/${id}.jpg` : null;
    const storedDescription = i === 2 ? `Description historique ${i}` : null;
    game.run(id, `Jeu ${i}`, `Studio ${i % 17}`, JSON.stringify([`Genre ${i % 9}`]), storedCover, storedDescription, i * 3, JSON.stringify({ source: 'steam', ordinal: i }), 'steam');
    profile.run(id, JSON.stringify({ summary: `Résumé enrichi historique ${i}`, motivations: [{ label: 'Exploration', evidence: `preuve-${i}` }] }), JSON.stringify([0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]), JSON.stringify({ description: `Description source ${i}`, steam: { short_description: `Steam ${i}` } }), 'qwen3:32b', 'embeddinggemma', 0.78);
  }
  db.exec('COMMIT');
  return db;
}
