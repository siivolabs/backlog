import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { databaseCapabilities, openDatabase, tableExists } from '../src/db.js';
import { discover } from '../src/discovery.js';
import { createBacklogServer } from '../src/http.js';
import { getGame, listGames, setCompleted } from '../src/library.js';
import { businessHash, createHistorical114Fixture, temporaryDirectory } from './helpers.js';

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}

test('conserve le contrat DATABASE_PATH et refuse tout chemin contradictoire', () => {
  const config = loadConfig({ DATABASE_PATH: '/data/backlog-core.sqlite', DB_PATH: '/data/backlog-core.sqlite' });
  assert.equal(config.databasePath, '/data/backlog-core.sqlite');
  assert.equal(config.databasePathSource, 'DATABASE_PATH');
  assert.equal(config.version, '1.2.2');
  assert.throws(() => loadConfig({ DATABASE_PATH: '/data/historique.sqlite', DB_PATH: '/data/nouvelle.sqlite' }), /deux fichiers différents/);
});

test('refuse de créer une base absente ou de modifier une base non reconnue', () => {
  const directory = temporaryDirectory();
  const missing = path.join(directory, 'absente.sqlite');
  assert.throws(() => openDatabase(missing), /introuvable/);
  assert.equal(fs.existsSync(missing), false);

  const invalid = path.join(directory, 'invalide.sqlite');
  const raw = new DatabaseSync(invalid); raw.exec('CREATE TABLE autre(id INTEGER)'); raw.close();
  assert.throws(() => openDatabase(invalid), /base historique Backlog attendue/);
  const verify = new DatabaseSync(invalid, { readOnly: true });
  assert.deepEqual(tableNames(verify), ['autre']);
  verify.close();
});

test('annule intégralement l’ajout V1.2 si une table d’état incompatible existe', () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  const original = createHistorical114Fixture(filename, 5);
  const before = businessHash(original);
  original.exec('CREATE TABLE game_user_state(bad_id TEXT PRIMARY KEY)');
  original.close();
  assert.throws(() => openDatabase(filename), /Initialisation additive de l’état V1.2 annulée/);
  const verify = new DatabaseSync(filename, { readOnly: true });
  assert.equal(tableExists(verify, 'recommendation_history'), false);
  assert.equal(businessHash(verify), before);
  verify.close();
});

test('ajoute uniquement les deux états V1.2 à la base 1.1.4 sans altérer jeux ni profils', () => {
  const directory = temporaryDirectory();
  const filename = path.join(directory, 'backlog-core.sqlite');
  const original = createHistorical114Fixture(filename);
  const businessBefore = businessHash(original);
  const tablesBefore = tableNames(original);
  original.close();

  const db = openDatabase(filename);
  assert.equal(db.databasePath, filename);
  assert.ok(db.migrationBackupPath && fs.existsSync(db.migrationBackupPath));
  assert.equal(path.extname(db.migrationBackupPath), '.bak');
  assert.equal(db.prepare('SELECT COUNT(*) total FROM games').get().total, 4321);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM profiles').get().total, 4321);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM game_user_state').get().total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM recommendation_history').get().total, 0);
  assert.equal(businessHash(db), businessBefore);
  assert.deepEqual(databaseCapabilities(db), { historicalCore: true, completion: true, recommendationHistory: true, feedback: true, enrichmentQueue: false });
  assert.deepEqual(tableNames(db), [...tablesBefore, 'game_user_state', 'recommendation_history'].sort());
  db.close();

  const reopened = openDatabase(filename);
  assert.equal(reopened.migrationBackupPath, null);
  assert.equal(businessHash(reopened), businessBefore);
  reopened.close();
  assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith('.bak')).length, 1);
});

test('restaure les jaquettes, descriptions et fiches historiques', () => {
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
  db.close();
});

test('Terminé persiste, exclut immédiatement les recommandations et reste réversible', () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  const original = createHistorical114Fixture(filename, 12);
  const businessBefore = businessHash(original); original.close();
  let db = openDatabase(filename);

  const initial = discover(db, { referenceAppId: '100001', limit: 24, minQuality: 0.35, requestKey: 'avant' });
  assert.ok(initial.results.some((item) => item.app_id === '100002'));
  const completed = setCompleted(db, '100002', true);
  assert.equal(completed.completed, true);
  const after = discover(db, { referenceAppId: '100001', limit: 24, minQuality: 0.35, requestKey: 'apres' });
  assert.ok(!after.results.some((item) => item.app_id === '100002'));
  assert.equal(businessHash(db), businessBefore);
  db.close();

  db = openDatabase(filename);
  assert.equal(getGame(db, '100002').completed, true);
  setCompleted(db, '100002', false);
  const reopened = discover(db, { referenceAppId: '100001', limit: 24, minQuality: 0.35, requestKey: 'rouvert' });
  assert.ok(reopened.results.some((item) => item.app_id === '100002'));
  assert.ok(db.prepare('SELECT COUNT(*) total FROM recommendation_history').get().total > 0);
  assert.equal(businessHash(db), businessBefore);
  db.close();
});

test('HTTP protège le bouton Terminé et exclut le jeu marqué de Découverte', async () => {
  const filename = path.join(temporaryDirectory(), 'backlog-core.sqlite');
  createHistorical114Fixture(filename, 8).close();
  const config = loadConfig({ DATABASE_PATH: filename, ADMIN_TOKEN: 'test-token' });
  const { server, db } = createBacklogServer(config);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/healthz`).then((response) => response.json());
    assert.equal(health.version, '1.2.2');
    assert.equal(health.games, 8);
    assert.equal(health.capabilities.completion, true);

    const denied = await fetch(`${base}/api/games/100002/completed`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: true })
    });
    assert.equal(denied.status, 401);

    const invalid = await fetch(`${base}/api/games/100002/completed`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-token': 'test-token' }, body: JSON.stringify({ completed: 'true' })
    });
    assert.equal(invalid.status, 400);

    const accepted = await fetch(`${base}/api/games/100002/completed`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-token': 'test-token' }, body: JSON.stringify({ completed: true })
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).completed, true);

    const discovery = await fetch(`${base}/api/discovery`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceAppId: '100001', limit: 24, requestKey: 'http-test' })
    }).then((response) => response.json());
    assert.ok(!discovery.results.some((item) => item.app_id === '100002'));
  } finally {
    await close(server); db.close();
  }
});
