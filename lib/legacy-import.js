'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');

const ID_COLUMNS = ['app_id', 'appid', 'steam_appid', 'steam_app_id', 'steam_id', 'game_id', 'id'];
const TITLE_COLUMNS = ['name', 'title', 'game_name', 'app_name', 'display_name'];
const TABLE_PRIORITY = ['games', 'steam_games', 'library', 'game_library', 'backlog_games', 'apps', 'owned_games'];
const FIELD_COLUMNS = {
  studio: ['studio', 'developer', 'developers', 'publisher'],
  genres: ['genres', 'genre', 'categories'],
  cover_url: ['cover_url', 'header_image', 'image_url', 'cover', 'capsule_image'],
  playtime_minutes: ['playtime_minutes', 'playtime_forever', 'playtime', 'minutes_played'],
  last_played_at: ['last_played_at', 'rtime_last_played', 'last_played']
};

function quote(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function asText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const candidate of candidates) if (byLower.has(candidate)) return byLower.get(candidate);
  return null;
}

function normalizeGenres(value) {
  if (!value) return null;
  if (typeof value !== 'string') return asText(value);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((x) => typeof x === 'string' ? x : x?.description || x?.name).filter(Boolean).join(', ');
  } catch {}
  return value.replaceAll('|', ', ').replace(/\s*,\s*/g, ', ').trim() || null;
}

function discoverLibrarySource(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const candidates = [];
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map((r) => r.name);
    const idColumn = pickColumn(columns, ID_COLUMNS);
    const titleColumn = pickColumn(columns, TITLE_COLUMNS);
    if (!idColumn || !titleColumn) continue;
    let count = 0;
    try { count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n); } catch { continue; }
    if (!count) continue;
    const rank = TABLE_PRIORITY.indexOf(table.toLowerCase());
    candidates.push({ table, columns, idColumn, titleColumn, count, score: (rank < 0 ? 0 : 1000 - rank * 10) + Math.min(count, 500) });
  }
  return candidates.sort((a, b) => b.score - a.score || b.count - a.count)[0] || null;
}

function importLegacyInventory(coreDb, legacyPath, options = {}) {
  if (!legacyPath || !fs.existsSync(legacyPath)) return { status: 'missing', imported: 0, legacyPath };
  const legacy = new DatabaseSync(legacyPath, { readOnly: true });
  try {
    const source = discoverLibrarySource(legacy);
    if (!source) return { status: 'no_compatible_table', imported: 0, legacyPath };
    const mappings = {};
    for (const [field, candidates] of Object.entries(FIELD_COLUMNS)) mappings[field] = pickColumn(source.columns, candidates);
    const rows = legacy.prepare(`SELECT * FROM ${quote(source.table)}`).all();
    const insert = coreDb.prepare(`
      INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,last_played_at,inventory_metadata_json,source_table,imported_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(app_id) DO UPDATE SET
        title=excluded.title,
        studio=COALESCE(excluded.studio,games.studio),
        genres=COALESCE(excluded.genres,games.genres),
        cover_url=COALESCE(excluded.cover_url,games.cover_url),
        playtime_minutes=COALESCE(excluded.playtime_minutes,games.playtime_minutes),
        last_played_at=COALESCE(excluded.last_played_at,games.last_played_at),
        inventory_metadata_json=excluded.inventory_metadata_json,
        source_table=excluded.source_table,
        updated_at=datetime('now')
    `);
    let imported = 0;
    coreDb.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const appId = asText(row[source.idColumn]);
        const title = asText(row[source.titleColumn]);
        if (!appId || !title) continue;
        // Only direct inventory-identification fields are accepted. Historical JSON blobs and
        // descriptions are intentionally ignored because their provenance may be mixed or AI-derived.
        const studio = asText(row[mappings.studio]);
        const genres = normalizeGenres(row[mappings.genres]);
        const cover = asText(row[mappings.cover_url]);
        const playtime = Number(row[mappings.playtime_minutes]);
        const lastPlayed = asText(row[mappings.last_played_at]);
        insert.run(appId, title, studio, genres, cover, null, Number.isFinite(playtime) ? playtime : null, lastPlayed, JSON.stringify({ importedFrom: source.table }), source.table);
        imported++;
      }
      coreDb.exec('COMMIT');
    } catch (error) {
      coreDb.exec('ROLLBACK');
      throw error;
    }
    return { status: 'imported', imported, sourceTable: source.table, sourceRows: source.count, legacyPath, columns: { id: source.idColumn, title: source.titleColumn } };
  } finally { legacy.close(); }
}

module.exports = { discoverLibrarySource, importLegacyInventory };
