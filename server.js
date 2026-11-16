'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const VERSION = '0.5.0';
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_DB_PATH = process.env.DB_PATH || '/data/backlog.sqlite';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_ENRICH_BATCH = 10;
const STEAM_TIMEOUT_MS = 12_000;
const APPID_MAX = 2_147_483_647;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function validateAppid(value) {
  const text = String(value ?? '');
  if (!/^\d{1,10}$/.test(text)) return null;
  const appid = Number(text);
  return Number.isSafeInteger(appid) && appid > 0 && appid <= APPID_MAX ? appid : null;
}

function normalizeGame(game) {
  const appid = validateAppid(game?.appid ?? game?.app_id);
  const name = typeof game?.name === 'string' ? game.name.trim() : '';
  if (!appid || !name) return null;

  return {
    appid,
    name: name.slice(0, 500),
    playtime_forever: toInteger(game.playtime_forever),
    playtime_windows_forever: toInteger(game.playtime_windows_forever),
    playtime_mac_forever: toInteger(game.playtime_mac_forever),
    playtime_linux_forever: toInteger(game.playtime_linux_forever),
    playtime_deck_forever: toInteger(game.playtime_deck_forever),
    rtime_last_played: toInteger(game.rtime_last_played),
    img_icon_url: typeof game.img_icon_url === 'string' ? game.img_icon_url.slice(0, 200) : '',
    raw_json: JSON.stringify(game)
  };
}

function ensureDatabaseDirectory(dbPath) {
  if (dbPath === ':memory:') return;
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}

function openDatabase(dbPath) {
  ensureDatabaseDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      playtime_windows_forever INTEGER NOT NULL DEFAULT 0,
      playtime_mac_forever INTEGER NOT NULL DEFAULT 0,
      playtime_linux_forever INTEGER NOT NULL DEFAULT 0,
      playtime_deck_forever INTEGER NOT NULL DEFAULT 0,
      rtime_last_played INTEGER NOT NULL DEFAULT 0,
      img_icon_url TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS metadata (
      appid INTEGER PRIMARY KEY,
      steam_name TEXT NOT NULL DEFAULT '',
      genres_json TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT NOT NULL,
      FOREIGN KEY (appid) REFERENCES games(appid) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS library_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_name TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL,
      game_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name COLLATE NOCASE);
  `);
  return db;
}

function createRepository(db) {
  const listGames = db.prepare(`
    SELECT g.appid, g.name, g.playtime_forever, g.playtime_windows_forever,
           g.playtime_mac_forever, g.playtime_linux_forever, g.playtime_deck_forever,
           g.rtime_last_played, g.img_icon_url, m.steam_name, m.genres_json, m.fetched_at
      FROM games g
      LEFT JOIN metadata m ON m.appid = g.appid
     ORDER BY g.name COLLATE NOCASE, g.appid
  `);
  const getMetadata = db.prepare('SELECT steam_name, genres_json, fetched_at FROM metadata WHERE appid = ?');
  const upsertGame = db.prepare(`
    INSERT INTO games (
      appid, name, playtime_forever, playtime_windows_forever, playtime_mac_forever,
      playtime_linux_forever, playtime_deck_forever, rtime_last_played, img_icon_url,
      raw_json, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      playtime_forever = excluded.playtime_forever,
      playtime_windows_forever = excluded.playtime_windows_forever,
      playtime_mac_forever = excluded.playtime_mac_forever,
      playtime_linux_forever = excluded.playtime_linux_forever,
      playtime_deck_forever = excluded.playtime_deck_forever,
      rtime_last_played = excluded.rtime_last_played,
      img_icon_url = excluded.img_icon_url,
      raw_json = excluded.raw_json,
      imported_at = excluded.imported_at
  `);
  const upsertMetadata = db.prepare(`
    INSERT INTO metadata (appid, steam_name, genres_json, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      steam_name = excluded.steam_name,
      genres_json = excluded.genres_json,
      fetched_at = excluded.fetched_at
  `);

  function rowToGame(row) {
    let genres = [];
    try { genres = JSON.parse(row.genres_json || '[]'); } catch { genres = []; }
    return { ...row, genres, enriched: Boolean(row.fetched_at) };
  }

  return {
    getLibrary() {
      const state = db.prepare('SELECT source_name, imported_at, game_count FROM library_state WHERE id = 1').get() || null;
      return { state, games: listGames.all().map(rowToGame) };
    },

    importGames(inputGames, sourceName = '') {
      const unique = new Map();
      for (const candidate of inputGames) {
        const game = normalizeGame(candidate);
        if (game) unique.set(game.appid, game);
      }
      const games = [...unique.values()];
      if (!games.length && inputGames.length) {
        const error = new Error('Aucun jeu valide dans le fichier importé.');
        error.statusCode = 400;
        throw error;
      }
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('CREATE TEMP TABLE current_import (appid INTEGER PRIMARY KEY) STRICT;');
        const remember = db.prepare('INSERT INTO current_import (appid) VALUES (?)');
        for (const game of games) {
          remember.run(game.appid);
          upsertGame.run(
            game.appid, game.name, game.playtime_forever, game.playtime_windows_forever,
            game.playtime_mac_forever, game.playtime_linux_forever, game.playtime_deck_forever,
            game.rtime_last_played, game.img_icon_url, game.raw_json, now
          );
        }
        db.exec('DELETE FROM games WHERE appid NOT IN (SELECT appid FROM current_import); DROP TABLE current_import;');
        db.prepare(`
          INSERT INTO library_state (id, source_name, imported_at, game_count)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET source_name = excluded.source_name,
            imported_at = excluded.imported_at, game_count = excluded.game_count
        `).run(String(sourceName).slice(0, 255), now, games.length);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { imported: games.length, rejected: inputGames.length - games.length, importedAt: now };
    },

    clearLibrary() {
      db.exec('BEGIN IMMEDIATE; DELETE FROM metadata; DELETE FROM games; DELETE FROM library_state; COMMIT;');
    },

    getMetadata(appid) {
      const row = getMetadata.get(appid);
      if (!row) return null;
      let genres = [];
      try { genres = JSON.parse(row.genres_json || '[]'); } catch { genres = []; }
      return { appid, name: row.steam_name, genres, fetchedAt: row.fetched_at, cached: true };
    },

    saveMetadata(appid, metadata) {
      const fetchedAt = new Date().toISOString();
      upsertMetadata.run(appid, metadata.name || '', JSON.stringify(metadata.genres || []), fetchedAt);
      return { appid, name: metadata.name || '', genres: metadata.genres || [], fetchedAt, cached: false };
    },

    hasGame(appid) {
      return Boolean(db.prepare('SELECT 1 AS found FROM games WHERE appid = ?').get(appid));
    }
  };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Le fichier dépasse la taille maximale autorisée.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Le corps de la requête n’est pas un JSON valide.');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(body);
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}

async function fetchSteamMetadata(appid, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STEAM_TIMEOUT_MS);
  try {
    const endpoint = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=french&cc=fr`;
    const steamResponse = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: { 'User-Agent': `Backlog/${VERSION}` }
    });
    if (!steamResponse.ok) throw new Error(`Steam a répondu avec le statut ${steamResponse.status}.`);
    const payload = await steamResponse.json();
    const item = payload?.[String(appid)];
    if (!item?.success || !item.data) throw new Error('Steam ne fournit aucune fiche pour cet AppID.');
    return {
      name: typeof item.data.name === 'string' ? item.data.name : '',
      genres: Array.isArray(item.data.genres)
        ? [...new Set(item.data.genres.map((genre) => genre?.description).filter(Boolean))]
        : []
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Steam n’a pas répondu dans le délai prévu.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function serveStatic(requestPath, response) {
  const normalized = requestPath === '/' ? '/index.html' : requestPath;
  const decoded = decodeURIComponent(normalized);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`)) return false;
  let stats;
  try { stats = fs.statSync(filePath); } catch { return false; }
  if (!stats.isFile()) return false;
  const content = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600'
  });
  response.end(content);
  return true;
}

function createApp({ dbPath = DEFAULT_DB_PATH, fetchImpl = globalThis.fetch } = {}) {
  const db = openDatabase(dbPath);
  const repository = createRepository(db);
  const allowSteamRequest = createRateLimiter();

  async function getSteam(appid, refresh = false) {
    if (!refresh) {
      const cached = repository.getMetadata(appid);
      if (cached) return cached;
    }
    const metadata = await fetchSteamMetadata(appid, fetchImpl);
    if (repository.hasGame(appid)) return repository.saveMetadata(appid, metadata);
    return { appid, ...metadata, fetchedAt: new Date().toISOString(), cached: false };
  }

  const handler = async (request, response) => {
    securityHeaders(response);
    const url = new URL(request.url, 'http://localhost');
    const method = request.method || 'GET';

    try {
      if (method === 'GET' && url.pathname === '/healthz') {
        return sendJson(response, 200, { status: 'ok', version: VERSION, storage: 'sqlite' });
      }

      if (method === 'GET' && url.pathname === '/api/library') {
        return sendJson(response, 200, repository.getLibrary());
      }

      if (method === 'POST' && url.pathname === '/api/library/import') {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.games)) return sendJson(response, 400, { error: 'Le champ games doit être une liste.' });
        const result = repository.importGames(body.games, body.sourceName || '');
        return sendJson(response, 200, result);
      }

      if (method === 'DELETE' && url.pathname === '/api/library') {
        repository.clearLibrary();
        return sendJson(response, 200, { cleared: true });
      }

      const steamMatch = url.pathname.match(/^\/api\/steam\/(\d+)$/);
      if (method === 'GET' && steamMatch) {
        const appid = validateAppid(steamMatch[1]);
        if (!appid) return sendJson(response, 400, { error: 'AppID invalide.' });
        const client = request.socket.remoteAddress || 'unknown';
        if (!allowSteamRequest(client)) return sendJson(response, 429, { error: 'Trop de requêtes. Réessaie dans une minute.' });
        const metadata = await getSteam(appid, url.searchParams.get('refresh') === '1');
        return sendJson(response, 200, metadata);
      }

      if (method === 'POST' && url.pathname === '/api/library/enrich') {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.appids) || body.appids.length < 1 || body.appids.length > MAX_ENRICH_BATCH) {
          return sendJson(response, 400, { error: `Choisis entre 1 et ${MAX_ENRICH_BATCH} jeux.` });
        }
        const appids = [...new Set(body.appids.map(validateAppid).filter(Boolean))];
        if (!appids.length) return sendJson(response, 400, { error: 'Aucun AppID valide.' });
        const results = [];
        for (const appid of appids) {
          if (!repository.hasGame(appid)) {
            results.push({ appid, ok: false, error: 'Ce jeu n’appartient pas à la bibliothèque.' });
            continue;
          }
          try {
            const metadata = await getSteam(appid, Boolean(body.refresh));
            results.push({ ...metadata, ok: true });
          } catch (error) {
            results.push({ appid, ok: false, error: error.message });
          }
        }
        return sendJson(response, 200, { results });
      }

      if (method === 'GET' || method === 'HEAD') {
        if (serveStatic(url.pathname, response)) return;
      }
      return sendJson(response, 404, { error: 'Ressource introuvable.' });
    } catch (error) {
      console.error(error);
      return sendJson(response, error.statusCode || 502, { error: error.message || 'Erreur interne.' });
    }
  };

  return {
    handler,
    repository,
    db,
    close() { db.close(); }
  };
}

if (require.main === module) {
  const app = createApp();
  const server = http.createServer(app.handler);
  server.listen(DEFAULT_PORT, '0.0.0.0', () => {
    console.log(`Backlog v${VERSION} écoute sur le port ${DEFAULT_PORT}; SQLite: ${DEFAULT_DB_PATH}`);
  });
  const shutdown = () => server.close(() => { app.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { VERSION, createApp, normalizeGame, validateAppid, fetchSteamMetadata };
