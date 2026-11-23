import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase, columns } from '../src/db.js';

const filename = path.resolve(process.argv[2] || process.env.DATABASE_PATH || process.env.DB_PATH || '/data/backlog-core.sqlite');
if (!fs.existsSync(filename)) { console.error(`Base introuvable: ${filename}`); process.exit(2); }
const before = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const stat = fs.statSync(filename);
const db = openDatabase(filename, { readOnly: true });
const gameColumns = [...columns(db, 'games')];
const profileColumns = [...columns(db, 'profiles')];
const report = {
  mode: 'lecture-seule', path: filename, bytes: stat.size, sha256: before,
  quick_check: db.prepare('PRAGMA quick_check').get()?.quick_check,
  games: db.prepare('SELECT COUNT(*) count FROM games').get().count,
  profiles: db.prepare('SELECT COUNT(*) count FROM profiles').get().count,
  games_with_cover: gameColumns.includes('cover_url') ? db.prepare("SELECT COUNT(*) count FROM games WHERE TRIM(COALESCE(cover_url,''))<>''").get().count : null,
  games_with_description: gameColumns.includes('description') ? db.prepare("SELECT COUNT(*) count FROM games WHERE TRIM(COALESCE(description,''))<>''").get().count : null,
  profiles_with_embedding: profileColumns.includes('embedding_json') ? db.prepare("SELECT COUNT(*) count FROM profiles WHERE TRIM(COALESCE(embedding_json,'')) NOT IN ('','[]','null')").get().count : null,
  capabilities: db.capabilities,
  game_columns: gameColumns, profile_columns: profileColumns,
  tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name)
};
db.close();
const after = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
report.unchanged = before === after;
console.log(JSON.stringify(report, null, 2));
if (!report.unchanged || report.quick_check !== 'ok' || !report.capabilities.historicalCore) process.exitCode = 1;
