'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');
const { SimilarityExperiment } = require('../lib/similarity-experiment');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-v0941-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec('CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL,playtime_forever INTEGER DEFAULT 0);');
  const insert = seed.prepare('INSERT INTO games(appid,name) VALUES(?,?)');
  for (let index = 1; index <= 5; index += 1) insert.run(String(index), `Jeu ${index}`);
  seed.close();

  const database = new BacklogDatabase(filename, { logger: { info() {} } });
  for (let index = 1; index <= 5; index += 1) {
    database.insertProfileVersion({
      appId: String(index),
      lifecycleState: index === 1 ? 'draft' : 'active',
      qualityStatus: 'generated',
      profile: {
        gameplay_loops: [{ action: `automation ${index % 2}`, objective: 'production', cadence: 'continuous', centrality: 'core', description: 'Construire et optimiser une chaîne de production.' }],
        narrative: { importance: 'low', structure: 'environmental', delivery: ['environment'], player_agency: 'low', description: 'Une narration environnementale discrète.' },
        exploration: { freedom: 'open', topology: 'open_world', map_generation: 'fixed', guidance: 'player_directed', rewards: ['resources'], description: 'Exploration libre d’un monde fixe.' },
        structure: { world: 'open_world', activity_model: 'self_directed', session_model: 'open_ended', linearity: 'player_directed', description: 'Structure ouverte et orientée joueur.' },
        atmosphere_themes: { tone: ['industrial'], themes: ['automation'], sensory_style: ['mechanical'], description: 'Ambiance industrielle et mécanique.' },
        pace: { baseline: 'moderate', variation: 'player_driven', intensity: 'moderate', player_control: 'high', description: 'Rythme largement contrôlé par le joueur.' },
        progression: { systems: ['technology'], scope: 'technology', pacing: 'tiered', save_persistence: 'saved_between_sessions', reset_model: 'none', description: 'Progression technologique persistante.' },
        difficulty_friction: { baseline: 'moderate', adjustability: 'limited', failure_cost: 'low', friction_sources: ['planning'], skill_demands: ['optimization'], description: 'Difficulté fondée sur la planification.' },
        multiplayer: { availability: 'optional', modes: ['coop'], cooperation: 'supported', competition: 'none', world_persistence: 'host_save', description: 'Coopération facultative.' },
        distinctive_elements: [{ element: `signature ${index}`, role: 'core', description: 'Élément distinctif du jeu.' }]
      },
      embedding: [1, index / 10, 0.5],
      embeddingModel: 'fixture'
    });
  }
  const experiment = new SimilarityExperiment(filename, { experimentSize: 5, useDraftProfiles: true });
  return { directory, filename, database, experiment };
}

test('le correctif conserve les fonctions 0.9.3.2 et ajoute le réseau dans la même base', () => {
  const { directory, database, experiment } = fixture();
  try {
    assert.equal(database.listGames({ limit: 10 }).total, 5);
    assert.equal(database.getProfileBundle('1').candidate.version_no, 1);
    assert.equal(experiment.getSelectedAppIds().length, 5);
    const result = experiment.rebuildNetwork();
    assert.equal(result.pairCount, 10);
    assert.equal(experiment.recommendations('1', 5).length, 4);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count, 5);
    assert.ok(database.tableNames().includes('similarity_edges_v094'));
  } finally {
    experiment.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('le réseau peut utiliser un candidat sans modifier son état de cycle de vie', () => {
  const { directory, database, experiment } = fixture();
  try {
    const chosen = experiment.chooseProfiles(['1'])[0];
    assert.equal(chosen.lifecycleState, 'draft');
    experiment.rebuildNetwork();
    assert.equal(database.db.prepare("SELECT lifecycle_state FROM ai_profile_versions WHERE app_id='1'").get().lifecycle_state, 'draft');
  } finally {
    experiment.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('la migration du réseau est idempotente avec les tables créées par la première 0.9.4', () => {
  const { directory, filename, database, experiment } = fixture();
  experiment.close();
  const reopened = new SimilarityExperiment(filename, { experimentSize: 5 });
  try {
    assert.equal(reopened.getSelectedAppIds().length, 5);
    assert.doesNotThrow(() => reopened.migrate());
    const tables = new Set(reopened.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%v094%'").all().map((row) => row.name));
    for (const name of ['similarity_edges_v094','recommendation_feedback_v094','similarity_runs_v094','similarity_profile_adapters_v0941','similarity_completion_runs_v0941','similarity_completion_items_v0941']) assert.ok(tables.has(name));
  } finally {
    reopened.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
