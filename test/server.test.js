'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp, VERSION } = require('../server');

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'backlog.sqlite');
}

async function start(t, options = {}) {
  const app = createApp(options);
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.close();
  });
  const { port } = server.address();
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

test('healthz annonce SQLite et la version 0.5', async (t) => {
  const { baseUrl } = await start(t, { dbPath: temporaryDatabase(t) });
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', version: VERSION, storage: 'sqlite' });
});

test('la bibliothèque importée et les métadonnées survivent à une réouverture SQLite', async (t) => {
  const dbPath = temporaryDatabase(t);
  const first = createApp({ dbPath });
  first.repository.importGames([
    { appid: 400, name: 'Portal', playtime_forever: 120 },
    { appid: 620, name: 'Portal 2', playtime_forever: 0 }
  ], 'response.txt');
  first.repository.saveMetadata(400, { name: 'Portal', genres: ['Action'] });
  first.close();

  const second = createApp({ dbPath });
  t.after(() => second.close());
  const library = second.repository.getLibrary();
  assert.equal(library.state.source_name, 'response.txt');
  assert.equal(library.games.length, 2);
  assert.deepEqual(library.games.find((game) => game.appid === 400).genres, ['Action']);
});

test('l’import API remplace la bibliothèque mais conserve les métadonnées des jeux présents', async (t) => {
  const { baseUrl } = await start(t, { dbPath: temporaryDatabase(t) });
  const importResponse = await fetch(`${baseUrl}/api/library/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceName: 'response.txt', games: [
      { appid: 400, name: 'Portal', playtime_forever: 61 },
      { appid: 620, name: 'Portal 2', playtime_forever: 0 }
    ] })
  });
  assert.equal(importResponse.status, 200);
  assert.equal((await importResponse.json()).imported, 2);

  const libraryResponse = await fetch(`${baseUrl}/api/library`);
  const library = await libraryResponse.json();
  assert.equal(library.games.length, 2);
  assert.equal(library.games[0].name, 'Portal');
});

test('le proxy Steam met en cache persistant la fiche d’un jeu importé', async (t) => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ '400': { success: true, data: { name: 'Portal', genres: [{ description: 'Action' }] } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const { app, baseUrl } = await start(t, { dbPath: temporaryDatabase(t), fetchImpl });
  app.repository.importGames([{ appid: 400, name: 'Portal', playtime_forever: 0 }], 'response.txt');

  const first = await (await fetch(`${baseUrl}/api/steam/400`)).json();
  const second = await (await fetch(`${baseUrl}/api/steam/400`)).json();
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.genres, ['Action']);
  assert.equal(calls, 1);
});

test('l’enrichissement refuse les lots supérieurs à dix jeux', async (t) => {
  const { baseUrl } = await start(t, { dbPath: temporaryDatabase(t) });
  const response = await fetch(`${baseUrl}/api/library/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appids: Array.from({ length: 11 }, (_, index) => index + 1) })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /10/);
});

test('l’état vide est masqué explicitement quand des résultats existent', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(appJs, /elements\.emptyState\.hidden = true/);
  assert.match(appJs, /Aucun jeu ne correspond à vos critères/);
  assert.match(css, /\.empty-state\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});
