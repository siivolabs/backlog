import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { requireAdmin } from './auth.js';
import { discover } from './discovery.js';
import { embedText, runEnrichmentBatch } from './enrichment.js';
import { recordFeedback } from './feedback.js';
import { getGame, importSteam, listGames, setCompleted } from './library.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(response, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  response.writeHead(status, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'content-length': data.length, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'", ...headers });
  response.end(data);
}

async function body(request, max = 12 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > max) throw Object.assign(new Error('Corps de requête trop volumineux.'), { status: 413 }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON invalide.'), { status: 400 }); }
}

function staticFile(urlPath, response) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const filename = path.resolve(publicDir, relative);
  if (!filename.startsWith(`${publicDir}${path.sep}`) && filename !== path.join(publicDir, 'index.html')) return false;
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return false;
  const data = fs.readFileSync(filename);
  send(response, 200, data, { 'content-type': TYPES[path.extname(filename)] || 'application/octet-stream', 'cache-control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  return true;
}

export function createBacklogServer(config, options = {}) {
  const db = options.db || openDatabase(config.databasePath);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://backlog.local');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const counts = db.prepare('SELECT (SELECT COUNT(*) FROM games) games,(SELECT COUNT(*) FROM profiles) profiles').get();
        return send(response, 200, { status: 'ok', version: config.version, database: 'historical-existing', databasePathSource: config.databasePathSource, capabilities: db.capabilities, ...counts });
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        const completedRaw = url.searchParams.get('completed');
        const completed = completedRaw === '1' ? true : completedRaw === '0' ? false : null;
        return send(response, 200, { games: listGames(db, { q: url.searchParams.get('q'), completed, limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }) });
      }
      const gameMatch = url.pathname.match(/^\/api\/games\/([^/]+)$/);
      if (request.method === 'GET' && gameMatch) {
        const game = getGame(db, gameMatch[1]);
        return game ? send(response, 200, game) : send(response, 404, { error: 'Jeu introuvable.' });
      }
      const completedMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/completed$/);
      if (request.method === 'PATCH' && completedMatch) {
        requireAdmin(request, config);
        const input = await body(request);
        if (typeof input.completed !== 'boolean') throw Object.assign(new Error('Le champ completed doit être un booléen.'), { status: 400 });
        const state = setCompleted(db, completedMatch[1], input.completed);
        return state ? send(response, 200, state) : send(response, 404, { error: 'Jeu introuvable.' });
      }
      if (request.method === 'POST' && url.pathname === '/api/discovery') {
        const input = await body(request);
        let embedding = Array.isArray(input.embedding) ? input.embedding : null;
        if (!embedding && input.query && !input.surprise) embedding = await embedText(config, input.query);
        return send(response, 200, discover(db, { ...input, embedding, minQuality: config.discoveryMinQuality, recentDays: config.recentDays }));
      }
      if (request.method === 'POST' && url.pathname === '/api/discovery/feedback') { requireAdmin(request, config); return send(response, 201, recordFeedback(db, await body(request))); }
      if (request.method === 'POST' && url.pathname === '/api/import/steam') { requireAdmin(request, config); return send(response, 200, importSteam(db, await body(request))); }
      if (request.method === 'GET' && url.pathname === '/api/enrichment/status') {
        if (!db.capabilities.enrichmentQueue) return send(response, 200, { enabled: false, queue: [], message: 'Ré-enrichissement désactivé; base historique laissée intacte.' });
        const queueId = db.prepare("PRAGMA table_info(enrichment_queue)").all().some((row) => row.name === 'app_id') ? 'app_id' : 'game_id';
        return send(response, 200, { enabled: config.enrichmentEnabled, identifier: queueId, queue: db.prepare('SELECT status,COUNT(*) count FROM enrichment_queue GROUP BY status').all() });
      }
      if (request.method === 'POST' && url.pathname === '/api/enrichment/run') {
        requireAdmin(request, config);
        if (!config.enrichmentEnabled) return send(response, 409, { error: 'Ré-enrichissement désactivé dans ce correctif de reconnexion historique.' });
        return send(response, 200, await runEnrichmentBatch(db, config, (await body(request)).limit));
      }
      if (request.method === 'GET' && !url.pathname.startsWith('/api/') && staticFile(url.pathname, response)) return;
      send(response, 404, { error: 'Route introuvable.' });
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(error);
      send(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
    }
  });
  return { server, db };
}
