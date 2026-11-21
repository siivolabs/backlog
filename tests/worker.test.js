import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EnrichmentWorker } from '../src/worker.js';
import { tempDir, v1Database, until } from './helpers.js';

const result = (game) => ({ profile: { summary: game.title, confidence: .8 }, embedding: [0,1,0], source: { app_id: game.app_id }, analysisModel: 'fake', embeddingModel: 'fake-embed', confidence: .8 });

test('campagne globale ignore les profils existants et isole une erreur', async () => {
  const db = v1Database(path.join(tempDir(), 'worker.sqlite'));
  const worker = new EnrichmentWorker(db, async (game) => { if (game.app_id === '20') throw new Error('échec simulé'); return result(game); }, { pollDelayMs: 1 });
  worker.enqueueAll();
  await until(() => ['completed','completed_with_errors'].includes(worker.status().campaign.status));
  const status = worker.status();
  assert.equal(status.queue.completed, 1); // Gamma; le profil historique n'est jamais remis en file
  assert.equal(status.queue.failed, 1);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM profiles').get().count), 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM core_background_queue WHERE app_id='10'").get().count, 0);
  worker.stop(); db.close();
});

test('suspension prend effet après le jeu en cours puis reprise', async () => {
  const db = v1Database(path.join(tempDir(), 'pause.sqlite'));
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const worker = new EnrichmentWorker(db, async (game) => { if (game.app_id === '20') await gate; return result(game); }, { pollDelayMs: 1 });
  worker.enqueueAll();
  await until(() => worker.status().queue.processing === 1);
  worker.pause(); release();
  await until(() => worker.status().campaign.status === 'paused');
  assert.equal(worker.status().queue.pending, 1);
  worker.resume();
  await until(() => worker.status().campaign.status === 'completed');
  assert.equal(worker.status().library.enriched, 3);
  worker.stop(); db.close();
});

test('redémarrage remet processing en pending et reprend une campagne active', async () => {
  const db = v1Database(path.join(tempDir(), 'restart.sqlite'));
  db.prepare("INSERT INTO core_background_queue(app_id,status,started_at) VALUES('20','processing',datetime('now'))").run();
  db.prepare("UPDATE core_background_campaign SET status='running',current_app_id='20'").run();
  const worker = new EnrichmentWorker(db, async (game) => result(game), { pollDelayMs: 1 });
  worker.recover();
  await until(() => worker.status().campaign.status === 'completed');
  assert.equal(db.prepare("SELECT status FROM core_background_queue WHERE app_id='20'").get().status, 'completed');
  worker.stop(); db.close();
});
