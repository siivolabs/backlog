import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateAdditively, tableSql } from '../src/db.js';
import { tempDir, v1Database } from './helpers.js';

test('migration additive conserve les structures et données métier V1.0', () => {
  const file = path.join(tempDir(), 'v1.sqlite');
  let db = v1Database(file);
  db.close();
  const raw = new DatabaseSync(file);
  const tables = ['games','profiles','discovery_feedback','discovery_sessions','enrichment_items','enrichment_runs'];
  const beforeSql = Object.fromEntries(tables.map((name) => [name, tableSql(raw, name)]));
  const beforeRows = JSON.stringify(raw.prepare('SELECT * FROM games ORDER BY app_id').all());
  migrateAdditively(raw);
  assert.deepEqual(Object.fromEntries(tables.map((name) => [name, tableSql(raw, name)])), beforeSql);
  assert.equal(JSON.stringify(raw.prepare('SELECT * FROM games ORDER BY app_id').all()), beforeRows);
  assert.ok(tableSql(raw, 'core_background_campaign'));
  assert.ok(tableSql(raw, 'core_background_queue'));
  raw.close();
});

test('migration est réexécutable sans duplication', () => {
  const file = path.join(tempDir(), 'twice.sqlite'); const db = v1Database(file);
  migrateAdditively(db); migrateAdditively(db);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM core_background_campaign').get().count), 1);
  db.close();
});

test('schéma V1.1 incompatible est refusé sans conversion destructive', () => {
  const file = path.join(tempDir(), 'bad.sqlite'); const db = new DatabaseSync(file);
  db.exec('CREATE TABLE games(app_id INTEGER PRIMARY KEY,name TEXT NOT NULL);');
  assert.throws(() => migrateAdditively(db), /V1\.0 manquantes/);
  assert.deepEqual(db.prepare('PRAGMA table_info(games)').all().map((row) => row.name), ['app_id','name']);
  db.close();
});
