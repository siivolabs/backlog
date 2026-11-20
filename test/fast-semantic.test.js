'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');
const { FastSemanticService, FAST_SCHEMA_VERSION, normalizeFastProfile } = require('../lib/fast-semantic');

function compactProfile(name) {
  return {
    schema_version: FAST_SCHEMA_VERSION,
    summary: `${name} propose une expérience structurée autour de décisions persistantes, de progression et d’exploration tactique.`,
    dimensions: {
      gameplay: ['exploration et collecte', 'gestion de ressources', `boucle propre à ${name}`],
      narrative: ['récit environnemental', 'agence modérée'],
      exploration: ['structure semi-ouverte', 'récompenses cachées'],
      structure: ['objectifs hybrides', 'sessions continues'],
      pace: ['rythme variable', 'tempo contrôlé par le joueur'],
      progression: ['équipement persistant', 'paliers technologiques'],
      difficulty: ['pression sur les ressources', 'échec modérément coûteux'],
      atmosphere: ['ton contemplatif', 'tension progressive'],
      mode: ['expérience solo'],
      perspective: ['caméra à la troisième personne'],
      identity: [`signature ${name}`, 'systèmes fortement interconnectés']
    },
    distinctive_signals: [`identité de ${name}`, 'décisions à conséquences durables']
  };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-fast-semantic-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec("CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO games VALUES('1','Alpha'),('2','Beta'),('3','Gamma'),('4','Sans dossier');");
  seed.close();
  const database = new BacklogDatabase(filename, { logger: { info() {} } });
  database.insertProfileVersion({ appId: '1', profile: { summary: 'Profil historique à préserver.' }, lifecycleState: 'active', profileSchemaVersion: 'legacy' });
  for (const appId of ['1','2','3']) database.insertDossier(appId, {
    quality_status: 'partial', completeness_score: 70, dimensions: { gameplay_loops: true }, notes: [], source_fingerprint: `fingerprint-${appId}`,
    sources: [{ sourceType: 'steam', sourceKey: `steam:${appId}`, title: `Source ${appId}`, excerpt: 'Gameplay, exploration, progression, structure, rythme, difficulté et ambiance documentés.', supports: ['gameplay_loops','progression'], confidence: 'high' }]
  });
  database.db.exec("CREATE TABLE similarity_experiment_games(app_id TEXT PRIMARY KEY,selected_at TEXT NOT NULL,selection_source TEXT NOT NULL); INSERT INTO similarity_experiment_games VALUES('1','2026-01-01','test'),('2','2026-01-01','test'),('3','2026-01-01','test'),('4','2026-01-01','test');");
  return { directory, filename, database };
}

test('le pipeline rapide crée un réseau séparé, mesure ses étapes et réutilise les résultats inchangés', async () => {
  const { directory, filename, database } = fixture();
  let generated = 0; let embedded = 0;
  const aiEngine = { config: { analysisModel: 'qwen3:32b' }, checkEmbedding(vector) { assert.equal(vector.length, 3); } };
  const embeddingClient = { model: 'embeddinggemma', async embedText(text) { embedded += 1; assert.match(text, /gameplay:/); return [1, embedded / 10, 0]; } };
  const service = new FastSemanticService({
    filename, database, aiEngine, embeddingClient, logger: { error() {} },
    profileGenerator: async (game) => { generated += 1; return compactProfile(game.name); }
  });
  try {
    const first = await service.run({ mode: 'rebuild' });
    assert.equal(first.status, 'completed_with_errors');
    assert.equal(first.summary.completed, 3);
    assert.equal(first.summary.failed, 1);
    assert.equal(first.summary.generated, 3);
    assert.equal(first.summary.embedded, 3);
    assert.equal(first.summary.pairCount, 3);
    assert.equal(first.summary.errorCodes.MISSING_DOSSIER, 1);
    assert.equal(generated, 3);
    assert.equal(embedded, 3);
    assert.equal(database.getActiveProfile('1').profile_schema_version, 'legacy');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count, 1);
    assert.equal(service.recommendations('1', 5).length, 2);

    const second = await service.run({ mode: 'smart' });
    assert.equal(second.summary.reused, 3);
    assert.equal(second.summary.generated, 0);
    assert.equal(second.summary.pairCount, 3);
    assert.equal(generated, 3, 'aucun nouvel appel Qwen pour un dossier inchangé');
    assert.equal(embedded, 3, 'aucun nouvel embedding pour un dossier inchangé');
    assert.equal(service.dashboard().metrics.completed, 3);
    for (const table of ['fast_semantic_runs_v095','fast_semantic_items_v095','fast_semantic_edges_v095']) {
      assert.ok(database.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
  } finally {
    service.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('la validation compacte refuse un profil sans gameplay discriminant', () => {
  const value = compactProfile('Incomplet');
  value.dimensions.gameplay = [];
  assert.throws(() => normalizeFastProfile(value), (error) => error.code === 'FAST_GAMEPLAY_MISSING');
});
