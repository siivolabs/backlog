import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.js';
import { EnrichmentOrchestrator } from '../src/orchestrator.js';
import { DiscoveryEngine } from '../src/discovery.js';
import { createApp } from '../src/app.js';
import { createFaithfulV1Database, tempDatabase, profileFor, waitFor } from './helpers.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const quiet = { error(){},warn(){} };

test('démarrage HTTP et parcours complet Bibliothèque → enrichissement → Découverte → feedback', async () => {
  const temp = tempDatabase(); createFaithfulV1Database(temp.file,3).close(); const db = openDatabase(temp.file);
  const orchestrator = new EnrichmentOrchestrator({ db,loopDelayMs:1,logger:quiet,processGame:async(game)=>profileFor(game.app_id, game.app_id==='1001'?[1,0,0]:game.app_id==='1002'?[.9,.1,0]:[0,1,0]) });
  orchestrator.recover(); const discovery = new DiscoveryEngine({ db,embedText:async()=>[1,0,0] });
  const server = http.createServer(createApp({db,orchestrator,discovery,publicDir})); await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let response=await fetch(`${base}/api/health`); assert.equal(response.status,200); assert.equal((await response.json()).version,'1.1.2');
  response=await fetch(base); assert.equal(response.status,200); assert.match(await response.text(),/Votre bibliothèque, enrichie en continu/);
  response=await fetch(`${base}/api/enrichment/start`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(response.status,202);
  await waitFor(()=>orchestrator.status().lifecycle==='completed');
  const games=await (await fetch(`${base}/api/games?status=completed&limit=10`)).json(); assert.equal(games.total,3); assert.equal(games.items.every((g)=>g.enrichment_status==='completed'),true);
  const result=await (await fetch(`${base}/api/discovery`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference_app_id:'1001',motivation_text:'exploration',limit:2})})).json(); assert.equal(result.results.length,2); assert.equal(result.results[0].app_id,'1002');
  response=await fetch(`${base}/api/discovery/feedback`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference_app_id:'1001',candidate_app_id:'1002',motivation_text:'exploration',verdict:'positive'})}); assert.equal(response.status,200); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discovery_feedback').get().n,1);
  await orchestrator.shutdown(); await new Promise((resolve)=>server.close(resolve)); db.close(); temp.cleanup();
});
