import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['server.js', 'src', 'public', 'test', 'scripts'];
const files = [];
function walk(name) { const stat = fs.statSync(name); if (stat.isDirectory()) for (const child of fs.readdirSync(name)) walk(path.join(name, child)); else if (/\.(m?js)$/.test(name)) files.push(name); }
for (const root of roots) walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version !== '1.2.0') throw new Error('La version package.json doit être 1.2.0.');
if (!fs.readFileSync('src/config.js', 'utf8').includes("version: '1.2.0'")) throw new Error('Version runtime incohérente.');
console.log(`${files.length} fichiers JavaScript valides · version ${pkg.version}`);
