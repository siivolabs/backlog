'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase } = require('../lib/database');
const { DiscoveryService } = require('../lib/discovery');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-discovery-'));
  const filename = path.join(directory, 'backlog.sqlite');
  const seed = new DatabaseSync(filename);
  seed.exec(`CREATE TABLE games(app_id TEXT PRIMARY KEY,name TEXT NOT NULL,genres_json TEXT,themes_json TEXT,platforms_json TEXT,playtime_forever INTEGER,cover_url TEXT);`);
  const insert = seed.prepare('INSERT INTO games VALUES(?,?,?,?,?,?,?)');
  const games = [
    ['1','Control',['Action'],['Mystery','Supernatural']],
    ['2','Signalis',['Horror'],['Mystery','Identity']],
    ['3','Outer Wilds',['Adventure'],['Mystery','Exploration']],
    ['4','Pentiment',['Adventure'],['Investigation','Consequences']],
    ['5','Pathologic 2',['RPG'],['Uncertainty','Consequences']],
    ['6','The Forgotten City',['Adventure'],['Time loop','Consequences']],
    ['7','Return of the Obra Dinn',['Puzzle'],['Investigation','Mystery']],
    ['8','Skyrim',['RPG'],['Open world']]
  ];
  for (const [id, name, genres, themes] of games) insert.run(id, name, JSON.stringify(genres), JSON.stringify(themes), JSON.stringify(['PC']), id === '1' ? 6000 : 0, `https://example.test/${id}.jpg`);
  seed.close();
  const database = new BacklogDatabase(filename, { logger:{ error(){} } });
  for (const [id, name,, themes] of games.slice(1)) database.insertProfileVersion({ appId:id, profile:{ summary:`${name} propose une expérience de ${themes.join(', ')}`, dimensions:{ atmosphere:themes }, distinctive_signals:themes }, embedding:[Number(id), 1, 0.5], lifecycleState:'active', qualityStatus:'validated' });
  const aiEngine = { config:{ ollamaBaseUrl:'http://ollama.test', analysisModel:'qwen-test' } };
  const embeddingClient = { model:'embedding-test', async embedText(){ return [1, 1, 0.5]; } };
  const service = new DiscoveryService({
    filename, database, aiEngine, embeddingClient, env:{ DISCOVERY_DEEP_CANDIDATES:'6', DISCOVERY_CANDIDATE_LIMIT:'7' },
    motivationInterpreter: async () => ({ motivations:[
      { label:'Construire du sens', description:'Trouver une logique cohérente derrière un désordre apparent.', mechanism_agnostic_reason:'Cette motivation peut être satisfaite par une enquête, une simulation ou une narration dirigée.', evidence_from_player:'Le joueur veut comprendre les règles cachées.', confidence:0.94, uncertainty:'La place souhaitée pour les combats reste inconnue.' },
      { label:'Observer les conséquences', description:'Décider avec des informations incomplètes puis observer les effets cohérents.', mechanism_agnostic_reason:'La causalité peut être narrative ou systémique.', evidence_from_player:'Le joueur dit apprécier les conséquences.', confidence:0.9, uncertainty:'Le niveau de contrôle recherché reste à confirmer.' }
    ] }),
    recommendationAnalyzer: async ({ candidates, intentions, target }) => ({ recommendations:candidates.slice(0, target).map((candidate, index) => ({
      app_id:candidate.appId, resonance_score:0.91 - index * 0.05, confidence:index < 2 ? 'high' : 'medium', matched_intention_ids:[String(intentions[index % intentions.length].id)], presentation:`${candidate.title} propose une voie distincte pour éprouver cette motivation.`, explanation:`Les éléments connus de ${candidate.title} indiquent une expérience où le joueur doit interpréter des règles ou observer des conséquences cohérentes sans reproduire Control.`, difference:'La structure, le genre et les mécaniques diffèrent du jeu de référence, ce qui constitue précisément l’intérêt de la découverte.', uncertainties:['Les données disponibles ne permettent pas de garantir la réception personnelle du rythme.'], evidence:[`Métadonnées et profil compact disponibles pour ${candidate.title}.`]
    })) })
  });
  return { directory, filename, database, service };
}

test('Backlog Discovery confirme les motivations, analyse seulement les candidats prometteurs et produit cinq recommandations', async () => {
  const setup = fixture();
  try {
    const interpretation = await setup.service.interpret({ appId:'1', sourceText:'J’aime trouver une logique dans le chaos, formuler des hypothèses et observer les conséquences de décisions prises dans l’incertitude.' });
    assert.equal(interpretation.status, 'draft');
    assert.equal(interpretation.motivations.length, 2);
    interpretation.motivations[0].label = 'Donner du sens au chaos';
    const confirmed = setup.service.confirmInterpretation(interpretation.id, { motivations:interpretation.motivations });
    assert.equal(confirmed.intentions.length, 2);
    assert.ok(confirmed.intentions.some((item) => item.label === 'Donner du sens au chaos'));

    const historicalProfiles = setup.database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count;
    const run = await setup.service.discover({ referenceAppId:'1', intentionIds:confirmed.intentions.map((item) => item.id), queryText:'Je veux une découverte inattendue, pas un clone mécanique.' });
    assert.equal(run.status, 'completed');
    assert.equal(run.recommendations.length, 5);
    assert.equal(run.deep_candidate_count, 6);
    assert.equal(run.candidate_count, 7);
    assert.ok(run.candidates.filter((item) => item.deep_selected).length === 6);
    assert.equal(setup.database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count, historicalProfiles, 'les profils existants ne sont jamais modifiés');
    assert.equal(new Set(run.recommendations.map((item) => item.app_id)).size, 5);
    assert.ok(run.recommendations.every((item) => item.uncertainties.length && item.difference_text));

    const feedback = setup.service.saveFeedback({ runId:run.id, appId:run.recommendations[0].app_id, verdict:'reason_wrong', correctionTarget:'match', comment:'Le jeu est intéressant, mais le lien causal est à reformuler.' });
    assert.equal(feedback.verdict, 'reason_wrong');
    const dashboard = setup.service.dashboard();
    assert.equal(dashboard.counts.completed_runs, 1);
    assert.equal(dashboard.counts.feedback, 1);
  } finally { setup.service.close(); setup.database.close(); fs.rmSync(setup.directory, { recursive:true, force:true }); }
});

test('la migration Discovery est additive et idempotente', () => {
  const setup = fixture();
  try {
    const before = setup.database.db.prepare('SELECT COUNT(*) AS count FROM games').get().count;
    setup.service.migrate(); setup.service.migrate();
    const tables = setup.service.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%_v096' ORDER BY name").all().map((row) => row.name);
    assert.equal(tables.length, 6);
    assert.equal(setup.database.db.prepare('SELECT COUNT(*) AS count FROM games').get().count, before);
  } finally { setup.service.close(); setup.database.close(); fs.rmSync(setup.directory, { recursive:true, force:true }); }
});
