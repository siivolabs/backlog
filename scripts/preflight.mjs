import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const file = process.env.DATABASE_PATH || '/data/backlog-core.sqlite';
if (!fs.existsSync(file)) { console.log(`Prévol: aucune base existante à ${file}; elle sera créée au premier démarrage.`); process.exit(0); }
const db = new DatabaseSync(file, { readOnly: true });
const quick = db.prepare('PRAGMA quick_check').get();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
const games = tables.includes('games') ? db.prepare('PRAGMA table_info(games)').all().map((row) => row.name) : [];
console.log(JSON.stringify({ database: file, quick_check: quick.quick_check, tables, games_columns: games }, null, 2));
if (quick.quick_check !== 'ok') process.exitCode = 1;
if (games.length && (!games.includes('title') || !games.includes('cover_url'))) { console.error('Schéma games non compatible avec Backlog Core V1.0.'); process.exitCode = 2; }
db.close();
