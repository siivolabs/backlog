import fs from 'node:fs';
import path from 'node:path';
import { parseJson, quickCheck } from './db.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(payload),
    'cache-control': type.startsWith('text/html') ? 'no-store' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  res.end(payload);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Corps de requête trop volumineux.');
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('JSON invalide.'); }
}

function gameRows(db, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || 'all';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = ['(? = \'\' OR g.title LIKE \'%\' || ? || \'%\' COLLATE NOCASE OR COALESCE(g.studio,\'\') LIKE \'%\' || ? || \'%\' COLLATE NOCASE)'];
  const params = [q, q, q];
  const statusExpr = "CASE WHEN p.app_id IS NOT NULL THEN 'completed' WHEN i.status='running' THEN 'running' WHEN i.status='error' THEN 'error' ELSE 'pending' END";
  if (status !== 'all') { where.push(`${statusExpr}=?`); params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) AS count FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN autonomous_enrichment_items i ON i.app_id=g.app_id WHERE ${where.join(' AND ')}`).get(...params).count;
  const rows = db.prepare(`
    SELECT g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,
      ${statusExpr} AS enrichment_status,i.current_step,i.last_error,i.attempts,p.confidence,p.updated_at AS profile_updated_at
    FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN autonomous_enrichment_items i ON i.app_id=g.app_id
    WHERE ${where.join(' AND ')} ORDER BY g.title COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { total, limit, offset, items: rows };
}

function serveStatic(publicDir, pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(path.resolve(publicDir) + path.sep) && file !== path.resolve(publicDir, 'index.html')) return send(res, 403, { error: 'Accès refusé.' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Introuvable.' });
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

export function createApp({ db, orchestrator, discovery, publicDir }) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const integrity = quickCheck(db);
        return send(res, integrity.ok ? 200 : 503, { ok: integrity.ok, version: '1.1.2', database: integrity });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, orchestrator.status());
      if (req.method === 'GET' && url.pathname === '/api/games') return send(res, 200, gameRows(db, url));
      if (req.method === 'GET' && /^\/api\/games\/[^/]+$/.test(url.pathname)) {
        const appId = decodeURIComponent(url.pathname.split('/').pop());
        const game = db.prepare(`SELECT g.*,p.schema_version,p.profile_json,p.source_json,p.analysis_model,p.embedding_model,p.confidence,p.updated_at AS profile_updated_at FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id WHERE g.app_id=?`).get(appId);
        if (!game) return send(res, 404, { error: 'Jeu introuvable.' });
        game.profile = parseJson(game.profile_json, null); delete game.profile_json;
        game.source = parseJson(game.source_json, null); delete game.source_json;
        return send(res, 200, game);
      }
      if (req.method === 'POST' && url.pathname === '/api/enrichment/start') return send(res, 202, orchestrator.start());
      if (req.method === 'POST' && url.pathname === '/api/enrichment/pause') return send(res, 202, orchestrator.pause());
      if (req.method === 'POST' && url.pathname === '/api/enrichment/retry-errors') return send(res, 202, orchestrator.retryErrors());
      if (req.method === 'POST' && url.pathname === '/api/discovery') {
        const body = await readJson(req);
        const result = await discovery.discover({ referenceAppId: body.reference_app_id, motivationText: body.motivation_text, limit: body.limit });
        return send(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/discovery/feedback') {
        const body = await readJson(req);
        return send(res, 200, discovery.saveFeedback({ referenceAppId: body.reference_app_id, candidateAppId: body.candidate_app_id, motivationText: body.motivation_text, verdict: body.verdict, note: body.note }));
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Route API introuvable.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Méthode non autorisée.' });
      return serveStatic(publicDir, url.pathname, res);
    } catch (error) {
      const status = /introuvable|référence|Verdict|JSON|volumineux|doit être enrichi/i.test(error.message) ? 400 : 500;
      console.error(error);
      return send(res, status, { error: error.message });
    }
  };
}
