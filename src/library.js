import { asJson, parseJson } from './json.js';
import { columns, tableExists } from './db.js';

export function steamCover(appId) {
  return /^\d+$/.test(String(appId || '')) ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : '';
}
function firstText(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}
function profileSummary(profile) {
  if (!profile || typeof profile !== 'object') return '';
  return firstText(profile.summary, profile.description, profile.overview, profile.synthesis, profile.experience?.summary, profile.identity?.summary);
}
function sourceDescription(source) {
  if (!source || typeof source !== 'object') return '';
  return firstText(source.description, source.short_description, source.about_the_game, source.steam?.short_description, source.game?.description);
}
function presentGame(row) {
  const profile = parseJson(row.profile_json, {}) || {};
  const source = parseJson(row.source_json, {}) || {};
  const { profile_json, source_json, ...game } = row;
  return {
    ...game,
    app_id: String(row.app_id),
    cover_url: firstText(row.cover_url) || steamCover(row.app_id),
    description: firstText(row.description, profileSummary(profile), sourceDescription(source)),
    profiled: Boolean(row.profile_json),
    enriched: Boolean(row.profile_json),
    completed: Boolean(row.completed)
  };
}
function stateJoin(db) {
  const available = columns(db, 'game_user_state');
  return available.has('app_id') && available.has('completed')
    ? { join: 'LEFT JOIN game_user_state s ON CAST(s.app_id AS TEXT)=CAST(g.app_id AS TEXT)', select: 'COALESCE(s.completed,0) completed', filter: 'COALESCE(s.completed,0)' }
    : { join: '', select: '0 completed', filter: '0' };
}
export function listGames(db, options = {}) {
  const limit = Math.min(250, Math.max(1, Number(options.limit) || 100));
  const offset = Math.max(0, Number(options.offset) || 0);
  const q = `%${String(options.q || '').trim()}%`;
  const completed = options.completed === true ? 1 : options.completed === false ? 0 : null;
  const state = stateJoin(db);
  return db.prepare(`SELECT g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,g.last_played_at,
      ${state.select},p.profile_json,p.source_json,p.confidence
    FROM games g ${state.join}
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE (?='%%' OR g.title LIKE ? COLLATE NOCASE OR COALESCE(g.studio,'') LIKE ? COLLATE NOCASE OR CAST(g.app_id AS TEXT) LIKE ?)
      AND (? IS NULL OR ${state.filter}=?) ORDER BY g.title COLLATE NOCASE LIMIT ? OFFSET ?`).all(q, q, q, q, completed, completed, limit, offset).map(presentGame);
}
export function getGame(db, appId) {
  const state = stateJoin(db);
  const row = db.prepare(`SELECT g.*,${state.select},p.profile_json,p.embedding_json,p.schema_version,p.analysis_model,p.embedding_model,p.confidence,p.source_json
    FROM games g ${state.join}
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT) WHERE CAST(g.app_id AS TEXT)=?`).get(String(appId));
  if (!row) return null;
  const profile = parseJson(row.profile_json, null);
  const source = parseJson(row.source_json, null);
  const presented = presentGame(row);
  return { ...presented, profile, embedding: parseJson(row.embedding_json, null), sources: source, source,
    schema_version: row.schema_version || null, analysis_model: row.analysis_model || null,
    embedding_model: row.embedding_model || null, confidence: row.confidence ?? null };
}
export function setCompleted(db, appId, completed) {
  const state = columns(db, 'game_user_state');
  if (!state.has('app_id') || !state.has('completed')) {
    throw Object.assign(new Error('Le statut Terminé n’existe pas dans le schéma historique 1.1.4. Aucune table ne sera créée automatiquement.'), { status: 409 });
  }
  const id = String(appId);
  if (!db.prepare('SELECT 1 FROM games WHERE CAST(app_id AS TEXT)=?').get(id)) return null;
  const completedAt = state.has('completed_at') ? ',completed_at' : '';
  const updatedAt = state.has('updated_at') ? ',updated_at' : '';
  const values = state.has('completed_at') ? ",CASE WHEN ?=1 THEN CURRENT_TIMESTAMP END" : '';
  const updateValue = state.has('updated_at') ? ',CURRENT_TIMESTAMP' : '';
  const updates = [`completed=excluded.completed`];
  if (state.has('completed_at')) updates.push('completed_at=CASE WHEN excluded.completed=1 THEN COALESCE(game_user_state.completed_at,CURRENT_TIMESTAMP) ELSE NULL END');
  if (state.has('updated_at')) updates.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`INSERT INTO game_user_state(app_id,completed${completedAt}${updatedAt}) VALUES (?,?${values}${updateValue}) ON CONFLICT(app_id) DO UPDATE SET ${updates.join(',')}`)
    .run(...(state.has('completed_at') ? [id, completed ? 1 : 0, completed ? 1 : 0] : [id, completed ? 1 : 0]));
  return { app_id: id, completed: Boolean(completed) };
}
export function importSteam(db, payload) {
  const games = Array.isArray(payload) ? payload : payload?.response?.games || payload?.games || [];
  const gameColumns = columns(db, 'games');
  if (!gameColumns.has('inventory_metadata_json')) {
    throw Object.assign(new Error('Import désactivé: le schéma ciblé n’est pas le schéma historique 1.1.4 attendu.'), { status: 409 });
  }
  const upsert = db.prepare(`INSERT INTO games(app_id,title,cover_url,playtime_minutes,last_played_at,inventory_metadata_json,source_table,imported_at,updated_at)
    VALUES (?,?,?,?,?,?, 'steam',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET title=excluded.title,cover_url=CASE WHEN excluded.cover_url<>'' THEN excluded.cover_url ELSE games.cover_url END,
      playtime_minutes=excluded.playtime_minutes,last_played_at=excluded.last_played_at,inventory_metadata_json=excluded.inventory_metadata_json,updated_at=CURRENT_TIMESTAMP`);
  let imported = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const game of games) {
      const appId = String(game.appid ?? game.app_id ?? '').trim();
      if (!/^\d+$/.test(appId)) continue;
      const title = String(game.name ?? game.title ?? '').trim() || `Steam ${appId}`;
      const cover = game.cover_url || steamCover(appId);
      const lastPlayed = Number(game.rtime_last_played) > 0 ? new Date(Number(game.rtime_last_played) * 1000).toISOString() : null;
      upsert.run(appId, title, cover, Number(game.playtime_forever ?? game.playtime_minutes ?? 0) || 0, lastPlayed, asJson(game, {}));
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { received: games.length, imported };
}
