import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, CORE_CONTRACT, quickCheck } from '../src/db.js';
import { createFaithfulV1Database, tempDatabase, insertProfile } from './helpers.js';

const protectedTables = ['games','profiles','discovery_feedback','discovery_sessions','enrichment_campaign','enrichment_items','enrichment_jobs','enrichment_runs','meta','schema_migrations','work_batch'];

function snapshot(db) {
  return Object.fromEntries(protectedTables.map((table) => [table, {
    sql: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql,
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    rows: db.prepare(`SELECT * FROM ${table}`).all()
  }]));
}

test('migration additive: conserve byte-for-byte les structures et données métier V1.0', () => {
  const temp = tempDatabase();
  const fixture = createFaithfulV1Database(temp.file, 3);
  insertProfile(fixture, '1001');
  fixture.prepare("INSERT INTO discovery_feedback VALUES ('1001','1002','motivation','positive','note',datetime('now'))").run();
  fixture.prepare("INSERT INTO discovery_sessions (reference_app_id,motivation_text,motivations_json,results_json) VALUES ('1001','explorer','{}','[]')").run();
  const before = snapshot(fixture);
  fixture.close();

  const db = openDatabase(temp.file);
  const after = snapshot(db);
  assert.deepEqual(after, before);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'autonomous_enrichment_%' ORDER BY name").all().map((r) => r.name), ['autonomous_enrichment_control','autonomous_enrichment_items']);
  assert.equal(quickCheck(db).ok, true);
  for (const [table, contract] of Object.entries(CORE_CONTRACT)) {
    const columns = Object.fromEntries(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => [c.name, c.type]));
    for (const [name, type] of Object.entries(contract)) assert.equal(columns[name], type);
  }
  db.close(); temp.cleanup();
});

test('migration réexécutable sans duplication', () => {
  const temp = tempDatabase(); createFaithfulV1Database(temp.file, 2).close();
  let db = openDatabase(temp.file); db.close();
  db = openDatabase(temp.file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM autonomous_enrichment_control').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'autonomous_enrichment_%'").get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n, 2);
  db.close(); temp.cleanup();
});

test('refuse clairement le schéma V1.1 incompatible au lieu de modifier les données', () => {
  const temp = tempDatabase();
  const raw = new DatabaseSync(temp.file); raw.exec('CREATE TABLE games (app_id INTEGER PRIMARY KEY, name TEXT, developer TEXT)'); raw.close();
  assert.throws(() => openDatabase(temp.file), /Base V1\.0 incompatible/);
  const check = new DatabaseSync(temp.file, { readOnly: true });
  assert.deepEqual(check.prepare('PRAGMA table_info(games)').all().map((c) => c.name), ['app_id','name','developer']);
  check.close(); temp.cleanup();
});
