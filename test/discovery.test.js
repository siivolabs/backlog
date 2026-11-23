import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { discover } from '../src/discovery.js';

function add(db, id, title, options = {}) {
  db.prepare('INSERT INTO games(app_id,title,studio,genres,description) VALUES (?,?,?,?,?)').run(id, title, options.studio || 'Studio', JSON.stringify(options.genres || ['Indé']), options.description || 'Description documentée');
  db.prepare('INSERT INTO profiles(app_id,profile_json,embedding_json,confidence,source_json) VALUES (?,?,?,?,?)').run(id, JSON.stringify(options.profile || { summary: 'Une expérience originale et concise avec des mécaniques identifiées.' }), JSON.stringify(options.embedding || [1,0,0,0,0,0,0,0]), options.confidence ?? 0.8, JSON.stringify(options.sources ?? ['Steam','IGDB']));
}

test('exclut les profils spéculatifs et les jeux terminés', () => {
  const db = openDatabase(':memory:', { backup: false });
  add(db, '1', 'Solide');
  add(db, '2', 'Spéculatif', { studio: '', description: '', confidence: 0.6, sources: [], profile: { summary: "Absence de données, analyse spéculative, studio inconnu." } });
  add(db, '3', 'Terminé');
  db.prepare("UPDATE game_user_state SET completed=1 WHERE app_id='3'").run();
  const result = discover(db, { embedding: [1,0,0,0,0,0,0,0], query: 'original', limit: 10 });
  assert.deepEqual(result.results.map((row) => row.app_id), ['1']);
  assert.equal(result.excludedForQuality, 1);
  db.close();
});

test('le mode Surprends-moi fonctionne sans embedding cible', () => {
  const db = openDatabase(':memory:', { backup: false });
  add(db, '10', 'A'); add(db, '11', 'B', { genres: ['Puzzle'] });
  const result = discover(db, { surprise: true, motivationKey: 'surprise', limit: 2, requestKey: 'stable' });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((row) => row.profileQuality >= 0.45));
  db.close();
});
