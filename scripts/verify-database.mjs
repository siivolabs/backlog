import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const databasePath = path.resolve(process.argv[2] || process.env.DATABASE_PATH || '/data/backlog-core.sqlite');
const db = new DatabaseSync(databasePath, { readOnly:true });
const value = (row) => row ? Object.values(row)[0] : null;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row)=>row.name);
const report = {
  database: databasePath,
  integrity: value(db.prepare('PRAGMA integrity_check').get()),
  foreignKeyErrors: db.prepare('PRAGMA foreign_key_check').all(),
  tables: Object.fromEntries(tables.map((table)=>[table, Number(value(db.prepare(`SELECT COUNT(*) FROM "${table.replaceAll('"','""')}"`).get()))])),
  gamesColumns: db.prepare('PRAGMA table_info(games)').all(),
  migration: db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
};
console.log(JSON.stringify(report,null,2));
db.close();
if(report.integrity!=='ok'||report.foreignKeyErrors.length) process.exitCode=1;
