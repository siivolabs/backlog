'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAiEngine } = require('./ai-engine');

const VERSION = '0.8.0-poc';
// Temporary pilot guardrail only. The future architecture must support arbitrary batch sizes.
const AI_PILOT_POC_LIMIT = 50;
const STATUS_VALUES = ['pending', 'syncing', 'synced', 'temporary_error', 'unavailable'];
const APPLICATION_TYPES = ['full_game', 'demo', 'beta', 'prototype', 'public_test', 'dedicated_server', 'software_tool', 'dlc', 'multiplayer_component', 'unknown'];
const RECOMMENDATION_ALGORITHM = 'explainable-v1';
const NON_RECOMMENDABLE_TYPES = new Set(['demo', 'beta', 'prototype', 'public_test', 'dedicated_server', 'software_tool', 'dlc', 'multiplayer_component']);
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

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizedText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function classifyApplication(metadata = {}) {
  const name = normalizedText(metadata.name);
  const steamType = normalizedText(metadata.steamType).replace(/[^a-z]/g, '');
  const igdbType = normalizedText(metadata.igdbType).replace(/[_-]+/g, ' ');
  const categories = uniqueStrings(metadata.categories).map(normalizedText).join(' ');
  const explicit = (applicationType, source, reason, confidence = 'high') => ({ applicationType, source, reason, confidence });

  if (steamType === 'dlc' || /\b(dlc|downloadable content|add on|expansion pass|season pass)\b/.test(igdbType)) {
    return explicit('dlc', steamType === 'dlc' ? 'steam_store' : 'igdb', 'Type DLC explicite.');
  }
  if (/\b(dedicated server|serveur dedie)\b/.test(`${name} ${categories}`)) {
    return explicit('dedicated_server', 'metadata', 'Serveur dédié identifié dans les métadonnées.');
  }
  if (['software', 'tool', 'advertising'].includes(steamType) || /\b(sdk|editor|benchmark|configuration tool|development tool|software)\b/.test(`${name} ${categories}`)) {
    return explicit('software_tool', steamType ? 'steam_store' : 'name_signal', 'Logiciel ou outil technique identifié.');
  }
  if (steamType === 'demo' || /\b(demo|trial)\b/.test(igdbType) || /\b(demo|demonstration)\b/.test(name)) {
    return explicit('demo', steamType === 'demo' ? 'steam_store' : 'metadata', 'Version de démonstration identifiée.');
  }
  if (/\b(playtest|public test|public testing|test public|test server|pts)\b/.test(`${name} ${igdbType}`)) {
    return explicit('public_test', 'metadata', 'Version de test public identifiée.');
  }
  if (/\b(prototype|jam build|proof of concept)\b/.test(`${name} ${igdbType}`)) {
    return explicit('prototype', 'metadata', 'Prototype identifié.');
  }
  if (/\b(beta|alpha|early test)\b/.test(`${name} ${igdbType}`)) {
    return explicit('beta', 'metadata', 'Version bêta ou alpha identifiée.');
  }
  if (/\b(multiplayer component|multiplayer only|multijoueur)\b/.test(`${name} ${igdbType}`)) {
    return explicit('multiplayer_component', 'metadata', 'Composant multijoueur distinct identifié.');
  }
  if (['game', 'mod'].includes(steamType) || /\b(main game|remake|remaster|port|standalone expansion|expanded game|episode)\b/.test(igdbType)) {
    return explicit('full_game', steamType ? 'steam_store' : 'igdb', 'Jeu jouable identifié par le fournisseur.');
  }
  if (metadata.ownedGame) return explicit('full_game', 'steam_library', 'Entrée de bibliothèque Steam sans signal contraire.', 'low');
  return explicit('unknown', 'unclassified', 'Type insuffisamment documenté.', 'low');
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

function repairMetadataStatuses071(db) {
  const markerKey = 'migration_071_status_repair';
  const existingMarker = db.prepare('SELECT value FROM settings WHERE key = ?').get(markerKey)?.value;
  let result = { applied: false, marker: existingMarker || null };
  if (!existingMarker) result = transaction(db, () => {
    const repairedFromSource = Number(db.prepare(`UPDATE games
      SET metadata_status = 'synced', metadata_error = NULL, next_retry_at = NULL
      WHERE metadata_status = 'pending'
        AND metadata_updated_at IS NOT NULL
        AND metadata_source IN ('steam_store', 'igdb')`).run().changes);

    // A completed IGDB fallback may be recovered from the persistent exact-AppID cache.
    // Existing game values win; the cache only fills fields that are absent.
    const repairedFromCache = Number(db.prepare(`UPDATE games
      SET metadata_status = 'synced',
          metadata_error = NULL,
          next_retry_at = NULL,
          metadata_source = 'igdb',
          metadata_sources = '["igdb"]',
          metadata_provider_id = COALESCE(metadata_provider_id, (
            SELECT provider_id FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          )),
          igdb_provider_id = COALESCE(igdb_provider_id, (
            SELECT provider_id FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          )),
          name = CASE WHEN name IS NULL OR name = '' THEN COALESCE((
            SELECT name FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          ), name) ELSE name END,
          genres = CASE WHEN genres IS NULL OR genres = '' OR genres = '[]' THEN COALESCE((
            SELECT genres FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          ), '[]') ELSE genres END,
          themes = CASE WHEN themes IS NULL OR themes = '' OR themes = '[]' THEN COALESCE((
            SELECT themes FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          ), '[]') ELSE themes END,
          platforms = CASE WHEN platforms IS NULL OR platforms = '' OR platforms = '[]' THEN COALESCE((
            SELECT platforms FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          ), '[]') ELSE platforms END,
          metadata_cover_url = COALESCE(metadata_cover_url, (
            SELECT cover_url FROM metadata_cache c WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT)
          ))
      WHERE metadata_status = 'pending'
        AND metadata_updated_at IS NOT NULL
        AND (metadata_source IS NULL OR metadata_source = '')
        AND EXISTS (
          SELECT 1 FROM metadata_cache c
          WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT) AND c.found = 1
        )`).run().changes);

    const repairedUnavailable = Number(db.prepare(`UPDATE games
      SET metadata_status = 'unavailable',
          metadata_error = COALESCE(NULLIF(metadata_error, ''), 'Aucune fiche Steam Store ni correspondance IGDB par AppID.'),
          next_retry_at = NULL,
          metadata_source = NULL,
          metadata_sources = '[]'
      WHERE metadata_status = 'pending'
        AND metadata_updated_at IS NOT NULL
        AND (metadata_source IS NULL OR metadata_source = '')
        AND EXISTS (
          SELECT 1 FROM metadata_cache c
          WHERE c.provider = 'igdb' AND c.external_id = CAST(games.appid AS TEXT) AND c.found = 0
        )`).run().changes);

    const marker = JSON.stringify({
      completedAt: nowIso(),
      repairedSynced: repairedFromSource + repairedFromCache,
      repairedFromSource,
      repairedFromCache,
      repairedUnavailable
    });
    db.prepare(`INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(markerKey, marker, nowIso());
    return { applied: true, marker, repairedFromSource, repairedFromCache, repairedUnavailable };
  });
  // A process interrupted while a request was in flight must always be resumable,
  // but it must not be mistaken for a status damaged by the V0.7.0 migration.
  const interrupted = Number(db.prepare("UPDATE games SET metadata_status = 'pending' WHERE metadata_status = 'syncing'").run().changes);
  return { ...result, interrupted };
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
      themes TEXT NOT NULL DEFAULT '[]',
      platforms TEXT NOT NULL DEFAULT '[]',
      steam_type TEXT,
      igdb_game_type TEXT,
      application_type TEXT NOT NULL DEFAULT 'unknown',
      classification_source TEXT,
      classification_reason TEXT,
      classification_confidence TEXT NOT NULL DEFAULT 'low',
      metadata_status TEXT NOT NULL DEFAULT 'pending',
      metadata_error TEXT,
      metadata_attempts INTEGER NOT NULL DEFAULT 0,
      metadata_updated_at TEXT,
      next_retry_at TEXT,
      metadata_source TEXT,
      metadata_sources TEXT NOT NULL DEFAULT '[]',
      metadata_provider_id TEXT,
      igdb_provider_id TEXT,
      metadata_cover_url TEXT,
      steam_short_description TEXT,
      steam_about TEXT,
      steam_categories TEXT NOT NULL DEFAULT '[]',
      igdb_summary TEXT,
      igdb_storyline TEXT,
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
    CREATE TABLE IF NOT EXISTS metadata_cache (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      provider_id TEXT,
      name TEXT,
      genres TEXT NOT NULL DEFAULT '[]',
      themes TEXT NOT NULL DEFAULT '[]',
      platforms TEXT NOT NULL DEFAULT '[]',
      game_type TEXT,
      cover_url TEXT,
      summary TEXT,
      storyline TEXT,
      found INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY(provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS game_manual_overrides (
      appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
      display_name TEXT,
      application_type TEXT,
      genres TEXT,
      themes TEXT,
      platforms TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'admin'
    );
    CREATE TABLE IF NOT EXISTS igdb_manual_matches (
      appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
      igdb_game_id INTEGER,
      status TEXT NOT NULL DEFAULT 'unmatched',
      updated_at TEXT NOT NULL,
      CHECK (status IN ('unmatched', 'confirmed', 'rejected'))
    );
    CREATE TABLE IF NOT EXISTS recommendation_cache (
      appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
      algorithm_version TEXT NOT NULL,
      score REAL NOT NULL,
      reasons TEXT NOT NULL DEFAULT '[]',
      factors TEXT NOT NULL DEFAULT '{}',
      generated_at TEXT NOT NULL
    );
  `);

  // Migration non destructive depuis V0.5.
  const existing = new Set(db.prepare('PRAGMA table_info(games)').all().map((row) => row.name));
  const migratingFromPre061 = !existing.has('metadata_source');
  const additions = {
    playtime_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_windows_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_mac_forever: 'INTEGER NOT NULL DEFAULT 0',
    playtime_linux_forever: 'INTEGER NOT NULL DEFAULT 0',
    rtime_last_played: 'INTEGER NOT NULL DEFAULT 0',
    img_icon_url: "TEXT NOT NULL DEFAULT ''",
    genres: "TEXT NOT NULL DEFAULT '[]'",
    themes: "TEXT NOT NULL DEFAULT '[]'",
    platforms: "TEXT NOT NULL DEFAULT '[]'",
    steam_type: 'TEXT',
    igdb_game_type: 'TEXT',
    application_type: "TEXT NOT NULL DEFAULT 'unknown'",
    classification_source: 'TEXT',
    classification_reason: 'TEXT',
    classification_confidence: "TEXT NOT NULL DEFAULT 'low'",
    metadata_status: "TEXT NOT NULL DEFAULT 'pending'",
    metadata_error: 'TEXT',
    metadata_attempts: 'INTEGER NOT NULL DEFAULT 0',
    metadata_updated_at: 'TEXT',
    next_retry_at: 'TEXT',
    metadata_source: 'TEXT',
    metadata_sources: "TEXT NOT NULL DEFAULT '[]'",
    metadata_provider_id: 'TEXT',
    igdb_provider_id: 'TEXT',
    metadata_cover_url: 'TEXT',
    steam_short_description: 'TEXT',
    steam_about: 'TEXT',
    steam_categories: "TEXT NOT NULL DEFAULT '[]'",
    igdb_summary: 'TEXT',
    igdb_storyline: 'TEXT',
    source_steamid: 'TEXT',
    last_seen_at: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT'
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE games ADD COLUMN ${column} ${definition}`);
  }
  const cacheColumns = new Set(db.prepare('PRAGMA table_info(metadata_cache)').all().map((row) => row.name));
  const cacheAdditions = {
    themes: "TEXT NOT NULL DEFAULT '[]'",
    platforms: "TEXT NOT NULL DEFAULT '[]'",
    game_type: 'TEXT',
    summary: 'TEXT',
    storyline: 'TEXT'
  };
  for (const [column, definition] of Object.entries(cacheAdditions)) {
    if (!cacheColumns.has(column)) db.exec(`ALTER TABLE metadata_cache ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_metadata_status ON games(metadata_status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_metadata_cache_expiry ON metadata_cache(provider, expires_at);
    CREATE INDEX IF NOT EXISTS idx_games_application_type ON games(application_type);
    UPDATE games SET genres = '[]' WHERE genres IS NULL OR genres = '';
    UPDATE games SET themes = '[]' WHERE themes IS NULL OR themes = '';
    UPDATE games SET platforms = '[]' WHERE platforms IS NULL OR platforms = '';
    UPDATE games SET metadata_sources = CASE
      WHEN metadata_sources IS NULL OR metadata_sources = '' OR metadata_sources = '[]'
        THEN CASE WHEN metadata_source IS NULL OR metadata_source = '' THEN '[]' ELSE '["' || metadata_source || '"]' END
      ELSE metadata_sources END;
  `);
  if (migratingFromPre061) {
    db.exec(`
      UPDATE games SET metadata_source = 'steam_store'
        WHERE metadata_status = 'synced' AND (metadata_source IS NULL OR metadata_source = '');
      UPDATE games SET metadata_status = 'pending', metadata_error = NULL
        WHERE metadata_status = 'unavailable' AND (metadata_source IS NULL OR metadata_source = '');
    `);
  }
  repairMetadataStatuses071(db);
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
  const provider = String(options.provider || 'Steam');
  const providerCode = provider.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'upstream';
  try {
    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: {
        'user-agent': `SiivoLabs-Backlog/${VERSION}`,
        accept: 'application/json',
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new HttpError(502, `${provider} a renvoyé une réponse illisible.`, `${providerCode}_invalid_response`); }
    }
    if (!response.ok) {
      const error = new HttpError(response.status === 429 ? 429 : 502, `${provider} a répondu HTTP ${response.status}.`, `${providerCode}_upstream_error`);
      error.upstreamStatus = response.status;
      error.retryAfter = Number(response.headers.get('retry-after')) || null;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, `${provider} n'a pas répondu à temps.`, `${providerCode}_timeout`);
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
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.cloudflare.steamstatic.com https://shared.cloudflare.steamstatic.com https://images.igdb.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
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
  const twitchClientId = String(env.TWITCH_CLIENT_ID || '').trim();
  const twitchClientSecret = String(env.TWITCH_CLIENT_SECRET || '').trim();
  const igdbConfigured = Boolean(twitchClientId && twitchClientSecret);
  const configuredDelay = env.STEAM_REQUEST_INTERVAL_MS ?? env.METADATA_DELAY_MS ?? 150;
  const metadataDelayMs = Number.isFinite(Number(configuredDelay)) ? Math.max(0, Number(configuredDelay)) : 150;
  const metadataConcurrency = Math.max(1, Math.min(8, Math.trunc(Number(env.STEAM_METADATA_CONCURRENCY)) || 4));
  const igdbBatchSize = Math.max(1, Math.min(200, Math.trunc(Number(env.IGDB_BATCH_SIZE)) || 100));
  const igdbCacheTtlHours = Math.max(1, Number(env.IGDB_CACHE_TTL_HOURS) || 720);
  const igdbMissCacheTtlHours = Math.max(1, Number(env.IGDB_MISS_CACHE_TTL_HOURS) || 24);
  const metadataLanguage = String(env.METADATA_LANGUAGE || 'french');
  const metadataCountry = String(env.METADATA_COUNTRY || 'FR');
  const production = env.NODE_ENV === 'production';
  const trustProxy = booleanFromEnv(env.TRUST_PROXY, false);
  if (!fetchImpl) throw new Error('fetch is required');

  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);
  const settings = createSettingsStore(db);
  const classificationUpdate = db.prepare(`UPDATE games SET application_type = ?, classification_source = ?,
    classification_reason = ?, classification_confidence = ?, updated_at = ? WHERE appid = ?`);
  const manualOverrideLookup = db.prepare('SELECT * FROM game_manual_overrides WHERE appid = ?');
  const igdbManualLookup = db.prepare('SELECT igdb_game_id, status, updated_at FROM igdb_manual_matches WHERE appid = ?');

  function persistClassification(appid, metadata) {
    const result = classifyApplication(metadata);
    classificationUpdate.run(result.applicationType, result.source, result.reason, result.confidence, nowIso(), Number(appid));
    return result;
  }

  const needsClassification = db.prepare(`SELECT appid, name, steam_type, igdb_game_type FROM games
    WHERE application_type IS NULL OR application_type = '' OR application_type = 'unknown'`).all();
  for (const row of needsClassification) {
    persistClassification(row.appid, {
      name: row.name,
      steamType: row.steam_type,
      igdbType: row.igdb_game_type,
      ownedGame: true
    });
  }

  const job = {
    running: false,
    pauseRequested: false,
    currentAppid: null,
    currentAppids: [],
    phase: 'idle',
    startedAt: null,
    stoppedAt: null,
    processedThisRun: 0,
    igdbCachedThisRun: 0,
    igdbLastError: null,
    lastMessage: 'En attente d’un lancement manuel.'
  };

  const igdbAuth = { accessToken: null, expiresAt: 0 };
  let nextIgdbRequestAt = 0;
  const cacheLookup = db.prepare(`SELECT * FROM metadata_cache
    WHERE provider = ? AND external_id = ? AND expires_at > ?`);
  const cacheUpsert = db.prepare(`
    INSERT INTO metadata_cache(provider, external_id, provider_id, name, genres, themes, platforms, game_type, cover_url, summary, storyline, found, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      provider_id = excluded.provider_id,
      name = excluded.name,
      genres = excluded.genres,
      themes = excluded.themes,
      platforms = excluded.platforms,
      game_type = excluded.game_type,
      cover_url = excluded.cover_url,
      summary = excluded.summary,
      storyline = excluded.storyline,
      found = excluded.found,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `);

  function normalizeIgdbCover(value) {
    const url = String(value || '').trim();
    if (!url) return null;
    const absolute = url.startsWith('//') ? `https:${url}` : url;
    return absolute.replace('/t_thumb/', '/t_cover_big/').slice(0, 500);
  }

  function getCachedIgdb(appid) {
    const row = cacheLookup.get('igdb', String(appid), nowIso());
    if (!row) return null;
    return {
      found: Boolean(row.found),
      providerId: row.provider_id || null,
      name: row.name || '',
      genres: safeJsonParse(row.genres, []),
      themes: safeJsonParse(row.themes, []),
      platforms: safeJsonParse(row.platforms, []),
      gameType: row.game_type || null,
      coverUrl: row.cover_url || null,
      summary: row.summary || null,
      storyline: row.storyline || null
    };
  }

  async function getIgdbToken(forceRefresh = false) {
    if (!igdbConfigured) throw new HttpError(503, 'IGDB n’est pas configuré.', 'igdb_not_configured');
    if (!forceRefresh && igdbAuth.accessToken && Date.now() < igdbAuth.expiresAt - 60_000) return igdbAuth.accessToken;
    const url = new URL('https://id.twitch.tv/oauth2/token');
    url.searchParams.set('client_id', twitchClientId);
    url.searchParams.set('client_secret', twitchClientSecret);
    url.searchParams.set('grant_type', 'client_credentials');
    const payload = await fetchJson(fetchImpl, url, { method: 'POST', provider: 'Twitch OAuth' });
    if (!payload?.access_token) throw new HttpError(502, 'Twitch OAuth n’a pas fourni de jeton IGDB.', 'igdb_token_missing');
    igdbAuth.accessToken = String(payload.access_token);
    igdbAuth.expiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return igdbAuth.accessToken;
  }

  async function igdbQuery(endpoint, body, retryAuth = true) {
    const token = await getIgdbToken();
    const waitMs = Math.max(0, nextIgdbRequestAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextIgdbRequestAt = Date.now() + 260;
    try {
      return await fetchJson(fetchImpl, `https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        provider: 'IGDB',
        timeoutMs: 20_000,
        headers: {
          'Client-ID': twitchClientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain'
        },
        body
      });
    } catch (error) {
      if (retryAuth && error.upstreamStatus === 401) {
        igdbAuth.accessToken = null;
        igdbAuth.expiresAt = 0;
        await getIgdbToken(true);
        return igdbQuery(endpoint, body, false);
      }
      throw error;
    }
  }

  async function resolveIgdbSteamSourceId() {
    const cached = Number(settings.get('igdb_steam_source_id', 0));
    if (cached > 0) return cached;
    const sources = await igdbQuery('external_game_sources', 'fields id,name; where name = "Steam"; limit 10;');
    const steam = Array.isArray(sources)
      ? sources.find((source) => String(source.name || '').toLowerCase() === 'steam')
      : null;
    if (!steam?.id) return null;
    settings.set('igdb_steam_source_id', Number(steam.id));
    return Number(steam.id);
  }

  function cacheIgdbBatch(appids, records) {
    const byAppid = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const appid = String(record.uid || '');
      if (!/^\d+$/.test(appid) || !record.game || typeof record.game !== 'object') continue;
      if (!byAppid.has(appid)) byAppid.set(appid, record);
    }
    const fetchedAt = nowIso();
    transaction(db, () => {
      for (const appid of appids) {
        const record = byAppid.get(String(appid));
        const game = record?.game;
        const found = Boolean(game && typeof game === 'object');
        const genres = found && Array.isArray(game.genres)
          ? [...new Set(game.genres.map((genre) => String(genre?.name || '').trim()).filter(Boolean))]
          : [];
        const themes = found && Array.isArray(game.themes)
          ? [...new Set(game.themes.map((theme) => String(theme?.name || '').trim()).filter(Boolean))]
          : [];
        const platforms = found && Array.isArray(game.platforms)
          ? [...new Set(game.platforms.map((platform) => String(platform?.name || '').trim()).filter(Boolean))]
          : [];
        const gameType = found
          ? String(game.game_type?.type || game.game_type?.name || game.game_type || game.category || '').trim()
          : '';
        const summary = found ? String(game.summary || '').trim().slice(0, 12000) : '';
        const storyline = found ? String(game.storyline || '').trim().slice(0, 12000) : '';
        const expiresAt = new Date(Date.now() + (found ? igdbCacheTtlHours : igdbMissCacheTtlHours) * 3_600_000).toISOString();
        cacheUpsert.run(
          'igdb', String(appid), found ? String(game.id || '') : null,
          found ? String(game.name || '').slice(0, 300) : null,
          JSON.stringify(genres), JSON.stringify(themes), JSON.stringify(platforms), gameType || null,
          found ? normalizeIgdbCover(game.cover?.url) : null,
           summary || null, storyline || null, found ? 1 : 0, fetchedAt, expiresAt
        );
      }
    });
    return byAppid.size;
  }

  async function fetchIgdbBatch(appids) {
    const quoted = appids.map((appid) => `"${String(appid)}"`).join(',');
    let sourceId = null;
    try { sourceId = await resolveIgdbSteamSourceId(); } catch (error) {
      if ([401, 403, 429].includes(error.upstreamStatus)) throw error;
    }
    const modernFields = 'fields uid,game.id,game.name,game.summary,game.storyline,game.genres.name,game.themes.name,game.platforms.name,game.game_type.type,game.category,game.cover.url;';
    const legacyFields = 'fields uid,game.id,game.name,game.summary,game.storyline,game.genres.name,game.themes.name,game.platforms.name,game.category,game.cover.url;';
    const queryExternalGames = async (filter) => {
      try {
        return await igdbQuery('external_games', `${modernFields} where ${filter}; limit ${appids.length};`);
      } catch (error) {
        if (error.upstreamStatus !== 400) throw error;
        return igdbQuery('external_games', `${legacyFields} where ${filter}; limit ${appids.length};`);
      }
    };
    let records;
    if (sourceId) {
      try {
        records = await queryExternalGames(`external_game_source = ${sourceId} & uid = (${quoted})`);
      } catch (error) {
        if (error.upstreamStatus !== 400) throw error;
      }
    }
    if (!records) {
      records = await queryExternalGames(`category = 1 & uid = (${quoted})`);
    }
    return cacheIgdbBatch(appids, records);
  }

  async function prefetchIgdb(rows) {
    if (!igdbConfigured || !rows.length) return true;
    const missing = rows
      .map((row) => Number(row.appid))
      .filter((appid) => !getCachedIgdb(appid));
    for (let offset = 0; offset < missing.length && !job.pauseRequested; offset += igdbBatchSize) {
      const batch = missing.slice(offset, offset + igdbBatchSize);
      job.lastMessage = `Préchargement IGDB : ${Math.min(offset + batch.length, missing.length)} / ${missing.length}.`;
      job.igdbCachedThisRun += await fetchIgdbBatch(batch);
    }
    return true;
  }

  function requireAdmin(req) {
    if (!adminToken) throw new HttpError(503, 'Administration désactivée : configure ADMIN_TOKEN dans Dockge.', 'admin_not_configured');
    if (!constantTimeEqual(req.headers['x-admin-token'] || '', adminToken)) {
      throw new HttpError(401, "Jeton d'administration incorrect.", 'unauthorized');
    }
  }

  function publicGame(row, manualOverride, manualMatch) {
    const manual = manualOverride === undefined ? manualOverrideLookup.get(Number(row.appid)) : manualOverride;
    const igdbManualMatch = manualMatch === undefined ? igdbManualLookup.get(Number(row.appid)) : manualMatch;
    const sourceGenres = safeJsonParse(row.genres, []);
    const sourceThemes = safeJsonParse(row.themes, []);
    const sourcePlatforms = safeJsonParse(row.platforms, []);
    const manualFields = manual ? ['display_name', 'application_type', 'genres', 'themes', 'platforms']
      .filter((field) => manual[field] != null) : [];
    return {
      appid: Number(row.appid),
      name: manual?.display_name || row.name || `App ${row.appid}`,
      source_name: row.name || `App ${row.appid}`,
      playtime_forever: Number(row.playtime_forever || 0),
      playtime_windows_forever: Number(row.playtime_windows_forever || 0),
      playtime_mac_forever: Number(row.playtime_mac_forever || 0),
      playtime_linux_forever: Number(row.playtime_linux_forever || 0),
      rtime_last_played: Number(row.rtime_last_played || 0),
      img_icon_url: row.img_icon_url || '',
      genres: manual?.genres != null ? safeJsonParse(manual.genres, []) : sourceGenres,
      themes: manual?.themes != null ? safeJsonParse(manual.themes, []) : sourceThemes,
      platforms: manual?.platforms != null ? safeJsonParse(manual.platforms, []) : sourcePlatforms,
      application_type: manual?.application_type || (APPLICATION_TYPES.includes(row.application_type) ? row.application_type : 'unknown'),
      source_application_type: APPLICATION_TYPES.includes(row.application_type) ? row.application_type : 'unknown',
      classification_source: row.classification_source || null,
      classification_reason: row.classification_reason || null,
      classification_confidence: row.classification_confidence || 'low',
      metadata_status: STATUS_VALUES.includes(row.metadata_status) ? row.metadata_status : 'pending',
      metadata_error: row.metadata_error || null,
      metadata_updated_at: row.metadata_updated_at || null,
      metadata_source: row.metadata_source || null,
      metadata_sources: safeJsonParse(row.metadata_sources, row.metadata_source ? [row.metadata_source] : []),
      metadata_provider_id: row.metadata_provider_id || null,
      igdb_provider_id: row.igdb_provider_id || null,
      manual_override: Boolean(manualFields.length),
      manual_fields: manualFields,
      manual_updated_at: manual?.updated_at || null,
      source_values: {
        name: row.name || `App ${row.appid}`,
        application_type: APPLICATION_TYPES.includes(row.application_type) ? row.application_type : 'unknown',
        genres: sourceGenres,
        themes: sourceThemes,
        platforms: sourcePlatforms
      },
      igdb_manual_match: igdbManualMatch || { status: 'unmatched' },
      header_image: row.metadata_cover_url || `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(row.appid)}/header.jpg`
    };
  }

  function allPublicGames() {
    const overrides = new Map(db.prepare('SELECT * FROM game_manual_overrides').all().map((row) => [Number(row.appid), row]));
    const matches = new Map(db.prepare('SELECT appid, igdb_game_id, status, updated_at FROM igdb_manual_matches').all().map((row) => [Number(row.appid), row]));
    return db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE, appid').all()
      .map((row) => publicGame(row, overrides.get(Number(row.appid)) || null, matches.get(Number(row.appid)) || null));
  }

  function gameByAppid(appid) {
    const row = db.prepare('SELECT * FROM games WHERE appid = ?').get(Number(appid));
    if (!row) throw new HttpError(404, 'Jeu introuvable dans la bibliothèque.', 'game_not_found');
    return publicGame(row);
  }

  function aiPilotSelectionState() {
    const available = new Set(db.prepare('SELECT appid FROM games').all().map((row) => Number(row.appid)));
    const stored = safeJsonParse(settings.get('ai_pilot_selection_appids', '[]'), []);
    const appids = Array.isArray(stored)
      ? [...new Set(stored.map(Number).filter((appid) => Number.isInteger(appid) && available.has(appid)))].slice(0, AI_PILOT_POC_LIMIT)
      : [];
    const confirmedAt = settings.get('ai_pilot_selection_confirmed_at');
    return {
      appids,
      confirmed: Boolean(confirmedAt && appids.length),
      confirmedAt: confirmedAt || null,
      pocLimit: AI_PILOT_POC_LIMIT,
      temporaryLimit: true,
      analysisAllowed: Boolean(confirmedAt && appids.length)
    };
  }

  function validateAiPilotSelection(value) {
    if (!Array.isArray(value)) throw new HttpError(400, 'appids doit être une liste.', 'invalid_ai_selection');
    if (value.length < 1) throw new HttpError(400, 'Sélectionne au moins un jeu avant validation.', 'empty_ai_selection');
    if (value.length > AI_PILOT_POC_LIMIT) {
      throw new HttpError(400, `Le POC accepte au maximum ${AI_PILOT_POC_LIMIT} jeux. Cette limite ne s’applique pas à l’architecture future.`, 'ai_poc_limit');
    }
    const appids = value.map(Number);
    if (appids.some((appid) => !Number.isInteger(appid) || appid < 1) || new Set(appids).size !== appids.length) {
      throw new HttpError(400, 'La sélection contient un AppID invalide ou dupliqué.', 'invalid_ai_selection');
    }
    const placeholders = appids.map(() => '?').join(', ');
    const existing = new Set(db.prepare(`SELECT appid FROM games WHERE appid IN (${placeholders})`).all(...appids).map((row) => Number(row.appid)));
    const missing = appids.filter((appid) => !existing.has(appid));
    if (missing.length) throw new HttpError(400, `Jeu(x) absent(s) de la bibliothèque : ${missing.join(', ')}.`, 'ai_selection_game_missing');
    return appids;
  }

  function playtimeBucket(minutes) {
    if (!minutes) return 'never';
    if (minutes < 120) return 'short';
    if (minutes < 1200) return 'medium';
    return 'long';
  }

  function buildDiversifiedAiSample(limit = AI_PILOT_POC_LIMIT) {
    const allGames = allPublicGames();
    const fullGames = allGames.filter((game) => game.application_type === 'full_game');
    const candidates = fullGames.length >= Math.min(limit, allGames.length) ? fullGames : allGames;
    const remaining = [...candidates];
    const selected = [];
    const target = Math.min(limit, remaining.length);
    const coverage = {
      genres: new Set(), themes: new Set(), platforms: new Set(), statuses: new Set(), playtime: new Set()
    };

    while (selected.length < target) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const game = remaining[index];
        const newGenres = (game.genres || []).filter((value) => !coverage.genres.has(value)).length;
        const newThemes = (game.themes || []).filter((value) => !coverage.themes.has(value)).length;
        const newPlatforms = (game.platforms || []).filter((value) => !coverage.platforms.has(value)).length;
        const bucket = playtimeBucket(game.playtime_forever);
        const completeness = Math.min(4, (game.genres?.length || 0) + (game.themes?.length || 0) + (game.platforms?.length || 0));
        const score = newGenres * 8 + newThemes * 6 + newPlatforms * 2
          + (coverage.statuses.has(game.metadata_status) ? 0 : 4)
          + (coverage.playtime.has(bucket) ? 0 : 5)
          + completeness
          + (game.metadata_status === 'synced' ? 2 : 0)
          + ((Number(game.appid) * 2654435761 % 997) / 997);
        if (score > bestScore || (score === bestScore && game.name.localeCompare(remaining[bestIndex].name, 'fr') < 0)) {
          bestIndex = index;
          bestScore = score;
        }
      }
      const [game] = remaining.splice(bestIndex, 1);
      selected.push(game);
      for (const value of game.genres || []) coverage.genres.add(value);
      for (const value of game.themes || []) coverage.themes.add(value);
      for (const value of game.platforms || []) coverage.platforms.add(value);
      coverage.statuses.add(game.metadata_status);
      coverage.playtime.add(playtimeBucket(game.playtime_forever));
    }

    return {
      proposed: true,
      persisted: false,
      confirmed: false,
      appids: selected.map((game) => game.appid),
      games: selected,
      requested: limit,
      count: selected.length,
      pocLimit: AI_PILOT_POC_LIMIT,
      temporaryLimit: true,
      methodology: 'Échantillon déterministe favorisant la diversité des genres, thèmes, plateformes, états de métadonnées et niveaux de temps de jeu. Il reste modifiable et n’est jamais validé automatiquement.'
    };
  }

  function affinityProfile(games) {
    const profile = { genres: new Map(), themes: new Map(), platforms: new Map(), playedGames: 0, totalMinutes: 0 };
    for (const game of games) {
      if (game.playtime_forever <= 0 || NON_RECOMMENDABLE_TYPES.has(game.application_type)) continue;
      const weight = 1 + Math.min(6, Math.log2(1 + game.playtime_forever / 60));
      profile.playedGames += 1;
      profile.totalMinutes += game.playtime_forever;
      for (const [key, values] of [['genres', game.genres], ['themes', game.themes], ['platforms', game.platforms]]) {
        for (const value of values || []) profile[key].set(value, (profile[key].get(value) || 0) + weight);
      }
    }
    return profile;
  }

  function normalizedAffinity(map, values, cap) {
    if (!map.size || !values?.length) return { points: 0, matches: [] };
    const max = Math.max(...map.values());
    const matches = values.filter((value) => map.has(value)).sort((a, b) => map.get(b) - map.get(a) || a.localeCompare(b, 'fr'));
    const ratio = matches.slice(0, 3).reduce((sum, value) => sum + map.get(value) / max, 0) / 3;
    return { points: Math.min(cap, ratio * cap), matches };
  }

  function buildRecommendations({ limit = 12, includeNonGames = false, includePlayed = false } = {}) {
    const games = allPublicGames();
    const profile = affinityProfile(games);
    const suggestions = [];
    for (const game of games) {
      if (!includePlayed && game.playtime_forever > 0) continue;
      if (!includeNonGames && game.application_type !== 'full_game') continue;
      if (includeNonGames && NON_RECOMMENDABLE_TYPES.has(game.application_type)) {
        // Explicit opt-in: keep the entry visible but apply a strong penalty.
      } else if (NON_RECOMMENDABLE_TYPES.has(game.application_type)) continue;
      if (!['synced', 'temporary_error'].includes(game.metadata_status) || !game.metadata_source) continue;

      const genre = normalizedAffinity(profile.genres, game.genres, 42);
      const theme = normalizedAffinity(profile.themes, game.themes, 20);
      const platform = normalizedAffinity(profile.platforms, game.platforms, 10);
      const factors = {
        neverPlayed: game.playtime_forever === 0 ? 18 : 0,
        fullGame: game.application_type === 'full_game' ? 8 : -35,
        genres: genre.points,
        themes: theme.points,
        platforms: platform.points,
        source: game.metadata_source === 'steam_store' ? 4 : 2,
        completeness: Math.min(5, (game.genres.length ? 2 : 0) + (game.themes.length ? 2 : 0) + (game.platforms.length ? 1 : 0))
      };
      const score = Math.round(Object.values(factors).reduce((sum, value) => sum + value, 0) * 10) / 10;
      const reasons = [];
      if (game.playtime_forever === 0) reasons.push('Jamais lancé : priorité à la découverte.');
      if (genre.matches.length) reasons.push(`Genres proches de tes habitudes : ${genre.matches.slice(0, 3).join(', ')}.`);
      if (theme.matches.length) reasons.push(`Thèmes appréciés : ${theme.matches.slice(0, 2).join(', ')}.`);
      if (platform.matches.length) reasons.push(`Plateformes cohérentes avec ton historique : ${platform.matches.slice(0, 2).join(', ')}.`);
      if (!genre.matches.length && !theme.matches.length && profile.playedGames === 0) reasons.push('Suggestion de démarrage fondée sur les métadonnées disponibles.');
      reasons.push(`Type : ${game.application_type}; source : ${game.metadata_source}.`);
      suggestions.push({ ...game, recommendation_score: score, recommendation_reasons: reasons, recommendation_factors: factors });
    }
    suggestions.sort((a, b) => b.recommendation_score - a.recommendation_score || a.name.localeCompare(b.name, 'fr') || a.appid - b.appid);
    const selected = suggestions.slice(0, limit);
    const generatedAt = nowIso();
    transaction(db, () => {
      db.prepare('DELETE FROM recommendation_cache').run();
      const insert = db.prepare(`INSERT INTO recommendation_cache(appid, algorithm_version, score, reasons, factors, generated_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const game of selected) insert.run(game.appid, RECOMMENDATION_ALGORITHM, game.recommendation_score,
        JSON.stringify(game.recommendation_reasons), JSON.stringify(game.recommendation_factors), generatedAt);
    });
    return {
      algorithm: RECOMMENDATION_ALGORITHM,
      generatedAt,
      deterministic: true,
      filters: { includeNonGames, includePlayed },
      profile: {
        playedGames: profile.playedGames,
        totalHours: Math.round((profile.totalMinutes / 60) * 10) / 10,
        topGenres: [...profile.genres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 5).map(([name]) => name),
        topThemes: [...profile.themes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 5).map(([name]) => name)
      },
      suggestions: selected
    };
  }

  function validateStringList(value, field) {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length > 30) throw new HttpError(400, `${field} doit être une liste de 30 valeurs maximum.`, 'invalid_manual_field');
    if (value.some((item) => typeof item !== 'string')) throw new HttpError(400, `${field} doit contenir uniquement du texte.`, 'invalid_manual_field');
    const values = uniqueStrings(value);
    if (values.length !== value.length || values.some((item) => item.length > 80)) {
      throw new HttpError(400, `${field} contient une valeur vide, dupliquée ou trop longue.`, 'invalid_manual_field');
    }
    return values;
  }

  function validateManualOverride(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Correction manuelle invalide.', 'invalid_manual_fields');
    const allowed = new Set(['display_name', 'application_type', 'genres', 'themes', 'platforms']);
    const keys = Object.keys(body || {});
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new HttpError(400, 'Champs de correction manuelle invalides.', 'invalid_manual_fields');
    const result = {};
    if ('display_name' in body) {
      if (body.display_name === null) result.display_name = null;
      else {
        if (typeof body.display_name !== 'string') throw new HttpError(400, 'Le titre doit être du texte.', 'invalid_display_name');
        const value = body.display_name.trim();
        if (!value || value.length > 300) throw new HttpError(400, 'Le titre doit contenir entre 1 et 300 caractères.', 'invalid_display_name');
        result.display_name = value;
      }
    }
    if ('application_type' in body) {
      if (body.application_type === null) result.application_type = null;
      else if (typeof body.application_type !== 'string' || !APPLICATION_TYPES.includes(body.application_type)) throw new HttpError(400, 'Type d’application invalide.', 'invalid_application_type');
      else result.application_type = body.application_type;
    }
    for (const field of ['genres', 'themes', 'platforms']) if (field in body) result[field] = validateStringList(body[field], field);
    return result;
  }

  function saveManualOverride(appid, patch) {
    gameByAppid(appid);
    const current = manualOverrideLookup.get(Number(appid)) || {};
    const merged = {
      display_name: 'display_name' in patch ? patch.display_name : current.display_name ?? null,
      application_type: 'application_type' in patch ? patch.application_type : current.application_type ?? null,
      genres: 'genres' in patch ? patch.genres : (current.genres == null ? null : safeJsonParse(current.genres, [])),
      themes: 'themes' in patch ? patch.themes : (current.themes == null ? null : safeJsonParse(current.themes, [])),
      platforms: 'platforms' in patch ? patch.platforms : (current.platforms == null ? null : safeJsonParse(current.platforms, []))
    };
    if (Object.values(merged).every((value) => value == null)) db.prepare('DELETE FROM game_manual_overrides WHERE appid = ?').run(Number(appid));
    else db.prepare(`INSERT INTO game_manual_overrides(appid, display_name, application_type, genres, themes, platforms, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'admin')
      ON CONFLICT(appid) DO UPDATE SET display_name = excluded.display_name, application_type = excluded.application_type,
        genres = excluded.genres, themes = excluded.themes, platforms = excluded.platforms,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(Number(appid), merged.display_name, merged.application_type,
        merged.genres == null ? null : JSON.stringify(merged.genres),
        merged.themes == null ? null : JSON.stringify(merged.themes),
        merged.platforms == null ? null : JSON.stringify(merged.platforms), nowIso());
    return gameByAppid(appid);
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
      application_type, classification_source, classification_reason, classification_confidence,
      source_steamid, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      playtime_forever = excluded.playtime_forever,
      playtime_windows_forever = excluded.playtime_windows_forever,
      playtime_mac_forever = excluded.playtime_mac_forever,
      playtime_linux_forever = excluded.playtime_linux_forever,
      rtime_last_played = excluded.rtime_last_played,
      img_icon_url = excluded.img_icon_url,
      application_type = CASE WHEN games.steam_type IS NULL AND games.igdb_game_type IS NULL THEN excluded.application_type ELSE games.application_type END,
      classification_source = CASE WHEN games.steam_type IS NULL AND games.igdb_game_type IS NULL THEN excluded.classification_source ELSE games.classification_source END,
      classification_reason = CASE WHEN games.steam_type IS NULL AND games.igdb_game_type IS NULL THEN excluded.classification_reason ELSE games.classification_reason END,
      classification_confidence = CASE WHEN games.steam_type IS NULL AND games.igdb_game_type IS NULL THEN excluded.classification_confidence ELSE games.classification_confidence END,
      source_steamid = excluded.source_steamid,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);

  function importGames(steamid, profileName, games) {
    transaction(db, () => {
      const timestamp = nowIso();
      for (const game of games) {
        const classification = classifyApplication({ name: game.name, ownedGame: true });
        upsertGame.run(
          Number(game.appid), String(game.name || `App ${game.appid}`).slice(0, 300),
          Number(game.playtime_forever || 0), Number(game.playtime_windows_forever || 0),
          Number(game.playtime_mac_forever || 0), Number(game.playtime_linux_forever || 0),
          Number(game.rtime_last_played || 0), String(game.img_icon_url || '').slice(0, 200),
          classification.applicationType, classification.source, classification.reason, classification.confidence,
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

  function updateFromIgdb(appid, cache, options = {}) {
    const timestamp = nowIso();
    const status = options.status || 'synced';
    const classification = classifyApplication({ name: cache.name, igdbType: cache.gameType, ownedGame: true });
    db.prepare(`UPDATE games SET name = COALESCE(NULLIF(?, ''), name), genres = ?, themes = ?, platforms = ?,
      igdb_game_type = ?, application_type = ?, classification_source = ?, classification_reason = ?,
      classification_confidence = ?, metadata_status = ?,
      metadata_error = ?, metadata_attempts = metadata_attempts + 1, metadata_updated_at = ?,
      next_retry_at = ?, metadata_source = 'igdb', metadata_sources = '["igdb"]', metadata_provider_id = ?,
      igdb_provider_id = ?, metadata_cover_url = ?, igdb_summary = ?, igdb_storyline = ?,
      updated_at = ? WHERE appid = ?`)
      .run(
        String(cache.name || '').slice(0, 300), JSON.stringify(cache.genres || []), JSON.stringify(cache.themes || []),
        JSON.stringify(cache.platforms || []), String(cache.gameType || '').slice(0, 100),
        classification.applicationType, classification.source, classification.reason, classification.confidence, status,
        options.error || null, timestamp, options.retryAt || null, cache.providerId,
        cache.providerId, cache.coverUrl, cache.summary, cache.storyline, timestamp, appid
      );
  }

  function markUnavailable(appid) {
    const timestamp = nowIso();
    db.prepare(`UPDATE games SET metadata_status = 'unavailable', metadata_error = ?,
      metadata_attempts = metadata_attempts + 1, metadata_updated_at = ?, next_retry_at = NULL,
      metadata_source = NULL, metadata_sources = '[]', metadata_provider_id = NULL, igdb_provider_id = NULL, metadata_cover_url = NULL,
      updated_at = ? WHERE appid = ?`)
      .run('Aucune fiche Steam Store ni correspondance IGDB par AppID.', timestamp, timestamp, appid);
  }

  function markTemporaryError(row, error, cache = null) {
    const appid = Number(row.appid);
    const attempts = Number(row.metadata_attempts || 0) + 1;
    const retrySeconds = error.retryAfter || Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 6)));
    const timestamp = nowIso();
    const retryAt = new Date(Date.now() + retrySeconds * 1000).toISOString();
    const message = cache?.found
      ? `${String(error.message || 'Steam Store temporairement indisponible')} Données IGDB affichées en attendant le réessai Steam.`
      : String(error.message || 'Erreur temporaire');
    if (cache?.found) {
      const classification = classifyApplication({ name: cache.name, igdbType: cache.gameType, ownedGame: true });
      db.prepare(`UPDATE games SET name = COALESCE(NULLIF(?, ''), name), genres = ?, themes = ?, platforms = ?,
        igdb_game_type = ?, application_type = ?, classification_source = ?, classification_reason = ?,
        classification_confidence = ?, metadata_status = 'temporary_error',
        metadata_error = ?, metadata_attempts = ?, metadata_updated_at = ?, next_retry_at = ?,
        metadata_source = 'igdb', metadata_sources = '["igdb"]', metadata_provider_id = ?, igdb_provider_id = ?,
        metadata_cover_url = ?, igdb_summary = ?, igdb_storyline = ?, updated_at = ? WHERE appid = ?`)
        .run(String(cache.name || '').slice(0, 300), JSON.stringify(cache.genres || []), JSON.stringify(cache.themes || []),
          JSON.stringify(cache.platforms || []), String(cache.gameType || '').slice(0, 100),
          classification.applicationType, classification.source, classification.reason, classification.confidence,
          message.slice(0, 500), attempts, timestamp, retryAt, cache.providerId, cache.providerId,
          cache.coverUrl, cache.summary, cache.storyline, timestamp, appid);
    } else {
      db.prepare(`UPDATE games SET metadata_status = 'temporary_error', metadata_error = ?, metadata_attempts = ?,
        metadata_updated_at = ?, next_retry_at = ?, updated_at = ? WHERE appid = ?`)
        .run(message.slice(0, 500), attempts, timestamp, retryAt, timestamp, appid);
    }
    return error.upstreamStatus === 429 ? retrySeconds * 1000 : 0;
  }

  async function enrichOne(row, igdbPrefetchOk) {
    const appid = Number(row.appid);
    try {
      const url = new URL('https://store.steampowered.com/api/appdetails');
      url.searchParams.set('appids', String(appid));
      url.searchParams.set('l', metadataLanguage);
      url.searchParams.set('cc', metadataCountry);
      const payload = await fetchJson(fetchImpl, url, { provider: 'Steam Store' });
      const entry = payload?.[String(appid)];
      if (!entry?.success || !entry.data) {
        const cache = getCachedIgdb(appid);
        if (cache?.found) updateFromIgdb(appid, cache);
        else if (igdbConfigured && !igdbPrefetchOk) {
          markTemporaryError(row, new HttpError(502, 'Fiche Steam absente ; IGDB est temporairement indisponible.', 'igdb_pending'));
        } else markUnavailable(appid);
        return 0;
      }
      const genres = Array.isArray(entry.data.genres)
        ? [...new Set(entry.data.genres.map((genre) => String(genre.description || '').trim()).filter(Boolean))]
        : [];
      const cache = getCachedIgdb(appid);
      const themes = cache?.found ? cache.themes : [];
      const steamPlatforms = Object.entries(entry.data.platforms || {}).filter(([, supported]) => Boolean(supported)).map(([platform]) => platform);
      const platforms = steamPlatforms.length ? steamPlatforms : (cache?.found ? cache.platforms : []);
      const steamType = String(entry.data.type || '').slice(0, 100);
      const categories = Array.isArray(entry.data.categories) ? entry.data.categories.map((category) => category.description) : [];
      const steamShortDescription = String(entry.data.short_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
      const steamAbout = String(entry.data.about_the_game || entry.data.detailed_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24000);
      const classification = classifyApplication({
        name: entry.data.name,
        steamType,
        igdbType: cache?.gameType,
        categories,
        ownedGame: true
      });
      const timestamp = nowIso();
      db.prepare(`UPDATE games SET name = COALESCE(NULLIF(?, ''), name), genres = ?, themes = ?, platforms = ?,
        steam_type = ?, igdb_game_type = ?, application_type = ?, classification_source = ?, classification_reason = ?,
        classification_confidence = ?, metadata_status = 'synced',
        metadata_error = NULL, metadata_attempts = metadata_attempts + 1, metadata_updated_at = ?,
        next_retry_at = NULL, metadata_source = 'steam_store', metadata_sources = ?, metadata_provider_id = ?,
        igdb_provider_id = ?, metadata_cover_url = NULL,
        steam_short_description = ?, steam_about = ?, steam_categories = ?, igdb_summary = ?, igdb_storyline = ?,
        updated_at = ? WHERE appid = ?`)
        .run(String(entry.data.name || '').slice(0, 300), JSON.stringify(genres), JSON.stringify(themes), JSON.stringify(platforms),
          steamType, String(cache?.gameType || '').slice(0, 100), classification.applicationType, classification.source,
          classification.reason, classification.confidence, timestamp,
          JSON.stringify(cache?.found ? ['steam_store', 'igdb'] : ['steam_store']), String(appid), cache?.providerId || null,
           steamShortDescription || null, steamAbout || null, JSON.stringify(categories), cache?.summary || null,
           cache?.storyline || null, timestamp, appid);
      return 0;
    } catch (error) {
      return markTemporaryError(row, error, getCachedIgdb(appid));
    }
  }

  function eligibleRows() {
    return db.prepare(`SELECT appid, metadata_attempts FROM games
      WHERE metadata_status = 'pending'
         OR (metadata_status = 'temporary_error' AND (next_retry_at IS NULL OR next_retry_at <= ?))
      ORDER BY CASE metadata_status WHEN 'pending' THEN 0 ELSE 1 END, metadata_attempts ASC, appid ASC`).all(nowIso());
  }

  function claimBatch() {
    return transaction(db, () => {
      const rows = db.prepare(`SELECT appid, metadata_attempts FROM games
        WHERE metadata_status = 'pending'
           OR (metadata_status = 'temporary_error' AND (next_retry_at IS NULL OR next_retry_at <= ?))
        ORDER BY CASE metadata_status WHEN 'pending' THEN 0 ELSE 1 END, metadata_attempts ASC, appid ASC
        LIMIT ?`).all(nowIso(), metadataConcurrency);
      const timestamp = nowIso();
      const claim = db.prepare("UPDATE games SET metadata_status = 'syncing', metadata_error = NULL, updated_at = ? WHERE appid = ?");
      for (const row of rows) claim.run(timestamp, Number(row.appid));
      return rows;
    });
  }

  async function runEnrichment() {
    if (job.running) return;
    job.running = true;
    job.pauseRequested = false;
    job.phase = 'igdb';
    job.startedAt = nowIso();
    job.stoppedAt = null;
    job.processedThisRun = 0;
    job.igdbCachedThisRun = 0;
    job.igdbLastError = null;
    let igdbPrefetchOk = !igdbConfigured;
    try {
      const rows = eligibleRows();
      if (igdbConfigured && rows.length) {
        try {
          await prefetchIgdb(rows);
          igdbPrefetchOk = true;
        } catch (error) {
          job.igdbLastError = String(error.message || 'IGDB indisponible').slice(0, 300);
          job.lastMessage = 'IGDB est temporairement indisponible ; poursuite avec Steam Store.';
        }
      }
      job.phase = 'steam';
      while (!job.pauseRequested) {
        const rowsToProcess = claimBatch();
        if (!rowsToProcess.length) {
          job.lastMessage = 'Aucun jeu éligible à enrichir pour le moment.';
          break;
        }
        job.currentAppids = rowsToProcess.map((row) => Number(row.appid));
        job.currentAppid = job.currentAppids[0] || null;
        job.lastMessage = `Enrichissement Steam Store (${rowsToProcess.length} requête(s) en parallèle).`;
        const throttles = await Promise.all(rowsToProcess.map((row) => enrichOne(row, igdbPrefetchOk)));
        job.processedThisRun += rowsToProcess.length;
        job.currentAppid = null;
        job.currentAppids = [];
        const adaptiveDelay = Math.max(metadataDelayMs, ...throttles);
        if (!job.pauseRequested && adaptiveDelay > 0) await sleep(adaptiveDelay);
      }
      if (job.pauseRequested) job.lastMessage = 'Enrichissement suspendu.';
    } finally {
      job.currentAppid = null;
      job.currentAppids = [];
      job.phase = 'idle';
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

  const aiEngine = createAiEngine({
    db,
    settings,
    fetchImpl,
    env,
    allPublicGames,
    gameByAppid,
    transaction,
    HttpError
  });

  async function handleApi(req, res, url) {
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION });
    if (req.method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, {
        version: VERSION,
        steamApiConfigured: Boolean(steamApiKey),
        igdbConfigured,
        adminConfigured: Boolean(adminToken),
        metadataConcurrency,
        manualIgdbMatchPrepared: true,
        recommendationAlgorithm: RECOMMENDATION_ALGORITHM,
        aiPilot: {
          enabled: true,
          pocLimit: AI_PILOT_POC_LIMIT,
          temporaryLimit: true,
          requiresExplicitSelectionConfirmation: true,
          analysisModel: aiEngine.config.analysisModel,
          embeddingModel: aiEngine.config.embeddingModel,
          embeddingDimensions: aiEngine.config.embeddingDimensions,
          promptVersion: aiEngine.config.promptVersion,
          searxngConfigured: aiEngine.config.searxngConfigured
        },
        activeSteamId: settings.get('active_steamid'),
        activeProfileName: settings.get('active_profile_name'),
        lastLibrarySyncAt: settings.get('last_library_sync_at'),
        lastLibrarySyncCount: Number(settings.get('last_library_sync_count', 0))
      });
    }
    if (req.method === 'GET' && pathname === '/api/library') {
      const games = allPublicGames();
      const totalMinutes = games.reduce((sum, game) => sum + game.playtime_forever, 0);
      const neverPlayed = games.filter((game) => game.playtime_forever === 0).length;
      const technical = games.filter((game) => NON_RECOMMENDABLE_TYPES.has(game.application_type)).length;
      return sendJson(res, 200, {
        games,
        stats: { total: games.length, neverPlayed, played: games.length - neverPlayed, technical, totalHours: Math.round((totalMinutes / 60) * 10) / 10 },
        profile: { steamid: settings.get('active_steamid'), name: settings.get('active_profile_name'), lastSyncAt: settings.get('last_library_sync_at') }
      });
    }
    if (req.method === 'GET' && pathname === '/api/ai-pilot/selection') {
      const selection = aiPilotSelectionState();
      const gamesById = new Map(allPublicGames().map((game) => [game.appid, game]));
      return sendJson(res, 200, { ...selection, games: selection.appids.map((appid) => gamesById.get(appid)).filter(Boolean) });
    }
    if (req.method === 'GET' && pathname === '/api/ai-pilot/sample') {
      const requested = url.searchParams.get('limit') == null ? AI_PILOT_POC_LIMIT : Number(url.searchParams.get('limit'));
      if (!Number.isInteger(requested) || requested < 1 || requested > AI_PILOT_POC_LIMIT) {
        throw new HttpError(400, `La proposition du POC doit contenir entre 1 et ${AI_PILOT_POC_LIMIT} jeux.`, 'invalid_ai_sample_limit');
      }
      return sendJson(res, 200, buildDiversifiedAiSample(requested));
    }
    if (req.method === 'POST' && pathname === '/api/ai-pilot/selection/confirm') {
      requireAdmin(req);
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant de modifier le lot validé.', 'ai_job_running');
      const body = await readJson(req);
      const appids = validateAiPilotSelection(body.appids);
      const confirmedAt = nowIso();
      transaction(db, () => {
        settings.set('ai_pilot_selection_appids', JSON.stringify(appids));
        settings.set('ai_pilot_selection_confirmed_at', confirmedAt);
      });
      const gamesById = new Map(allPublicGames().map((game) => [game.appid, game]));
      return sendJson(res, 200, {
        appids,
        games: appids.map((appid) => gamesById.get(appid)).filter(Boolean),
        confirmed: true,
        confirmedAt,
        analysisAllowed: true,
        pocLimit: AI_PILOT_POC_LIMIT,
        temporaryLimit: true,
        message: 'Sélection validée. Aucune analyse n’a été lancée automatiquement.'
      });
    }
    if (req.method === 'GET' && pathname === '/api/ai-pilot/analysis/status') {
      return sendJson(res, 200, aiEngine.statusSnapshot());
    }
    if (req.method === 'POST' && pathname === '/api/ai-pilot/analysis/test') {
      requireAdmin(req);
      return sendJson(res, 200, await aiEngine.testConnection());
    }
    if (req.method === 'POST' && (pathname === '/api/ai-pilot/analysis/start' || pathname === '/api/ai-pilot/analysis/resume')) {
      requireAdmin(req);
      if (job.running) throw new HttpError(409, 'Suspends l’enrichissement des métadonnées avant de lancer l’analyse IA.', 'metadata_job_running');
      return sendJson(res, 202, { message: pathname.endsWith('/resume') ? 'Reprise de l’analyse IA demandée.' : 'Analyse IA lancée.', status: aiEngine.start() });
    }
    if (req.method === 'POST' && pathname === '/api/ai-pilot/analysis/pause') {
      requireAdmin(req);
      return sendJson(res, 202, { message: 'Suspension demandée après le jeu en cours.', status: aiEngine.pause() });
    }
    const aiProfileRoute = pathname.match(/^\/api\/ai-pilot\/games\/(\d{1,10})\/profile$/);
    if (req.method === 'GET' && aiProfileRoute) {
      return sendJson(res, 200, { profile: aiEngine.profileFor(aiProfileRoute[1]) });
    }
    const aiSimilarRoute = pathname.match(/^\/api\/ai-pilot\/games\/(\d{1,10})\/similar$/);
    if (req.method === 'GET' && aiSimilarRoute) {
      const limitValue = url.searchParams.get('limit');
      const limit = limitValue == null ? 10 : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new HttpError(400, 'La limite doit être comprise entre 1 et 20.', 'invalid_limit');
      return sendJson(res, 200, { suggestions: aiEngine.similarGames(aiSimilarRoute[1], limit) });
    }
    if (req.method === 'GET' && pathname === '/api/recommendations') {
      const limitValue = url.searchParams.get('limit');
      const limit = limitValue == null ? 12 : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new HttpError(400, 'La limite doit être comprise entre 1 et 24.', 'invalid_limit');
      for (const key of ['includeNonGames', 'includePlayed']) {
        const value = url.searchParams.get(key);
        if (value != null && !['0', '1'].includes(value)) throw new HttpError(400, `${key} doit valoir 0 ou 1.`, 'invalid_filter');
      }
      return sendJson(res, 200, buildRecommendations({
        limit,
        includeNonGames: url.searchParams.get('includeNonGames') === '1',
        includePlayed: url.searchParams.get('includePlayed') === '1'
      }));
    }
    const gameRoute = pathname.match(/^\/api\/games\/(\d{1,10})$/);
    if (req.method === 'GET' && gameRoute) return sendJson(res, 200, { game: gameByAppid(gameRoute[1]) });
    const manualRoute = pathname.match(/^\/api\/games\/(\d{1,10})\/manual$/);
    if (req.method === 'PATCH' && manualRoute) {
      requireAdmin(req);
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant de corriger les données sources.', 'ai_job_running');
      const patch = validateManualOverride(await readJson(req));
      return sendJson(res, 200, { game: saveManualOverride(manualRoute[1], patch) });
    }
    if (req.method === 'DELETE' && manualRoute) {
      requireAdmin(req);
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant de restaurer les données sources.', 'ai_job_running');
      gameByAppid(manualRoute[1]);
      db.prepare('DELETE FROM game_manual_overrides WHERE appid = ?').run(Number(manualRoute[1]));
      return sendJson(res, 200, { game: gameByAppid(manualRoute[1]) });
    }
    if (req.method === 'GET' && pathname === '/api/enrichment/status') return sendJson(res, 200, statusSnapshot());
    if (req.method === 'GET' && pathname === '/api/sync/history') {
      const history = db.prepare(`SELECT steamid, profile_name, game_count, status, message, started_at, finished_at
        FROM sync_runs ORDER BY id DESC LIMIT 10`).all();
      return sendJson(res, 200, { history });
    }
    if (req.method === 'POST' && pathname === '/api/import/steam') {
      requireAdmin(req);
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant de synchroniser la bibliothèque.', 'ai_job_running');
      const body = await readJson(req);
      return sendJson(res, 200, await importPublicProfile(body.profile));
    }
    if (req.method === 'POST' && pathname === '/api/enrichment/start') {
      requireAdmin(req);
      if (job.running) throw new HttpError(409, 'Un enrichissement est déjà en cours.', 'job_running');
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant d’enrichir les métadonnées.', 'ai_job_running');
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
      if (aiEngine.job.running) throw new HttpError(409, 'Suspends l’analyse IA avant de réinitialiser les données.', 'ai_job_running');
      const backup = createBackup(scope);
      let affected = 0;
      if (scope === 'metadata') {
        affected = Number(db.prepare(`UPDATE games SET genres = '[]', themes = '[]', platforms = '[]', steam_type = NULL,
          igdb_game_type = NULL, application_type = 'full_game', classification_source = 'steam_library',
          classification_reason = 'Entrée de bibliothèque Steam sans signal contraire.', classification_confidence = 'low',
          metadata_status = 'pending', metadata_error = NULL, metadata_attempts = 0, metadata_updated_at = NULL,
          next_retry_at = NULL, metadata_source = NULL, metadata_sources = '[]', metadata_provider_id = NULL,
          igdb_provider_id = NULL, metadata_cover_url = NULL, steam_short_description = NULL, steam_about = NULL,
          steam_categories = '[]', igdb_summary = NULL, igdb_storyline = NULL, updated_at = ?`).run(nowIso()).changes);
        db.prepare('DELETE FROM metadata_cache').run();
        db.prepare('DELETE FROM recommendation_cache').run();
      } else if (scope === 'library') {
        affected = Number(db.prepare('DELETE FROM games').run().changes);
        for (const key of ['active_steamid', 'active_profile_name', 'last_library_sync_at', 'last_library_sync_count']) settings.remove(key);
      } else {
        affected = transaction(db, () => {
          const count = Number(db.prepare('DELETE FROM games').run().changes);
          db.prepare('DELETE FROM metadata_cache').run();
          db.prepare('DELETE FROM recommendation_cache').run();
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
    aiEngine,
    close() { job.pauseRequested = true; aiEngine.job.pauseRequested = true; db.close(); }
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
    console.log(`IGDB : ${process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET ? 'configuré' : 'non configuré'}`);
    console.log(`Ollama : ${application.aiEngine.config.ollamaBaseUrl} (${application.aiEngine.config.analysisModel} + ${application.aiEngine.config.embeddingModel})`);
    console.log(`SearXNG : ${application.aiEngine.config.searxngConfigured ? 'configuré' : 'optionnel, non configuré'}`);
    console.log(`Administration : ${process.env.ADMIN_TOKEN ? 'protégée' : 'désactivée (ADMIN_TOKEN absent)'}`);
  });
  const shutdown = () => {
    application.job.pauseRequested = true;
    server.close(() => { application.close(); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApplication, normalizeProfileInput, classifyApplication, APPLICATION_TYPES, VERSION };
