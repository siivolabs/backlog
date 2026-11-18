'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');
const { AiEngine } = require('../lib/ai-engine');

function profile() {
  return {
    schema_version: '2.1', summary: 'Profil réseau généré automatiquement.',
    gameplay_loops: [{ action: 'Explorer', objective: 'Comprendre', description: 'Boucle principale.' }],
    narrative: { description: 'Narration structurée.' }, exploration: { description: 'Exploration guidée.' },
    structure: { description: 'Structure en chapitres.' }, atmosphere_themes: { description: 'Ambiance mystérieuse.' },
    pace: { description: 'Rythme mesuré.' }, progression: { description: 'Progression persistante.' },
    difficulty_friction: { description: 'Difficulté modérée.' }, multiplayer: { description: 'Solo.' },
    distinctive_elements: [{ element: 'Signature', description: 'Élément distinctif.' }], field_status: {}
  };
}

test('l’opération IA network réutilise le dossier, appelle Qwen puis EmbeddingGemma sans promouvoir la candidate', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-network-ai-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec("CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO games VALUES('7','Jeu réseau');");
  seed.close();
  const database = new BacklogDatabase(filename, { logger: { info() {} } });
  const active = database.insertProfileVersion({ appId: '7', profile: { summary: 'Ancien profil insuffisant.' }, lifecycleState: 'active', profileSchemaVersion: 'legacy' });
  database.insertDossier('7', {
    quality_status: 'partial', completeness_score: 70, dimensions: { gameplay_loops: true }, notes: [], source_fingerprint: 'fixture',
    sources: [{ sourceType: 'steam', sourceKey: 'steam:7', title: 'Page Steam', excerpt: 'Gameplay et progression détaillés.', supports: ['gameplay_loops','progression'], confidence: 'high' }]
  });
  const engine = new AiEngine({ database, env: { OLLAMA_BASE_URL: 'http://ollama:11434', AI_ANALYSIS_MODEL: 'qwen3:32b', AI_EMBEDDING_MODEL: 'embeddinggemma', AI_EMBEDDING_DIMENSIONS: '3' }, logger: { error() {} } });
  const calls = [];
  engine.generateProfile = async (game, sources) => { calls.push(['qwen', game.appId, sources.length]); return profile(); };
  engine.repairEvidencePaths = async (value) => ({ profile: value });
  engine.validateProfile = () => true;
  engine.verifyProfile = async () => ({ status: 'warnings', checked_claims: 0, issues: [{ severity: 'warning', field_path: 'summary', explanation: 'Prudence', source_ids: ['SOURCE-1'] }] });
  engine.assessProfile = () => ({ documentQuality: 'partial', documentCompletenessScore: 70, profileQuality: 'complete', profileCompletenessScore: 90, semanticScore: 90, evidenceCoverage: 80, evidencePrecision: 80, verificationPassed: false, factualQuality: 'warnings', factualAccuracyScore: 90 });
  engine.embed = async (text) => { calls.push(['embeddinggemma', text.length]); return [1, 0, 0]; };
  engine.computeSimilarities = () => [];

  try {
    const job = database.createJob('7', 'network');
    await engine.process(job);
    const completed = database.getJob(job.id);
    const bundle = database.getProfileBundle('7');
    assert.equal(completed.status, 'completed');
    assert.deepEqual(calls.map((call) => call[0]), ['qwen','embeddinggemma']);
    assert.equal(bundle.active.id, active.id);
    assert.equal(bundle.candidate.lifecycle_state, 'draft');
    assert.equal(bundle.candidate.model, 'qwen3:32b');
    assert.equal(bundle.candidate.embedding_model, 'embeddinggemma');
    assert.deepEqual(bundle.candidate.embedding, [1, 0, 0]);
    assert.equal(bundle.candidate.factual_quality, 'warnings');
    assert.equal(database.getLatestDossier('7').version_no, 1, 'le dossier exploitable existant est réutilisé');
  } finally {
    database.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
