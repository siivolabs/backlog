import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrate, MIGRATION_VERSION } from '../src/db.js';

function fixture(file, invalidAppId = false) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE games (
      app_id TEXT PRIMARY KEY,title TEXT NOT NULL,studio TEXT,genres TEXT,cover_url TEXT,
      description TEXT,playtime_minutes INTEGER,last_played_at TEXT,
      inventory_metadata_json TEXT NOT NULL DEFAULT '{}',source_table TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE profiles (app_id TEXT PRIMARY KEY REFERENCES games(app_id),schema_version TEXT NOT NULL,pipeline_version TEXT NOT NULL,model TEXT NOT NULL,embedding_model TEXT NOT NULL,source_json TEXT NOT NULL,profile_json TEXT NOT NULL,embedding_json TEXT NOT NULL,created_at TEXT,updated_at TEXT);
    CREATE TABLE enrichment_campaign (id INTEGER PRIMARY KEY,status TEXT,started_at TEXT,completed_at TEXT,updated_at TEXT,current_app_id TEXT,current_step TEXT,last_error TEXT);
    CREATE TABLE enrichment_jobs (app_id TEXT PRIMARY KEY REFERENCES games(app_id),status TEXT,attempts INTEGER,current_step TEXT,error TEXT,queued_at TEXT,started_at TEXT,finished_at TEXT,duration_ms INTEGER);
    CREATE TABLE discovery_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT,app_id TEXT REFERENCES games(app_id),motivation TEXT,verdict TEXT,note TEXT,created_at TEXT);
    CREATE TABLE discovery_sessions (id INTEGER PRIMARY KEY,motivation TEXT,confirmed_motivation TEXT,created_at TEXT);
    CREATE TABLE enrichment_items (id INTEGER PRIMARY KEY,app_id TEXT,payload TEXT);
    CREATE TABLE enrichment_runs (id INTEGER PRIMARY KEY,status TEXT,stats_json TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT);
    CREATE TABLE work_batch (id INTEGER PRIMARY KEY,state_json TEXT);
  `);
  const id1 = invalidAppId ? 'steam-10' : '10';
  db.prepare(`INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table,imported_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id1,'Outer Wilds','Mobius Digital','Exploration','https://img/10.jpg','Un système solaire en boucle.',900,'2026-01-02','{"owned":true}','steam_library','2026-01-01','2026-01-03');
  db.prepare(`INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('20','Superliminal','Pillow Castle','Puzzle','https://img/20.jpg','Perspective.',120,null,'{"deck":true}','steam_library');
  db.prepare(`INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id1,'core-1','1.0.0','qwen','embed','{"steam":1}','{"summary":"Exploration curieuse","intentions":["comprendre"]}','[0.1,0.2]','2026-02-01','2026-02-02');
  db.prepare(`INSERT INTO enrichment_campaign VALUES (1,'paused','2026-02-01',NULL,'2026-02-02',NULL,NULL,NULL)`).run();
  db.prepare(`INSERT INTO enrichment_jobs VALUES (?,?,?,?,?,?,?,?,?)`).run(id1,'completed',1,'completed',null,'2026-02-01','2026-02-01','2026-02-02',1234);
  db.prepare(`INSERT INTO discovery_feedback(app_id,motivation,verdict,note,created_at) VALUES (?,?,?,?,?)`).run(id1,'Je veux comprendre un monde','positive','Résonance juste','2026-02-03');
  db.prepare(`INSERT INTO discovery_sessions VALUES (1,'explorer','comprendre sans guide','2026-02-03')`).run();
  db.prepare(`INSERT INTO enrichment_items VALUES (1,?,'{"kept":true}')`).run(id1);
  db.prepare(`INSERT INTO enrichment_runs VALUES (1,'completed','{"success":1}')`).run();
  db.prepare(`INSERT INTO meta VALUES ('library_revision','42')`).run();
  db.prepare(`INSERT INTO schema_migrations VALUES (10000,'2026-01-01')`).run();
  db.prepare(`INSERT INTO work_batch VALUES (1,'{"cursor":2}')`).run();
  db.close();
}

function snapshotLegacyTables(db) {
  return Object.fromEntries(['enrichment_items','enrichment_runs','discovery_sessions','meta','work_batch'].map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
}

test('migre exactement le schéma V1.0 représentatif sans perte et crée une sauvegarde', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v111-'));
  const file = path.join(dir,'backlog-core.sqlite'); fixture(file);
  const before = new DatabaseSync(file, { readOnly:true }); const legacyBefore = snapshotLegacyTables(before); before.close();
  const { db, migration } = openDatabase(file);
  assert.equal(migration.gamesAction,'rebuilt');
  assert.ok(migration.backupPath && fs.existsSync(migration.backupPath));
  const columns = db.prepare('PRAGMA table_info(games)').all();
  assert.equal(columns.find((column)=>column.name==='app_id').type,'INTEGER');
  for (const name of ['name','developer','cover_url','genres','description','playtime_minutes','last_played_at','inventory_metadata_json','source_table','source']) assert.ok(columns.some((column)=>column.name===name),name);
  const game = db.prepare('SELECT * FROM games WHERE app_id=10').get();
  assert.equal(game.name,'Outer Wilds'); assert.equal(game.developer,'Mobius Digital');
  assert.equal(game.cover_url,'https://img/10.jpg'); assert.equal(game.inventory_metadata_json,'{"owned":true}');
  const profile = db.prepare('SELECT * FROM profiles WHERE app_id=10').get();
  assert.equal(profile.profile_json,'{"summary":"Exploration curieuse","intentions":["comprendre"]}');
  assert.equal(profile.embedding_json,'[0.1,0.2]');
  const feedback = db.prepare('SELECT * FROM discovery_feedback').get();
  assert.equal(feedback.motivation,'Je veux comprendre un monde'); assert.equal(feedback.note,'Résonance juste');
  assert.deepEqual(snapshotLegacyTables(db),legacyBefore);
  assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(MIGRATION_VERSION));
  const backup = new DatabaseSync(migration.backupPath,{readOnly:true});
  assert.equal(backup.prepare('SELECT title FROM games WHERE app_id=?').get('10').title,'Outer Wilds'); backup.close();
  db.close(); fs.rmSync(dir,{recursive:true,force:true});
});

test('la migration est réexécutable et ne duplique ni jeux ni profils', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v111-idem-'));const file=path.join(dir,'db.sqlite');fixture(file);
  const opened=openDatabase(file); const before={games:opened.db.prepare('SELECT * FROM games ORDER BY app_id').all(),profiles:opened.db.prepare('SELECT * FROM profiles').all(),feedback:opened.db.prepare('SELECT * FROM discovery_feedback').all()};
  const second=migrate(opened.db,{databasePath:file});
  assert.equal(second.gamesAction,'compatible'); assert.equal(second.backupPath,null);
  assert.deepEqual(opened.db.prepare('SELECT * FROM games ORDER BY app_id').all(),before.games);
  assert.deepEqual(opened.db.prepare('SELECT * FROM profiles').all(),before.profiles);
  assert.deepEqual(opened.db.prepare('SELECT * FROM discovery_feedback').all(),before.feedback);
  assert.equal(opened.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=?').get(MIGRATION_VERSION).n,1);
  opened.db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('un app_id non numérique annule la transaction et laisse la source intacte', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v111-invalid-'));const file=path.join(dir,'db.sqlite');fixture(file,true);
  const db=new DatabaseSync(file); assert.throws(()=>migrate(db,{databasePath:file}),/app_id non numérique/);
  const columns=db.prepare('PRAGMA table_info(games)').all().map((column)=>column.name);
  assert.ok(columns.includes('title')); assert.ok(!columns.includes('name'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n,2);
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
