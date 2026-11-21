import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db.js';
import { Repository } from '../src/repository.js';
import { EnrichmentWorker } from '../src/worker.js';
import { createBacklogServer } from '../src/server.js';

const waitFor = async (predicate, timeout=2000) => { const start=Date.now(); while(Date.now()-start<timeout){if(await predicate())return;await new Promise((resolve)=>setTimeout(resolve,20));}throw new Error('timeout'); };

test('la campagne serveur continue sans navigateur, isole les erreurs et reprend', async () => {
  const db=new DatabaseSync(':memory:');migrate(db);
  db.prepare("INSERT INTO games(app_id,name,developer,genres,inventory_metadata_json,source,imported_at,updated_at) VALUES (1,'A','Studio','Puzzle','{}','test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),(2,'B','Studio','RPG','{}','test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run();
  const repository=new Repository(db);let fail=true;
  const service={enrich:async(game,onStep)=>{onStep('analysis');if(game.app_id===2&&fail)throw new Error('échec simulé');return{model:'mock',embeddingModel:'mock',source:{},profile:{summary:game.name},embedding:[game.app_id,1]}}};
  const worker=new EnrichmentWorker(repository,service,{idleDelay:10});repository.startCampaign();worker.start();
  await waitFor(()=>repository.campaign().status==='completed_with_errors');
  assert.equal(repository.summary().enriched,1);assert.equal(repository.summary().failed,1);
  fail=false;repository.retryFailed();worker.wake();await waitFor(()=>repository.campaign().status==='completed');
  assert.equal(repository.summary().enriched,2);worker.stop();db.close();
});

test('l’API expose santé, bibliothèque et compatibilité', async () => {
  const db=new DatabaseSync(':memory:');migrate(db);
  db.prepare("INSERT INTO games(app_id,name,inventory_metadata_json,source,imported_at,updated_at) VALUES (10,'Outer Wilds','{}','test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run();
  const {server}=createBacklogServer({db,service:{embedMotivation:async()=>[1],enrich:async()=>({})}});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const health=await fetch(`${base}/health`).then((response)=>response.json());assert.equal(health.version,'1.1.1');
  const games=await fetch(`${base}/api/games?search=Outer`).then((response)=>response.json());assert.equal(games.total,1);assert.equal(games.rows[0].name,'Outer Wilds');
  const compatibility=await fetch(`${base}/api/compatibility`).then((response)=>response.json());assert.ok(compatibility.tables.some((row)=>row.table_name==='games'));
  await new Promise((resolve)=>server.close(resolve));db.close();
});
