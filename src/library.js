import { json } from './db.js';

export function libraryStats(db) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.app_id IS NOT NULL THEN 1 ELSE 0 END) AS enriched,
      SUM(CASE WHEN j.status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM games g
    LEFT JOIN profiles p ON p.app_id = g.app_id
    LEFT JOIN enrichment_jobs j ON j.app_id = g.app_id
  `).get();
  const total = Number(counts.total || 0);
  const enriched = Number(counts.enriched || 0);
  const failed = Number(counts.failed || 0);
  return {
    total,
    enriched,
    processing: Number(counts.processing || 0),
    failed,
    remaining: Math.max(0, total - enriched - failed),
    percent: total ? Math.round((enriched / total) * 10000) / 100 : 0
  };
}

export function listGames(db, { q = '', status = 'all', page = 1, pageSize = 48 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 48));
  const where = [];
  const params = [];
  if (q) {
    where.push('(g.name LIKE ? ESCAPE \'\\\' OR COALESCE(g.developer, \'\') LIKE ? ESCAPE \'\\\')');
    const escaped = `%${String(q).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    params.push(escaped, escaped);
  }
  if (status === 'enriched') where.push('p.app_id IS NOT NULL');
  if (status === 'pending') where.push('p.app_id IS NULL AND (j.status IS NULL OR j.status = \'pending\')');
  if (status === 'processing') where.push("j.status = 'processing'");
  if (status === 'failed') where.push("j.status = 'failed'");
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN enrichment_jobs j ON j.app_id=g.app_id ${clause}`).get(...params).count;
  const rows = db.prepare(`
    SELECT g.app_id, g.name, g.cover_url, g.developer, g.genres, g.playtime_minutes,
      CASE WHEN p.app_id IS NOT NULL THEN 'enriched' WHEN j.status IS NOT NULL THEN j.status ELSE 'pending' END AS enrichment_status,
      j.current_step, j.error, p.updated_at AS enriched_at
    FROM games g
    LEFT JOIN profiles p ON p.app_id = g.app_id
    LEFT JOIN enrichment_jobs j ON j.app_id = g.app_id
    ${clause}
    ORDER BY g.name COLLATE NOCASE, g.app_id
    LIMIT ? OFFSET ?
  `).all(...params, safePageSize, (safePage - 1) * safePageSize);
  return { items: rows, page: safePage, pageSize: safePageSize, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / safePageSize)) };
}

export function getGame(db, appId) {
  const row = db.prepare(`
    SELECT g.*, p.profile_json, p.source_json, p.schema_version, p.pipeline_version, p.model,
      p.embedding_model, p.updated_at AS enriched_at, j.status AS job_status, j.current_step, j.error
    FROM games g
    LEFT JOIN profiles p ON p.app_id=g.app_id
    LEFT JOIN enrichment_jobs j ON j.app_id=g.app_id
    WHERE g.app_id=?
  `).get(appId);
  if (!row) return null;
  return { ...row, profile: json(row.profile_json), source_details: json(row.source_json), profile_json: undefined, source_json: undefined };
}
