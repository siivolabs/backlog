import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, closeDatabase } from '../src/db.js';
import { DiscoveryEngine } from '../src/discovery.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('un profil nouvellement enregistré est immédiatement candidat dans Découverte', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-discovery-'));
  const db = openDatabase(path.join(dir, 'core.sqlite'));
  db.prepare('INSERT INTO games (app_id,name) VALUES (?,?)').run(42, 'Univers étrange');
  db.prepare(`INSERT INTO profiles (app_id,schema_version,pipeline_version,model,embedding_model,source_json,profile_json,embedding_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run(42, '1', 'test', 'fake', 'fake', '{}', JSON.stringify({ summary: 'Explorer un monde dont les règles se dévoilent progressivement.' }), JSON.stringify([1, 0]));
  const ollama = {
    async embed() { return [1, 0]; },
    async generateJson() { return { recommendations: [{ app_id: 42, score: 0.91, explanation: 'La logique du monde se découvre par l’exploration.', matching_motivations: ['comprendre un univers'], caveats: [] }] }; }
  };
  const engine = new DiscoveryEngine({ db, ollama, shortlist: 20, limit: 5, logger });
  const result = await engine.recommend({ motivation: 'Je veux comprendre progressivement un univers étrange.' });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].app_id, 42);
  engine.feedback({ appId: 42, motivation: 'univers étrange', verdict: 'positive' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM discovery_feedback').get().count, 1);
  closeDatabase(db);
});
