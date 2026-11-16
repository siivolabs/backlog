'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, fetchSteamMetadata, normalizeSteamPayload } = require('../server');

test('normalizeSteamPayload garde le nom et déduplique les genres', () => {
  const result = normalizeSteamPayload(400, {
    400: {
      success: true,
      data: {
        name: 'Portal',
        genres: [
          { description: 'Action' },
          { description: 'Action' },
          { description: 'Aventure' },
        ],
      },
    },
  });

  assert.deepEqual(result, {
    appid: 400,
    name: 'Portal',
    genres: ['Action', 'Aventure'],
  });
});

test('fetchSteamMetadata met une fiche en cache mémoire', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      987654321: {
        success: true,
        data: { name: 'Jeu de test', genres: [{ description: 'Indépendant' }] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const first = await fetchSteamMetadata(987654321);
  const second = await fetchSteamMetadata(987654321);

  assert.equal(first.cache, 'miss');
  assert.equal(second.cache, 'memory');
  assert.equal(calls, 1);
  assert.deepEqual(second.genres, ['Indépendant']);
});

test('le serveur expose la santé, les fichiers statiques et refuse un AppID nul', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', version: '0.4.0' });

  const index = await fetch(`${origin}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Backlog v0\.4/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);

  const invalid = await fetch(`${origin}/api/steam/0`);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /entier positif/);
});
