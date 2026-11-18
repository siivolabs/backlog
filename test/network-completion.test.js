'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');
const { SimilarityExperiment } = require('../lib/similarity-experiment');
const { NetworkCompletionService } = require('../lib/network-completion');

function modernProfile(marker) {
  return {
    schema_version: '2.1',
    gameplay_loops: [{ action: `action ${marker}`, objective: 'objectif', description: 'Boucle de jeu documentée.' }],
    narrative: { description: 'Narration structurée et documentée.' },
    exploration: { description: 'Exploration du monde documentée.' },
    structure: { description: 'Structure de jeu documentée.' },
    pace: { description: 'Rythme de jeu documenté.' },
    progression: { description: 'Progression documentée.' },
    difficulty_friction: { description: 'Difficulté documentée.' },
    atmosphere_themes: { description: 'Ambiance documentée.' },
    multiplayer: { description: 'Mode de jeu documenté.' },
    perspective: 'troisième personne',
    distinctive_elements: [{ element: `signature ${marker}`, description: 'Identité documentée.' }]
  };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-completion-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec("CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO games VALUES('1','Prêt'),('2','Convertible'),('3','À régénérer');");
  seed.close();
  const database = new BacklogDatabase(filename, { logger: { info() {} } });
  database.insertProfileVersion({ appId: '1', profile: modernProfile('un'), embedding: [1, 0, 0], embeddingModel: 'embeddinggemma', lifecycleState: 'active', profileSchemaVersion: '2.1' });
  database.insertProfileVersion({
    appId: '2', lifecycleState: 'active', profileSchemaVersion: 'legacy',
    profile: { analyse: { boucles_de_jeu: ['Construire'], narration: 'Discrète', exploration_du_monde: 'Ouverte', structure_du_jeu: 'Libre', rythme: 'Calme', progression: 'Technologique', difficulte: 'Modérée', ambiance: 'Industrielle' } }
  });
  database.insertProfileVersion({ appId: '3', lifecycleState: 'active', profileSchemaVersion: 'legacy', profile: { summary: 'Profil vide et inutilisable.' } });
  const experiment = new SimilarityExperiment(filename, { experimentSize: 3, usableThreshold: 0.45 });
  return { directory, filename, database, experiment };
}

test('complète automatiquement le lot, préserve les profils et recalcule toutes les paires', async () => {
  const { directory, database, experiment } = fixture();
  const embeddingClient = { model: 'embeddinggemma', async embedText(text) { assert.ok(text.length > 10); return [0.8, 0.2, 0.1]; } };
  const aiEngine = {
    checkEmbedding(vector) { assert.equal(vector.length, 3); },
    enqueue(appId, operation) {
      assert.equal(operation, 'network');
      const job = database.createJob(appId, operation);
      const active = database.getActiveProfile(appId);
      const version = database.insertProfileVersion({
        appId, profile: modernProfile('régénéré'), embedding: [0.7, 0.3, 0.2], embeddingModel: 'embeddinggemma',
        lifecycleState: active ? 'draft' : 'active', basedOnVersionId: active?.id || null, profileSchemaVersion: '2.1',
        model: 'qwen3:32b', promptVersion: 'test-network', qualityStatus: 'generated'
      });
      database.updateJob(job.id, { status: 'completed', current_step: 'completed', message: 'Profil réseau généré', target_version_id: version.id, finished_at: new Date().toISOString() });
      return database.getJob(job.id);
    }
  };
  const service = new NetworkCompletionService({ experiment, database, aiEngine, embeddingClient, pollIntervalMs: 1, jobTimeoutMs: 1000, logger: { error() {} } });

  try {
    const plan = service.publicPlan();
    assert.deepEqual(Object.fromEntries(plan.map((item) => [item.appId, item.action])), { '1': 'reuse', '2': 'convert_embed', '3': 'regenerate' });
    const before = database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count;
    const result = await service.run();
    const after = database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count;

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.counts, { reused: 1, converted: 1, embedded: 2, regenerated: 1, failed: 0 });
    assert.equal(result.network.usableCount, 3);
    assert.equal(result.network.embeddedCount, 3);
    assert.equal(result.network.pairCount, 3);
    assert.equal(after, before + 1, 'seule la régénération ajoute une version; les profils existants restent intacts');
    assert.equal(database.getActiveProfile('3').profile_schema_version, 'legacy', 'la version active historique n’est pas promue ni écrasée');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM similarity_profile_adapters_v0941').get().count, 1);
    assert.equal(experiment.latestCompletionRun().status, 'completed');
    assert.ok(service.publicPlan().every((item) => item.action === 'reuse'));
    const second = await service.run();
    assert.deepEqual(second.counts, { reused: 3, converted: 0, embedded: 0, regenerated: 0, failed: 0 });
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count, after, 'une reprise idempotente ne crée aucune version supplémentaire');
  } finally {
    experiment.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('le lot cible de 50 jeux produit 50 embeddings et 1 225 paires sans validation jeu par jeu', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-completion-50-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec('CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL);');
  const insertGame = seed.prepare('INSERT INTO games(appid,name) VALUES(?,?)');
  for (let index = 1; index <= 50; index += 1) insertGame.run(String(index), `Jeu ${index}`);
  seed.close();
  const database = new BacklogDatabase(filename, { logger: { info() {} } });
  for (let index = 1; index <= 50; index += 1) {
    database.insertProfileVersion(index <= 3
      ? { appId: String(index), profile: modernProfile(String(index)), embedding: [1, index / 100, 0.5], embeddingModel: 'embeddinggemma', lifecycleState: 'active', profileSchemaVersion: '2.1' }
      : { appId: String(index), profile: { summary: `Ancien profil ${index}` }, lifecycleState: 'active', profileSchemaVersion: 'legacy' });
  }
  const experiment = new SimilarityExperiment(filename, { experimentSize: 50, usableThreshold: 0.45 });
  const embeddingClient = { model: 'embeddinggemma', async embedText() { return [1, 0, 0]; } };
  const aiEngine = {
    checkEmbedding(vector) { assert.equal(vector.length, 3); },
    enqueue(appId, operation) {
      assert.equal(operation, 'network');
      const job = database.createJob(appId, operation);
      const active = database.getActiveProfile(appId);
      const version = database.insertProfileVersion({ appId, profile: modernProfile(appId), embedding: [1, Number(appId) / 100, 0.5], embeddingModel: 'embeddinggemma', lifecycleState: 'draft', basedOnVersionId: active.id, profileSchemaVersion: '2.1', model: 'qwen3:32b' });
      database.updateJob(job.id, { status: 'completed', current_step: 'completed', message: 'Profil réseau généré', target_version_id: version.id, finished_at: new Date().toISOString() });
      return database.getJob(job.id);
    }
  };
  const service = new NetworkCompletionService({ experiment, database, aiEngine, embeddingClient, pollIntervalMs: 1, jobTimeoutMs: 1000, logger: { error() {} } });

  try {
    const result = await service.run();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.counts, { reused: 3, converted: 0, embedded: 47, regenerated: 47, failed: 0 });
    assert.equal(result.network.selectedCount, 50);
    assert.equal(result.network.usableCount, 50);
    assert.equal(result.network.embeddedCount, 50);
    assert.equal(result.network.pairCount, 1225);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='active'").get().count, 50);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='draft'").get().count, 47);
  } finally {
    experiment.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
