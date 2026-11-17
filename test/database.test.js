'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BacklogDatabase, resolveDatabasePath } = require('../lib/database');

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v09-'));
  const filename=path.join(dir,'backlog.sqlite');
  const legacy=new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL,playtime_forever INTEGER,genres TEXT,platforms TEXT);
    INSERT INTO games VALUES('400','Portal',720,'Puzzle, Action','["windows","linux"]');
    INSERT INTO games VALUES('620','Portal 2',1200,'Puzzle, Action','["windows"]');
    CREATE TABLE ai_profiles(app_id TEXT PRIMARY KEY,profile_json TEXT,embedding_json TEXT,model TEXT,generated_at TEXT);
    CREATE TABLE ai_sources(app_id TEXT,source_type TEXT,title TEXT,url TEXT,excerpt TEXT,collected_at TEXT);
    INSERT INTO ai_sources VALUES('400','steam','Page Steam','https://store.steampowered.com/app/400','Description officielle','2026-11-16T09:00:00.000Z');
  `);
  const profile={summary:'Une aventure de réflexion spatiale fondée sur des portails et une narration environnementale.',gameplay_loops:['Résoudre des salles','Manipuler des portails'],narrative:'Humour et mystère',exploration:'Salles linéaires',structure:'Chapitres',atmosphere_themes:['science','isolement'],pace:'Mesuré',progression:'Complexité croissante',difficulty_friction:'Énigmes lisibles',multiplayer:'Solo',distinctive_elements:['portal gun'],uncertainties:[]};
  legacy.prepare('INSERT INTO ai_profiles VALUES(?,?,?,?,?)').run('400',JSON.stringify(profile),JSON.stringify([1,0,0]),'qwen3:32b','2026-11-16T10:00:00.000Z');
  legacy.close();
  const database=new BacklogDatabase(filename,{logger:{info(){}}});
  return {dir,filename,database,profile};
}

test('détecte la base existante et importe les profils V0.8 sans suppression',()=>{
  const {database,dir}=fixture();
  try {
    assert.equal(database.discoverLibrarySource().table,'games');
    assert.equal(database.getGame('400').name,'Portal');
    assert.equal(database.getActiveProfile('400').version_no,1);
    assert.equal(database.getMeta('legacy_import_count'),'1');
    assert.equal(database.getMeta('legacy_source_import_count'),'1');
    assert.equal(database.getProfileBundle('400').displayed.sources[0].source_type,'steam');
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM games").get().count,2);
  } finally { database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('la réanalyse crée une candidate et préserve la version active jusqu’à validation',()=>{
  const {database,dir,profile}=fixture();
  try {
    const active=database.getActiveProfile('400');
    const candidate=database.insertProfileVersion({appId:'400',profile:{...profile,summary:'Version améliorée avec davantage de sources.'},embedding:[.9,.1,0],model:'qwen3:32b',promptVersion:'v09',basedOnVersionId:active.id,lifecycleState:'draft'});
    assert.equal(database.getActiveProfile('400').id,active.id);
    assert.equal(database.getProfileBundle('400').candidate.id,candidate.id);
    database.reviewProfile(candidate.id,{action:'validate',notes:'Vérifié manuellement'});
    assert.equal(database.getActiveProfile('400').id,candidate.id);
    assert.equal(database.db.prepare('SELECT lifecycle_state FROM ai_profile_versions WHERE id=?').get(active.id).lifecycle_state,'superseded');
  } finally { database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('retours de similarité et expérience personnelle restent dans des tables séparées',()=>{
  const {database,dir}=fixture();
  try {
    database.saveSimilarityFeedback({fromAppId:'400',toAppId:'620',similarityScore:3,personallyRelevant:false,reason:'Très similaire mais déjà joué'});
    database.saveExperience('620',{liked:1,overallRating:5,dimensions:{narrative:4},comment:'Excellent coop'});
    assert.equal(database.db.prepare('SELECT similarity_score FROM ai_similarity_feedback').get().similarity_score,3);
    assert.equal(database.getExperience('620').overall_rating,5);
    assert.equal(database.getDashboard().feedback,2);
  } finally { database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('resolveDatabasePath privilégie un fichier SQLite existant',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-path-'));
  try { fs.writeFileSync(path.join(dir,'backlog.db'),''); assert.equal(resolveDatabasePath({DATA_DIR:dir}),path.join(dir,'backlog.db')); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
