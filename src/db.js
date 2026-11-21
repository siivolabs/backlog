import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATION_VERSION = 10101;
const REQUIRED_EXISTING_TABLES = [
  'enrichment_items', 'enrichment_runs', 'enrichment_jobs', 'enrichment_campaign',
  'profiles', 'discovery_feedback', 'discovery_sessions', 'meta',
  'schema_migrations', 'work_batch'
];

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function tableInfo(db, name) {
  if (!tableExists(db, name)) return [];
  return db.prepare(`PRAGMA table_info(${q(name)})`).all();
}

export function columnNames(db, name) {
  return new Set(tableInfo(db, name).map((column) => column.name));
}

function addColumn(db, table, name, declaration) {
  if (!columnNames(db, table).has(name)) {
    db.exec(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${declaration}`);
  }
}

function createGames(db, table = 'games') {
  db.exec(`
    CREATE TABLE ${q(table)} (
      app_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cover_url TEXT,
      developer TEXT,
      genres TEXT,
      description TEXT,
      playtime_minutes INTEGER,
      last_played_at TEXT,
      inventory_metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'legacy',
      source_table TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function validateLegacyAppIds(db) {
  const rows = db.prepare('SELECT app_id FROM games').all();
  const seen = new Set();
  for (const { app_id } of rows) {
    const text = String(app_id ?? '').trim();
    if (!/^[1-9][0-9]*$/.test(text)) {
      throw new Error(`Migration V1.1.1 annulée : app_id non numérique ou invalide (${JSON.stringify(app_id)}). La base source est intacte.`);
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Migration V1.1.1 annulée : app_id hors plage JavaScript (${text}). La base source est intacte.`);
    }
    if (seen.has(value)) {
      throw new Error(`Migration V1.1.1 annulée : collision après conversion de app_id (${text}). La base source est intacte.`);
    }
    seen.add(value);
  }
}

function preserveGamesSchemaObjects(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_legacy_schema (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_version INTEGER NOT NULL,
      object_type TEXT NOT NULL,
      object_name TEXT NOT NULL,
      object_sql TEXT,
      preserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(migration_version, object_type, object_name)
    )
  `);
  const objects = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE tbl_name='games' AND type IN ('index','trigger') AND sql IS NOT NULL
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO migration_legacy_schema
      (migration_version, object_type, object_name, object_sql)
    VALUES (?, ?, ?, ?)
  `);
  for (const object of objects) insert.run(MIGRATION_VERSION, object.type, object.name, object.sql);
}

function migrateGames(db) {
  if (!tableExists(db, 'games')) {
    createGames(db);
    return 'created';
  }

  const info = tableInfo(db, 'games');
  const columns = new Set(info.map((column) => column.name));
  const appId = info.find((column) => column.name === 'app_id');
  if (!appId) throw new Error('Migration V1.1.1 annulée : la table games ne contient pas app_id.');

  const legacyShape = columns.has('title') && !columns.has('name');
  const nonIntegerId = String(appId.type || '').toUpperCase() !== 'INTEGER';

  if (legacyShape || nonIntegerId) {
    validateLegacyAppIds(db);
    preserveGamesSchemaObjects(db);
    db.exec('DROP TABLE IF EXISTS games_v111_new');
    createGames(db, 'games_v111_new');

    const title = columns.has('name') ? 'name' : columns.has('title') ? 'title' : null;
    if (!title) throw new Error('Migration V1.1.1 annulée : games ne contient ni name ni title.');
    const developer = columns.has('developer') ? 'developer' : columns.has('studio') ? 'studio' : 'NULL';
    const expr = (name, fallback = 'NULL') => columns.has(name) ? q(name) : fallback;
    const sourceExpr = columns.has('source') ? q('source') : columns.has('source_table') ? `COALESCE(${q('source_table')}, 'legacy')` : `'legacy'`;
    const sourceTableExpr = columns.has('source_table') ? q('source_table') : 'NULL';

    db.exec(`
      INSERT INTO games_v111_new (
        app_id, name, cover_url, developer, genres, description,
        playtime_minutes, last_played_at, inventory_metadata_json,
        source, source_table, imported_at, updated_at
      )
      SELECT
        CAST(app_id AS INTEGER),
        COALESCE(NULLIF(TRIM(${q(title)}), ''), 'Jeu ' || CAST(app_id AS TEXT)),
        ${expr('cover_url')}, ${developer}, ${expr('genres')}, ${expr('description')},
        ${expr('playtime_minutes')}, ${expr('last_played_at')},
        COALESCE(${expr('inventory_metadata_json', `'{}'`)}, '{}'),
        COALESCE(${sourceExpr}, 'legacy'), ${sourceTableExpr},
        COALESCE(${expr('imported_at', 'CURRENT_TIMESTAMP')}, CURRENT_TIMESTAMP),
        COALESCE(${expr('updated_at', 'CURRENT_TIMESTAMP')}, CURRENT_TIMESTAMP)
      FROM games
    `);
    db.exec('DROP TABLE games; ALTER TABLE games_v111_new RENAME TO games;');
    return 'rebuilt';
  }

  const additions = {
    cover_url: 'TEXT', developer: 'TEXT', genres: 'TEXT', description: 'TEXT',
    playtime_minutes: 'INTEGER', last_played_at: 'TEXT',
    inventory_metadata_json: "TEXT NOT NULL DEFAULT '{}'", source: "TEXT NOT NULL DEFAULT 'legacy'",
    source_table: 'TEXT', imported_at: 'TEXT', updated_at: 'TEXT'
  };
  for (const [name, declaration] of Object.entries(additions)) addColumn(db, 'games', name, declaration);
  db.exec(`
    UPDATE games SET
      inventory_metadata_json=COALESCE(inventory_metadata_json, '{}'),
      source=COALESCE(NULLIF(source, ''), source_table, 'legacy'),
      imported_at=COALESCE(imported_at, CURRENT_TIMESTAMP),
      updated_at=COALESCE(updated_at, CURRENT_TIMESTAMP)
  `);
  return 'compatible';
}

function ensureSchemaMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
  )`);
  addColumn(db, 'schema_migrations', 'version', 'INTEGER');
  addColumn(db, 'schema_migrations', 'applied_at', 'TEXT');
  addColumn(db, 'schema_migrations', 'description', 'TEXT');
}

function ensureProfiles(db) {
  if (!tableExists(db, 'profiles')) {
    db.exec(`CREATE TABLE profiles (
      app_id INTEGER PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,
      schema_version TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      model TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      source_json TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    return;
  }
  if (!columnNames(db, 'profiles').has('app_id')) throw new Error('Table profiles incompatible : app_id absent.');
  const fields = {
    schema_version: 'TEXT', pipeline_version: 'TEXT', model: 'TEXT', embedding_model: 'TEXT',
    source_json: 'TEXT', profile_json: 'TEXT', embedding_json: 'TEXT', created_at: 'TEXT', updated_at: 'TEXT'
  };
  for (const [name, type] of Object.entries(fields)) addColumn(db, 'profiles', name, type);
  db.exec(`UPDATE profiles SET
    schema_version=COALESCE(schema_version,'core-1'), pipeline_version=COALESCE(pipeline_version,'1.1.1'),
    model=COALESCE(model,''), embedding_model=COALESCE(embedding_model,''),
    source_json=COALESCE(source_json,'{}'), profile_json=COALESCE(profile_json,'{}'),
    embedding_json=COALESCE(embedding_json,'[]'), created_at=COALESCE(created_at,CURRENT_TIMESTAMP),
    updated_at=COALESCE(updated_at,CURRENT_TIMESTAMP)`);
}

function ensureCampaign(db) {
  if (!tableExists(db, 'enrichment_campaign')) {
    db.exec(`CREATE TABLE enrichment_campaign (
      id INTEGER PRIMARY KEY CHECK (id=1),
      status TEXT NOT NULL DEFAULT 'idle', started_at TEXT, completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      current_app_id INTEGER REFERENCES games(app_id), current_step TEXT, last_error TEXT
    )`);
  } else {
    if (!columnNames(db, 'enrichment_campaign').has('id')) throw new Error('Table enrichment_campaign incompatible : id absent.');
    for (const [name, type] of Object.entries({status:'TEXT',started_at:'TEXT',completed_at:'TEXT',updated_at:'TEXT',current_app_id:'INTEGER',current_step:'TEXT',last_error:'TEXT'})) addColumn(db, 'enrichment_campaign', name, type);
  }
  db.prepare(`INSERT OR IGNORE INTO enrichment_campaign (id,status,updated_at) VALUES (1,'idle',CURRENT_TIMESTAMP)`).run();
  db.exec(`UPDATE enrichment_campaign SET status=COALESCE(status,'idle'), updated_at=COALESCE(updated_at,CURRENT_TIMESTAMP) WHERE id=1`);
}

function ensureJobs(db) {
  if (!tableExists(db, 'enrichment_jobs')) {
    db.exec(`CREATE TABLE enrichment_jobs (
      app_id INTEGER PRIMARY KEY REFERENCES games(app_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      current_step TEXT, error TEXT, queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT, finished_at TEXT, duration_ms INTEGER
    )`);
    return;
  }
  if (!columnNames(db, 'enrichment_jobs').has('app_id')) throw new Error('Table enrichment_jobs incompatible : app_id absent.');
  for (const [name,type] of Object.entries({status:'TEXT',attempts:'INTEGER',current_step:'TEXT',error:'TEXT',queued_at:'TEXT',started_at:'TEXT',finished_at:'TEXT',duration_ms:'INTEGER'})) addColumn(db, 'enrichment_jobs', name, type);
  db.exec(`UPDATE enrichment_jobs SET status=COALESCE(status,'pending'), attempts=COALESCE(attempts,0), queued_at=COALESCE(queued_at,CURRENT_TIMESTAMP)`);
}

function ensureFeedback(db) {
  if (!tableExists(db, 'discovery_feedback')) {
    db.exec(`CREATE TABLE discovery_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES games(app_id) ON DELETE CASCADE,
      motivation TEXT NOT NULL, verdict TEXT NOT NULL, note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    return;
  }
  const columns = columnNames(db, 'discovery_feedback');
  if (!columns.has('id') || !columns.has('app_id')) throw new Error('Table discovery_feedback incompatible : id ou app_id absent.');
  for (const [name,type] of Object.entries({motivation:'TEXT',verdict:'TEXT',note:'TEXT',created_at:'TEXT'})) addColumn(db, 'discovery_feedback', name, type);
  db.exec(`UPDATE discovery_feedback SET motivation=COALESCE(motivation,''), verdict=COALESCE(verdict,'neutral'), created_at=COALESCE(created_at,CURRENT_TIMESTAMP)`);
}

function recordCompatibility(db, existedBefore = new Map()) {
  db.exec(`CREATE TABLE IF NOT EXISTS migration_compatibility (
    migration_version INTEGER NOT NULL, table_name TEXT NOT NULL,
    existed_before INTEGER NOT NULL, row_count INTEGER, columns_json TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(migration_version, table_name)
  )`);
  const upsert = db.prepare(`INSERT INTO migration_compatibility
    (migration_version,table_name,existed_before,row_count,columns_json,checked_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(migration_version,table_name) DO UPDATE SET
      row_count=excluded.row_count, columns_json=excluded.columns_json,
      checked_at=CURRENT_TIMESTAMP`);
  for (const table of ['games', ...REQUIRED_EXISTING_TABLES]) {
    const exists = tableExists(db, table);
    const count = exists ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).get().count) : null;
    upsert.run(MIGRATION_VERSION, table, existedBefore.get(table) ? 1 : 0, count, JSON.stringify(tableInfo(db, table)));
  }
}

function createSafetyBackup(db, databasePath) {
  if (!databasePath || databasePath === ':memory:' || process.env.BACKLOG_SKIP_BACKUP === '1') return null;
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return null;
  const directory = path.dirname(databasePath);
  const base = path.basename(databasePath, path.extname(databasePath));
  const stamp = new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
  const backupPath = path.join(directory, `${base}.pre-v1.1.1-${stamp}.sqlite`);
  db.exec(`VACUUM INTO ${sqlString(backupPath)}`);
  return backupPath;
}

function migrationApplied(db) {
  if (!tableExists(db, 'schema_migrations')) return false;
  const columns = columnNames(db, 'schema_migrations');
  if (!columns.has('version')) return false;
  return Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(MIGRATION_VERSION));
}

export function migrate(db, { databasePath = ':memory:' } = {}) {
  const trackedTables = ['games', ...REQUIRED_EXISTING_TABLES];
  const existedBefore = new Map(trackedTables.map((table) => [table, tableExists(db, table)]));
  const gamesInfo = tableInfo(db, 'games');
  const needsGamesRebuild = gamesInfo.length > 0 && (
    !gamesInfo.some((column) => column.name === 'name') ||
    String(gamesInfo.find((column) => column.name === 'app_id')?.type || '').toUpperCase() !== 'INTEGER'
  );
  const alreadyApplied = migrationApplied(db);
  const backupPath = !alreadyApplied && needsGamesRebuild ? createSafetyBackup(db, databasePath) : null;

  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  let gamesAction;
  try {
    ensureSchemaMigrations(db);
    gamesAction = migrateGames(db);
    ensureProfiles(db);
    ensureCampaign(db);
    ensureJobs(db);
    ensureFeedback(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_games_name ON games(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON enrichment_jobs(status, queued_at);
      CREATE INDEX IF NOT EXISTS idx_feedback_app ON discovery_feedback(app_id, created_at);
    `);
    recordCompatibility(db, existedBefore);
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(MIGRATION_VERSION)) {
      db.prepare(`INSERT INTO schema_migrations(version,applied_at,description) VALUES (?,CURRENT_TIMESTAMP,?)`)
        .run(MIGRATION_VERSION, 'Backlog Core V1.1.1 - compatibilité V1.0/V1.1');
    }
    const quick = db.prepare('PRAGMA quick_check').get();
    if (!quick || Object.values(quick)[0] !== 'ok') throw new Error(`SQLite quick_check a échoué: ${JSON.stringify(quick)}`);
    const foreignErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignErrors.length) throw new Error(`SQLite foreign_key_check a détecté ${foreignErrors.length} erreur(s).`);
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
  return { version: MIGRATION_VERSION, gamesAction, backupPath, alreadyApplied };
}

export function openDatabase(databasePath, options = {}) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
    const migration = migrate(db, { databasePath, ...options });
    return { db, migration };
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function json(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
