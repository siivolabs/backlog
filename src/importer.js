import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.js';

const pick = (columns, candidates) => candidates.find((name) => columns.has(name));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function importLegacyInventory(target, legacyPath) {
  if (!legacyPath || !fs.existsSync(legacyPath)) return { imported: 0, source: null, reason: 'source_absent' };
  if (target.prepare('SELECT COUNT(*) AS count FROM games').get().count > 0) {
    return { imported: 0, source: null, reason: 'target_not_empty' };
  }

  const source = new DatabaseSync(legacyPath, { readOnly: true });
  try {
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const candidates = tables.filter((table) => {
      const columns = new Set(source.prepare(`PRAGMA table_info(${quote(table)})`).all().map((column) => column.name));
      return pick(columns, ['app_id', 'appid', 'steam_appid']) && pick(columns, ['title', 'name']);
    });
    if (!candidates.length) return { imported: 0, source: null, reason: 'no_inventory_table' };

    const table = candidates.includes('games') ? 'games' : candidates[0];
    const info = source.prepare(`PRAGMA table_info(${quote(table)})`).all();
    const columns = new Set(info.map((column) => column.name));
    const appId = pick(columns, ['app_id', 'appid', 'steam_appid']);
    const title = pick(columns, ['title', 'name']);
    const studio = pick(columns, ['studio', 'developer', 'publisher']);
    const genres = pick(columns, ['genres', 'genre']);
    const cover = pick(columns, ['cover_url', 'header_image', 'image_url']);
    const description = pick(columns, ['description', 'short_description', 'about_the_game']);
    const playtime = pick(columns, ['playtime_minutes', 'playtime_forever', 'playtime']);
    const lastPlayed = pick(columns, ['last_played_at', 'rtime_last_played']);
    const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
    const insert = target.prepare(`
      INSERT OR IGNORE INTO games
      (app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    let imported = 0;
    transaction(target, () => {
      for (const row of rows) {
        if (row[appId] == null || !String(row[title] ?? '').trim()) continue;
        insert.run(
          String(row[appId]), String(row[title]).trim(), studio ? row[studio] : null,
          genres ? row[genres] : null, cover ? row[cover] : null, description ? row[description] : null,
          playtime && row[playtime] != null ? Number(row[playtime]) : null,
          lastPlayed && row[lastPlayed] != null ? String(row[lastPlayed]) : null,
          JSON.stringify({ legacy: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])) }),
          table
        );
        imported += 1;
      }
    });
    return { imported, source: table, reason: 'ok' };
  } finally {
    source.close();
  }
}
