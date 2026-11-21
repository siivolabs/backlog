import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { Repository } from './repository.js';
import { EnrichmentService, cosine } from './services.js';
import { EnrichmentWorker } from './worker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml' };

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store', ...headers });
  res.end(payload);
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('Corps de requête trop volumineux.');
  }
  return data ? JSON.parse(data) : {};
}

export function createBacklogServer({ db, repository = new Repository(db), service = new EnrichmentService(), worker = null } = {}) {
  const activeWorker = worker || new EnrichmentWorker(repository, service);
  activeWorker.start();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status:'ok', version:'1.1.1' });
      if (req.method === 'GET' && url.pathname === '/api/summary') return send(res, 200, repository.summary());
      if (req.method === 'GET' && url.pathname === '/api/campaign') return send(res, 200, repository.campaign());
      if (req.method === 'GET' && url.pathname === '/api/compatibility') return send(res, 200, { tables: repository.compatibility() });
      if (req.method === 'GET' && url.pathname === '/api/games') {
        return send(res, 200, repository.listGames({
          search: url.searchParams.get('search') || '', status: url.searchParams.get('status') || 'all',
          limit: url.searchParams.get('limit') || 100, offset: url.searchParams.get('offset') || 0
        }));
      }
      const gameMatch = url.pathname.match(/^\/api\/games\/(\d+)$/);
      if (req.method === 'GET' && gameMatch) {
        const game = repository.game(Number(gameMatch[1]));
        return game ? send(res, 200, game) : send(res, 404, { error:'Jeu introuvable' });
      }
      if (req.method === 'POST' && url.pathname === '/api/campaign/start') {
        const result = repository.startCampaign(); activeWorker.wake(); return send(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/campaign/pause') return send(res, 200, repository.requestPause());
      if (req.method === 'POST' && url.pathname === '/api/campaign/resume') {
        const result = repository.resumeCampaign(); activeWorker.wake(); return send(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/campaign/retry') {
        const result = repository.retryFailed(); activeWorker.wake(); return send(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/discovery') {
        const body = await readJson(req);
        const motivation = String(body.motivation || '').trim();
        if (!motivation) return send(res, 400, { error:'La motivation est obligatoire.' });
        const likedId = body.likedAppId ? Number(body.likedAppId) : null;
        const motivationEmbedding = await service.embedMotivation(motivation);
        const liked = likedId ? repository.game(likedId) : null;
        const candidates = repository.profileCandidates(likedId).map((candidate) => {
          const motivationScore = cosine(motivationEmbedding, candidate.embedding);
          const affinityScore = liked ? cosine(liked.embedding, candidate.embedding) : 0;
          const score = liked ? motivationScore * 0.7 + affinityScore * 0.3 : motivationScore;
          return { app_id:candidate.app_id, name:candidate.name, cover_url:candidate.cover_url,
            developer:candidate.developer, score, profile:candidate.profile,
            explanation: candidate.profile?.summary || candidate.profile?.experiential_signature || 'Résonance calculée à partir du profil expérientiel.' };
        }).sort((a,b) => b.score-a.score).slice(0,5);
        return send(res, 200, { motivation, recommendations:candidates });
      }
      if (req.method === 'POST' && url.pathname === '/api/discovery/feedback') {
        const body = await readJson(req);
        if (!body.appId || !body.motivation || !['positive','negative','neutral'].includes(body.verdict)) return send(res, 400, { error:'Retour incomplet.' });
        return send(res, 201, repository.addFeedback(body));
      }
      if (req.method === 'GET') {
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const target = path.resolve(publicRoot, relative);
        if (!target.startsWith(publicRoot + path.sep) && target !== path.join(publicRoot, 'index.html')) return send(res, 403, { error:'Accès refusé' });
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          const data = fs.readFileSync(target);
          return send(res, 200, data, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control':'public, max-age=300' });
        }
      }
      return send(res, 404, { error:'Route introuvable' });
    } catch (error) {
      console.error('[http]', error);
      return send(res, 500, { error:error.message || 'Erreur interne' });
    }
  });
  server.on('close', () => activeWorker.stop());
  return { server, worker: activeWorker, repository };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databasePath = process.env.DATABASE_PATH || '/data/backlog-core.sqlite';
  const port = Number(process.env.PORT || 3000);
  const { db, migration } = openDatabase(databasePath);
  const { server } = createBacklogServer({ db });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[backlog-core] V1.1.1 sur :${port}`);
    console.log(`[backlog-core] migration=${JSON.stringify(migration)}`);
  });
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
