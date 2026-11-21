'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CoreDatabase } = require('../lib/database');
const { EnrichmentService } = require('../lib/enrichment');
const { createApplication } = require('../server');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-core-')); const legacy = path.join(dir, 'backlog.sqlite');
  const db = new DatabaseSync(legacy); db.exec(`CREATE TABLE games(app_id TEXT PRIMARY KEY,name TEXT,developer TEXT,genres TEXT,header_image TEXT,short_description TEXT); CREATE TABLE ai_profiles(app_id TEXT,profile_json TEXT,embedding_json TEXT);`);
  const add=db.prepare('INSERT INTO games VALUES(?,?,?,?,?,?)'); add.run('100','Control','Remedy','Action, Aventure','https://img/control.jpg','Une aventure surnaturelle.'); add.run('200','Satisfactory','Coffee Stain','Simulation','https://img/sat.jpg','Construire et optimiser.'); add.run('300','Persona 5 Royal','Atlus','RPG','https://img/p5.jpg','RPG narratif.');
  db.prepare('INSERT INTO ai_profiles VALUES(?,?,?)').run('100','{"old":true}','[9,9]'); db.close(); return { dir, legacy, core: path.join(dir,'backlog-core.sqlite') };
}

const mockOllama={analysisModel:'qwen3:test',embeddingModel:'embedding:test',async profile(prompt){return {overview:prompt.includes('Control')?'Maîtrise surnaturelle':'Construction progressive',loops:['Explorer','Progresser'],experiential_intentions:['Maîtriser un système complexe'],signatures:['Choix structurants'],structure:'Progressive',progression:'Par paliers',difficulty:'Adaptative',uncertainties:[],confidence:.82}},async embed(input){const x=input.length%10;return [x/10,.5,.25]}};

test('importe uniquement le véritable inventaire et garde la connaissance IA vierge',()=>{const f=fixture();const core=new CoreDatabase(f.core,{legacyPath:f.legacy});assert.equal(core.countGames(),3);assert.equal(core.countProfiles(),0);assert.equal(core.libraryStatus().historicalAiImported,false);assert.equal(core.getGame('100').title,'Control');const tables=core.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x=>x.name);assert.ok(!tables.includes('ai_profiles'));core.close();fs.rmSync(f.dir,{recursive:true,force:true});});

test('enrichit le lot, persiste les profils et produit des découvertes',async()=>{const f=fixture();const core=new CoreDatabase(f.core,{legacyPath:f.legacy});core.setBatchItem('100',true);core.setBatchItem('200',true);core.setBatchItem('300',true);const service=new EnrichmentService({database:core,ollama:mockOllama,steamFetchEnabled:false});const run=await service.run();assert.equal(run.status,'completed');assert.equal(core.countProfiles(),3);const result=await service.discover({referenceAppId:'100',motivationText:'Maîtriser progressivement un système complexe'});assert.ok(result.items.length>0);assert.ok(result.items.length<=5);core.close();fs.rmSync(f.dir,{recursive:true,force:true});});

test('sert l’interface et les API essentielles',async()=>{const f=fixture();const database=new CoreDatabase(f.core,{legacyPath:f.legacy});const app=createApplication({database,ollama:mockOllama,env:{STEAM_FETCH_ENABLED:'false'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.ok,true);const status=await fetch(base+'/api/status').then(r=>r.json());assert.equal(status.inventory,3);const html=await fetch(base+'/').then(r=>r.text());assert.match(html,/Bibliothèque/);await new Promise(r=>app.server.close(r));database.close();fs.rmSync(f.dir,{recursive:true,force:true});});
