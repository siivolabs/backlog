import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  console.error('Usage: node scripts/verify-database.mjs /chemin/backlog-core.sqlite');
  process.exit(2);
}
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-verify-'));
const copy = path.join(tempDir, 'backlog-core.sqlite');
const original = new DatabaseSync(source, { readOnly: true });
original.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
const before = original.prepare('SELECT (SELECT COUNT(*) FROM games) games,(SELECT COUNT(*) FROM profiles) profiles').get();
original.close();
const db = openDatabase(copy, { backup: false });
const after = db.prepare('SELECT (SELECT COUNT(*) FROM games) games,(SELECT COUNT(*) FROM profiles) profiles,(SELECT COUNT(*) FROM game_user_state) states').get();
const sample = db.prepare('SELECT app_id,title FROM games ORDER BY app_id LIMIT 25').all();
const result = { source: path.resolve(source), testedCopy: copy, before, after, schemaVersion: db.prepare('PRAGMA user_version').get().user_version, sampleHash: crypto.createHash('sha256').update(JSON.stringify(sample)).digest('hex'), integrity: db.prepare('PRAGMA integrity_check').get().integrity_check };
console.log(JSON.stringify(result, null, 2));
db.close();
if (before.games !== after.games || before.profiles !== after.profiles || result.integrity !== 'ok') process.exitCode = 1;
