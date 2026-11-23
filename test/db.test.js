import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db.js';

test('la migration additive préserve une base V1.1 minimale', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE games(app_id INTEGER PRIMARY KEY,title TEXT);
    CREATE TABLE profiles(app_id INTEGER PRIMARY KEY,profile_json TEXT,embedding_json TEXT);
    CREATE TABLE enrichment_queue(app_id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE feedback(candidate_app_id TEXT,reference_app_id TEXT,motivation_key TEXT,verdict TEXT,created_at TEXT);
    INSERT INTO games VALUES(42,'Jeu conservé');
    INSERT INTO profiles VALUES(42,'{"summary":"profil conservé"}','[1,0]');
    INSERT INTO feedback VALUES('42','','test','positive',CURRENT_TIMESTAMP);
  `);
  migrate(db);
  assert.equal(db.prepare('SELECT title FROM games WHERE app_id=42').get().title, 'Jeu conservé');
  assert.match(db.prepare('SELECT profile_json FROM profiles WHERE app_id=42').get().profile_json, /conservé/);
  assert.equal(db.prepare('SELECT completed FROM game_user_state WHERE app_id=42').get().completed, 0);
  assert.equal(db.prepare('SELECT verdict FROM discovery_feedback WHERE candidate_app_id=?').get('42').verdict, 'positive');
  db.close();
});

test('la migration est idempotente', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); migrate(db);
  const tables = db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('game_user_state','recommendation_history')").get().count;
  assert.equal(tables, 2); db.close();
});
