import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

export function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-core-')); }
export function v1Database(file, seed = true) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE games (app_id TEXT PRIMARY KEY,title TEXT NOT NULL,studio TEXT,genres TEXT,cover_url TEXT,description TEXT,playtime_minutes INTEGER,last_played_at TEXT,inventory_metadata_json TEXT NOT NULL DEFAULT '{}',source_table TEXT,imported_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE profiles (app_id TEXT PRIMARY KEY,schema_version TEXT NOT NULL,profile_json TEXT NOT NULL,embedding_json TEXT,source_json TEXT NOT NULL,analysis_model TEXT,embedding_model TEXT,confidence REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE discovery_feedback (reference_app_id TEXT NOT NULL,candidate_app_id TEXT NOT NULL,motivation_key TEXT NOT NULL DEFAULT '',verdict TEXT NOT NULL,note TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(reference_app_id,candidate_app_id,motivation_key));
    CREATE TABLE discovery_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,reference_app_id TEXT NOT NULL,motivation_text TEXT NOT NULL,motivations_json TEXT NOT NULL,results_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE enrichment_items(id INTEGER PRIMARY KEY, legacy TEXT);
    CREATE TABLE enrichment_runs(id INTEGER PRIMARY KEY, legacy TEXT);
  `);
  if (seed) {
    db.prepare("INSERT INTO games(app_id,title,studio,genres,cover_url,inventory_metadata_json) VALUES('10','Alpha','Studio A','Action','https://example.test/alpha.jpg','{\"playtime_forever\":42}'),('20','Beta','Studio B','Puzzle',NULL,'{}'),('30','Gamma','Studio C','RPG',NULL,'{}')").run();
    db.prepare("INSERT INTO profiles(app_id,schema_version,profile_json,embedding_json,source_json,confidence) VALUES('10','core-v1','{\"summary\":\"Rapide\"}','[1,0,0]','{}',0.9)").run();
    db.prepare("INSERT INTO discovery_feedback VALUES('10','20','calme','positive','bon',datetime('now'))").run();
  }
  db.close();
  return openDatabase(file);
}
export async function until(check, timeout = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 15)); }
  throw new Error('Condition non atteinte avant expiration.');
}
