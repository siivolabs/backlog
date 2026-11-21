import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';
import { importLegacyInventory } from '../src/importer.js';
import { tempDatabase } from './helpers.js';

test('import initial adapte un inventaire historique sans importer de connaissance IA', () => {
  const temp = tempDatabase(); const legacyPath = path.join(temp.directory,'backlog.sqlite');
  const legacy = new DatabaseSync(legacyPath); legacy.exec('CREATE TABLE steam_library (appid INTEGER PRIMARY KEY,name TEXT,developer TEXT,playtime_forever INTEGER,header_image TEXT); CREATE TABLE ai_profiles (appid INTEGER,payload TEXT);');
  legacy.prepare("INSERT INTO steam_library VALUES (42,'Outer Test','Studio X',360,'https://cover')").run(); legacy.prepare("INSERT INTO ai_profiles VALUES (42,'ancienne connaissance')").run(); legacy.close();
  const db = openDatabase(temp.file); const result = importLegacyInventory(db,legacyPath);
  assert.equal(result.imported,1); assert.deepEqual({ ...db.prepare('SELECT app_id,title,studio,playtime_minutes FROM games').get() },{app_id:'42',title:'Outer Test',studio:'Studio X',playtime_minutes:360});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,0);
  assert.equal(importLegacyInventory(db,legacyPath).reason,'target_not_empty');
  db.close(); temp.cleanup();
});
