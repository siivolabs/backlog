import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function temporaryDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-v121-')); }
export function checksumRows(db) {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare('SELECT g.app_id,g.title,p.profile_json,p.embedding_json FROM games g JOIN profiles p ON p.app_id=g.app_id ORDER BY CAST(g.app_id AS INTEGER)').iterate()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}
export function createRealCoreFixture(filename, count = 4321) {
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE games (
      app_id TEXT PRIMARY KEY,title TEXT NOT NULL,studio TEXT,genres TEXT,cover_url TEXT,description TEXT,
      playtime_minutes INTEGER,last_played_at TEXT,inventory_metadata_json TEXT NOT NULL DEFAULT '{}',source_table TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE profiles (
      app_id TEXT PRIMARY KEY,profile_json TEXT,embedding_json TEXT,analysis_model TEXT,embedding_model TEXT,confidence REAL,
      updated_at TEXT,FOREIGN KEY(app_id) REFERENCES games(app_id)
    );
    CREATE TABLE discovery_feedback (
      id INTEGER PRIMARY KEY,reference_app_id TEXT,candidate_app_id TEXT,motivation_key TEXT,verdict TEXT,note TEXT,updated_at TEXT
    );
    CREATE TABLE enrichment_queue (game_id TEXT PRIMARY KEY,status TEXT,attempts INTEGER,last_error TEXT,updated_at TEXT);
    CREATE TABLE recommendation_history (id INTEGER PRIMARY KEY,app_id TEXT,created_at TEXT);
    CREATE TABLE autonomous_enrichment_control (id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE autonomous_enrichment_items (id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE enrichment_campaign (id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE enrichment_items (id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE enrichment_jobs (id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE enrichment_runs (id INTEGER PRIMARY KEY,value TEXT);
  `);
  const game = db.prepare('INSERT INTO games(app_id,title,studio,genres,description,playtime_minutes,inventory_metadata_json) VALUES (?,?,?,?,?,?,?)');
  const profile = db.prepare('INSERT INTO profiles(app_id,profile_json,embedding_json,analysis_model,embedding_model,confidence,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)');
  db.exec('BEGIN');
  for (let i = 1; i <= count; i += 1) {
    const id = String(100000 + i);
    game.run(id, `Jeu ${i}`, i % 3 ? `Studio ${i % 17}` : '', JSON.stringify([`Genre ${i % 9}`]), `Profil descriptif du jeu ${i}`, i * 3, JSON.stringify({ source: 'steam', ordinal: i }));
    profile.run(id, JSON.stringify({ summary: `Expérience ${i}`, evidence: [`source-${i}`] }), JSON.stringify([0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]), 'test-analysis', 'test-embedding', 0.78);
  }
  db.exec("INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,note,updated_at) VALUES ('','100001','court','positive','conserver',CURRENT_TIMESTAMP)");
  db.exec("INSERT INTO enrichment_queue(game_id,status,attempts,updated_at) VALUES ('100001','running',1,datetime('now','-2 hours'))");
  db.exec("INSERT INTO recommendation_history(app_id,created_at) VALUES ('100002',CURRENT_TIMESTAMP)");
  db.exec('COMMIT');
  return db;
}
