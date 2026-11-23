import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { requireAdmin } from './auth.js';
import { discover, discoveryHistory, recordFeedback } from './discovery.js';
import { enrichmentStatus, retryErrors, setPaused, startEnrichmentWorker } from './enrichment.js';
import { importInventory, listLibrary, profileDetails, searchLibrary, setCompleted } from './library.js';
import { openDatabase } from './db.js';
import { applicationStatus } from './status.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function securityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('content-security-policy', "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  response.end(payload);
}

async function body(request, maxBytes = 25 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Corps JSON invalide.'), { status: 400 }); }
}

function routeMatch(pathname, expression) { return pathname.match(expression); }

async function steamDetails(appId, timeoutMs) {
  if (!/^\d{1,12}$/.test(appId)) throw Object.assign(new Error('AppID invalide.'), { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 20000));
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=french`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Steam ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function staticFile(pathname, response) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filename = path.resolve(publicDir, requested);
  if (!filename.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return false;
  const data = fs.readFileSync(filename); const extension = path.extname(filename);
  response.writeHead(200, { 'content-type': mime[extension] || 'application/octet-stream', 'content-length': data.length, 'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=3600' });
  response.end(data); return true;
}

export function createBacklogServer(config, options = {}) {
  const db = options.db || openDatabase(config.databasePath);
  const stopWorker = options.disableWorker ? () => {} : startEnrichmentWorker(db, config);
  const server = createServer(async (request, response) => {
    securityHeaders(response);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    try {
      if (request.method === 'GET' && pathname === '/healthz') return json(response, 200, { status: 'ok', version: config.version, database: 'ok' });
      if (request.method === 'GET' && pathname === '/api/status') return json(response, 200, applicationStatus(db, config));
      if (request.method === 'GET' && pathname === '/api/enrichment/status') return json(response, 200, enrichmentStatus(db));
      if (request.method === 'GET' && pathname === '/api/library') return json(response, 200, listLibrary(db, Object.fromEntries(url.searchParams)));
      if (request.method === 'GET' && pathname === '/api/library/search') return json(response, 200, { items: searchLibrary(db, url.searchParams.get('q'), url.searchParams.get('limit')) });
      if (request.method === 'GET' && pathname === '/api/discovery/history') return json(response, 200, { items: discoveryHistory(db, url.searchParams.get('limit')) });

      let match = routeMatch(pathname, /^\/api\/library\/(\d+)\/profile$/);
      if (request.method === 'GET' && match) return json(response, 200, profileDetails(db, match[1]));
      match = routeMatch(pathname, /^\/api\/steam\/(\d+)$/);
      if (request.method === 'GET' && match) return json(response, 200, await steamDetails(match[1], config.requestTimeoutMs));

      if (request.method === 'POST' && pathname === '/api/library/import') { requireAdmin(request, config); return json(response, 200, importInventory(db, await body(request))); }
      match = routeMatch(pathname, /^\/api\/library\/(\d+)\/completed$/);
      if (request.method === 'PATCH' && match) { requireAdmin(request, config); const input = await body(request); return json(response, 200, setCompleted(db, match[1], input.completed)); }
      if (request.method === 'POST' && pathname === '/api/discovery') return json(response, 200, await discover(db, config, await body(request)));
      if (request.method === 'POST' && pathname === '/api/discovery/feedback') { requireAdmin(request, config); return json(response, 200, recordFeedback(db, await body(request))); }
      if (request.method === 'POST' && pathname === '/api/enrichment/start') { requireAdmin(request, config); return json(response, 200, setPaused(db, false)); }
      if (request.method === 'POST' && pathname === '/api/enrichment/pause') { requireAdmin(request, config); return json(response, 200, setPaused(db, true)); }
      if (request.method === 'POST' && pathname === '/api/enrichment/retry') { requireAdmin(request, config); return json(response, 200, retryErrors(db)); }

      if (request.method === 'GET' || request.method === 'HEAD') {
        if (staticFile(pathname, response)) return;
        if (!pathname.startsWith('/api/')) { staticFile('/', response); return; }
      }
      return json(response, 404, { error: 'Route introuvable.' });
    } catch (error) {
      const status = Number(error?.status) || (error?.name === 'AbortError' ? 504 : 500);
      if (status >= 500) console.error(error);
      return json(response, status, { error: error?.message || 'Erreur interne.' });
    }
  });
  server.on('close', () => { stopWorker(); if (!options.db) db.close(); });
  return { server, db };
}
