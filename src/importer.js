import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.js';

const FIELD_CANDIDATES = {
  appId: ['app_id', 'appid', 'steam_app_id', 'steam_appid', 'steam_id'],
  name: ['name', 'title', 'game_name', 'app_name'],
  cover: ['cover_url', 'header_image', 'image_url', 'image', 'cover', 'capsule_image'],
  developer: ['developer', 'developers', 'studio', 'publisher'],
  genres: ['genres', 'genre', 'tags', 'categories'],
  playtime: ['playtime_minutes', 'playtime_forever', 'playtime', 'minutes_played']
};

function quote(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function findColumn(columns, candidates) {
  const map = new Map(columns.map((column) => [column.toLowerCase(), column]));
  return candidates.map((candidate) => map.get(candidate)).find(Boolean) || null;
}

function tableScore(name, columns) {
  const appId = findColumn(columns, FIELD_CANDIDATES.appId);
  const title = findColumn(columns, FIELD_CANDIDATES.name);
  if (!appId || !title) return -1;
  let score = 10;
  if (/^(games?|library|steam_games?|owned_games?)$/i.test(name)) score += 20;
  for (const key of ['cover', 'developer', 'genres', 'playtime']) {
    if (findColumn(columns, FIELD_CANDIDATES[key])) score += 1;
  }
  return score;
}

export function inspectLegacyInventory(databasePath) {
  if (!fs.existsSync(databasePath)) return null;
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = source.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
    const candidates = tables.map(({ name }) => {
      const columns = source.prepare(`PRAGMA table_info(${quote(name)})`).all().map((column) => column.name);
      return { name, columns, score: tableScore(name, columns) };
    }).filter((table) => table.score >= 0).sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  } finally {
    source.close();
  }
}

export function importLegacyInventory(db, databasePath, { force = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM games').get().count;
  if (existing > 0 && !force) return { imported: 0, skipped: true, reason: 'inventory_not_empty' };
  const table = inspectLegacyInventory(databasePath);
  if (!table) return { imported: 0, skipped: true, reason: fs.existsSync(databasePath) ? 'no_compatible_table' : 'source_missing' };

  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const appId = findColumn(table.columns, FIELD_CANDIDATES.appId);
    const name = findColumn(table.columns, FIELD_CANDIDATES.name);
    const optional = Object.fromEntries(['cover', 'developer', 'genres', 'playtime'].map((key) => [key, findColumn(table.columns, FIELD_CANDIDATES[key])]));
    const expression = (column, alias) => column ? `${quote(column)} AS ${quote(alias)}` : `NULL AS ${quote(alias)}`;
    const rows = source.prepare(`
      SELECT ${quote(appId)} AS app_id, ${quote(name)} AS name,
             ${expression(optional.cover, 'cover_url')},
             ${expression(optional.developer, 'developer')},
             ${expression(optional.genres, 'genres')},
             ${expression(optional.playtime, 'playtime_minutes')}
      FROM ${quote(table.name)}
      WHERE ${quote(appId)} IS NOT NULL AND ${quote(name)} IS NOT NULL
    `).all();

    const insert = db.prepare(`
      INSERT INTO games (app_id, name, cover_url, developer, genres, playtime_minutes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        name = excluded.name,
        cover_url = COALESCE(excluded.cover_url, games.cover_url),
        developer = COALESCE(excluded.developer, games.developer),
        genres = COALESCE(excluded.genres, games.genres),
        playtime_minutes = COALESCE(excluded.playtime_minutes, games.playtime_minutes),
        updated_at = CURRENT_TIMESTAMP
    `);
    let imported = 0;
    transaction(db, () => {
      for (const row of rows) {
        const id = Number.parseInt(row.app_id, 10);
        const title = String(row.name || '').trim();
        if (!Number.isSafeInteger(id) || id <= 0 || !title) continue;
        insert.run(id, title, row.cover_url ? String(row.cover_url) : null,
          row.developer ? String(row.developer) : null,
          row.genres ? String(row.genres) : null,
          row.playtime_minutes !== null && row.playtime_minutes !== '' && Number.isFinite(Number(row.playtime_minutes)) ? Number(row.playtime_minutes) : null,
          `legacy:${table.name}`);
        imported += 1;
      }
    });
    return { imported, skipped: false, table: table.name };
  } finally {
    source.close();
  }
}
