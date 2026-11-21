import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, 'test'))) throw new Error('Le dossier hérité test/ ne doit pas exister. Conserver uniquement tests/.');
const files = [];
for (const dir of ['src','public','scripts','tests']) {
  const walk = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) files.push(full); } };
  walk(path.join(root, dir));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(`Syntaxe invalide: ${path.relative(root, file)}\n${result.stderr}`);
}
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
for (const phrase of ['Jeton administrateur','Importer l’inventaire','Suivi des erreurs','Découverte','gameGrid']) if (!html.includes(phrase)) throw new Error(`Régression UI: ${phrase} absent.`);
if (!css.includes('--blue:#2188ff') || css.includes('--blue:#16a34a')) throw new Error('L’identité visuelle bleue n’est pas garantie.');
console.log(`Vérifications statiques réussies (${files.length} fichiers JavaScript).`);
