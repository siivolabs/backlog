import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, closeDatabase } from '../src/db.js';
import { EnrichmentWorker } from '../src/worker.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function setup(count = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-worker-'));
  const db = openDatabase(path.join(dir, 'core.sqlite'));
  const insert = db.prepare('INSERT INTO games (app_id, name) VALUES (?, ?)');
  for (let id = 1; id <= count; id += 1) insert.run(id, `Jeu ${id}`);
  return { dir, db };
}
function output(game) {
  return { source: { name: game.name }, profile: { summary: game.name }, embedding: [game.app_id, 1], schemaVersion: '1.0', pipelineVersion: 'test', model: 'fake', embeddingModel: 'fake-embed' };
}

test('une erreur n’arrête pas la campagne, puis les échecs peuvent être relancés sans retraiter les succès', async () => {
  const { db } = setup();
  const calls = [];
  let failTwo = true;
  const pipeline = { async run(game, step) { calls.push(game.app_id); step('analyse'); if (game.app_id === 2 && failTwo) throw new Error('échec simulé'); return output(game); } };
  const worker = new EnrichmentWorker({ db, pipeline, logger, pollDelayMs: 1, retryDelayMs: 1, maxAttempts: 1 });
  worker.start();
  await worker.loopPromise;
  assert.equal(worker.status().status, 'completed_with_errors');
  assert.equal(worker.status().enriched, 2);
  assert.equal(worker.status().failed, 1);
  assert.deepEqual(calls, [1, 2, 3]);

  failTwo = false;
  worker.retryFailures();
  await worker.loopPromise;
  assert.equal(worker.status().status, 'completed');
  assert.equal(worker.status().enriched, 3);
  assert.deepEqual(calls, [1, 2, 3, 2], 'seul le jeu en échec doit être retraité');

  worker.start();
  if (worker.loopPromise) await worker.loopPromise;
  assert.deepEqual(calls, [1, 2, 3, 2], 'les profils prêts ne sont jamais retraités');
  closeDatabase(db);
});

test('la suspension attend la fin du jeu courant puis la reprise termine la file', async () => {
  const { db } = setup();
  const pipeline = { async run(game, step) { step('analyse'); await sleep(25); return output(game); } };
  const worker = new EnrichmentWorker({ db, pipeline, logger, pollDelayMs: 1, retryDelayMs: 1, maxAttempts: 1 });
  worker.start();
  await sleep(5);
  worker.pause();
  await worker.loopPromise;
  assert.equal(worker.status().status, 'paused');
  assert.equal(worker.status().enriched, 1);
  worker.resume();
  await worker.loopPromise;
  assert.equal(worker.status().status, 'completed');
  assert.equal(worker.status().enriched, 3);
  closeDatabase(db);
});

test('un redémarrage remet le travail interrompu dans la file et reprend automatiquement', async () => {
  const { dir, db: firstProcessDb } = setup(1);
  firstProcessDb.prepare("INSERT INTO enrichment_jobs (app_id,status,attempts) VALUES (1,'processing',1)").run();
  firstProcessDb.prepare("UPDATE enrichment_campaign SET status='running',current_app_id=1,current_step='analyse' WHERE id=1").run();
  closeDatabase(firstProcessDb);

  const restartedDb = openDatabase(path.join(dir, 'core.sqlite'));
  const worker = new EnrichmentWorker({ db: restartedDb, pipeline: { async run(game) { return output(game); } }, logger, pollDelayMs: 1, retryDelayMs: 1, maxAttempts: 1 });
  worker.recover();
  await worker.loopPromise;
  assert.equal(worker.status().status, 'completed');
  assert.equal(worker.status().enriched, 1);
  closeDatabase(restartedDb);
});
