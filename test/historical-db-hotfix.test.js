import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { databaseCapabilities, openDatabase, tableExists } from '../src/db.js';
import { discover } from '../src/discovery.js';
import { createBacklogServer } from '../src/http.js';
import { getGame, listGames, setCompleted } from '../src/library.js';
import { businessHash, createHistorical114Fixture, fileHash, temporaryDirectory } from './helpers.js';

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('reprend DATABASE_PATH de 1.1.4 et refuse deux chemins contradictoires', () => {
  const config = loadConfig({ DATABASE_PATH: '/data/backlog-core.sqlite', DB_PATH: '/data/backlog-core.sqlite' });
  assert.equal(config.databasePath, '/data/backlog-core.sqlite');
  assert.equal(config.databasePathSource, 'DATABASE_PATH');
  assert.throws(() => loadConfig({ DATABASE_PATH: '/data/historique.sqlite', DB_PATH: '/data/nouvelle.sqlite' }), /deux fichiers différents/);
});

test('refuse de créer une base absente', () => {
  const filename = path.join(temporaryDirectory(), 'absente.sqlite');
  assert.throws(() => openDatabase(filename), /introuvable/);
  assert.equal(fs.existsSync(filename), false);
});

test('ouvre la base 1.1.4 de 4 321 jeux sans migration ni écriture', () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  const original = createHistorical114Fixture(filename);
  const expectedBusiness = businessHash(original);
  const tablesBefore = original.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  original.close();
  const bytesBefore = fileHash(filename);
  const db = openDatabase(filename);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM games').get().total, 4321);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM profiles').get().total, 4321);
  assert.deepEqual(databaseCapabilities(db), { historicalCore: true, completion: false, recommendationHistory: false, feedback: true, enrichmentQueue: false });
  assert.equal(tableExists(db, 'game_user_state'), false);
  assert.equal(tableExists(db, 'recommendation_history'), false);
  assert.equal(businessHash(db), expectedBusiness);
  const tablesAfter = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tablesAfter, tablesBefore);
  db.close();
  assert.equal(fileHash(filename), bytesBefore);
});

test('rétablit jaquettes, descriptions et fiches depuis la base historique', () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  createHistorical114Fixture(filename, 3).close();
  const db = openDatabase(filename);
  const first = listGames(db, { limit: 3 })[0];
  assert.equal(first.cover_url, 'https://cdn.akamai.steamstatic.com/steam/apps/100001/header.jpg');
  assert.equal(first.description, 'Résumé enrichi historique 1');
  assert.equal(first.profiled, true);
  const second = getGame(db, '100002');
  assert.equal(second.cover_url, 'https://example.invalid/100002.jpg');
  assert.equal(second.description, 'Description historique 2');
  assert.equal(second.profile.summary, 'Résumé enrichi historique 2');
  assert.deepEqual(second.embedding, [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]);
  assert.equal(second.analysis_model, 'qwen3:32b');
  assert.throws(() => setCompleted(db, '100002', true), /Aucune table ne sera créée/);
  db.close();
});

test('Découverte réutilise les embeddings 1.1.4 sans toucher aux jeux ni aux profils', () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  const fixture = createHistorical114Fixture(filename, 50);
  const before = businessHash(fixture); fixture.close();
  const db = openDatabase(filename);
  const result = discover(db, { referenceAppId: '100001', limit: 6, minQuality: 0.35 });
  assert.equal(result.results.length, 6);
  assert.ok(result.results.every((item) => item.cover_url && item.summary));
  assert.equal(db.prepare('SELECT COUNT(*) total FROM discovery_sessions').get().total, 1);
  assert.equal(businessHash(db), before);
  db.close();
});

test('HTTP expose les 4 321 jeux et une fiche sans altérer le fichier SQLite', async () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  createHistorical114Fixture(filename).close();
  const before = fileHash(filename);
  const config = loadConfig({ DATABASE_PATH: filename, ADMIN_TOKEN: 'test-token' });
  const { server, db } = createBacklogServer(config);
  const port = await listen(server);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((response) => response.json());
  assert.equal(health.games, 4321); assert.equal(health.profiles, 4321); assert.equal(health.database, 'historical-existing');
  const library = await fetch(`http://127.0.0.1:${port}/api/library?limit=2`).then((response) => response.json());
  assert.equal(library.games.length, 2); assert.match(library.games[0].cover_url, /steamstatic/); assert.match(library.games[0].description, /Résumé enrichi/);
  const details = await fetch(`http://127.0.0.1:${port}/api/games/100001`).then((response) => response.json());
  assert.equal(details.profile.summary, 'Résumé enrichi historique 1'); assert.equal(details.embedding.length, 8);
  await close(server); db.close();
  assert.equal(fileHash(filename), before);
});
