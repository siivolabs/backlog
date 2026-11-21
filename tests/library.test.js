import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importGames, listLibrary } from '../src/library.js';
import { tempDir, v1Database } from './helpers.js';

test('bibliothèque conserve les couvertures V1.0 et ajoute un repli Steam', () => {
  const db = v1Database(path.join(tempDir(), 'library.sqlite'));
  const items = listLibrary(db, { pageSize: 10 }).items;
  assert.equal(items.find((g) => g.app_id === '10').cover_url, 'https://example.test/alpha.jpg');
  assert.match(items.find((g) => g.app_id === '20').cover_url, /steam\/apps\/20\/header\.jpg/);
  db.close();
});

test('import met à jour l’inventaire sans supprimer les profils', () => {
  const db = v1Database(path.join(tempDir(), 'import.sqlite'));
  const output = importGames(db, { response: { games: [{ appid: 10, name: 'Alpha révisé', playtime_forever: 88 }, { appid: 40, name: 'Delta' }] } });
  assert.equal(output.imported, 2);
  assert.equal(db.prepare("SELECT title FROM games WHERE app_id='10'").get().title, 'Alpha révisé');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM profiles').get().count), 1);
  db.close();
});
