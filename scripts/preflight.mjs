import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dataPath = process.env.DATA_PATH;
if (!dataPath) throw new Error('DATA_PATH est absent. Chargez .env avant le prévol.');
if (!fs.existsSync(dataPath)) throw new Error(`DATA_PATH introuvable : ${dataPath}`);
fs.accessSync(dataPath, fs.constants.R_OK | fs.constants.W_OK);
const core = `${dataPath.replace(/\/$/, '')}/backlog-core.sqlite`;
const legacy = `${dataPath.replace(/\/$/, '')}/backlog.sqlite`;
console.log(`Dossier accessible en lecture/écriture : ${dataPath}`);
if (fs.existsSync(core)) {
  const db = new DatabaseSync(core, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const required of ['games','profiles','discovery_feedback','discovery_sessions']) if (!tables.includes(required)) throw new Error(`Table V1.0 absente : ${required}`);
  const games = new Map(db.prepare('PRAGMA table_info(games)').all().map((c) => [c.name, c.type]));
  if (games.get('app_id') !== 'TEXT' || !games.has('title') || !games.has('studio')) throw new Error('Le schéma games ne correspond pas à Backlog Core V1.0.');
  console.log(`Base Core V1.0 détectée : ${db.prepare('SELECT COUNT(*) AS n FROM games').get().n} jeux.`);
  db.close();
} else if (fs.existsSync(legacy)) console.log('Base Core absente : l’inventaire historique sera importé au premier démarrage.');
else console.log('Aucune base détectée : une base Core V1.0 vide sera initialisée.');
console.log('Prévol réussi. Aucune donnée n’a été modifiée.');
