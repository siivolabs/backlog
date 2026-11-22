import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { listLibrary } from '../src/library.js';
import { createReferenceSearch, findReferenceGame } from '../public/reference-search.js';
import { tempDir, v1Database } from './helpers.js';

function testConfig() {
  return {
    version: '1.1.4',
    port: 0,
    databasePath: '',
    adminToken: 'secret',
    ollamaBaseUrl: '',
    analysisModel: 'test',
    embeddingModel: 'test',
    steamEnrichmentEnabled: false,
    requestTimeoutMs: 1000
  };
}

test('recherche un jeu de référence par titre, studio ou Steam AppID', () => {
  const db = v1Database(path.join(tempDir(), 'reference-search.sqlite'));
  assert.deepEqual(listLibrary(db, { search: 'alpha', pageSize: 20 }).items.map((game) => game.app_id), ['10']);
  assert.deepEqual(listLibrary(db, { search: 'Studio B', pageSize: 20 }).items.map((game) => game.app_id), ['20']);
  assert.deepEqual(listLibrary(db, { search: '30', pageSize: 20 }).items.map((game) => game.app_id), ['30']);
  db.close();
});

test('consulte un profil enrichi en lecture seule depuis la bibliothèque', async () => {
  const db = v1Database(path.join(tempDir(), 'profile-readonly.sqlite'));
  const before = {
    games: db.prepare('SELECT * FROM games ORDER BY app_id').all(),
    profiles: db.prepare('SELECT * FROM profiles ORDER BY app_id').all(),
    feedback: db.prepare('SELECT * FROM discovery_feedback ORDER BY reference_app_id,candidate_app_id,motivation_key').all()
  };
  const app = createApp({
    db,
    config: testConfig(),
    processor: async () => { throw new Error('Le profil en lecture seule ne doit pas lancer le pipeline.'); },
    embed: async () => { throw new Error('Le profil en lecture seule ne doit pas créer un embedding.'); }
  });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.server.address().port}`;

  try {
    let response = await fetch(`${base}/api/library/profile?appId=10`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.game.title, 'Alpha');
    assert.equal(JSON.parse(payload.profile.profile_json).summary, 'Rapide');

    response = await fetch(`${base}/api/library/profile?appId=20`);
    assert.equal(response.status, 404);
    response = await fetch(`${base}/api/library/profile?appId=not-an-appid`);
    assert.equal(response.status, 400);

    const after = {
      games: db.prepare('SELECT * FROM games ORDER BY app_id').all(),
      profiles: db.prepare('SELECT * FROM profiles ORDER BY app_id').all(),
      feedback: db.prepare('SELECT * FROM discovery_feedback ORDER BY reference_app_id,candidate_app_id,motivation_key').all()
    };
    assert.deepEqual(after, before);
  } finally {
    await app.close();
  }
});

test('sélectionne le véritable AppID et rejette une réponse asynchrone obsolète', async () => {
  const selected = findReferenceGame('Control', [
    { app_id: '870780', title: 'Control' },
    { app_id: '111111', title: 'Control Demo' }
  ]);
  assert.equal(selected.app_id, '870780');

  const pending = [];
  const displayed = [];
  const search = createReferenceSearch({
    fetchImpl: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })),
    onResults: (games) => displayed.push(games.map((game) => game.app_id))
  });

  const oldRequest = search.search('old');
  const newRequest = search.search('new');
  assert.equal(pending.length, 2);
  assert.equal(pending[0].options.signal.aborted, true);

  pending[1].resolve({ ok: true, status: 200, json: async () => ({ items: [{ app_id: '222', title: 'New' }] }) });
  assert.deepEqual((await newRequest).map((game) => game.app_id), ['222']);
  pending[0].resolve({ ok: true, status: 200, json: async () => ({ items: [{ app_id: '111', title: 'Old' }] }) });
  assert.deepEqual(await oldRequest, []);
  assert.deepEqual(search.current().map((game) => game.app_id), ['222']);
  assert.deepEqual(displayed.at(-1), ['222']);
});

test('le client utilise le sélecteur Résonances indépendant et la fiche enrichie', () => {
  const script = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="referenceSuggestions"/);
  assert.match(html, /id="profileDialog"/);
  assert.match(script, /createReferenceSearch/);
  assert.match(script, /referenceSearch\.resolve\(typedReference\)/);
  assert.match(script, /const reference = selected \? String\(selected\.app_id\) : ''/);
  assert.doesNotMatch(script, /gameSuggestions/);
});
