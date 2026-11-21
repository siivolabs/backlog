import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDatabase, closeDatabase } from './db.js';
import { importLegacyInventory } from './importer.js';
import { createLogger } from './logger.js';
import { OllamaClient } from './ollama.js';
import { EnrichmentPipeline } from './pipeline.js';
import { EnrichmentWorker } from './worker.js';
import { DiscoveryEngine } from './discovery.js';
import { libraryStats, listGames, getGame } from './library.js';

const logger = createLogger(config.logLevel);
const db = openDatabase(config.databasePath);
const importResult = importLegacyInventory(db, config.legacyDatabasePath);
logger.info('Inventaire initialisé', importResult);

const ollama = new OllamaClient({
  baseUrl: config.ollamaBaseUrl, analysisModel: config.analysisModel, embeddingModel: config.embeddingModel,
  timeoutMs: config.httpTimeoutMs, numPredict: config.numPredict, temperature: config.temperature
});
const pipeline = new EnrichmentPipeline({ ollama, steamDetailsUrl: config.steamDetailsUrl, steamTimeoutMs: config.steamTimeoutMs });
const worker = new EnrichmentWorker({ db, pipeline, logger, pollDelayMs: config.pollDelayMs, retryDelayMs: config.retryDelayMs, maxAttempts: config.maxAttempts });
const discovery = new DiscoveryEngine({ db, ollama, shortlist: config.discoveryShortlist, limit: config.discoveryLimit, logger });
worker.recover();

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(response, status, value, headers = {}) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  response.writeHead(status, { 'content-type': typeof value === 'object' && !Buffer.isBuffer(value) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body);
}

async function bodyJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Corps de requête trop volumineux');
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('JSON invalide'); }
}

function serveStatic(requestPath, response) {
  const clean = requestPath === '/' ? '/index.html' : requestPath;
  const target = path.resolve(config.publicDir, `.${clean}`);
  if (!target.startsWith(path.resolve(config.publicDir) + path.sep)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  const data = fs.readFileSync(target);
  response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': 'public, max-age=300' });
  response.end(data);
  return true;
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const method = request.method || 'GET';
  if (method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true, version: '1.1.0', database: true });
  if (method === 'GET' && url.pathname === '/api/library/stats') return send(response, 200, { ...libraryStats(db), campaign: worker.status() });
  if (method === 'GET' && url.pathname === '/api/library/games') return send(response, 200, listGames(db, Object.fromEntries(url.searchParams)));
  if (method === 'GET' && /^\/api\/games\/\d+$/.test(url.pathname)) {
    const game = getGame(db, Number(url.pathname.split('/').pop()));
    return game ? send(response, 200, game) : send(response, 404, { error: 'Jeu introuvable' });
  }
  if (method === 'GET' && url.pathname === '/api/enrichment') return send(response, 200, worker.status());
  if (method === 'POST' && url.pathname === '/api/enrichment/start') return send(response, 202, worker.start());
  if (method === 'POST' && url.pathname === '/api/enrichment/pause') return send(response, 202, worker.pause());
  if (method === 'POST' && url.pathname === '/api/enrichment/resume') return send(response, 202, worker.resume());
  if (method === 'POST' && url.pathname === '/api/enrichment/retry-failures') return send(response, 202, worker.retryFailures());
  if (method === 'GET' && url.pathname === '/api/discovery/games') return send(response, 200, { items: discovery.listCandidates(url.searchParams.get('q') || '', url.searchParams.get('limit') || 100) });
  if (method === 'POST' && url.pathname === '/api/discovery/recommend') return send(response, 200, await discovery.recommend(await bodyJson(request)));
  if (method === 'POST' && url.pathname === '/api/discovery/feedback') return send(response, 201, discovery.feedback(await bodyJson(request)));
  if (method === 'GET' && serveStatic(url.pathname, response)) return;
  send(response, 404, { error: 'Ressource introuvable' });
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    logger.error('Erreur HTTP', error);
    if (!response.headersSent) send(response, /invalide|Décrivez|introuvable/i.test(error.message) ? 400 : 500, { error: error.message });
    else response.destroy();
  });
});
server.listen(config.port, config.host, () => logger.info('Backlog Core démarré', { host: config.host, port: config.port, database: config.databasePath }));

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('Arrêt demandé', { signal });
  server.close();
  await worker.stop();
  closeDatabase(db);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { server, db, worker };
