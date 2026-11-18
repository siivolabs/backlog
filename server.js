'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { BacklogDatabase } = require('./lib/database');
const { OllamaClient } = require('./lib/ollama');

const PORT = Number(process.env.PORT || 3094);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.BACKLOG_DB || '/data/backlog.sqlite';
const database = new BacklogDatabase(DB_FILE, {
  experimentSize: Number(process.env.EXPERIMENT_SIZE || 50),
  useDraftProfiles: String(process.env.USE_DRAFT_PROFILES || 'true').toLowerCase() !== 'false'
});
const ollama = new OllamaClient(process.env.OLLAMA_URL, process.env.EMBEDDING_MODEL || 'embeddinggemma');
const publicDir = path.join(__dirname, 'public');
let activeJob = null;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_000_000) throw Object.assign(new Error('Corps de requête trop volumineux'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

function serveStatic(urlPath, res) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filename = path.resolve(publicDir, relative);
  if (!filename.startsWith(`${publicDir}${path.sep}`) && filename !== path.join(publicDir, 'index.html')) return false;
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return false;
  const type = ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'application/octet-stream';
  const data = fs.readFileSync(filename);
  res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff' });
  res.end(data); return true;
}

function match(pathname, expression) {
  const result = pathname.match(expression);
  return result ? result.slice(1).map(decodeURIComponent) : null;
}

async function api(req, res, url) {
  const { pathname, searchParams } = url;
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { status: 'ok', version: '0.9.4', database: DB_FILE, profileTable: database.hasProfileTable(), activeJob });
  }
  if (req.method === 'GET' && pathname === '/api/dashboard') return json(res, 200, database.dashboard());
  if (req.method === 'GET' && pathname === '/api/games') return json(res, 200, { games: database.libraryGames(Number(searchParams.get('limit') || 5000)) });
  if (req.method === 'GET' && pathname === '/api/job') return json(res, 200, { activeJob });
  const recommendationMatch = match(pathname, /^\/api\/games\/([^/]+)\/similar$/);
  if (req.method === 'GET' && recommendationMatch) return json(res, 200, { appId: recommendationMatch[0], recommendations: database.recommendations(recommendationMatch[0], Number(searchParams.get('limit') || 5)) });
  if (req.method === 'POST' && pathname === '/api/selection') {
    const body = await readJson(req);
    if (!Array.isArray(body.appIds)) throw Object.assign(new Error('appIds doit être un tableau'), { status: 400 });
    const count = database.setSelection(body.appIds);
    return json(res, 200, { selected: count, message: `${count} jeux sélectionnés` });
  }
  if (req.method === 'POST' && pathname === '/api/network/rebuild') {
    if (activeJob) throw Object.assign(new Error('Une opération est déjà en cours'), { status: 409 });
    activeJob = { type: 'network', status: 'running', startedAt: new Date().toISOString() };
    try {
      const result = database.rebuildNetwork();
      activeJob = null;
      return json(res, 200, result);
    } catch (error) { activeJob = null; throw error; }
  }
  if (req.method === 'POST' && pathname === '/api/embeddings/backfill') {
    if (activeJob) throw Object.assign(new Error('Une opération est déjà en cours'), { status: 409 });
    const body = await readJson(req);
    activeJob = { type: 'embeddings', status: 'running', startedAt: new Date().toISOString(), current: 0, total: null };
    try {
      const result = await ollama.backfill(database, Number(body.limit || 50), (progress) => { activeJob = { ...activeJob, ...progress }; });
      activeJob = null;
      return json(res, 200, result);
    } catch (error) { activeJob = null; throw error; }
  }
  if (req.method === 'POST' && pathname === '/api/feedback') {
    const body = await readJson(req);
    if (!body.sourceAppId || !body.targetAppId || !body.rating) throw Object.assign(new Error('sourceAppId, targetAppId et rating sont obligatoires'), { status: 400 });
    return json(res, 200, database.saveFeedback(body));
  }
  return json(res, 404, { error: 'Route introuvable' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    json(res, 404, { error: 'Page introuvable' });
  } catch (error) {
    console.error(error);
    json(res, Number(error.status || 500), { error: String(error.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Backlog V0.9.4 — Réseau de similarité: http://${HOST}:${PORT}`);
  console.log(`Base SQLite: ${DB_FILE}`);
});

function shutdown() {
  server.close(() => { database.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
