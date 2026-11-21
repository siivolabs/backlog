import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function tempDatabase(name = 'backlog-core.sqlite') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-core-test-'));
  return { directory, file: path.join(directory, name), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

export function createFaithfulV1Database(file, games = 3) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE games (
      app_id TEXT PRIMARY KEY, title TEXT NOT NULL, studio TEXT, genres TEXT, cover_url TEXT,
      description TEXT, playtime_minutes INTEGER, last_played_at TEXT,
      inventory_metadata_json TEXT NOT NULL DEFAULT '{}', source_table TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE profiles (
      app_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, profile_json TEXT NOT NULL,
      embedding_json TEXT, source_json TEXT NOT NULL, analysis_model TEXT, embedding_model TEXT,
      confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    );
    CREATE TABLE discovery_feedback (
      reference_app_id TEXT NOT NULL, candidate_app_id TEXT NOT NULL, motivation_key TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL, note TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(reference_app_id,candidate_app_id,motivation_key)
    );
    CREATE TABLE discovery_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reference_app_id TEXT NOT NULL, motivation_text TEXT NOT NULL,
      motivations_json TEXT NOT NULL, results_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE enrichment_campaign (id INTEGER PRIMARY KEY, state TEXT, payload_json TEXT);
    CREATE TABLE enrichment_items (app_id TEXT PRIMARY KEY, state TEXT, payload_json TEXT);
    CREATE TABLE enrichment_jobs (id INTEGER PRIMARY KEY, app_id TEXT, state TEXT);
    CREATE TABLE enrichment_runs (id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);
    CREATE TABLE work_batch (id INTEGER PRIMARY KEY, payload_json TEXT);
  `);
  const insert = db.prepare(`INSERT INTO games (app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 1; i <= games; i += 1) insert.run(String(1000 + i), `Jeu ${i}`, `Studio ${i}`, JSON.stringify(['Genre']), `https://example.test/${i}.jpg`, `Description ${i}`, i * 60, `2026-01-0${i}`, JSON.stringify({ owned: true, index: i }), 'steam_games');
  db.prepare("INSERT INTO meta VALUES ('core_version','1.0')").run();
  db.prepare("INSERT INTO schema_migrations VALUES (1,'2026-01-01')").run();
  db.prepare("INSERT INTO enrichment_campaign VALUES (1,'idle','{}')").run();
  db.prepare("INSERT INTO enrichment_items VALUES ('1001','done','{\"legacy\":true}')").run();
  db.prepare("INSERT INTO enrichment_jobs VALUES (1,'1001','completed')").run();
  db.prepare("INSERT INTO enrichment_runs VALUES (1,'2026-01-01','2026-01-02')").run();
  db.prepare("INSERT INTO work_batch VALUES (1,'{}')").run();
  return db;
}

export const profileFor = (appId, vector = [1, 0, 0]) => ({
  schema_version: 'core-profile-1.0',
  profile_json: JSON.stringify({ summary: `Profil ${appId}`, experiential_axes: ['exploration'], confidence: 0.9 }),
  embedding_json: JSON.stringify(vector), source_json: JSON.stringify({ fixture: true }),
  analysis_model: 'fixture-analysis', embedding_model: 'fixture-embedding', confidence: 0.9
});

export function insertProfile(db, appId, vector = [1, 0, 0]) {
  const profile = profileFor(appId, vector);
  db.prepare(`INSERT INTO profiles (app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence) VALUES (?,?,?,?,?,?,?,?)`).run(appId, profile.schema_version, profile.profile_json, profile.embedding_json, profile.source_json, profile.analysis_model, profile.embedding_model, profile.confidence);
}

export async function waitFor(predicate, { timeout = 3000, interval = 10 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Condition non satisfaite en ${timeout} ms`);
}
