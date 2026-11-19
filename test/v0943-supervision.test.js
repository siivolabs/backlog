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
const { classifyAnalysisError } = require('../lib/error-classifier');

function profile(marker='x') {
  return {schema_version:'2.1',gameplay_loops:[{action:`agir ${marker}`,objective:'avancer',description:'Boucle documentée'}],narrative:{description:'Narration documentée'},exploration:{description:'Exploration documentée'},structure:{description:'Structure documentée'},pace:{description:'Rythme documenté'},progression:{description:'Progression documentée'},difficulty_friction:{description:'Difficulté documentée'},atmosphere_themes:{description:'Ambiance documentée'},multiplayer:{description:'Mode documenté'},perspective:'troisième personne',distinctive_elements:[{element:`signature ${marker}`,description:'Identité documentée'}]};
}

function fixture(names=[['10','Alpha'],['100','Beta'],['210','Control']]) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-v0943-'));const filename=path.join(directory,'backlog.sqlite');
  const seed=new DatabaseSync(filename);seed.exec('CREATE TABLE games(appid TEXT PRIMARY KEY,name TEXT NOT NULL);');const insert=seed.prepare('INSERT INTO games VALUES(?,?)');for(const row of names)insert.run(...row);seed.close();
  const database=new BacklogDatabase(filename,{logger:{info(){}}});
  return {directory,filename,database,close(experiment){experiment?.close();database.close();fs.rmSync(directory,{recursive:true,force:true});}};
}

test('la recherche numérique utilise un Steam AppID exact',()=>{const f=fixture();try{assert.deepEqual(f.database.listGames({query:'10'}).items.map((item)=>item.appId),['10']);assert.deepEqual(f.database.listGames({query:'Control'}).items.map((item)=>item.appId),['210']);}finally{f.close();}});

test('les points de reprise conservent résultat brut, durée et journal',()=>{const f=fixture();try{const job=f.database.createJob('10','network',{priority:50,campaignRunId:7});f.database.beginCheckpoint(job.id,'10','analysis',{promptVersion:'prompt-test'});f.database.completeCheckpoint(job.id,'10','analysis',{raw:'profil brut'},{promptVersion:'prompt-test'});const detail=f.database.jobDetail(job.id);assert.equal(detail.priority,50);assert.equal(detail.campaign_run_id,7);assert.deepEqual(detail.checkpoints[0].payload,{raw:'profil brut'});assert.equal(detail.checkpoints[0].status,'completed');assert.ok(detail.events.some((event)=>event.event_type==='step_completed'));}finally{f.close();}});

test('la file persistante accepte priorité, retrait et relance ciblée',()=>{const f=fixture();const experiment=new SimilarityExperiment(f.filename,{experimentSize:3});try{const runId=experiment.startCompletionRun([{appId:'10',action:'regenerate',reason:'test'},{appId:'100',action:'regenerate',reason:'test'}]);experiment.setCompletionItemPriority(runId,'100',100);assert.equal(experiment.completionRun(runId).items[0].app_id,'100');experiment.updateCompletionItem(runId,'10',{status:'failed',error_category:'technique'});assert.equal(experiment.retryFailedCompletionItems(runId),1);assert.equal(experiment.completionRun(runId).items.find((item)=>item.app_id==='10').status,'pending');experiment.cancelCompletionItem(runId,'10');assert.equal(experiment.completionRun(runId).items.find((item)=>item.app_id==='10').status,'cancelled');}finally{f.close(experiment);}});

test('la reconstruction complète crée de nouvelles candidates sans remplacer les actives',async()=>{const f=fixture();for(const [appId] of [['10'],['100'],['210']])f.database.insertProfileVersion({appId,profile:profile(appId),embedding:[1,Number(appId)/1000,0.2],embeddingModel:'embeddinggemma',lifecycleState:'active',profileSchemaVersion:'2.1'});const experiment=new SimilarityExperiment(f.filename,{experimentSize:3,usableThreshold:0.45});const aiEngine={checkEmbedding(){},resume(){},enqueue(appId,operation,options){assert.equal(operation,'network');assert.equal(options.forceFull,true);const job=f.database.createJob(appId,operation,options);const active=f.database.getActiveProfile(appId);const version=f.database.insertProfileVersion({appId,profile:profile(`nouveau-${appId}`),embedding:[1,Number(appId)/1000,0.3],embeddingModel:'embeddinggemma',lifecycleState:'draft',basedOnVersionId:active.id,profileSchemaVersion:'2.1'});f.database.updateJob(job.id,{status:'completed',current_step:'completed',target_version_id:version.id,finished_at:new Date().toISOString()});return f.database.getJob(job.id);}};const service=new NetworkCompletionService({experiment,database:f.database,aiEngine,embeddingClient:{model:'embeddinggemma',async embedText(){return[1,0,0];}},pollIntervalMs:1,jobTimeoutMs:1000});try{assert.ok(service.publicPlan({mode:'full'}).every((item)=>item.action==='regenerate_full'));const result=await service.run({mode:'full'});assert.equal(result.status,'completed');assert.equal(result.counts.regenerated,3);assert.equal(f.database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='active'").get().count,3);assert.equal(f.database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='draft'").get().count,3);assert.equal(result.summary.pairs,3);}finally{f.close(experiment);}});

test('une erreur Ollama ponctuelle exige un contrôle de disponibilité avant toute suspension',()=>{const infra=classifyAnalysisError(Object.assign(new Error('Ollama: fetch failed'),{code:'NETWORK_ERROR'}),'analysis');const quality=classifyAnalysisError(new Error('Le profil régénéré reste insuffisant pour le réseau'),'verification');assert.deepEqual({category:infra.category,autoPause:infra.autoPause,healthCheckRequired:infra.healthCheckRequired},{category:'infrastructure',autoPause:false,healthCheckRequired:true});assert.equal(quality.category,'qualite');assert.equal(quality.autoPause,false);});

test('une campagne suspendue reprend le même lot sans perdre son travail',async()=>{
  const f=fixture([['10','À reprendre']]);f.database.insertProfileVersion({appId:'10',profile:{summary:'ancien profil'},lifecycleState:'active',profileSchemaVersion:'legacy'});const experiment=new SimilarityExperiment(f.filename,{experimentSize:1,usableThreshold:0.45});let jobId=null;
  const aiEngine={checkEmbedding(){},pause(){if(jobId)f.database.updateJob(jobId,{status:'interrupted',current_step:'analysis',message:'Suspendu',error_category:'interruption',error_code:'PAUSED',finished_at:new Date().toISOString()});},resume(){},enqueue(appId,operation,options){const job=f.database.createJob(appId,operation,options);jobId=job.id;f.database.updateJob(job.id,{status:'running',current_step:'analysis',started_at:new Date().toISOString()});return f.database.getJob(job.id);}};
  const service=new NetworkCompletionService({experiment,database:f.database,aiEngine,embeddingClient:{model:'embeddinggemma',async embedText(){return[1,0,0];}},pollIntervalMs:5,jobTimeoutMs:2000,logger:{error(){}}});
  try{
    const firstPromise=service.run();while(!jobId)await new Promise((resolve)=>setTimeout(resolve,5));service.pause();const first=await firstPromise;assert.equal(first.status,'paused');const runId=first.runId;assert.equal(experiment.completionRun(runId).items[0].status,'interrupted');
    const resumePromise=service.resume();
    for(let index=0;index<100;index+=1){const job=f.database.getJob(jobId);if(job?.status==='queued'){const active=f.database.getActiveProfile('10');const version=f.database.insertProfileVersion({appId:'10',profile:profile('repris'),embedding:[1,0,0],embeddingModel:'embeddinggemma',lifecycleState:'draft',basedOnVersionId:active.id,profileSchemaVersion:'2.1'});f.database.updateJob(jobId,{status:'completed',current_step:'completed',target_version_id:version.id,finished_at:new Date().toISOString()});break;}await new Promise((resolve)=>setTimeout(resolve,5));}
    const resumed=await resumePromise;assert.equal(resumed.runId,runId);assert.equal(resumed.status,'completed');assert.equal(experiment.completionRun(runId).items[0].status,'completed');assert.equal(f.database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='active'").get().count,1);assert.equal(f.database.db.prepare("SELECT COUNT(*) AS count FROM ai_profile_versions WHERE lifecycle_state='draft'").get().count,1);
  }finally{f.close(experiment);}
});


test('la campagne continue après une erreur réseau ponctuelle si Ollama répond au contrôle de disponibilité',async()=>{
  const f=fixture([['10','Erreur ponctuelle']]);
  f.database.insertProfileVersion({appId:'10',profile:{summary:'ancien profil'},lifecycleState:'active',profileSchemaVersion:'legacy'});
  const experiment=new SimilarityExperiment(f.filename,{experimentSize:1,usableThreshold:0.45});
  const aiEngine={resume(){},async isOllamaAvailable(){return true;},enqueue(appId,operation,options){const job=f.database.createJob(appId,operation,options);f.database.updateJob(job.id,{status:'error',current_step:'analysis',message:'Connexion réinitialisée',error_category:'infrastructure',error_code:'NETWORK_ERROR',error_detail:'ECONNRESET',finished_at:new Date().toISOString()});return f.database.getJob(job.id);}};
  const service=new NetworkCompletionService({experiment,database:f.database,aiEngine,embeddingClient:{model:'embeddinggemma',async embedText(){return[1,0,0];}},pollIntervalMs:1,jobTimeoutMs:100,logger:{error(){}}});
  try{const result=await service.run();assert.equal(result.status,'completed_with_errors');assert.equal(result.counts.failed,1);assert.equal(service.pauseRequested,false);}finally{f.close(experiment);}
});

test('la campagne se suspend seulement quand le contrôle confirme Ollama indisponible',async()=>{
  const f=fixture([['10','Ollama indisponible']]);
  f.database.insertProfileVersion({appId:'10',profile:{summary:'ancien profil'},lifecycleState:'active',profileSchemaVersion:'legacy'});
  const experiment=new SimilarityExperiment(f.filename,{experimentSize:1,usableThreshold:0.45});
  const aiEngine={resume(){},async isOllamaAvailable(){return false;},enqueue(appId,operation,options){const job=f.database.createJob(appId,operation,options);f.database.updateJob(job.id,{status:'error',current_step:'analysis',message:'Connexion refusée',error_category:'infrastructure',error_code:'NETWORK_ERROR',error_detail:'ECONNREFUSED',finished_at:new Date().toISOString()});return f.database.getJob(job.id);}};
  const service=new NetworkCompletionService({experiment,database:f.database,aiEngine,embeddingClient:{model:'embeddinggemma',async embedText(){return[1,0,0];}},pollIntervalMs:1,jobTimeoutMs:100,logger:{error(){}}});
  try{const result=await service.run();assert.equal(result.status,'paused');assert.equal(service.pauseRequested,true);assert.equal(experiment.completionRun(result.runId).items[0].status,'interrupted');}finally{f.close(experiment);}
});
