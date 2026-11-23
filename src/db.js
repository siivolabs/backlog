import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const STATE_SCHEMA_VERSION = 1202;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function ident(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identifiant SQL invalide: ${value}`);
  return `"${value}"`;
}
export function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
export function columns(db, table) {
  if (!IDENTIFIER.test(table) || !tableExists(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${ident(table)})`).all().map((row) => row.name));
}
export function databaseCapabilities(db) {
  const games = columns(db, 'games');
  const profiles = columns(db, 'profiles');
  const state = columns(db, 'game_user_state');
  const history = columns(db, 'recommendation_history');
  const feedback = columns(db, 'discovery_feedback');
  const queue = columns(db, 'enrichment_queue');
  return {
    historicalCore: ['app_id', 'title'].every((name) => games.has(name)) && ['app_id', 'profile_json', 'embedding_json'].every((name) => profiles.has(name)),
    completion: ['app_id', 'completed'].every((name) => state.has(name)),
    recommendationHistory: history.has('candidate_app_id') || history.has('app_id'),
    feedback: ['reference_app_id', 'candidate_app_id', 'motivation_key', 'verdict'].every((name) => feedback.has(name)),
    enrichmentQueue: queue.has('app_id') || queue.has('game_id')
  };
}
function assertHistoricalCore(db) {
  const capabilities = databaseCapabilities(db);
  if (!capabilities.historicalCore) {
    throw new Error('La base ciblée n’est pas la base historique Backlog attendue (tables games/profiles ou colonnes essentielles absentes). Aucune modification effectuée.');
  }
  const quick = db.prepare('PRAGMA quick_check').get()?.quick_check;
  if (quick !== 'ok') throw new Error(`Échec de PRAGMA quick_check: ${quick || 'résultat absent'}. Aucune modification effectuée.`);
  return capabilities;
}

function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertColumns(db, table, required) {
  const available = columns(db, table);
  const missing = required.filter((name) => !available.has(name));
  if (missing.length) {
    throw new Error(`Table V1.2 incompatible: ${table} ne contient pas ${missing.join(', ')}.`);
  }
}

function createSafetyBackup(db, filename) {
  if (filename === ':memory:' || !fs.existsSync(filename)) return null;
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  let backup = `${filename}.pre-v1.2.2-${stamp}.bak`;
  let sequence = 1;
  while (fs.existsSync(backup)) backup = `${filename}.pre-v1.2.2-${stamp}-${sequence++}.bak`;
  db.exec(`VACUUM INTO ${quoteSqlString(backup)}`);
  return backup;
}

export function ensureV12State(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS game_user_state (
        app_id TEXT PRIMARY KEY,
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS recommendation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_key TEXT NOT NULL DEFAULT '',
        reference_app_id TEXT NOT NULL DEFAULT '',
        motivation_key TEXT NOT NULL DEFAULT '',
        candidate_app_id TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 0,
        similarity REAL,
        profile_quality REAL,
        presented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    assertColumns(db, 'game_user_state', ['app_id', 'completed', 'completed_at', 'updated_at']);
    assertColumns(db, 'recommendation_history', [
      'id', 'request_key', 'reference_app_id', 'motivation_key', 'candidate_app_id',
      'rank', 'similarity', 'profile_quality', 'presented_at'
    ]);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_game_user_state_completed ON game_user_state(completed);
      CREATE INDEX IF NOT EXISTS idx_recommendation_history_candidate_date
        ON recommendation_history(candidate_app_id, presented_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recommendation_history_request
        ON recommendation_history(request_key, presented_at DESC);
    `);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw new Error(`Initialisation additive de l’état V1.2 annulée: ${error.message}`, { cause: error });
  }
}

export function openDatabase(filename, { readOnly = false } = {}) {
  const memory = filename === ':memory:';
  const resolved = memory ? filename : path.resolve(filename);
  if (!memory) {
    let stat;
    try { stat = fs.statSync(resolved); }
    catch { throw new Error(`Base SQLite historique introuvable: ${resolved}. Démarrage refusé pour éviter la création d’une base vide.`); }
    if (!stat.isFile() || stat.size === 0) throw new Error(`Chemin SQLite historique invalide ou vide: ${resolved}. Démarrage refusé.`);
  }
  const db = new DatabaseSync(resolved, { readOnly });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.databasePath = resolved;
    db.capabilities = assertHistoricalCore(db);
    const stateAlreadyPresent = tableExists(db, 'game_user_state') && tableExists(db, 'recommendation_history');
    if (!readOnly) {
      db.migrationBackupPath = stateAlreadyPresent ? null : createSafetyBackup(db, resolved);
      ensureV12State(db);
      db.capabilities = databaseCapabilities(db);
    }
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}
