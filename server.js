'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const VERSION = '0.6.0';
const STATUS_VALUES = ['pending', 'syncing', 'synced', 'temporary_error', 'unavailable'];
const PUBLIC_DIR = path.join(__dirname, 'public');

class HttpError extends Error {
  constructor(status, message, code = 'request_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function safeJsonParse(value, fallback = []) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function booleanFromEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no-op */ }
    throw error;
  }
}

function initializeDatabase(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      playtime_windows_forever INTEGER NOT NULL DEFAULT 0,
      playtime_mac_forever INTEGER NOT NULL DEFAULT 0,
      playtime_linux_forever INTEGER NOT NULL DEFAULT 0,
      rtime_last_played INTEGER NOT NULL DEFAULT 0,
      img_icon_url TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '[]',
      metadata_status TEXT NOT NULL DEFAULT 'pending',
      metadata_error TEXT,
      metadata_attempts INTEGER NOT NULL DEFAULT 0,
      metadata_updated_at TEXT,
      next_retry_at TEXT,
      source_steamid TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      profile_name TEXT,
      game_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);

  // Migration non destructive depuis V0.5.
  const existing = new Set(db.prepare('PRAGMA table_info(games)').all().map((row) => row.name));
  const additions = {
    playtime_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_windows_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_mac_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_linux_forever: 'INTEGER NOT NULL DEFAULT 0',
    rtime_last_played: 'INTEGER NOT NULL DEFAULT 0',
    img_icon_url: "TEXT NOT NULL DEFAULT ''",
    genres: "TEXT NOT NULL DEFAULT '[]'",
    metadata_status: "TEXT NOT NULL DEFAULT 'pending'",
    metadata_error: 'TEXT',
    metadata_attempts: 'INTEGER NOT NULL DEFAULT 0',
    metadata_updated_at: 'TEXT',
    next_retry_at: 'TEXT',
    source_steamid: 'TEXT',
    last_seen_at: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT'
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE games ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_metadata_status ON games(metadata_status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name COLLATE NOCASE);
    UPDATE games SET metadata_status = 'pending' WHERE metadata_status = 'syncing';
    UPDATE games SET genres = '[]' WHERE genres IS NULL OR genres = '';
  `);
}

function createSettingsStore(db) {
  const getStatement = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStatement = db.prepare(`
    INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteStatement = db.prepare('DELETE FROM settings WHERE key = ?');
  return {
    get(key, fallback = null) { return getStatement.get(key)?.value ?? fallback; },
    set(key, value) { setStatement.run(key, String(value), nowIso()); },
    remove(key) { deleteStatement.run(key); }
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeProfileInput(input) {
  const value = String(input || '').trim();
  if (/^\d{17}$/.test(value)) return { type: 'steamid', value };
  let parsed = null;
  try { parsed = new URL(value); } catch { /* not a URL */ }
  if (parsed && /(^|\.)steamcommunity\.com$/i.test(parsed.hostname)) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'profiles' && /^\d{17}$/.test(parts[1] || '')) return { type: 'steamid', value: parts[1] };
    if (parts[0] === 'id' && /^[A-Za-z0-9_-]{2,64}$/.test(parts[1] || '')) return { type: 'vanity', value: parts[1] };
  }
  if (/^[A-Za-z0-9_-]{2,64}$/.test(value)) return { type: 'vanity', value };
  throw new HttpError(400, 'Saisis un SteamID64, un nom personnalisé ou une URL de profil Steam valide.', 'invalid_profile');
}

async function fetchJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': `SiivoLabs-Backlog/${VERSION}`, accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new HttpError(502, 'Steam a renvoyé une réponse illisible.', 'invalid_upstream_response'); }
    }
    if (!response.ok) {
      const error = new HttpError(response.status === 429 ? 429 : 502, `Steam a répondu HTTP ${response.status}.`, 'upstream_error');
      error.upstreamStatus = response.status;
      error.retryAfter = Number(response.headers.get('retry-after')) || null;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, "Steam n'a pas répondu à temps.", 'upstream_timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.cloudflare.steamstatic.com https://shared.cloudflare.steamstatic.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

async function readJson(req, limit = 65536) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('application/json')) throw new HttpError(415, 'Le corps doit être au format JSON.', 'invalid_content_type');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Corps de requête trop volumineux.', 'payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'JSON invalide.', 'invalid_json'); }
}

function staticResponse(req, res, pathname, production) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { return false; }
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': production && path.extname(filePath) !== '.html' ? 'public, max-age=3600' : 'no-cache'
  });
  if (req.method === 'HEAD') res.end(); else res.end(body);
  return true;
}

function createApplication(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const dbPath = options.dbPath || env.DB_PATH || path.join(__dirname, 'data', 'backlog.sqlite');
  const fetchImpl = options.fetchImpl || global.fetch;
  const steamApiKey = String(env.STEAM_API_KEY || '').trim();
  const adminToken = String(env.ADMIN_TOKEN || '').trim();
  const metadataDelayMs = Math.max(250, Number(env.METADATA_DELAY_MS) || 1500);
  const metadataLanguage = String(env.METADATA_LANGUAGE || 'french');
  const metadataCountry = String(env.METADATA_COUNTRY || 'FR');
  const production = env.NODE_ENV === 'production';
  const trustProxy = booleanFromEnv(env.TRUST_PROXY, false);
  if (!fetchImpl) throw new Error('fetch is required');

  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);
  const settings = createSettingsStore(db);

  const job = {
    running: false,
    pauseRequested: false,
    currentAppid: null,
    startedAt: null,
    stoppedAt: null,
    processedThisRun: 0,
    lastMessage: 'En attente d’un lancement manuel.'
  };

  function requireAdmin(req) {
    if (!adminToken) throw new HttpError(503, 'Administration désactivée : configure ADMIN_TOKEN dans Dockge.', 'admin_not_configured');
    if (!constantTimeEqual(req.headers['x-admin-token'] || '', adminToken)) {
      throw new HttpError(401, "Jeton d'administration incorrect.", 'unauthorized');
    }
  }

  function publicGame(row) {
    return {
      appid: Number(row.appid),
      name: row.name || `App ${row.appid}`,
      playtime_forever: Number(row.playtime_forever || 0),
      playtime_windows_forever: Number(row.playtime_windows_forever || 0),
      playtime_mac_forever: Number(row.playtime_mac_forever || 0),
      playtime_linux_forever: Number(row.playtime_linux_forever || 0),
      rtime_last_played: Number(row.rtime_last_played || 0),
      img_icon_url: row.img_icon_url || '',
      genres: safeJsonParse(row.genres, []),
      metadata_status: STATUS_VALUES.includes(row.metadata_status) ? row.metadata_status : 'pending',
      metadata_error: row.metadata_error || null,
      metadata_updated_at: row.metadata_updated_at || null,
      header_image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(row.appid)}/header.jpg`
    };
  }

  function statusSnapshot() {
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM games').get().count);
    const rows = db.prepare('SELECT metadata_status AS status, COUNT(*) AS count FROM games GROUP BY metadata_status').all();
    const counts = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0]));
    for (const row of rows) counts[row.status] = Number(row.count);
    const completed = counts.synced + counts.unavailable;
    return { ...job, total, counts, completed, percent: total ? Math.round((completed / total) * 1000) / 10 : 0 };
  }

  async function resolveSteamId(profileInput) {
    const normalized = normalizeProfileInput(profileInput);
    if (normalized.type === 'steamid') return normalized.value;
    if (!steamApiKey) throw new HttpError(503, 'La clé Steam Web API n’est pas configurée.', 'steam_key_missing');
    const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
    url.searchParams.set('key', steamApiKey);
    url.searchParams.set('vanityurl', normalized.value);
    const data = await fetchJson(fetchImpl, url);
    if (Number(data?.response?.success) !== 1 || !data?.response?.steamid) {
      throw new HttpError(404, 'Ce profil Steam personnalisé est introuvable.', 'profile_not_found');
    }
    return String(data.response.steamid);
  }

  async function getPlayerSummary(steamid) {
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    url.searchParams.set('key', steamApiKey);
    url.searchParams.set('steamids', steamid);
    const data = await fetchJson(fetchImpl, url);
    return data?.response?.players?.[0] || null;
  }

  async function getOwnedGames(steamid) {
    const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
    url.searchParams.set('key', steamApiKey);
    url.searchParams.set('steamid', steamid);
    url.searchParams.set('include_appinfo', 'true');
    url.searchParams.set('include_played_free_games', 'true');
    url.searchParams.set('format', 'json');
    const data = await fetchJson(fetchImpl, url, { timeoutMs: 30000 });
    const response = data?.response;
    if (!response || (!Array.isArray(response.games) && response.game_count == null)) {
      throw new HttpError(403, 'La liste des jeux de ce profil n’est pas publique ou n’est pas accessible.', 'games_private');
    }
    return Array.isArray(response.games) ? response.games : [];
  }

  const upsertGame = db.prepare(`
    INSERT INTO games (
      appid, name, playtime_forever, playtime_windows_forever, playtime_mac_forever,
      playtime_linux_forever, rtime_last_played, img_icon_url, genres, metadata_status,
      source_steamid, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'pending', ?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      playtime_forever = excluded.playtime_forever,
      playtime_windows_forever = excluded.playtime_windows_forever,
      playtime_mac_forever = excluded.playtime_mac_forever,
      playtime_linux_forever = excluded.playtime_linux_forever,
      rtime_last_played = excluded.rtime_last_played,
      img_icon_url = excluded.img_icon_url,
      source_steamid = excluded.source_steamid,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);

  function importGames(steamid, profileName, games) {
    transaction(db, () => {
      const timestamp = nowIso();
      for (const game of games) {
        upsertGame.run(
          Number(game.appid), String(game.name || `App ${game.appid}`).slice(0, 300),
          Number(game.playtime_forever || 0), Number(game.playtime_windows_forever || 0),
          Number(game.playtime_mac_forever || 0), Number(game.playtime_linux_forever || 0),
          Number(game.rtime_last_played || 0), String(game.img_icon_url || '').slice(0, 200),
          steamid, timestamp, timestamp, timestamp
        );
      }
      db.prepare('DELETE FROM games WHERE source_steamid IS NULL OR source_steamid <> ? OR last_seen_at <> ?').run(steamid, timestamp);
      settings.set('active_steamid', steamid);
      settings.set('active_profile_name', profileName || steamid);
      settings.set('last_library_sync_at', timestamp);
      settings.set('last_library_sync_count', games.length);
    });
  }

  async function importPublicProfile(profileInput) {
    if (!steamApiKey) throw new HttpError(503, 'Configure STEAM_API_KEY dans Dockge avant la synchronisation.', 'steam_key_missing');
    const steamid = await resolveSteamId(profileInput);
    const startedAt = nowIso();
    const run = db.prepare("INSERT INTO sync_runs(steamid, status, started_at) VALUES (?, 'running', ?)").run(steamid, startedAt);
    try {
      const [summary, games] = await Promise.all([getPlayerSummary(steamid), getOwnedGames(steamid)]);
      if (!summary) throw new HttpError(404, 'Profil Steam introuvable.', 'profile_not_found');
      const profileName = String(summary.personaname || steamid).slice(0, 200);
      importGames(steamid, profileName, games);
      const finishedAt = nowIso();
      db.prepare("UPDATE sync_runs SET profile_name = ?, game_count = ?, status = 'success', message = ?, finished_at = ? WHERE id = ?")
        .run(profileName, games.length, `${games.length} jeu(x) synchronisé(s).`, finishedAt, run.lastInsertRowid);
      return { steamid, profileName, gameCount: games.length, syncedAt: finishedAt };
    } catch (error) {
      db.prepare("UPDATE sync_runs SET status = 'error', message = ?, finished_at = ? WHERE id = ?")
        .run(String(error.message || 'Erreur de synchronisation').slice(0, 500), nowIso(), run.lastInsertRowid);
      throw error;
    }
  }

  async function enrichOne(row) {
    const appid = Number(row.appid);
    db.prepare("UPDATE games SET metadata_status = 'syncing', metadata_error = NULL, updated_at = ? WHERE appid = ?").run(nowIso(), appid);
    job.currentAppid = appid;
    try {
      const url = new URL('https://store.steampowered.com/api/appdetails');
      url.searchParams.set('appids', String(appid));
      url.searchParams.set('l', metadataLanguage);
      url.searchParams.set('cc', metadataCountry);
      const payload = await fetchJson(fetchImpl, url);
      const entry = payload?.[String(appid)];
      if (!entry?.success || !entry.data) {
        const timestamp = nowIso();
        db.prepare(`UPDATE games SET metadata_status = 'unavailable', metadata_error = ?, metadata_attempts = metadata_attempts + 1,
          metadata_updated_at = ?, next_retry_at = NULL, updated_at = ? WHERE appid = ?`)
          .run('Métadonnées indisponibles sur le magasin Steam.', timestamp, timestamp, appid);
        return;
      }
      const genres = Array.isArray(entry.data.genres)
        ? entry.data.genres.map((genre) => String(genre.description || '').trim()).filter(Boolean)
        : [];
      const timestamp = nowIso();
      db.prepare(`UPDATE games SET name = COALESCE(NULLIF(?, ''), name), genres = ?, metadata_status = 'synced',
        metadata_error = NULL, metadata_attempts = metadata_attempts + 1, metadata_updated_at = ?,
        next_retry_at = NULL, updated_at = ? WHERE appid = ?`)
        .run(String(entry.data.name || '').slice(0, 300), JSON.stringify(genres), timestamp, timestamp, appid);
    } catch (error) {
      const attempts = Number(row.metadata_attempts || 0) + 1;
      const retrySeconds = error.retryAfter || Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 6)));
      const timestamp = nowIso();
      const retryAt = new Date(Date.now() + retrySeconds * 1000).toISOString();
      db.prepare(`UPDATE games SET metadata_status = 'temporary_error', metadata_error = ?, metadata_attempts = ?,
        metadata_updated_at = ?, next_retry_at = ?, updated_at = ? WHERE appid = ?`)
        .run(String(error.message || 'Erreur temporaire').slice(0, 500), attempts, timestamp, retryAt, timestamp, appid);
    }
  }

  async function runEnrichment() {
    if (job.running) return;
    job.running = true;
    job.pauseRequested = false;
    job.startedAt = nowIso();
    job.stoppedAt = null;
    job.processedThisRun = 0;
    job.lastMessage = 'Enrichissement en cours.';
    try {
      while (!job.pauseRequested) {
        const row = db.prepare(`SELECT appid, metadata_attempts FROM games
          WHERE metadata_status = 'pending'
             OR (metadata_status = 'temporary_error' AND (next_retry_at IS NULL OR next_retry_at <= ?))
          ORDER BY CASE metadata_status WHEN 'pending' THEN 0 ELSE 1 END, metadata_attempts ASC, appid ASC LIMIT 1`).get(nowIso());
        if (!row) {
          job.lastMessage = 'Aucun jeu éligible à enrichir pour le moment.';
          break;
        }
        await enrichOne(row);
        job.processedThisRun += 1;
        job.currentAppid = null;
        if (!job.pauseRequested) await sleep(metadataDelayMs);
      }
      if (job.pauseRequested) job.lastMessage = 'Enrichissement suspendu.';
    } finally {
      job.currentAppid = null;
      job.running = false;
      job.stoppedAt = nowIso();
    }
  }

  function createBackup(scope) {
    if (dbPath === ':memory:') return null;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const backupsDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const destination = path.join(backupsDir, `backlog-${timestamp}-${scope}.sqlite`);
    fs.copyFileSync(dbPath, destination);
    return path.basename(destination);
  }

  async function handleApi(req, res, url) {
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION });
    if (req.method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, {
        version: VERSION,
        steamApiConfigured: Boolean(steamApiKey),
        adminConfigured: Boolean(adminToken),
        activeSteamId: settings.get('active_steamid'),
        activeProfileName: settings.get('active_profile_name'),
        lastLibrarySyncAt: settings.get('last_library_sync_at'),
        lastLibrarySyncCount: Number(settings.get('last_library_sync_count', 0))
      });
    }
    if (req.method === 'GET' && pathname === '/api/library') {
      const games = db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE, appid').all().map(publicGame);
      const totalMinutes = games.reduce((sum, game) => sum + game.playtime_forever, 0);
      const neverPlayed = games.filter((game) => game.playtime_forever === 0).length;
      return sendJson(res, 200, {
        games,
        stats: { total: games.length, neverPlayed, played: games.length - neverPlayed, totalHours: Math.round((totalMinutes / 60) * 10) / 10 },
        profile: { steamid: settings.get('active_steamid'), name: settings.get('active_profile_name'), lastSyncAt: settings.get('last_library_sync_at') }
      });
    }
    if (req.method === 'GET' && pathname === '/api/enrichment/status') return sendJson(res, 200, statusSnapshot());
    if (req.method === 'GET' && pathname === '/api/sync/history') {
      const history = db.prepare(`SELECT steamid, profile_name, game_count, status, message, started_at, finished_at
        FROM sync_runs ORDER BY id DESC LIMIT 10`).all();
      return sendJson(res, 200, { history });
    }
    if (req.method === 'POST' && pathname === '/api/import/steam') {
      requireAdmin(req);
      const body = await readJson(req);
      return sendJson(res, 200, await importPublicProfile(body.profile));
    }
    if (req.method === 'POST' && pathname === '/api/enrichment/start') {
      requireAdmin(req);
      if (job.running) throw new HttpError(409, 'Un enrichissement est déjà en cours.', 'job_running');
      void runEnrichment();
      return sendJson(res, 202, { message: 'Enrichissement lancé.', status: statusSnapshot() });
    }
    if (req.method === 'POST' && pathname === '/api/enrichment/pause') {
      requireAdmin(req);
      if (!job.running) throw new HttpError(409, 'Aucun enrichissement n’est en cours.', 'job_not_running');
      job.pauseRequested = true;
      return sendJson(res, 202, { message: 'Suspension demandée après la requête en cours.', status: statusSnapshot() });
    }
    if (req.method === 'POST' && pathname === '/api/enrichment/retry-errors') {
      requireAdmin(req);
      const result = db.prepare(`UPDATE games SET metadata_status = 'pending', metadata_error = NULL, next_retry_at = NULL, updated_at = ?
        WHERE metadata_status IN ('temporary_error', 'unavailable')`).run(nowIso());
      return sendJson(res, 200, { reset: Number(result.changes) });
    }
    if (req.method === 'POST' && pathname === '/api/admin/reset') {
      requireAdmin(req);
      const body = await readJson(req);
      const scope = String(body.scope || '');
      if (!['metadata', 'library', 'all'].includes(scope)) throw new HttpError(400, 'Portée de réinitialisation invalide.', 'invalid_reset_scope');
      if (String(body.confirmation || '') !== 'REINITIALISER') throw new HttpError(400, 'Confirmation incorrecte.', 'confirmation_required');
      if (job.running) throw new HttpError(409, 'Suspends l’enrichissement avant de réinitialiser les données.', 'job_running');
      const backup = createBackup(scope);
      let affected = 0;
      if (scope === 'metadata') {
        affected = Number(db.prepare(`UPDATE games SET genres = '[]', metadata_status = 'pending', metadata_error = NULL,
          metadata_attempts = 0, metadata_updated_at = NULL, next_retry_at = NULL, updated_at = ?`).run(nowIso()).changes);
      } else if (scope === 'library') {
        affected = Number(db.prepare('DELETE FROM games').run().changes);
        for (const key of ['active_steamid', 'active_profile_name', 'last_library_sync_at', 'last_library_sync_count']) settings.remove(key);
      } else {
        affected = transaction(db, () => {
          const count = Number(db.prepare('DELETE FROM games').run().changes);
          db.prepare('DELETE FROM sync_runs').run();
          db.prepare('DELETE FROM settings').run();
          return count;
        });
      }
      return sendJson(res, 200, { scope, affected, backup });
    }
    throw new HttpError(404, 'Ressource introuvable.', 'not_found');
  }

  async function handler(req, res) {
    try {
      const host = trustProxy ? String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost') : String(req.headers.host || 'localhost');
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (staticResponse(req, res, url.pathname, production)) return;
      sendJson(res, 404, { error: 'Ressource introuvable.', code: 'not_found' });
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error(`[backlog] ${error.code || 'error'}: ${error.message}`);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Erreur interne du serveur.' : error.message, code: error.code || 'internal_error' });
      else res.destroy();
    }
  }

  return {
    app: { listen(...args) { return http.createServer(handler).listen(...args); } },
    handler,
    db,
    settings,
    job,
    close() { job.pauseRequested = true; db.close(); }
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const application = createApplication();
  const server = http.createServer(application.handler);
  server.listen(port, host, () => {
    console.log(`Backlog v${VERSION} écoute sur ${host}:${port}`);
    console.log(`Steam Web API : ${process.env.STEAM_API_KEY ? 'configurée' : 'non configurée'}`);
    console.log(`Administration : ${process.env.ADMIN_TOKEN ? 'protégée' : 'désactivée (ADMIN_TOKEN absent)'}`);
  });
  const shutdown = () => {
    application.job.pauseRequested = true;
    server.close(() => { application.close(); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApplication, normalizeProfileInput, VERSION };
