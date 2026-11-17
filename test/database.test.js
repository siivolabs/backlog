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


test('versionne les dossiers documentaires séparément des profils',()=>{
  const {database,dir}=fixture();
  try {
    const base={quality_status:'partial',completeness_score:64,dimensions:{gameplay_loops:true},notes:['Ambiance manquante'],source_fingerprint:'abc',sources:[{sourceType:'steam',sourceKey:'steam:400',title:'Steam',excerpt:'Description détaillée',supports:['summary'],confidence:'high',relevanceScore:10,retrievalStatus:'structured'}]};
    const first=database.insertDossier('400',base);
    const second=database.insertDossier('400',{...base,quality_status:'complete',completeness_score:88,source_fingerprint:'def'});
    assert.equal(first.version_no,1);
    assert.equal(second.version_no,2);
    assert.equal(database.getLatestDossier('400').quality_status,'complete');
    assert.equal(database.getLatestDossier('400').sources[0].confidence,'high');
  } finally { database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('marque un profil insuffisant sans embedding comme tel dans la bibliothèque',()=>{
  const {database,dir,profile}=fixture();
  try {
    database.db.prepare(`UPDATE ai_profile_versions SET lifecycle_state='superseded' WHERE app_id='400'`).run();
    database.insertProfileVersion({appId:'400',profile,embedding:null,lifecycleState:'active',qualityStatus:'needs_review',documentQuality:'insufficient',completenessScore:37});
    const game=database.attachAiState(database.getGame('400'));
    assert.equal(game.aiStatus,'insufficient');
    assert.equal(game.documentCompleteness,37);
    assert.throws(()=>database.reviewProfile(database.getActiveProfile('400').id,{action:'validate'}),/insuffisamment documenté/);
    const job=database.createJob('400','documents');
    assert.equal(job.operation,'documents');
  } finally { database.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});


test('migration 0.9.0 vers 0.9.1 reste additive et conserve la version active',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v090-migration-'));
  const filename=path.join(dir,'backlog.sqlite');
  const old=new DatabaseSync(filename);
  old.exec(`
    CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL);
    INSERT INTO games VALUES('227300','Euro Truck Simulator 2');
    CREATE TABLE ai_v09_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    INSERT INTO ai_v09_meta VALUES('legacy_import_v1','done','2026-11-17T00:00:00.000Z');
    CREATE TABLE ai_profile_versions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,app_id TEXT NOT NULL,version_no INTEGER NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',quality_status TEXT NOT NULL DEFAULT 'generated',
      profile_json TEXT NOT NULL,embedding_json TEXT,model TEXT,embedding_model TEXT,prompt_version TEXT,
      source_fingerprint TEXT,generated_at TEXT NOT NULL,based_on_version_id INTEGER,validated_at TEXT,
      validation_notes TEXT,UNIQUE(app_id,version_no)
    );
    INSERT INTO ai_profile_versions(app_id,version_no,lifecycle_state,quality_status,profile_json,generated_at)
      VALUES('227300',1,'active','generated','{"summary":"profil existant"}','2026-11-17T00:00:00.000Z');
  `);
  old.close();
  const database=new BacklogDatabase(filename,{logger:{info(){}}});
  try {
    assert.equal(database.getActiveProfile('227300').version_no,1);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM ai_profile_versions').get().count,1);
    assert.ok(database.columns('ai_profile_versions').includes('document_quality'));
    assert.ok(database.tableNames().includes('ai_document_dossiers'));
    assert.equal(database.getMeta('schema_version'),'0.9.1');
  } finally {database.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('migration 0.9.1 conserve une ancienne table ai_document_sources incompatible',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v091-document-sources-'));
  const filename=path.join(dir,'backlog.sqlite');
  const old=new DatabaseSync(filename);
  old.exec(`
    CREATE TABLE ai_document_sources(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appid TEXT NOT NULL,
      source_type TEXT NOT NULL,
      title TEXT,
      url TEXT,
      content TEXT,
      fetched_at TEXT,
      content_hash TEXT,
      used_for_profile INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO ai_document_sources(appid,source_type,title,url,content,fetched_at,content_hash,used_for_profile)
      VALUES('227300','steam','Euro Truck Simulator 2','https://example.test/ets2','source historique','2026-11-16T00:00:00.000Z','abc',1);
  `);
  old.close();

  const logger={messages:[],info(message){this.messages.push(message);}};
  let database=new BacklogDatabase(filename,{logger});
  try {
    assert.ok(database.columns('ai_document_sources').includes('dossier_id'));
    assert.equal(database.getMeta('legacy_document_sources_table'),'ai_document_sources_legacy_v090');
    assert.equal(database.getMeta('legacy_document_sources_count'),'1');
    assert.equal(database.db.prepare('SELECT content FROM ai_document_sources_legacy_v090').get().content,'source historique');
    assert.match(logger.messages.join('\n'),/conservée.*1 ligne/i);
  } finally { database.close(); }

  database=new BacklogDatabase(filename,{logger:{info(){}}});
  try {
    assert.equal(database.getMeta('legacy_document_sources_table'),'ai_document_sources_legacy_v090');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM ai_document_sources_legacy_v090').get().count,1);
    assert.equal(database.tableNames().filter((name)=>name.startsWith('ai_document_sources_legacy_v090')).length,1);
  } finally {database.close();fs.rmSync(dir,{recursive:true,force:true});}
});
