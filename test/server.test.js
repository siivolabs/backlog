'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../server');

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function createMockSteam(options = {}) {
  const igdbMissing = new Set((options.igdbMissing || []).map(String));
  const steamMissing = new Set((options.steamMissing || []).map(String));
  return async (input, request = {}) => {
    const url = new URL(input);
    if (url.hostname === 'id.twitch.tv') {
      return jsonResponse({ access_token: 'secret-igdb-token', expires_in: 3600, token_type: 'bearer' });
    }
    if (url.hostname === 'api.igdb.com' && url.pathname.endsWith('/external_game_sources')) {
      return jsonResponse([{ id: 1, name: 'Steam' }]);
    }
    if (url.hostname === 'api.igdb.com' && url.pathname.endsWith('/external_games')) {
      const appids = [...String(request.body || '').matchAll(/"(\d+)"/g)].map((match) => match[1]);
      return jsonResponse(appids.filter((appid) => !igdbMissing.has(appid)).map((appid) => ({
        uid: appid,
        game: {
          id: Number(appid) + 10000,
          name: appid === '400' ? 'Portal IGDB' : 'Portal 2 IGDB',
          genres: [{ name: 'Puzzle' }],
          cover: { url: `//images.igdb.com/igdb/image/upload/t_thumb/cover-${appid}.jpg` }
        }
      })));
    }
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
      if (steamMissing.has(appid)) return jsonResponse({ [appid]: { success: false } });
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
      TWITCH_CLIENT_ID: 'secret-twitch-client-id',
      TWITCH_CLIENT_SECRET: 'secret-twitch-client-secret',
      STEAM_REQUEST_INTERVAL_MS: '0',
      STEAM_METADATA_CONCURRENCY: '4',
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

async function runEnrichment(baseUrl) {
  const started = await api(baseUrl, '/api/enrichment/start', {
    method: 'POST', headers: { 'x-admin-token': 'secret-admin-token' }
  });
  assert.equal(started.response.status, 202);
  const deadline = Date.now() + 5000;
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await api(baseUrl, '/api/enrichment/status')).body;
  } while (status.running && Date.now() < deadline);
  assert.equal(status.running, false);
  return status;
}

test('health and config do not expose secrets', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    const health = await api(baseUrl, '/healthz');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: 'ok', version: '0.6.1' });

    const config = await api(baseUrl, '/api/config');
    assert.equal(config.body.steamApiConfigured, true);
    assert.equal(config.body.igdbConfigured, true);
    assert.equal(config.body.adminConfigured, true);
    assert.equal(JSON.stringify(config.body).includes('secret-steam-key'), false);
    assert.equal(JSON.stringify(config.body).includes('secret-admin-token'), false);
    assert.equal(JSON.stringify(config.body).includes('secret-twitch-client-secret'), false);
    assert.equal(JSON.stringify(config.body).includes('secret-igdb-token'), false);
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
    const status = await runEnrichment(baseUrl);

    assert.equal(status.counts.synced, 2);
    assert.equal(status.percent, 100);
    const library = await api(baseUrl, '/api/library');
    assert.deepEqual(library.body.games[0].genres, ['Action']);
    assert.ok(library.body.games.every((game) => game.metadata_status === 'synced'));
    assert.ok(library.body.games.every((game) => game.metadata_source === 'steam_store'));
  });
});

test('uses grouped IGDB external_games lookup and falls back by exact Steam AppID', async (t) => {
  const upstream = createMockSteam({ steamMissing: [620] });
  const igdbBodies = [];
  await withServer(t, async ({ baseUrl, application }) => {
    await importProfile(baseUrl);
    const status = await runEnrichment(baseUrl);
    assert.equal(status.counts.synced, 2);
    assert.equal(status.counts.temporary_error, 0);
    assert.equal(status.counts.unavailable, 0);

    assert.equal(igdbBodies.length, 1);
    assert.match(igdbBodies[0], /external_game_source = 1/);
    assert.match(igdbBodies[0], /"400"/);
    assert.match(igdbBodies[0], /"620"/);

    const library = await api(baseUrl, '/api/library');
    const steamGame = library.body.games.find((game) => game.appid === 400);
    const fallbackGame = library.body.games.find((game) => game.appid === 620);
    assert.equal(steamGame.metadata_source, 'steam_store');
    assert.deepEqual(steamGame.genres, ['Action']);
    assert.equal(fallbackGame.metadata_source, 'igdb');
    assert.deepEqual(fallbackGame.genres, ['Puzzle']);
    assert.match(fallbackGame.header_image, /^https:\/\/images\.igdb\.com\//);
    assert.equal(Number(application.db.prepare("SELECT COUNT(*) AS count FROM metadata_cache WHERE provider = 'igdb'").get().count), 2);
  }, {
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/external_games')) igdbBodies.push(String(options?.body || ''));
      return upstream(input, options);
    }
  });
});

test('does not classify a missing Steam Store page as a temporary error', async (t) => {
  await withServer(t, async ({ baseUrl }) => {
    await importProfile(baseUrl);
    const status = await runEnrichment(baseUrl);
    assert.equal(status.counts.synced, 1);
    assert.equal(status.counts.unavailable, 1);
    assert.equal(status.counts.temporary_error, 0);
    const library = await api(baseUrl, '/api/library');
    const unavailable = library.body.games.find((game) => game.appid === 620);
    assert.equal(unavailable.metadata_status, 'unavailable');
    assert.match(unavailable.metadata_error, /Steam Store ni correspondance IGDB/);
  }, { fetchImpl: createMockSteam({ steamMissing: [620], igdbMissing: [620] }) });
});

test('runs Steam Store enrichment concurrently after IGDB prefetch', async (t) => {
  const upstream = createMockSteam();
  let inFlight = 0;
  let maximum = 0;
  await withServer(t, async ({ baseUrl }) => {
    await importProfile(baseUrl);
    await runEnrichment(baseUrl);
    assert.ok(maximum >= 2, `expected at least 2 concurrent Steam requests, saw ${maximum}`);
  }, {
    env: { STEAM_METADATA_CONCURRENCY: '2' },
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.hostname !== 'store.steampowered.com') return upstream(input, options);
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      try { return await upstream(input, options); }
      finally { inFlight -= 1; }
    }
  });
});

test('restart resumes interrupted work, retries legacy unavailable games, and keeps the IGDB cache', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-restart-test-'));
  const dbPath = path.join(directory, 'backlog.sqlite');
  const options = {
    dbPath,
    fetchImpl: createMockSteam(),
    env: { NODE_ENV: 'test', STEAM_API_KEY: 'key', ADMIN_TOKEN: 'token' }
  };
  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '[]',
      metadata_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT,
      updated_at TEXT
    )`);
    legacy.prepare(`INSERT INTO games(appid, name, metadata_status, genres, created_at, updated_at)
      VALUES (400, 'Portal', 'syncing', '[]', ?, ?), (620, 'Portal 2', 'unavailable', '[]', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    legacy.close();

    const first = createApplication(options);
    assert.equal(first.db.prepare('SELECT metadata_status FROM games WHERE appid = 400').get().metadata_status, 'pending');
    assert.equal(first.db.prepare('SELECT metadata_status FROM games WHERE appid = 620').get().metadata_status, 'pending');
    first.db.prepare(`INSERT INTO metadata_cache(provider, external_id, provider_id, name, genres, found, fetched_at, expires_at)
      VALUES ('igdb', '620', '10620', 'Portal 2 IGDB', '["Puzzle"]', 1, ?, ?)`)
      .run(new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    first.close();

    const second = createApplication(options);
    assert.equal(second.db.prepare('SELECT metadata_status FROM games WHERE appid = 400').get().metadata_status, 'pending');
    assert.equal(second.db.prepare('SELECT metadata_status FROM games WHERE appid = 620').get().metadata_status, 'pending');
    assert.equal(Number(second.db.prepare("SELECT COUNT(*) AS count FROM metadata_cache WHERE provider = 'igdb'").get().count), 1);
    second.db.prepare("UPDATE games SET metadata_status = 'unavailable' WHERE appid = 620").run();
    second.close();

    const third = createApplication(options);
    assert.equal(third.db.prepare('SELECT metadata_status FROM games WHERE appid = 620').get().metadata_status, 'unavailable');
    third.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
