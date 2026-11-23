import { normalizeText, nowIso, parseJson, safeAppId, steamCover } from './utils.js';
import { transaction } from './db.js';

function escapeLike(value) { return String(value).replace(/[\\%_]/g, (match) => `\\${match}`); }

export function listLibrary(db, query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 48));
  const search = normalizeText(query.search);
  const status = ['all', 'enriched', 'pending', 'completed', 'not-completed'].includes(query.status) ? query.status : 'all';
  const where = []; const params = [];
  if (search) {
    const value = `%${escapeLike(search)}%`;
    where.push(`(g.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR g.studio LIKE ? ESCAPE '\\' COLLATE NOCASE OR CAST(g.app_id AS TEXT) LIKE ? ESCAPE '\\')`);
    params.push(value, value, value);
  }
  if (status === 'enriched') where.push('p.app_id IS NOT NULL');
  if (status === 'pending') where.push('p.app_id IS NULL');
  if (status === 'completed') where.push('COALESCE(us.completed,0)=1');
  if (status === 'not-completed') where.push('COALESCE(us.completed,0)=0');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) total FROM games g LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT) LEFT JOIN game_user_state us ON CAST(us.app_id AS TEXT)=CAST(g.app_id AS TEXT) ${clause}`).get(...params).total;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const items = db.prepare(`
    SELECT CAST(g.app_id AS TEXT) app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,g.last_played_at,
           CASE WHEN p.app_id IS NULL THEN 0 ELSE 1 END enriched,COALESCE(us.completed,0) completed
    FROM games g
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN game_user_state us ON CAST(us.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    ${clause}
    ORDER BY g.title COLLATE NOCASE, CAST(g.app_id AS TEXT)
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (safePage - 1) * pageSize).map((row) => ({ ...row, cover_url: row.cover_url || steamCover(row.app_id), enriched: Boolean(row.enriched), completed: Boolean(row.completed) }));
  return { items, total, page: safePage, pageSize, pages };
}

export function searchLibrary(db, text, limit = 12) {
  const q = normalizeText(text);
  if (q.length < 1) return [];
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 12));
  const prefix = `${escapeLike(q)}%`; const contains = `%${escapeLike(q)}%`;
  return db.prepare(`
    SELECT CAST(app_id AS TEXT) app_id,title,studio,cover_url
    FROM games
    WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE OR studio LIKE ? ESCAPE '\\' COLLATE NOCASE OR CAST(app_id AS TEXT) LIKE ? ESCAPE '\\'
    ORDER BY CASE WHEN CAST(app_id AS TEXT)=? THEN 0 WHEN title LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 2 END,
             title COLLATE NOCASE
    LIMIT ?
  `).all(contains, contains, contains, q, prefix, safeLimit).map((row) => ({ ...row, cover_url: row.cover_url || steamCover(row.app_id) }));
}

function inventoryGames(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.games)) return payload.games;
  if (Array.isArray(payload?.response?.games)) return payload.response.games;
  if (Array.isArray(payload?.response?.game_count) && payload.response.games) return payload.response.games;
  throw Object.assign(new Error('Format d’inventaire non reconnu.'), { status: 400 });
}

function toGame(raw) {
  const appId = safeAppId(raw.app_id ?? raw.appid ?? raw.id);
  const title = normalizeText(raw.title ?? raw.name ?? `Jeu ${appId}`);
  const studio = normalizeText(raw.studio ?? raw.developer ?? raw.publisher);
  const genres = Array.isArray(raw.genres) ? raw.genres.map((g) => g.description || g).join(', ') : normalizeText(raw.genres);
  const description = normalizeText(raw.description ?? raw.short_description ?? raw.about_the_game);
  return {
    appId, title, studio, genres,
    coverUrl: normalizeText(raw.cover_url ?? raw.header_image) || steamCover(appId),
    description,
    playtime: Math.max(0, Number.parseInt(raw.playtime_minutes ?? raw.playtime_forever, 10) || 0),
    lastPlayed: raw.last_played_at ?? (raw.rtime_last_played ? new Date(Number(raw.rtime_last_played) * 1000).toISOString() : null),
    raw: JSON.stringify(raw)
  };
}

export function importInventory(db, payload) {
  const games = inventoryGames(payload).map(toGame);
  const upsert = db.prepare(`
    INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET
      title=excluded.title,
      studio=CASE WHEN excluded.studio<>'' THEN excluded.studio ELSE games.studio END,
      genres=CASE WHEN excluded.genres<>'' THEN excluded.genres ELSE games.genres END,
      cover_url=CASE WHEN excluded.cover_url<>'' THEN excluded.cover_url ELSE games.cover_url END,
      description=CASE WHEN excluded.description<>'' THEN excluded.description ELSE games.description END,
      playtime_minutes=excluded.playtime_minutes,last_played_at=excluded.last_played_at,
      inventory_json=excluded.inventory_json,updated_at=CURRENT_TIMESTAMP
  `);
  const queue = db.prepare(`INSERT OR IGNORE INTO enrichment_queue(app_id,status,updated_at)
    SELECT ?, 'pending', CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE CAST(app_id AS TEXT)=?)`);
  const userState = db.prepare('INSERT OR IGNORE INTO game_user_state(app_id,completed,updated_at) VALUES(?,0,CURRENT_TIMESTAMP)');
  transaction(db, () => {
    for (const game of games) {
      upsert.run(game.appId, game.title, game.studio, game.genres, game.coverUrl, game.description, game.playtime, game.lastPlayed, game.raw);
      queue.run(game.appId, game.appId); userState.run(game.appId);
    }
  });
  return { imported: games.length };
}

export function profileDetails(db, value) {
  const appId = safeAppId(value);
  const row = db.prepare(`
    SELECT CAST(g.app_id AS TEXT) app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,g.last_played_at,
           g.inventory_json,g.steam_json,p.profile_json,p.embedding_json,p.schema_version,p.analysis_model,p.embedding_model,p.confidence,p.source_json,
           COALESCE(us.completed,0) completed,us.completed_at
    FROM games g LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN game_user_state us ON CAST(us.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE CAST(g.app_id AS TEXT)=?
  `).get(appId);
  if (!row) throw Object.assign(new Error('Jeu introuvable.'), { status: 404 });
  return {
    app_id: row.app_id, title: row.title, schema_version: row.schema_version || null,
    profile: parseJson(row.profile_json, null), embedding: parseJson(row.embedding_json, null),
    source: parseJson(row.source_json, null) || {
      app_id: row.app_id, title: row.title, studio: row.studio, genres: row.genres, description: row.description,
      playtime_minutes: row.playtime_minutes, last_played_at: row.last_played_at,
      inventory: parseJson(row.inventory_json, null), steam: parseJson(row.steam_json, null)
    },
    analysis_model: row.analysis_model || null, embedding_model: row.embedding_model || null,
    confidence: row.confidence, completed: Boolean(row.completed), completed_at: row.completed_at || null
  };
}

export function setCompleted(db, value, completed) {
  const appId = safeAppId(value);
  if (!db.prepare('SELECT 1 found FROM games WHERE CAST(app_id AS TEXT)=?').get(appId)) throw Object.assign(new Error('Jeu introuvable.'), { status: 404 });
  const flag = completed === true || completed === 1;
  db.prepare(`
    INSERT INTO game_user_state(app_id,completed,completed_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET completed=excluded.completed,completed_at=excluded.completed_at,updated_at=CURRENT_TIMESTAMP
  `).run(appId, flag ? 1 : 0, flag ? nowIso() : null);
  return { app_id: appId, completed: flag };
}
