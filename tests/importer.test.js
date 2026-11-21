import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, closeDatabase } from '../src/db.js';
import { inspectLegacyInventory, importLegacyInventory } from '../src/importer.js';

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-import-')); }

test('importe uniquement l’inventaire d’une base historique hétérogène', () => {
  const dir = temp();
  const legacyPath = path.join(dir, 'backlog.sqlite');
  const source = new DatabaseSync(legacyPath);
  source.exec(`CREATE TABLE steam_games (appid INTEGER, title TEXT, header_image TEXT, developers TEXT, genres TEXT, playtime_forever INTEGER);
    CREATE TABLE ai_profiles (app_id INTEGER, profile_json TEXT);`);
  const insert = source.prepare('INSERT INTO steam_games VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(10, 'Alpha', 'https://example/10.jpg', 'Studio A', 'Aventure', 120);
  insert.run(20, 'Beta', null, 'Studio B', 'Puzzle', 0);
  source.prepare('INSERT INTO ai_profiles VALUES (?, ?)').run(10, '{"legacy":true}');
  source.close();

  const inspected = inspectLegacyInventory(legacyPath);
  assert.equal(inspected.name, 'steam_games');
  const db = openDatabase(path.join(dir, 'core.sqlite'));
  const result = importLegacyInventory(db, legacyPath);
  assert.equal(result.imported, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count, 0, 'aucune connaissance IA historique ne doit être importée');
  assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE app_id=10').get().playtime_minutes, 120);
  assert.equal(importLegacyInventory(db, legacyPath).reason, 'inventory_not_empty');
  closeDatabase(db);
});
