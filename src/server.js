import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase, json } from './db.js';
import { authorize } from './auth.js';
import { createProcessor } from './processor.js';
import { EnrichmentWorker } from './worker.js';
import { listLibrary, importGames } from './library.js';
import { discover, saveFeedback } from './discovery.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(response, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers
  });
  response.end(payload);
}

async function bodyJson(request, limit = 15 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Corps de requête trop volumineux.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON invalide.'), { status: 400 }); }
}

function admin(request, response, config) {
  const result = authorize(request, config.adminToken);
  if (!result.ok) { send(response, result.status, { error: result.error }); return false; }
  return true;
}

function staticFile(urlPath, response) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.resolve(PUBLIC, relative);
  if (!target.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  const payload = fs.readFileSync(target);
  send(response, 200, payload, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'cache-control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
  return true;
}

export function createApp(options = {}) {
  const config = options.config || loadConfig();
  const db = options.db || openDatabase(config.databasePath);
  const worker = options.worker || new EnrichmentWorker(db, options.processor || createProcessor(config));
  worker.recover();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
        const quick = db.prepare('PRAGMA quick_check').get();
        return send(response, 200, { status: 'ok', version: config.version, database: quick.quick_check });
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return send(response, 200, { version: config.version, admin_token_configured: Boolean(config.adminToken), analysis_model: config.analysisModel, embedding_model: config.embeddingModel });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/verify') {
        if (!admin(request, response, config)) return;
        return send(response, 200, { valid: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        return send(response, 200, listLibrary(db, Object.fromEntries(url.searchParams)));
      }

      // BACKLOG_V1_1_4: consultation en lecture seule des profils déjà enrichis.
      if (request.method === 'GET' && url.pathname === '/api/library/profile') {
        const appId = String(url.searchParams.get('appId') || '').trim();
        if (!/^\d+$/.test(appId)) return send(response, 400, { error: 'Steam AppID invalide.' });
        const game = db.prepare('SELECT * FROM games WHERE CAST(app_id AS TEXT)=?').get(appId);
        if (!game) return send(response, 404, { error: 'Jeu introuvable.' });
        const profile = db.prepare('SELECT * FROM profiles WHERE CAST(app_id AS TEXT)=?').get(appId);
        if (!profile) return send(response, 404, { error: 'Aucun profil enrichi pour ce jeu.' });
        return send(response, 200, { game, profile });
      }
      const detail = url.pathname.match(/^\/api\/library\/([^/]+)$/);
      if (request.method === 'GET' && detail) {
        const appId = decodeURIComponent(detail[1]);
        const game = db.prepare('SELECT * FROM games WHERE CAST(app_id AS TEXT)=?').get(appId);
        if (!game) return send(response, 404, { error: 'Jeu introuvable.' });
        const profile = db.prepare('SELECT * FROM profiles WHERE CAST(app_id AS TEXT)=?').get(appId);
        return send(response, 200, { game, profile: profile ? { ...profile, profile: json(profile.profile_json, {}), source: json(profile.source_json, {}) } : null });
      }
      if (request.method === 'POST' && url.pathname === '/api/library/import') {
        if (!admin(request, response, config)) return;
        return send(response, 200, importGames(db, await bodyJson(request)));
      }
      if (request.method === 'GET' && url.pathname === '/api/enrichment/status') return send(response, 200, worker.status());
      if (request.method === 'GET' && url.pathname === '/api/enrichment/errors') {
        const errors = db.prepare(`SELECT q.app_id,g.title,q.attempts,q.error,q.finished_at FROM core_background_queue q LEFT JOIN games g ON CAST(g.app_id AS TEXT)=q.app_id WHERE q.status='failed' ORDER BY q.finished_at DESC`).all();
        return send(response, 200, { items: errors });
      }
      const action = url.pathname.match(/^\/api\/enrichment\/(start|pause|resume|retry-failed)$/);
      if (request.method === 'POST' && action) {
        if (!admin(request, response, config)) return;
        const methods = { start: 'enqueueAll', pause: 'pause', resume: 'resume', 'retry-failed': 'retryFailed' };
        return send(response, 200, worker[methods[action[1]]]());
      }
      if (request.method === 'POST' && url.pathname === '/api/discovery') return send(response, 200, { items: await discover(db, await bodyJson(request), config, options.embed) });
      if (request.method === 'POST' && url.pathname === '/api/discovery/feedback') {
        if (!admin(request, response, config)) return;
        return send(response, 200, saveFeedback(db, await bodyJson(request)));
      }
      if (request.method === 'GET' && staticFile(url.pathname, response)) return;
      send(response, 404, { error: 'Route introuvable.' });
    } catch (error) {
      console.error(error);
      send(response, error.status || 500, { error: error.message || 'Erreur interne.' });
    }
  });

  return {
    server, db, worker, config,
    listen(port = config.port, host = '0.0.0.0') { return new Promise((resolve) => server.listen(port, host, resolve)); },
    close() { worker.stop(); return new Promise((resolve) => server.close(() => { try { db.close(); } catch {} resolve(); })); }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  await app.listen();
  console.log(`Backlog Core ${app.config.version} écoute sur :${app.config.port}`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
