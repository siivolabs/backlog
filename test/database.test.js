'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-v094-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE games(app_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE ai_profile_versions(
      id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, version_no INTEGER,
      lifecycle_state TEXT, profile_json TEXT, embedding_json TEXT,
      embedding_model TEXT, profile_completeness_score REAL,
      semantic_quality_score REAL, generated_at TEXT, quality_status TEXT
    );
  `);
  const game = db.prepare('INSERT INTO games(app_id,name) VALUES(?,?)');
  const profile = db.prepare("INSERT INTO ai_profile_versions(id,app_id,version_no,lifecycle_state,profile_json,embedding_json,profile_completeness_score,generated_at) VALUES(?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 5; i += 1) {
    game.run(String(i), `Jeu ${i}`);
    profile.run(i, String(i), 1, i === 1 ? 'draft' : 'active', JSON.stringify({ gameplay_loops:[`automation ${i % 2}`], game_structure:'missions', atmosphere_themes:['industrial'] }), JSON.stringify([1, i / 10, 0.5]), 0.8, `2026-01-0${i}T00:00:00Z`);
  }
  db.close();
  return { directory, filename };
}

test('migration additive, sélection, réseau et feedback', () => {
  const { directory, filename } = fixture();
  const database = new BacklogDatabase(filename, { experimentSize: 5, useDraftProfiles: true });
  try {
    assert.equal(database.getSelectedAppIds().length, 5);
    const result = database.rebuildNetwork();
    assert.equal(result.pairCount, 10);
    const recommendations = database.recommendations('1', 5);
    assert.equal(recommendations.length, 4);
    database.saveFeedback({ sourceAppId:'1', targetAppId:recommendations[0].appId, rating:'very_similar', reason:'Même boucle principale' });
    const dashboard = database.dashboard();
    assert.equal(dashboard.coverage.pairCount, 10);
    assert.equal(dashboard.quality.evaluatedRecommendations, 1);
    assert.equal(dashboard.games.find((game)=>game.appId==='1').recommendations[0].feedback.rating, 'very_similar');
  } finally { database.close(); fs.rmSync(directory, { recursive:true, force:true }); }
});

test('le choix de profil accepte un candidat plus complet sans le promouvoir', () => {
  const { directory, filename } = fixture();
  const db = new DatabaseSync(filename);
  db.prepare("INSERT INTO ai_profile_versions(id,app_id,version_no,lifecycle_state,profile_json,embedding_json,profile_completeness_score,generated_at) VALUES(99,'1',2,'draft',?,NULL,0.99,'2026-02-01T00:00:00Z')").run(JSON.stringify({ gameplay_loops:['automation'],narrative_structure:['environmental'],world_exploration:['open'],game_structure:['missions'],pacing:['slow'],progression_systems:['technology'],difficulty:['planning'],atmosphere_themes:['industrial'],game_modes:['solo'],perspective:['first person'],distinctive_elements:['factory'] }));
  db.close();
  const database = new BacklogDatabase(filename, { experimentSize: 5, useDraftProfiles: true });
  try {
    const chosen = database.chooseProfiles(['1'])[0];
    assert.equal(chosen.versionNo, 2);
    const verify = new DatabaseSync(filename, { readOnly:true }).prepare('SELECT lifecycle_state FROM ai_profile_versions WHERE id=99').get();
    assert.equal(verify.lifecycle_state, 'draft');
  } finally { database.close(); fs.rmSync(directory, { recursive:true, force:true }); }
});
