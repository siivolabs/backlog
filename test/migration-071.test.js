'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../server');

const timestamp = '2026-11-16T20:00:00.000Z';
const expiry = '2027-11-16T20:00:00.000Z';
const noNetwork = async () => { throw new Error('Network access is not expected during migration tests.'); };

function openApplication(dbPath) {
  return createApplication({
    dbPath,
    fetchImpl: noNetwork,
    env: { NODE_ENV: 'test', STEAM_API_KEY: 'test', ADMIN_TOKEN: 'test' }
  });
}

function create061Database(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      playtime_windows_forever INTEGER NOT NULL DEFAULT 0,
      playtime_mac_forever INTEGER NOT NULL DEFAULT 0,
      playtime_linux_forever INTEGER NOT NULL DEFAULT 0,
      rtime_last_played INTEGER NOT NULL DEFAULT 0,
      img_icon_url TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '[]',
      metadata_status TEXT NOT NULL DEFAULT 'pending',
      metadata_error TEXT,
      metadata_attempts INTEGER NOT NULL DEFAULT 0,
      metadata_updated_at TEXT,
      next_retry_at TEXT,
      metadata_source TEXT,
      metadata_provider_id TEXT,
      metadata_cover_url TEXT,
      source_steamid TEXT,
      last_seen_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, steamid TEXT NOT NULL, profile_name TEXT,
      game_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, message TEXT,
      started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE TABLE metadata_cache (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, provider_id TEXT, name TEXT,
      genres TEXT NOT NULL DEFAULT '[]', cover_url TEXT, found INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(provider, external_id)
    );
  `);
  const insertGame = db.prepare(`INSERT INTO games(
    appid, name, genres, metadata_status, metadata_error, metadata_attempts,
    metadata_updated_at, next_retry_at, metadata_source, metadata_provider_id,
    metadata_cover_url, source_steamid, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'steam-user', ?, ?)`);
  insertGame.run(10, 'Steam complete', '["Action"]', 'synced', null, 1, timestamp, null, 'steam_store', '10', null, timestamp, timestamp);
  insertGame.run(20, 'IGDB complete', '["Puzzle"]', 'synced', null, 1, timestamp, null, 'igdb', '20020', 'https://images.igdb.com/20.jpg', timestamp, timestamp);
  insertGame.run(30, 'Missing metadata', '[]', 'unavailable', 'Aucune fiche Steam Store ni correspondance IGDB par AppID.', 1, timestamp, null, null, null, null, timestamp, timestamp);
  insertGame.run(40, 'Temporary provider issue', '["Adventure"]', 'temporary_error', 'IGDB HTTP 429', 2, timestamp, expiry, 'igdb', '20040', null, timestamp, timestamp);
  insertGame.run(50, 'Interrupted request', '[]', 'syncing', null, 0, null, null, null, null, null, timestamp, timestamp);

  const insertCache = db.prepare(`INSERT INTO metadata_cache(
    provider, external_id, provider_id, name, genres, cover_url, found, fetched_at, expires_at
  ) VALUES ('igdb', ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertCache.run('10', '20010', 'Steam complete IGDB', '["Action"]', null, 1, timestamp, expiry);
  insertCache.run('20', '20020', 'IGDB complete', '["Puzzle"]', 'https://images.igdb.com/20.jpg', 1, timestamp, expiry);
  insertCache.run('30', null, null, '[]', null, 0, timestamp, expiry);
  insertCache.run('40', '20040', 'Temporary provider issue', '["Adventure"]', null, 1, timestamp, expiry);
  insertCache.run('50', '20050', 'Interrupted request', '["Action"]', null, 1, timestamp, expiry);
  db.close();
}

function statusMap(db) {
  return Object.fromEntries(db.prepare('SELECT appid, metadata_status FROM games ORDER BY appid').all()
    .map((row) => [Number(row.appid), row.metadata_status]));
}

test('migration from a fully enriched V0.6.1 database preserves completed statuses and metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-061-migration-'));
  const dbPath = path.join(directory, 'backlog.sqlite');
  try {
    create061Database(dbPath);
    const application = openApplication(dbPath);
    assert.deepEqual(statusMap(application.db), {
      10: 'synced',
      20: 'synced',
      30: 'unavailable',
      40: 'temporary_error',
      50: 'pending'
    });
    assert.equal(application.db.prepare('SELECT genres FROM games WHERE appid = 10').get().genres, '["Action"]');
    assert.equal(application.db.prepare('SELECT metadata_source FROM games WHERE appid = 20').get().metadata_source, 'igdb');
    assert.equal(application.db.prepare('SELECT metadata_error FROM games WHERE appid = 30').get().metadata_error,
      'Aucune fiche Steam Store ni correspondance IGDB par AppID.');
    assert.equal(Number(application.db.prepare('SELECT COUNT(*) AS count FROM metadata_cache').get().count), 5);
    assert.equal(Number(application.db.prepare("SELECT COUNT(*) AS count FROM games WHERE metadata_status = 'pending'").get().count), 1);
    const marker = JSON.parse(application.db.prepare("SELECT value FROM settings WHERE key = 'migration_071_status_repair'").get().value);
    assert.equal(marker.repairedSynced, 0);
    assert.equal(marker.repairedUnavailable, 0);
    application.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('V0.7.1 repairs V0.7.0-damaged statuses from preserved data and cache exactly once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-070-repair-'));
  const dbPath = path.join(directory, 'backlog.sqlite');
  try {
    const seed = openApplication(dbPath);
    seed.db.prepare("DELETE FROM settings WHERE key = 'migration_071_status_repair'").run();
    const insertGame = seed.db.prepare(`INSERT INTO games(
      appid, name, genres, themes, platforms, application_type, metadata_status, metadata_error,
      metadata_attempts, metadata_updated_at, next_retry_at, metadata_source, metadata_sources,
      metadata_provider_id, igdb_provider_id, source_steamid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'full_game', ?, ?, 1, ?, ?, ?, ?, ?, ?, 'steam-user', ?, ?)`);
    insertGame.run(101, 'Recovered Steam', '["Action"]', '["Science fiction"]', '["windows"]', 'pending', null,
      timestamp, null, 'steam_store', '["steam_store","igdb"]', '101', '20101', timestamp, timestamp);
    insertGame.run(102, 'Recovered IGDB', '["Puzzle"]', '[]', '["linux"]', 'pending', null,
      timestamp, null, 'igdb', '["igdb"]', '20102', '20102', timestamp, timestamp);
    insertGame.run(103, 'Cache fallback', '[]', '[]', '[]', 'pending', null,
      timestamp, null, null, '[]', null, null, timestamp, timestamp);
    insertGame.run(104, 'No metadata', '[]', '[]', '[]', 'pending', null,
      timestamp, null, null, '[]', null, null, timestamp, timestamp);
    insertGame.run(105, 'Temporary issue', '["Adventure"]', '[]', '["windows"]', 'temporary_error', 'Steam Store HTTP 429',
      timestamp, expiry, 'steam_store', '["steam_store"]', '105', null, timestamp, timestamp);
    insertGame.run(106, 'Interrupted', '["Action"]', '[]', '["windows"]', 'syncing', null,
      timestamp, null, 'steam_store', '["steam_store"]', '106', null, timestamp, timestamp);

    const insertCache = seed.db.prepare(`INSERT INTO metadata_cache(
      provider, external_id, provider_id, name, genres, themes, platforms, game_type,
      cover_url, found, fetched_at, expires_at
    ) VALUES ('igdb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertCache.run('101', '20101', 'Recovered Steam IGDB', '["Action"]', '["Science fiction"]', '["PC"]', 'Main Game', null, 1, timestamp, expiry);
    insertCache.run('102', '20102', 'Recovered IGDB', '["Puzzle"]', '[]', '["Linux"]', 'Main Game', null, 1, timestamp, expiry);
    insertCache.run('103', '20103', 'Cache fallback', '["Strategy"]', '["Fantasy"]', '["PC"]', 'Main Game', 'https://images.igdb.com/103.jpg', 1, timestamp, expiry);
    insertCache.run('104', null, null, '[]', '[]', '[]', null, null, 0, timestamp, expiry);
    insertCache.run('105', '20105', 'Temporary issue', '["Adventure"]', '[]', '["PC"]', 'Main Game', null, 1, timestamp, expiry);
    insertCache.run('106', '20106', 'Interrupted', '["Action"]', '[]', '["PC"]', 'Main Game', null, 1, timestamp, expiry);
    seed.db.prepare(`INSERT INTO game_manual_overrides(appid, display_name, genres, updated_at, updated_by)
      VALUES (101, 'Manual title', '["Manual genre"]', ?, 'admin')`).run(timestamp);
    seed.db.prepare(`INSERT INTO igdb_manual_matches(appid, igdb_game_id, status, updated_at)
      VALUES (102, 99999, 'confirmed', ?)`).run(timestamp);
    seed.close();

    const repaired = openApplication(dbPath);
    assert.deepEqual(statusMap(repaired.db), {
      101: 'synced',
      102: 'synced',
      103: 'synced',
      104: 'unavailable',
      105: 'temporary_error',
      106: 'pending'
    });
    assert.equal(repaired.db.prepare('SELECT genres FROM games WHERE appid = 101').get().genres, '["Action"]');
    assert.equal(repaired.db.prepare('SELECT genres FROM games WHERE appid = 103').get().genres, '["Strategy"]');
    assert.equal(repaired.db.prepare('SELECT metadata_source FROM games WHERE appid = 103').get().metadata_source, 'igdb');
    assert.equal(repaired.db.prepare('SELECT metadata_error FROM games WHERE appid = 104').get().metadata_error,
      'Aucune fiche Steam Store ni correspondance IGDB par AppID.');
    assert.equal(repaired.db.prepare('SELECT display_name FROM game_manual_overrides WHERE appid = 101').get().display_name, 'Manual title');
    assert.equal(Number(repaired.db.prepare('SELECT igdb_game_id FROM igdb_manual_matches WHERE appid = 102').get().igdb_game_id), 99999);
    assert.equal(Number(repaired.db.prepare('SELECT COUNT(*) AS count FROM metadata_cache').get().count), 6);
    assert.equal(Number(repaired.db.prepare(`SELECT COUNT(*) AS count FROM games
      WHERE metadata_status = 'pending' OR (metadata_status = 'temporary_error' AND (next_retry_at IS NULL OR next_retry_at <= ?))`).get(new Date().toISOString()).count), 1);
    const markerValue = repaired.db.prepare("SELECT value FROM settings WHERE key = 'migration_071_status_repair'").get().value;
    const marker = JSON.parse(markerValue);
    assert.equal(marker.repairedFromSource, 2);
    assert.equal(marker.repairedFromCache, 1);
    assert.equal(marker.repairedUnavailable, 1);
    repaired.close();

    const reopened = openApplication(dbPath);
    assert.deepEqual(statusMap(reopened.db), {
      101: 'synced', 102: 'synced', 103: 'synced', 104: 'unavailable', 105: 'temporary_error', 106: 'pending'
    });
    assert.equal(reopened.db.prepare("SELECT value FROM settings WHERE key = 'migration_071_status_repair'").get().value, markerValue);
    assert.equal(reopened.db.prepare('SELECT display_name FROM game_manual_overrides WHERE appid = 101').get().display_name, 'Manual title');
    assert.equal(Number(reopened.db.prepare('SELECT igdb_game_id FROM igdb_manual_matches WHERE appid = 102').get().igdb_game_id), 99999);
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('status repair handles the observed 4,321-game damaged distribution without re-enrichment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-4321-repair-'));
  const dbPath = path.join(directory, 'backlog.sqlite');
  try {
    const seed = openApplication(dbPath);
    seed.db.prepare("DELETE FROM settings WHERE key = 'migration_071_status_repair'").run();
    const insertGame = seed.db.prepare(`INSERT INTO games(
      appid, name, genres, themes, platforms, application_type, classification_source,
      classification_reason, classification_confidence, metadata_status, metadata_error,
      metadata_attempts, metadata_updated_at, next_retry_at, metadata_source, metadata_sources,
      metadata_provider_id, source_steamid, created_at, updated_at
    ) VALUES (?, ?, ?, '[]', '["windows"]', 'full_game', 'steam_store',
      'Jeu jouable identifié par le fournisseur.', 'high', ?, ?, 1, ?, ?, ?, ?, ?, 'steam-user', ?, ?)`);
    const insertCache = seed.db.prepare(`INSERT INTO metadata_cache(
      provider, external_id, provider_id, name, genres, themes, platforms, game_type,
      cover_url, found, fetched_at, expires_at
    ) VALUES ('igdb', ?, ?, ?, ?, '[]', '["PC"]', 'Main Game', NULL, ?, ?, ?)`);
    seed.db.exec('BEGIN IMMEDIATE');
    try {
      for (let appid = 1; appid <= 4321; appid += 1) {
        const missing = appid <= 63;
        const status = appid <= 3893 ? 'pending' : appid <= 4295 ? 'synced' : 'temporary_error';
        const error = status === 'temporary_error' ? 'Steam Store HTTP 429' : null;
        const retryAt = status === 'temporary_error' ? expiry : null;
        const source = missing ? null : 'steam_store';
        const sources = missing ? '[]' : '["steam_store","igdb"]';
        const genres = missing ? '[]' : '["Action"]';
        insertGame.run(appid, `Game ${appid}`, genres, status, error, timestamp, retryAt,
          source, sources, source ? String(appid) : null, timestamp, timestamp);
        insertCache.run(String(appid), missing ? null : String(20000 + appid), missing ? null : `Game ${appid}`,
          genres, missing ? 0 : 1, timestamp, expiry);
      }
      seed.db.exec('COMMIT');
    } catch (error) {
      seed.db.exec('ROLLBACK');
      throw error;
    }
    seed.db.prepare(`INSERT INTO game_manual_overrides(appid, display_name, updated_at, updated_by)
      VALUES (100, 'Manual 100', ?, 'admin')`).run(timestamp);
    seed.db.prepare(`INSERT INTO igdb_manual_matches(appid, igdb_game_id, status, updated_at)
      VALUES (101, 50101, 'confirmed', ?)`).run(timestamp);
    seed.close();

    const repaired = openApplication(dbPath);
    const counts = Object.fromEntries(repaired.db.prepare(`SELECT metadata_status AS status, COUNT(*) AS count
      FROM games GROUP BY metadata_status`).all().map((row) => [row.status, Number(row.count)]));
    assert.deepEqual(counts, { synced: 4232, temporary_error: 26, unavailable: 63 });
    assert.equal(Number(repaired.db.prepare("SELECT COUNT(*) AS count FROM games WHERE genres <> '[]'").get().count), 4258);
    assert.equal(Number(repaired.db.prepare('SELECT COUNT(*) AS count FROM metadata_cache').get().count), 4321);
    assert.equal(Number(repaired.db.prepare("SELECT COUNT(*) AS count FROM games WHERE metadata_status = 'pending'").get().count), 0);
    assert.equal(repaired.db.prepare('SELECT display_name FROM game_manual_overrides WHERE appid = 100').get().display_name, 'Manual 100');
    assert.equal(Number(repaired.db.prepare('SELECT igdb_game_id FROM igdb_manual_matches WHERE appid = 101').get().igdb_game_id), 50101);
    const marker = JSON.parse(repaired.db.prepare("SELECT value FROM settings WHERE key = 'migration_071_status_repair'").get().value);
    assert.equal(marker.repairedFromSource, 3830);
    assert.equal(marker.repairedFromCache, 0);
    assert.equal(marker.repairedUnavailable, 63);
    repaired.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
