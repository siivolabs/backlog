'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const VERSION = '0.4.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STEAM_ENDPOINT = 'https://store.steampowered.com/api/appdetails';
const STEAM_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const staticFiles = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
]);

const metadataCache = new Map();
const pendingRequests = new Map();
const requestCounters = new Map();

function commonHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' https://cdn.akamai.steamstatic.com data:",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function sendJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...commonHeaders(),
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function sendText(response, status, text) {
  response.writeHead(status, {
    ...commonHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

function isRateLimited(address) {
  const now = Date.now();
  const current = requestCounters.get(address);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestCounters.set(address, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX;
}

function pruneCache() {
  const now = Date.now();
  for (const [appid, entry] of metadataCache) {
    if (now - entry.cachedAt >= CACHE_TTL_MS) metadataCache.delete(appid);
  }

  while (metadataCache.size > CACHE_MAX_ENTRIES) {
    metadataCache.delete(metadataCache.keys().next().value);
  }
}

function getCachedMetadata(appid) {
  const entry = metadataCache.get(appid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= CACHE_TTL_MS) {
    metadataCache.delete(appid);
    return null;
  }
  return entry.value;
}

function normalizeSteamPayload(appid, payload) {
  const record = payload && payload[String(appid)];
  if (!record || record.success !== true || !record.data) {
    const error = new Error('Steam ne fournit pas de fiche exploitable pour cet AppID.');
    error.statusCode = 404;
    throw error;
  }

  const data = record.data;
  const genres = Array.isArray(data.genres)
    ? [...new Set(data.genres.map((genre) => String(genre.description || '').trim()).filter(Boolean))]
    : [];

  return {
    appid,
    name: String(data.name || `AppID ${appid}`),
    genres,
  };
}

async function fetchSteamMetadata(appid) {
  pruneCache();
  const cached = getCachedMetadata(appid);
  if (cached) return { ...cached, cache: 'memory' };
  if (pendingRequests.has(appid)) return pendingRequests.get(appid);

  const operation = (async () => {
    const requestUrl = new URL(STEAM_ENDPOINT);
    requestUrl.searchParams.set('appids', String(appid));
    requestUrl.searchParams.set('l', 'french');
    requestUrl.searchParams.set('cc', 'fr');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STEAM_TIMEOUT_MS);

    try {
      const steamResponse = await fetch(requestUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': `Backlog/${VERSION}`,
        },
      });

      if (!steamResponse.ok) {
        const error = new Error(`Steam a répondu avec le statut HTTP ${steamResponse.status}.`);
        error.statusCode = 502;
        throw error;
      }

      const payload = await steamResponse.json();
      const metadata = normalizeSteamPayload(appid, payload);
      metadataCache.set(appid, { value: metadata, cachedAt: Date.now() });
      pruneCache();
      return { ...metadata, cache: 'miss' };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Steam n’a pas répondu dans le délai prévu.');
        timeoutError.statusCode = 504;
        throw timeoutError;
      }
      if (error instanceof SyntaxError) {
        const parseError = new Error('Steam a renvoyé une réponse illisible.');
        parseError.statusCode = 502;
        throw parseError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      pendingRequests.delete(appid);
    }
  })();

  pendingRequests.set(appid, operation);
  return operation;
}

function serveStatic(request, response, pathname) {
  const asset = staticFiles.get(pathname);
  if (!asset) return false;

  const filePath = path.join(PUBLIC_DIR, asset.file);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, 500, 'Le fichier demandé est indisponible.');
      return;
    }

    response.writeHead(200, {
      ...commonHeaders(),
      'Content-Type': asset.type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(data);
  });
  return true;
}

async function handleRequest(request, response) {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendJson(response, 400, { error: 'Requête invalide.' });
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    sendJson(response, 405, { error: 'Méthode non autorisée.' }, { Allow: 'GET, HEAD' });
    return;
  }

  if (url.pathname === '/healthz') {
    sendJson(response, 200, { status: 'ok', version: VERSION });
    return;
  }

  const apiMatch = url.pathname.match(/^\/api\/steam\/(\d{1,10})$/);
  if (apiMatch) {
    const appid = Number.parseInt(apiMatch[1], 10);
    if (!Number.isSafeInteger(appid) || appid <= 0) {
      sendJson(response, 400, { error: 'L’AppID doit être un entier positif.' });
      return;
    }

    const address = request.socket.remoteAddress || 'unknown';
    if (isRateLimited(address)) {
      sendJson(response, 429, { error: 'Trop de requêtes. Réessaie dans une minute.' }, { 'Retry-After': '60' });
      return;
    }

    try {
      const metadata = await fetchSteamMetadata(appid);
      sendJson(response, 200, metadata);
    } catch (error) {
      console.error(`[steam:${appid}]`, error.message);
      sendJson(response, error.statusCode || 502, {
        error: error.statusCode ? error.message : 'Impossible de contacter Steam pour le moment.',
      });
    }
    return;
  }

  if (serveStatic(request, response, url.pathname)) return;
  sendJson(response, 404, { error: 'Ressource introuvable.' });
}

function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('[server]', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'Erreur interne du serveur.' });
      else response.destroy();
    });
  });
}

if (require.main === module) {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
    console.error('PORT doit être un entier compris entre 1 et 65535.');
    process.exit(1);
  }

  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Backlog ${VERSION} écoute sur http://${HOST}:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} reçu, arrêt de Backlog…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createServer, fetchSteamMetadata, normalizeSteamPayload };
