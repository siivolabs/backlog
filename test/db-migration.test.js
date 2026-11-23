import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { columns, migrate, openDatabase, SCHEMA_VERSION } from '../src/db.js';
import { checksumRows, createRealCoreFixture, temporaryDirectory } from './helpers.js';

test('migre la structure Core réelle de 4 321 jeux sans modifier les jeux ni les profils', () => {
  const directory = temporaryDirectory(); const filename = path.join(directory, 'backlog-core.sqlite');
  const original = createRealCoreFixture(filename);
  const before = checksumRows(original); original.close();

  const db = openDatabase(filename);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM games').get().total, 4321);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM profiles').get().total, 4321);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM game_user_state').get().total, 4321);
  assert.equal(checksumRows(db), before);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(columns(db, 'discovery_feedback').has('created_at'));
  assert.ok(columns(db, 'enrichment_queue').has('app_id'));
  assert.ok(columns(db, 'recommendation_history').has('candidate_app_id'));
  assert.equal(db.prepare("SELECT status FROM enrichment_queue WHERE app_id='100001'").get().status, 'pending');
  assert.equal(db.prepare("SELECT candidate_app_id FROM recommendation_history WHERE id=1").get().candidate_app_id, '100002');
  assert.ok(db.migrationBackupPath && fs.existsSync(db.migrationBackupPath));

  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM game_user_state').get().total, 4321);
  assert.equal(checksumRows(db), before);
  db.close();
});

test('adapte aussi une table historique games.appid de façon additive', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE games(appid INTEGER PRIMARY KEY,name TEXT NOT NULL,playtime_forever INTEGER NOT NULL DEFAULT 0,rtime_last_played INTEGER NOT NULL DEFAULT 0); INSERT INTO games VALUES (400,'Portal',123,0)");
  migrate(db);
  const row = db.prepare("SELECT app_id,title,playtime_minutes FROM games WHERE appid=400").get();
  assert.deepEqual({ ...row }, { app_id: '400', title: 'Portal', playtime_minutes: 123 });
  assert.equal(db.prepare("SELECT COUNT(*) total FROM game_user_state WHERE app_id='400'").get().total, 1);
  db.close();
});

test('annule intégralement une migration incompatible', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE games(bad_identifier TEXT PRIMARY KEY,title TEXT); INSERT INTO games VALUES ('x','Intact')");
  assert.throws(() => migrate(db), /annulée sans perte de données/);
  assert.equal(db.prepare('SELECT title FROM games').get().title, 'Intact');
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sqlite_master WHERE type='table' AND name='profiles'").get().total, 0);
  db.close();
});
