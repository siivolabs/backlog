import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { EnrichmentOrchestrator } from '../src/orchestrator.js';
import { createFaithfulV1Database, tempDatabase, profileFor, waitFor } from './helpers.js';

const quiet = { error(){}, warn(){} };

test('campagne globale: profils existants ignorés, erreur isolée, pause et relance', async () => {
  const temp = tempDatabase(); const fixture = createFaithfulV1Database(temp.file, 4);
  const p = profileFor('1001');
  fixture.prepare('INSERT INTO profiles (app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence) VALUES (?,?,?,?,?,?,?,?)').run('1001',p.schema_version,p.profile_json,p.embedding_json,p.source_json,p.analysis_model,p.embedding_model,p.confidence);
  fixture.close(); const db = openDatabase(temp.file);
  const calls = [];
  const orchestrator = new EnrichmentOrchestrator({ db, loopDelayMs: 1, logger: quiet, processGame: async (game, step) => { calls.push(game.app_id); step('analysis'); if (game.app_id === '1003') throw new Error('échec simulé'); return profileFor(game.app_id, [0.8,0.2,0]); } });
  orchestrator.recover(); orchestrator.start();
  await waitFor(() => ['completed','completed_with_errors'].includes(orchestrator.status().lifecycle));
  let status = orchestrator.status();
  assert.equal(status.completed, 3); assert.equal(status.errors, 1); assert.equal(status.lifecycle, 'completed_with_errors');
  assert.deepEqual(calls.sort(), ['1002','1003','1004']); assert.equal(calls.includes('1001'), false);

  orchestrator.processGame = async (game) => profileFor(game.app_id, [0.7,0.3,0]);
  orchestrator.retryErrors(); orchestrator.start();
  await waitFor(() => orchestrator.status().lifecycle === 'completed');
  status = orchestrator.status(); assert.equal(status.completed, 4); assert.equal(status.errors, 0); assert.equal(status.progress_percent, 100);
  await orchestrator.shutdown(); db.close(); temp.cleanup();
});

test('reprend après fermeture SQLite: running redevient pending et la campagne continue', async () => {
  const temp = tempDatabase(); createFaithfulV1Database(temp.file, 2).close();
  let db = openDatabase(temp.file);
  db.prepare("INSERT OR REPLACE INTO autonomous_enrichment_items (app_id,status,attempts,current_step) VALUES ('1001','running',1,'analysis')").run();
  db.prepare("UPDATE autonomous_enrichment_control SET desired_state='running',lifecycle='running',current_app_id='1001',current_step='analysis' WHERE id=1").run();
  db.close();

  db = openDatabase(temp.file);
  const processed = [];
  const orchestrator = new EnrichmentOrchestrator({ db, loopDelayMs: 1, logger: quiet, processGame: async (game) => { processed.push(game.app_id); return profileFor(game.app_id); } });
  orchestrator.recover();
  await waitFor(() => orchestrator.status().lifecycle === 'completed');
  assert.deepEqual(processed.sort(), ['1001','1002']);
  assert.equal(db.prepare("SELECT status FROM autonomous_enrichment_items WHERE app_id='1001'").get().status, 'completed');
  await orchestrator.shutdown(); db.close(); temp.cleanup();
});

test('suspension demandée pendant un jeu prend effet après celui-ci', async () => {
  const temp = tempDatabase(); createFaithfulV1Database(temp.file, 3).close(); const db = openDatabase(temp.file);
  let release; const gate = new Promise((resolve) => { release = resolve; }); let first = true;
  const orchestrator = new EnrichmentOrchestrator({ db, loopDelayMs: 1, logger: quiet, processGame: async (game) => { if (first) { first=false; await gate; } return profileFor(game.app_id); } });
  orchestrator.recover(); orchestrator.start(); await waitFor(() => orchestrator.status().running === 1);
  const paused = orchestrator.pause(); assert.equal(paused.lifecycle, 'pausing'); release();
  await waitFor(() => orchestrator.status().lifecycle === 'paused');
  assert.equal(orchestrator.status().completed, 1); assert.equal(orchestrator.status().pending, 2);
  await orchestrator.shutdown(); db.close(); temp.cleanup();
});
