export function steamCover(appId) {
  return /^\d+$/.test(String(appId)) ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null;
}

export function listLibrary(db, options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize) || 48));
  const search = String(options.search || '').trim();
  const status = String(options.status || 'all');
  const where = [];
  const params = [];
  // BACKLOG_V1_1_4: recherche isolée de l'enrichissement ; inclut l'AppID.
  if (search) {
    const pattern = `%${search}%`;
    where.push('(CAST(g.app_id AS TEXT) LIKE ? OR g.title LIKE ? COLLATE NOCASE OR g.studio LIKE ? COLLATE NOCASE)');
    params.push(pattern, pattern, pattern);
  }
  if (status === 'enriched') where.push('p.app_id IS NOT NULL');
  else if (status === 'failed') where.push("q.status='failed'");
  else if (status === 'pending') where.push("(q.status IN ('pending','processing') OR (q.app_id IS NULL AND p.app_id IS NULL))");
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT COUNT(*) count FROM games g LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT) LEFT JOIN core_background_queue q ON q.app_id=CAST(g.app_id AS TEXT) ${clause}`).get(...params).count);
  const rows = db.prepare(`
    SELECT g.*, CASE WHEN p.app_id IS NOT NULL THEN 1 ELSE 0 END enriched,
      q.status enrichment_status, q.current_step, q.error, q.attempts
    FROM games g
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN core_background_queue q ON q.app_id=CAST(g.app_id AS TEXT)
    ${clause}
    ORDER BY g.title COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize).map((row) => ({ ...row, cover_url: row.cover_url || steamCover(row.app_id) }));
  return { items: rows, page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function importGames(db, payload) {
  const games = Array.isArray(payload) ? payload : payload?.response?.games || payload?.games;
  if (!Array.isArray(games)) throw new Error('Format invalide : tableau games introuvable.');
  const statement = db.prepare(`
    INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table,imported_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'steam',datetime('now'),datetime('now'))
    ON CONFLICT(app_id) DO UPDATE SET
      title=excluded.title,
      studio=COALESCE(excluded.studio,games.studio), genres=COALESCE(excluded.genres,games.genres),
      cover_url=COALESCE(excluded.cover_url,games.cover_url), description=COALESCE(excluded.description,games.description),
      playtime_minutes=COALESCE(excluded.playtime_minutes,games.playtime_minutes),
      last_played_at=COALESCE(excluded.last_played_at,games.last_played_at),
      inventory_metadata_json=excluded.inventory_metadata_json, updated_at=datetime('now')
  `);
  let imported = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of games) {
      const appId = String(item.app_id ?? item.appid ?? '').trim();
      const title = String(item.title ?? item.name ?? '').trim();
      if (!appId || !title) continue;
      const cover = item.cover_url || (/^\d+$/.test(appId) ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null);
      statement.run(appId, title, item.studio || item.developer || null, Array.isArray(item.genres) ? item.genres.join(', ') : item.genres || null, cover, item.description || null, item.playtime_minutes ?? item.playtime_forever ?? null, item.last_played_at || null, JSON.stringify(item));
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { imported, received: games.length };
}
