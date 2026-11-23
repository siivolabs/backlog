import { asJson, parseJson } from './json.js';

export function listGames(db, options = {}) {
  const limit = Math.min(250, Math.max(1, Number(options.limit) || 100));
  const offset = Math.max(0, Number(options.offset) || 0);
  const q = `%${String(options.q || '').trim()}%`;
  const completed = options.completed === true ? 1 : options.completed === false ? 0 : null;
  return db.prepare(`SELECT g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,g.last_played_at,
      COALESCE(s.completed,0) completed,s.completed_at,(p.app_id IS NOT NULL) profiled,p.confidence
    FROM games g LEFT JOIN game_user_state s ON CAST(s.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE (?='%%' OR g.title LIKE ? COLLATE NOCASE OR g.studio LIKE ? COLLATE NOCASE OR CAST(g.app_id AS TEXT) LIKE ?)
      AND (? IS NULL OR COALESCE(s.completed,0)=?) ORDER BY g.title COLLATE NOCASE LIMIT ? OFFSET ?`).all(q, q, q, q, completed, completed, limit, offset);
}

export function getGame(db, appId) {
  const row = db.prepare(`SELECT g.*,COALESCE(s.completed,0) completed,s.completed_at,p.profile_json,p.embedding_json,
    p.schema_version,p.analysis_model,p.embedding_model,p.confidence,p.source_json
    FROM games g LEFT JOIN game_user_state s ON CAST(s.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT) WHERE CAST(g.app_id AS TEXT)=?`).get(String(appId));
  if (!row) return null;
  return { ...row, profile: parseJson(row.profile_json), embedding: parseJson(row.embedding_json), sources: parseJson(row.source_json) };
}

export function setCompleted(db, appId, completed) {
  const id = String(appId);
  if (!db.prepare('SELECT 1 FROM games WHERE CAST(app_id AS TEXT)=?').get(id)) return null;
  db.prepare(`INSERT INTO game_user_state(app_id,completed,completed_at,updated_at) VALUES (?,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP END,CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET completed=excluded.completed,
      completed_at=CASE WHEN excluded.completed=1 THEN COALESCE(game_user_state.completed_at,CURRENT_TIMESTAMP) ELSE NULL END,
      updated_at=CURRENT_TIMESTAMP`).run(id, completed ? 1 : 0, completed ? 1 : 0);
  return db.prepare('SELECT app_id,completed,completed_at,updated_at FROM game_user_state WHERE app_id=?').get(id);
}

export function importSteam(db, payload) {
  const games = Array.isArray(payload) ? payload : payload?.response?.games || payload?.games || [];
  const upsert = db.prepare(`INSERT INTO games(app_id,title,cover_url,playtime_minutes,last_played_at,inventory_json,steam_json,updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET title=excluded.title,cover_url=CASE WHEN excluded.cover_url<>'' THEN excluded.cover_url ELSE games.cover_url END,
      playtime_minutes=excluded.playtime_minutes,last_played_at=excluded.last_played_at,inventory_json=excluded.inventory_json,
      steam_json=excluded.steam_json,updated_at=CURRENT_TIMESTAMP`);
  const queue = db.prepare(`INSERT INTO enrichment_queue(app_id,status,updated_at) VALUES (?,'pending',CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO NOTHING`);
  let imported = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const game of games) {
      const appId = String(game.appid ?? game.app_id ?? '').trim();
      if (!/^\d+$/.test(appId)) continue;
      const title = String(game.name ?? game.title ?? '').trim() || `Steam ${appId}`;
      const cover = game.cover_url || `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
      const lastPlayed = Number(game.rtime_last_played) > 0 ? new Date(Number(game.rtime_last_played) * 1000).toISOString() : null;
      upsert.run(appId, title, cover, Number(game.playtime_forever ?? game.playtime_minutes ?? 0) || 0, lastPlayed, asJson(game, {}), asJson(game, {}));
      queue.run(appId); imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { received: games.length, imported };
}
