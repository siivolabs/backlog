import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1201;
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

function addColumn(db, table, definition) {
  const name = definition.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
  if (!name) throw new Error(`Définition de colonne invalide: ${definition}`);
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${ident(table)} ADD COLUMN ${definition}`);
}

function addColumns(db, table, definitions) {
  for (const definition of definitions) addColumn(db, table, definition);
}

function firstColumn(db, table, candidates) {
  const available = columns(db, table);
  return candidates.find((candidate) => available.has(candidate)) || null;
}

function ensureCanonicalAppId(db, table, candidates = ['app_id', 'appid', 'game_id']) {
  const existing = firstColumn(db, table, candidates);
  if (!existing) {
    if (columns(db, table).size === 0) return;
    throw new Error(`Migration impossible: ${table} ne contient aucun identifiant de jeu reconnu.`);
  }
  if (!columns(db, table).has('app_id')) addColumn(db, table, 'app_id TEXT');
  if (existing !== 'app_id') {
    db.exec(`UPDATE ${ident(table)} SET app_id=CAST(${ident(existing)} AS TEXT) WHERE app_id IS NULL OR app_id=''`);
  }
}

function copyColumn(db, table, target, sources, expression = null) {
  const targetColumn = columns(db, table).has(target) ? target : null;
  const source = firstColumn(db, table, sources);
  if (!targetColumn || !source || source === target) return;
  const value = expression ? expression.replaceAll('$source', ident(source)) : ident(source);
  db.exec(`UPDATE ${ident(table)} SET ${ident(target)}=${value} WHERE (${ident(target)} IS NULL OR ${ident(target)}='') AND ${ident(source)} IS NOT NULL`);
}

function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function migrationBackup(db, filename) {
  if (filename === ':memory:' || !fs.existsSync(filename)) return null;
  const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (current >= SCHEMA_VERSION) return null;
  const userTables = Number(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count || 0);
  if (userTables === 0) return null;
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  let backup = `${filename}.pre-v1.2.1-${stamp}.sqlite`;
  let sequence = 1;
  while (fs.existsSync(backup)) backup = `${filename}.pre-v1.2.1-${stamp}-${sequence++}.sqlite`;
  db.exec(`VACUUM INTO ${quoteSqlString(backup)}`);
  return backup;
}

export function openDatabase(filename, { backup = true } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  try {
    const backupPath = backup ? migrationBackup(db, filename) : null;
    migrate(db);
    db.migrationBackupPath = backupPath;
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

export function migrate(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    // Important: no index is created before every referenced column has been verified or added.
    db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        app_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '', studio TEXT NOT NULL DEFAULT '', genres TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', playtime_minutes INTEGER NOT NULL DEFAULT 0,
        last_played_at TEXT, inventory_json TEXT, steam_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    ensureCanonicalAppId(db, 'games');
    addColumns(db, 'games', [
      "title TEXT NOT NULL DEFAULT ''", "studio TEXT NOT NULL DEFAULT ''", "genres TEXT NOT NULL DEFAULT ''",
      "cover_url TEXT NOT NULL DEFAULT ''", "description TEXT NOT NULL DEFAULT ''", 'playtime_minutes INTEGER NOT NULL DEFAULT 0',
      'last_played_at TEXT', 'inventory_json TEXT', 'steam_json TEXT', 'created_at TEXT', 'updated_at TEXT'
    ]);
    copyColumn(db, 'games', 'title', ['name']);
    copyColumn(db, 'games', 'playtime_minutes', ['playtime_forever'], 'CAST($source AS INTEGER)');
    if (columns(db, 'games').has('playtime_forever')) {
      db.exec('UPDATE games SET playtime_minutes=CAST(playtime_forever AS INTEGER) WHERE COALESCE(playtime_minutes,0)=0 AND CAST(playtime_forever AS INTEGER)>0');
    }
    copyColumn(db, 'games', 'last_played_at', ['rtime_last_played'], "CASE WHEN CAST($source AS INTEGER)>0 THEN datetime(CAST($source AS INTEGER),'unixepoch') END");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_games_app_id ON games(app_id)');

    db.exec(`CREATE TABLE IF NOT EXISTS profiles (
      app_id TEXT PRIMARY KEY, profile_json TEXT, embedding_json TEXT, schema_version TEXT NOT NULL DEFAULT 'core-v1',
      analysis_model TEXT, embedding_model TEXT, confidence REAL, source_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    )`);
    ensureCanonicalAppId(db, 'profiles');
    addColumns(db, 'profiles', [
      'profile_json TEXT', 'embedding_json TEXT', "schema_version TEXT DEFAULT 'core-v1'", 'analysis_model TEXT',
      'embedding_model TEXT', 'confidence REAL', 'source_json TEXT', 'created_at TEXT', 'updated_at TEXT'
    ]);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_app_id ON profiles(app_id)');

    db.exec(`CREATE TABLE IF NOT EXISTS discovery_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reference_app_id TEXT NOT NULL DEFAULT '', candidate_app_id TEXT NOT NULL,
      motivation_key TEXT NOT NULL DEFAULT '', verdict TEXT NOT NULL CHECK(verdict IN ('positive','negative')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    addColumns(db, 'discovery_feedback', [
      "reference_app_id TEXT NOT NULL DEFAULT ''", 'candidate_app_id TEXT', "motivation_key TEXT NOT NULL DEFAULT ''",
      'verdict TEXT', 'created_at TEXT'
    ]);
    copyColumn(db, 'discovery_feedback', 'candidate_app_id', ['app_id', 'game_id']);
    copyColumn(db, 'discovery_feedback', 'created_at', ['updated_at']);
    db.exec("UPDATE discovery_feedback SET created_at=CURRENT_TIMESTAMP WHERE created_at IS NULL OR created_at=''");

    db.exec(`CREATE TABLE IF NOT EXISTS enrichment_queue (
      app_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, locked_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    )`);
    ensureCanonicalAppId(db, 'enrichment_queue');
    addColumns(db, 'enrichment_queue', [
      "status TEXT NOT NULL DEFAULT 'pending'", 'attempts INTEGER NOT NULL DEFAULT 0', 'last_error TEXT',
      'locked_at TEXT', 'updated_at TEXT'
    ]);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_enrichment_queue_app_id ON enrichment_queue(app_id)');

    db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    addColumns(db, 'app_settings', ['key TEXT', 'value TEXT', 'updated_at TEXT']);
    copyColumn(db, 'app_settings', 'key', ['setting_key', 'name']);
    copyColumn(db, 'app_settings', 'value', ['setting_value']);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_app_settings_key ON app_settings(key)');

    db.exec(`CREATE TABLE IF NOT EXISTS game_user_state (
      app_id TEXT PRIMARY KEY, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
      completed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(app_id) REFERENCES games(app_id) ON DELETE CASCADE
    )`);
    ensureCanonicalAppId(db, 'game_user_state');
    addColumns(db, 'game_user_state', [
      'completed INTEGER NOT NULL DEFAULT 0', 'completed_at TEXT', 'updated_at TEXT'
    ]);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_game_user_state_app_id ON game_user_state(app_id)');

    db.exec(`CREATE TABLE IF NOT EXISTS recommendation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_key TEXT NOT NULL DEFAULT '', reference_app_id TEXT NOT NULL DEFAULT '',
      motivation_key TEXT NOT NULL DEFAULT '', candidate_app_id TEXT, rank INTEGER NOT NULL DEFAULT 0,
      similarity REAL, profile_quality REAL, presented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    addColumns(db, 'recommendation_history', [
      "request_key TEXT NOT NULL DEFAULT ''", "reference_app_id TEXT NOT NULL DEFAULT ''", "motivation_key TEXT NOT NULL DEFAULT ''",
      'candidate_app_id TEXT', 'rank INTEGER NOT NULL DEFAULT 0', 'similarity REAL', 'profile_quality REAL', 'presented_at TEXT'
    ]);
    copyColumn(db, 'recommendation_history', 'candidate_app_id', ['app_id', 'game_id']);
    copyColumn(db, 'recommendation_history', 'presented_at', ['created_at', 'updated_at']);
    db.exec("UPDATE recommendation_history SET presented_at=CURRENT_TIMESTAMP WHERE presented_at IS NULL OR presented_at=''");

    if (tableExists(db, 'feedback')) {
      const legacy = columns(db, 'feedback');
      const candidate = ['candidate_app_id', 'app_id', 'game_id'].find((name) => legacy.has(name));
      if (candidate && legacy.has('verdict')) {
        const reference = legacy.has('reference_app_id') ? "COALESCE(CAST(f.reference_app_id AS TEXT),'')" : "''";
        const motivation = legacy.has('motivation_key') ? "COALESCE(f.motivation_key,'')" : "''";
        const created = legacy.has('created_at') ? 'COALESCE(f.created_at,CURRENT_TIMESTAMP)' : legacy.has('updated_at') ? 'COALESCE(f.updated_at,CURRENT_TIMESTAMP)' : 'CURRENT_TIMESTAMP';
        db.exec(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,created_at)
          SELECT ${reference},CAST(f.${ident(candidate)} AS TEXT),${motivation},f.verdict,${created}
          FROM feedback f WHERE f.verdict IN ('positive','negative') AND NOT EXISTS (
            SELECT 1 FROM discovery_feedback d WHERE d.reference_app_id=${reference}
              AND CAST(d.candidate_app_id AS TEXT)=CAST(f.${ident(candidate)} AS TEXT)
              AND d.motivation_key=${motivation} AND d.verdict=f.verdict
          )`);
      }
    }

    // Only now are indexes created: existing V1.1 tables have first been brought to the expected shape.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_feedback_candidate ON discovery_feedback(candidate_app_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_candidate_date ON recommendation_history(candidate_app_id, presented_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_request ON recommendation_history(request_key, presented_at DESC);
      CREATE INDEX IF NOT EXISTS idx_games_title ON games(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_user_state_completed ON game_user_state(completed);
    `);

    db.exec(`INSERT OR IGNORE INTO game_user_state(app_id,completed,updated_at)
      SELECT CAST(g.app_id AS TEXT),0,CURRENT_TIMESTAMP FROM games g WHERE g.app_id IS NOT NULL`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_games_user_state_insert AFTER INSERT ON games
      WHEN NEW.app_id IS NOT NULL BEGIN
        INSERT OR IGNORE INTO game_user_state(app_id,completed,updated_at) VALUES (CAST(NEW.app_id AS TEXT),0,CURRENT_TIMESTAMP);
      END`);
    db.exec("INSERT OR IGNORE INTO app_settings(key,value) VALUES ('enrichment_paused','0')");
    db.exec(`UPDATE enrichment_queue SET status='pending',locked_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE status='running' AND (locked_at IS NULL OR datetime(locked_at)<datetime('now','-30 minutes'))`);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw new Error(`Migration SQLite V1.2.1 annulée sans perte de données: ${error.message}`, { cause: error });
  }
}
