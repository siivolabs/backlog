'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CoreDatabase } = require('./lib/database');
const { OllamaClient } = require('./lib/ollama');
const { EnrichmentService } = require('./lib/enrichment');

const VERSION = '1.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function bool(value, fallback = false) { if (value == null) return fallback; return !['0','false','no','off'].includes(String(value).toLowerCase()); }
function json(res, status, body) { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' }); res.end(data); }
function error(res, err) { console.error(err); json(res, err.statusCode || 500, { error: err.message || String(err) }); }
async function readJson(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw Object.assign(new Error('Corps trop volumineux'), { statusCode: 413 }); } try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('JSON invalide'), { statusCode: 400 }); } }

function createApplication(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const database = options.database || new CoreDatabase(env.CORE_DB_PATH || '/data/backlog-core.sqlite', { legacyPath: env.LEGACY_DB_PATH || '/data/backlog.sqlite', autoImport: env.AUTO_IMPORT_LEGACY !== 'false' });
  const ollama = options.ollama || new OllamaClient({ baseUrl: env.OLLAMA_BASE_URL, analysisModel: env.AI_ANALYSIS_MODEL, embeddingModel: env.EMBEDDING_MODEL, timeoutMs: env.AI_TIMEOUT_MS });
  const service = options.service || new EnrichmentService({ database, ollama, steamApiBase: env.STEAM_API_BASE, steamFetchEnabled: bool(env.STEAM_FETCH_ENABLED, true), fetchImpl: options.fetchImpl || fetch });
  const adminToken = env.ADMIN_TOKEN || '';
  function requireAdmin(req) { if (adminToken && req.headers['x-admin-token'] !== adminToken) throw Object.assign(new Error('Jeton administrateur requis'), { statusCode: 401 }); }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'); const pathname = decodeURIComponent(url.pathname); const method = req.method;
      if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, version: VERSION });
      if (method === 'GET' && pathname === '/api/status') return json(res, 200, { version: VERSION, ...database.libraryStatus(), enrichment: service.status(), analysisModel: ollama.analysisModel, embeddingModel: ollama.embeddingModel, adminTokenRequired: Boolean(adminToken) });
      if (method === 'GET' && pathname === '/api/games') return json(res, 200, database.listGames({ q: url.searchParams.get('q') || '', status: url.searchParams.get('status') || 'all', limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }));
      let match = pathname.match(/^\/api\/games\/([^/]+)$/);
      if (method === 'GET' && match) { const game = database.getGame(match[1]); return game ? json(res, 200, { game, profile: database.getProfile(match[1]) }) : json(res, 404, { error: 'Jeu introuvable' }); }
      if (method === 'GET' && pathname === '/api/batch') return json(res, 200, { items: database.getBatch(), limit: 50 });
      if (method === 'PUT' && pathname === '/api/batch') { const body = await readJson(req); return json(res, 200, { items: database.setBatchItem(body.appId, Boolean(body.selected)), limit: 50 }); }
      if (method === 'DELETE' && pathname === '/api/batch') { database.clearBatch(); return json(res, 200, { items: [], limit: 50 }); }
      if (method === 'POST' && pathname === '/api/inventory/reimport') { requireAdmin(req); const result = database.reimportInventory(env.LEGACY_DB_PATH || '/data/backlog.sqlite'); return json(res, 200, result); }
      if (method === 'GET' && pathname === '/api/enrichment') return json(res, 200, service.status());
      if (method === 'POST' && pathname === '/api/enrichment/start') { requireAdmin(req); if (service.running) throw Object.assign(new Error('Un enrichissement est déjà en cours'), { statusCode: 409 }); setImmediate(() => service.run().catch(console.error)); return json(res, 202, { accepted: true }); }
      if (method === 'POST' && pathname === '/api/enrichment/pause') { requireAdmin(req); return json(res, 202, service.pause()); }
      if (method === 'POST' && pathname === '/api/enrichment/resume') { requireAdmin(req); if (service.running) throw Object.assign(new Error('Un enrichissement est déjà en cours'), { statusCode: 409 }); setImmediate(() => service.resume().catch(console.error)); return json(res, 202, { accepted: true }); }
      if (method === 'POST' && pathname === '/api/discovery') { const body = await readJson(req); return json(res, 200, await service.discover(body)); }
      if (method === 'PUT' && pathname === '/api/discovery/feedback') { const body = await readJson(req); if (!['relevant','not_relevant'].includes(body.verdict)) throw Object.assign(new Error('Verdict invalide'), { statusCode: 400 }); return json(res, 200, { feedback: database.saveFeedback(body) }); }
      if (method === 'GET' && pathname.startsWith('/api/')) return json(res, 404, { error: 'Route introuvable' });

      const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const target = path.resolve(PUBLIC, safePath); if (!target.startsWith(path.resolve(PUBLIC) + path.sep) && target !== path.join(PUBLIC, 'index.html')) return json(res, 403, { error: 'Accès refusé' });
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(302, { location: '/' }); return res.end(); }
      const stat = fs.statSync(target); res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': safePath === 'index.html' ? 'no-cache' : 'public, max-age=3600' }); fs.createReadStream(target).pipe(res);
    } catch (err) { error(res, err); }
  });
  return { server, database, service, ollama };
}

if (require.main === module) {
  const app = createApplication(); const port = Number(process.env.PORT || 3000); const host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => console.log(`Backlog Core ${VERSION} — http://${host}:${port}`));
  const shutdown = () => app.server.close(() => { app.database.close(); process.exit(0); }); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

module.exports = { createApplication, VERSION };
