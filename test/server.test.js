'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('../server');

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function createMockSteam() {
  return async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('ResolveVanityURL')) {
      return jsonResponse({ response: { success: 1, steamid: '76561198000000000' } });
    }
    if (url.pathname.includes('GetPlayerSummaries')) {
      return jsonResponse({ response: { players: [{ steamid: '76561198000000000', personaname: 'Profil test', communityvisibilitystate: 3 }] } });
    }
    if (url.pathname.includes('GetOwnedGames')) {
      return jsonResponse({ response: { game_count: 2, games: [
        { appid: 400, name: 'Portal', playtime_forever: 120, img_icon_url: 'icon1' },
        { appid: 620, name: 'Portal 2', playtime_forever: 0, img_icon_url: 'icon2' }
      ] } });
    }
    if (url.hostname === 'store.steampowered.com') {
      const appid = url.searchParams.get('appids');
      return jsonResponse({ [appid]: { success: true, data: { name: appid === '400' ? 'Portal' : 'Portal 2', genres: [{ description: 'Action' }] } } });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };
}

async function withServer(t, callback, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-test-'));
  const dbPath = path.join(directory, 'backlog.sqlite');
  const application = createApplication({
    dbPath,
    fetchImpl: overrides.fetchImpl || createMockSteam(),
    env: {
      NODE_ENV: 'test',
      STEAM_API_KEY: 'secret-steam-key',
      ADMIN_TOKEN: 'secret-admin-token',
      METADATA_DELAY_MS: '250',
      ...(overrides.env || {})
    }
  });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    application.job.pauseRequested = true;
    await new Promise((resolve) => server.close(resolve));
    application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await callback({ baseUrl, application, directory });
}

async function api(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  return { response, body: await response.json() };
}

async function importProfile(baseUrl, profile = '76561198000000000') {
  return api(baseUrl, '/api/import/steam', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'secret-admin-token' },
    body: JSON.stringify({ profile })
  });
}

test('health and config do not expose secrets', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    const health = await api(baseUrl, '/healthz');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: 'ok', version: '0.6.0' });

    const config = await api(baseUrl, '/api/config');
    assert.equal(config.body.steamApiConfigured, true);
    assert.equal(config.body.adminConfigured, true);
    assert.equal(JSON.stringify(config.body).includes('secret-steam-key'), false);
    assert.equal(JSON.stringify(config.body).includes('secret-admin-token'), false);
  });
});

test('admin routes reject missing token', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    const result = await api(baseUrl, '/api/import/steam', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: '76561198000000000' })
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.code, 'unauthorized');
  });
});

test('imports a public profile by SteamID64 and replaces the active library', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    const imported = await importProfile(baseUrl);
    assert.equal(imported.response.status, 200);
    assert.equal(imported.body.profileName, 'Profil test');
    assert.equal(imported.body.gameCount, 2);

    const library = await api(baseUrl, '/api/library');
    assert.equal(library.body.games.length, 2);
    assert.equal(library.body.stats.total, 2);
    assert.equal(library.body.stats.neverPlayed, 1);
    assert.equal(library.body.profile.steamid, '76561198000000000');
  });
});

test('resolves a public vanity profile without exposing the API key', async (t) => {
  const seenUrls = [];
  const upstream = createMockSteam();
  await withServer(t, async ({ baseUrl }) => {
    const imported = await importProfile(baseUrl, 'profil-test');
    assert.equal(imported.response.status, 200);
    assert.equal(imported.body.steamid, '76561198000000000');
    assert.equal(seenUrls.some((url) => url.includes('secret-steam-key')), false);
  }, {
    fetchImpl: async (url) => {
      seenUrls.push(String(url).replace(/key=[^&]+/, 'key=REDACTED'));
      return upstream(url);
    }
  });
});

test('progressively enriches games and persists per-game status', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    await importProfile(baseUrl);
    const started = await api(baseUrl, '/api/enrichment/start', {
      method: 'POST', headers: { 'x-admin-token': 'secret-admin-token' }
    });
    assert.equal(started.response.status, 202);

    const deadline = Date.now() + 4000;
    let status;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await api(baseUrl, '/api/enrichment/status')).body;
    } while (status.running && Date.now() < deadline);

    assert.equal(status.running, false);
    assert.equal(status.counts.synced, 2);
    assert.equal(status.percent, 100);
    const library = await api(baseUrl, '/api/library');
    assert.deepEqual(library.body.games[0].genres, ['Action']);
    assert.ok(library.body.games.every((game) => game.metadata_status === 'synced'));
  });
});

test('reset requires explicit confirmation and creates a SQLite backup', async (t) => {
  await withServer(t, async ({ baseUrl, directory }) => {
    await importProfile(baseUrl);
    const rejected = await api(baseUrl, '/api/admin/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'secret-admin-token' },
      body: JSON.stringify({ scope: 'library', confirmation: 'non' })
    });
    assert.equal(rejected.response.status, 400);

    const reset = await api(baseUrl, '/api/admin/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'secret-admin-token' },
      body: JSON.stringify({ scope: 'library', confirmation: 'REINITIALISER' })
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.affected, 2);
    assert.ok(reset.body.backup.endsWith('-library.sqlite'));
    assert.equal(fs.existsSync(path.join(directory, 'backups', reset.body.backup)), true);

    const library = await api(baseUrl, '/api/library');
    assert.equal(library.body.games.length, 0);
  });
});

test('private game details return a clear error', async (t) => {
  const privateFetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('GetPlayerSummaries')) {
      return jsonResponse({ response: { players: [{ steamid: '76561198000000000', personaname: 'Privé' }] } });
    }
    if (url.pathname.includes('GetOwnedGames')) return jsonResponse({ response: {} });
    return createMockSteam()(input);
  };
  await withServer(t, async ({ baseUrl }) => {
    const result = await importProfile(baseUrl);
    assert.equal(result.response.status, 403);
    assert.equal(result.body.code, 'games_private');
  }, { fetchImpl: privateFetch });
});
