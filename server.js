'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { BacklogDatabase, resolveDatabasePath } = require('./lib/database');
const { AiEngine } = require('./lib/ai-engine');
const { SimilarityExperiment } = require('./lib/similarity-experiment');
const { OllamaClient } = require('./lib/network-ollama');
const { NetworkCompletionService } = require('./lib/network-completion');
const { FastSemanticService } = require('./lib/fast-semantic');
const { DiscoveryService } = require('./lib/discovery');

const VERSION = '0.9.6';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const databasePath = resolveDatabasePath(process.env);
const database = new BacklogDatabase(databasePath);
const aiEngine = new AiEngine({ database, env: process.env });
const similarityExperiment = new SimilarityExperiment(databasePath, {
  experimentSize: Number(process.env.EXPERIMENT_SIZE || 50),
  useDraftProfiles: String(process.env.USE_DRAFT_PROFILES || 'true').toLowerCase() !== 'false'
});
const networkOllama = new OllamaClient(aiEngine.config.ollamaBaseUrl, aiEngine.config.embeddingModel);
const networkCompletion = new NetworkCompletionService({
  experiment: similarityExperiment, database, aiEngine, embeddingClient: networkOllama,
  pollIntervalMs: Number(process.env.NETWORK_JOB_POLL_MS || 500),
  jobTimeoutMs: Number(process.env.NETWORK_GAME_TIMEOUT_MS || 45 * 60 * 1000)
});
const fastSemantic = new FastSemanticService({
  filename: databasePath, database, aiEngine, embeddingClient: networkOllama, env: process.env
});
const discovery = new DiscoveryService({
  filename: databasePath, database, aiEngine, embeddingClient: networkOllama, env: process.env
});
let networkJob = null;
aiEngine.start();

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control':'no-store', ...headers });
  res.end(body);
}

function jsonError(res, status, message, detail = null) { send(res,status,{error:message,detail}); }

async function readJson(req, maxBytes = 1_000_000) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if (size>maxBytes) throw Object.assign(new Error('Corps de requête trop volumineux'),{statusCode:413}); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON invalide'),{statusCode:400}); }
}

function requireAdmin(req) {
  const expected=String(process.env.ADMIN_TOKEN||'');
  if (!expected) return;
  const supplied=String(req.headers['x-admin-token']||'');
  const a=Buffer.from(expected); const b=Buffer.from(supplied);
  if (a.length!==b.length || !require('node:crypto').timingSafeEqual(a,b)) throw Object.assign(new Error('Jeton administrateur requis'),{statusCode:401});
}

function publicConfig() {
  return { version:VERSION, adminTokenRequired:Boolean(process.env.ADMIN_TOKEN), analysisModel:aiEngine.config.analysisModel, embeddingModel:aiEngine.config.embeddingModel, embeddingDimensions:aiEngine.config.embeddingDimensions, ollamaConfigured:aiEngine.config.ollamaExplicitlyConfigured, searxngConfigured:Boolean(aiEngine.config.searxngBaseUrl), databaseFile:path.basename(databasePath), librarySource:database.discoverLibrarySource()?.table||null, similarityNetwork:true, fastSemanticPipeline:true, experientialDiscovery:true };
}

function addGameNames(items) {
  return items.map((item)=>{ const game=database.getGame(item.to_app_id||item.appId); return {...item,game:game?{appId:game.appId,name:game.name,coverUrl:game.coverUrl}:null}; });
}

function persistentNetworkJob() {
  const state=networkCompletion.status();const run=state.run;if(!run)return networkJob;
  const namedRun={...run,items:(run.items||[]).map((item)=>{const game=database.getGame(item.app_id);return{...item,game_name:game?.name||null};})};
  const activeItem=namedRun.items.find((item)=>item.status==='running')||namedRun.items.find((item)=>item.job_id&&['pending','paused','interrupted'].includes(item.status));
  const telemetry=activeItem?.job_id?networkCompletion.itemTelemetry(activeItem.job_id):null;
  const completed=run.items.filter((item)=>['completed','failed','cancelled'].includes(item.status)).length;
  const persisted={type:'completion',status:run.status,phase:run.status,runId:run.id,mode:run.mode,current:completed,total:run.selected_count,startedAt:run.started_at,finishedAt:run.completed_at,pauseRequested:Boolean(run.pause_requested),run:namedRun,telemetry,currentStep:telemetry?.job?.current_step||activeItem?.current_step||null,message:telemetry?.job?.message||activeItem?.message||null,result:run.summary?{summary:run.summary,counts:run.summary.counts,network:{pairCount:run.pair_count}}:null};
  if(networkJob?.status==='running'||networkJob?.status==='pausing')return{...persisted,...networkJob,run:namedRun,telemetry:telemetry||networkJob.telemetry,currentStep:telemetry?.job?.current_step||networkJob.currentStep||persisted.currentStep,message:telemetry?.job?.message||networkJob.message||persisted.message};
  return persisted;
}

async function api(req,res,url) {
  const method=req.method||'GET'; const pathname=url.pathname;
  if (method==='GET'&&pathname==='/healthz') return send(res,200,{status:'ok',version:VERSION,database:path.basename(databasePath)});
  if (method==='GET'&&pathname==='/api/v09/config') return send(res,200,publicConfig());
  if (method==='GET'&&pathname==='/api/v09/dashboard') return send(res,200,database.getDashboard());
  if (method==='GET'&&pathname==='/api/v09/games') {
    return send(res,200,database.listGames({query:url.searchParams.get('query')||'',aiStatus:url.searchParams.get('aiStatus')||'all',limit:url.searchParams.get('limit')||60,offset:url.searchParams.get('offset')||0}));
  }
  if (method==='GET'&&pathname==='/api/v09/errors') return send(res,200,{items:database.listErrors(url.searchParams.get('limit')||100)});
  if (method==='POST'&&pathname==='/api/v09/ai/test') { requireAdmin(req); return send(res,200,await aiEngine.testConnection()); }

  let match=pathname.match(/^\/api\/v09\/games\/([^/]+)$/);
  if (method==='GET'&&match) {
    const appId=decodeURIComponent(match[1]); const game=database.getGame(appId); if(!game)return jsonError(res,404,'Jeu introuvable');
    return send(res,200,{...database.attachAiState(game),profile:database.getProfileBundle(appId),dossier:database.getLatestDossier(appId),experience:database.getExperience(appId)});
  }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/(profile|sources|similarities|history|experience)$/);
  if (method==='GET'&&match) {
    const appId=decodeURIComponent(match[1]); const type=match[2]; const bundle=database.getProfileBundle(appId);
    if(type==='profile') return send(res,200,{bundle});
    if(type==='sources') { const dossier=database.getLatestDossier(appId); return send(res,200,{dossier,items:dossier?.sources||bundle?.displayed?.sources||[]}); }
    if(type==='similarities') return send(res,200,{items:addGameNames(database.similarities(appId))});
    if(type==='history') return send(res,200,{items:database.history(appId)});
    return send(res,200,{experience:database.getExperience(appId)});
  }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/reanalyze$/);
  if(method==='POST'&&match){ requireAdmin(req); const appId=decodeURIComponent(match[1]); if(!database.getGame(appId))return jsonError(res,404,'Jeu introuvable'); const job=aiEngine.enqueue(appId); return send(res,202,{job}); }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/(documents|analysis|embedding)$/);
  if(method==='POST'&&match){ requireAdmin(req); const appId=decodeURIComponent(match[1]); if(!database.getGame(appId))return jsonError(res,404,'Jeu introuvable'); const job=aiEngine.enqueue(appId,match[2]); return send(res,202,{job}); }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/retry$/);
  if(method==='POST'&&match){ requireAdmin(req); const appId=decodeURIComponent(match[1]); const job=aiEngine.enqueue(appId); return send(res,202,{job}); }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/experience$/);
  if(method==='PUT'&&match){ requireAdmin(req); const body=await readJson(req); return send(res,200,{experience:database.saveExperience(decodeURIComponent(match[1]),body)}); }

  if(method==='GET'&&pathname==='/api/v09/jobs') return send(res,200,{items:database.listJobs({status:url.searchParams.get('status')||null,campaignRunId:url.searchParams.get('campaignRunId')||null,limit:url.searchParams.get('limit')||500})});
  match=pathname.match(/^\/api\/v09\/jobs\/(\d+)$/);
  if(method==='GET'&&match){ const job=database.jobDetail(match[1]); return job?send(res,200,{job}):jsonError(res,404,'Tâche introuvable'); }
  match=pathname.match(/^\/api\/v09\/jobs\/(\d+)\/priority$/);
  if(method==='PATCH'&&match){requireAdmin(req);const body=await readJson(req);const job=database.setJobPriority(match[1],body.priority);return job?send(res,200,{job}):jsonError(res,404,'Tâche introuvable');}
  match=pathname.match(/^\/api\/v09\/jobs\/(\d+)\/retry$/);
  if(method==='POST'&&match){requireAdmin(req);const job=database.retryJob(match[1]);if(!job)return jsonError(res,404,'Tâche introuvable');aiEngine.resume();return send(res,202,{job});}
  match=pathname.match(/^\/api\/v09\/jobs\/(\d+)$/);
  if(method==='DELETE'&&match){requireAdmin(req);const job=database.cancelJob(match[1]);return job?send(res,200,{job}):jsonError(res,404,'Tâche introuvable');}
  match=pathname.match(/^\/api\/v09\/profiles\/(\d+)\/review$/);
  if(method==='PATCH'&&match){ requireAdmin(req); const body=await readJson(req); const profile=database.reviewProfile(match[1],body); return profile?send(res,200,{profile}):jsonError(res,404,'Version introuvable'); }
  match=pathname.match(/^\/api\/v09\/profiles\/(\d+)\/fields\/(.+)\/review$/);
  if(method==='PUT'&&match){ requireAdmin(req); const body=await readJson(req); const review=database.saveFieldReview(match[1],decodeURIComponent(match[2]),body); return send(res,200,{review}); }
  if(method==='PUT'&&pathname==='/api/v09/feedback/similarity'){ requireAdmin(req); const body=await readJson(req); return send(res,200,{feedback:database.saveSimilarityFeedback(body)}); }


  // Réseau expérimental historique : campagnes persistantes, supervisées et reprenables.
  if(method==='GET'&&pathname==='/api/v09/network/dashboard') return send(res,200,similarityExperiment.dashboard());
  if(method==='GET'&&pathname==='/api/v09/network/games') return send(res,200,{games:similarityExperiment.libraryGames(Number(url.searchParams.get('limit')||10000),{query:url.searchParams.get('query')||'',status:url.searchParams.get('status')||'all'})});
  if(method==='GET'&&pathname==='/api/v09/network/job') return send(res,200,{job:persistentNetworkJob()});
  if(method==='GET'&&pathname==='/api/v09/network/campaigns') return send(res,200,{items:similarityExperiment.campaignHistory(url.searchParams.get('limit')||20)});
  if(method==='GET'&&pathname==='/api/v09/network/completion/plan') return send(res,200,{items:networkCompletion.publicPlan({mode:url.searchParams.get('mode')||'smart'})});
  match=pathname.match(/^\/api\/v09\/network\/campaigns\/(\d+)$/);
  if(method==='GET'&&match){const run=similarityExperiment.completionRun(match[1]);return run?send(res,200,{run}):jsonError(res,404,'Campagne introuvable');}
  match=pathname.match(/^\/api\/v09\/network\/campaigns\/(\d+)\/queue\/([^/]+)\/priority$/);
  if(method==='PATCH'&&match){requireAdmin(req);const body=await readJson(req);const item=networkCompletion.prioritize(match[1],decodeURIComponent(match[2]),body.priority??100);return item?send(res,200,{item}):jsonError(res,404,'Élément introuvable');}
  match=pathname.match(/^\/api\/v09\/network\/campaigns\/(\d+)\/queue\/([^/]+)$/);
  if(method==='DELETE'&&match){requireAdmin(req);const item=networkCompletion.remove(match[1],decodeURIComponent(match[2]));return item?send(res,200,{item}):jsonError(res,404,'Élément introuvable');}
  match=pathname.match(/^\/api\/v09\/network\/campaigns\/(\d+)\/retry-errors$/);
  if(method==='POST'&&match){requireAdmin(req);return send(res,200,{retried:networkCompletion.retryErrors(match[1])});}
  match=pathname.match(/^\/api\/v09\/network\/games\/([^/]+)\/similar$/);
  if(method==='GET'&&match) return send(res,200,{appId:decodeURIComponent(match[1]),recommendations:similarityExperiment.recommendations(decodeURIComponent(match[1]),Number(url.searchParams.get('limit')||5))});
  if(method==='POST'&&pathname==='/api/v09/network/selection'){
    requireAdmin(req); const body=await readJson(req);
    if(!Array.isArray(body.appIds)) throw Object.assign(new Error('appIds doit être un tableau'),{statusCode:400});
    return send(res,200,{selected:similarityExperiment.setSelection(body.appIds)});
  }
  if(method==='POST'&&pathname==='/api/v09/network/rebuild'){
    requireAdmin(req);
    if(networkJob?.status==='running'||networkCompletion.running||fastSemantic.running) throw Object.assign(new Error('Une opération réseau ou sémantique est déjà en cours'),{statusCode:409});
    networkJob={type:'network',status:'running',startedAt:new Date().toISOString()};
    try { const result=similarityExperiment.rebuildNetwork(); networkJob={...networkJob,status:'completed',finishedAt:new Date().toISOString(),result}; return send(res,200,result); }
    catch(error){ networkJob={...networkJob,status:'failed',finishedAt:new Date().toISOString(),error:String(error.message||error)}; throw error; }
  }
  if(method==='POST'&&pathname==='/api/v09/network/embeddings/backfill'){
    requireAdmin(req); const body=await readJson(req);
    if(networkJob?.status==='running') throw Object.assign(new Error('Une opération réseau est déjà en cours'),{statusCode:409});
    networkJob={type:'embeddings',status:'running',startedAt:new Date().toISOString(),current:0,total:null};
    const limit=Math.min(500,Math.max(1,Number(body.limit||50)));
    setImmediate(async()=>{
      try { const result=await networkOllama.backfill(similarityExperiment,limit,(progress)=>{networkJob={...networkJob,...progress};}); networkJob={...networkJob,status:'completed',finishedAt:new Date().toISOString(),result}; }
      catch(error){ console.error(error); networkJob={...networkJob,status:'failed',finishedAt:new Date().toISOString(),error:String(error.message||error)}; }
    });
    return send(res,202,{job:networkJob});
  }
  if(method==='POST'&&pathname==='/api/v09/network/complete'){
    requireAdmin(req);const body=await readJson(req);const mode=body.mode==='full'?'full':'smart';
    if(networkJob?.status==='running'||networkCompletion.running||fastSemantic.running) throw Object.assign(new Error('Une opération réseau ou sémantique est déjà en cours'),{statusCode:409});
    const plan=networkCompletion.publicPlan({mode});
    networkJob={type:'completion',status:'running',phase:'planning',mode,startedAt:new Date().toISOString(),current:0,total:plan.length,plan};
    setImmediate(async()=>{
      try {
        const result=await networkCompletion.run({mode,onProgress:(progress)=>{networkJob={...networkJob,...progress,status:progress.phase==='paused'?'paused':'running'};}});
        networkJob={...networkJob,status:result.status,phase:'completed',finishedAt:new Date().toISOString(),current:result.selected,total:result.selected,result};
      } catch(error) {
        console.error(error);networkJob={...networkJob,status:'failed',finishedAt:new Date().toISOString(),error:String(error.message||error)};
      }
    });
    return send(res,202,{job:networkJob});
  }
  if(method==='POST'&&pathname==='/api/v09/network/pause'){
    requireAdmin(req);const state=networkCompletion.pause();networkJob={...persistentNetworkJob(),status:'pausing',phase:'pausing'};return send(res,202,{job:networkJob,state});
  }
  if(method==='POST'&&pathname==='/api/v09/network/resume'){
    requireAdmin(req);if(networkCompletion.running)throw Object.assign(new Error('La campagne est déjà en cours'),{statusCode:409});
    const run=similarityExperiment.latestResumableRun();if(!run)return jsonError(res,409,'Aucune campagne à reprendre');
    networkJob={type:'completion',status:'running',phase:'resuming',mode:run.mode,runId:run.id,startedAt:run.started_at,current:run.items.filter((item)=>item.status==='completed').length,total:run.selected_count};
    setImmediate(async()=>{try{const result=await networkCompletion.resume({onProgress:(progress)=>{networkJob={...networkJob,...progress,status:progress.phase==='paused'?'paused':'running'};}});networkJob={...networkJob,status:result.status,phase:'completed',finishedAt:new Date().toISOString(),result};}catch(error){console.error(error);networkJob={...networkJob,status:'failed',finishedAt:new Date().toISOString(),error:String(error.message||error)};}});
    return send(res,202,{job:networkJob});
  }
  if(method==='PUT'&&pathname==='/api/v09/network/feedback'){
    requireAdmin(req); const body=await readJson(req); return send(res,200,{feedback:similarityExperiment.saveFeedback(body)});
  }

  // Pipeline sémantique rapide 0.9.5.0 : stockage et réseau totalement séparés.
  if(method==='GET'&&pathname==='/api/v09/fast/dashboard') return send(res,200,fastSemantic.dashboard());
  if(method==='GET'&&pathname==='/api/v09/fast/job') return send(res,200,{job:fastSemantic.status()});
  if(method==='GET'&&pathname==='/api/v09/fast/runs') return send(res,200,{items:fastSemantic.history(url.searchParams.get('limit')||20)});
  match=pathname.match(/^\/api\/v09\/fast\/runs\/(\d+)$/);
  if(method==='GET'&&match){const run=fastSemantic.getRun(match[1]);return run?send(res,200,{run}):jsonError(res,404,'Campagne rapide introuvable');}
  match=pathname.match(/^\/api\/v09\/fast\/games\/([^/]+)\/similar$/);
  if(method==='GET'&&match) return send(res,200,{appId:decodeURIComponent(match[1]),recommendations:fastSemantic.recommendations(decodeURIComponent(match[1]),url.searchParams.get('limit')||5,url.searchParams.get('runId')||null)});
  if(method==='POST'&&pathname==='/api/v09/fast/run'){
    requireAdmin(req);const body=await readJson(req);const mode=body.mode==='rebuild'?'rebuild':'smart';
    if(fastSemantic.running||networkCompletion.running||networkJob?.status==='running') throw Object.assign(new Error('Une opération réseau ou sémantique est déjà en cours'),{statusCode:409});
    void fastSemantic.run({mode}).catch((error)=>console.error(error));
    return send(res,202,{job:{...fastSemantic.status(),requestedMode:mode}});
  }
  if(method==='POST'&&pathname==='/api/v09/fast/pause'){
    requireAdmin(req);return send(res,202,{job:fastSemantic.pause()});
  }
  if(method==='POST'&&pathname==='/api/v09/fast/resume'){
    requireAdmin(req);
    if(fastSemantic.running||networkCompletion.running||networkJob?.status==='running') throw Object.assign(new Error('Une opération réseau ou sémantique est déjà en cours'),{statusCode:409});
    void fastSemantic.resume().catch((error)=>console.error(error));
    return send(res,202,{job:fastSemantic.status()});
  }

  // Backlog Discovery 0.9.6 : mémoire des motivations, présélection hybride et analyse ciblée.
  if(method==='GET'&&pathname==='/api/v09/discovery/dashboard') return send(res,200,discovery.dashboard());
  if(method==='GET'&&pathname==='/api/v09/discovery/games') return send(res,200,database.listGames({query:url.searchParams.get('query')||'',limit:url.searchParams.get('limit')||20,offset:url.searchParams.get('offset')||0}));
  if(method==='GET'&&pathname==='/api/v09/discovery/intentions') return send(res,200,{items:discovery.listIntentions()});
  if(method==='POST'&&pathname==='/api/v09/discovery/interpret'){
    requireAdmin(req);const body=await readJson(req);return send(res,201,{interpretation:await discovery.interpret({appId:body.appId,sourceText:body.sourceText})});
  }
  match=pathname.match(/^\/api\/v09\/discovery\/interpretations\/(\d+)\/confirm$/);
  if(method==='PUT'&&match){requireAdmin(req);const body=await readJson(req);return send(res,200,discovery.confirmInterpretation(match[1],body));}
  match=pathname.match(/^\/api\/v09\/discovery\/intentions\/(\d+)$/);
  if(method==='PATCH'&&match){requireAdmin(req);const body=await readJson(req);return send(res,200,{intention:discovery.setIntentionActive(match[1],body.active)});}
  if(method==='POST'&&pathname==='/api/v09/discovery/runs'){
    requireAdmin(req);const body=await readJson(req);return send(res,201,{run:await discovery.discover({referenceAppId:body.referenceAppId,intentionIds:body.intentionIds,queryText:body.queryText||''})});
  }
  match=pathname.match(/^\/api\/v09\/discovery\/runs\/(\d+)$/);
  if(method==='GET'&&match){const run=discovery.getRun(match[1]);return run?send(res,200,{run}):jsonError(res,404,'Découverte introuvable');}
  if(method==='PUT'&&pathname==='/api/v09/discovery/feedback'){
    requireAdmin(req);const body=await readJson(req);return send(res,200,{feedback:discovery.saveFeedback(body)});
  }
  return false;
}

function staticFile(req,res,url) {
  const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.replace(/^\//,''));
  const filename=path.resolve(PUBLIC_DIR,relative);
  if(!filename.startsWith(`${PUBLIC_DIR}${path.sep}`)&&filename!==path.join(PUBLIC_DIR,'index.html')) return jsonError(res,403,'Chemin interdit');
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()) return jsonError(res,404,'Ressource introuvable');
  const content=fs.readFileSync(filename); const cache=path.extname(filename)==='.html'?'no-store':'public, max-age=300';
  res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream','content-length':content.length,'cache-control':cache}); res.end(content);
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','no-referrer'); res.setHeader('content-security-policy',"default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  try {
    if(url.pathname==='/healthz'||url.pathname.startsWith('/api/')) { const handled=await api(req,res,url); if(handled===false)return jsonError(res,404,'Endpoint introuvable'); return; }
    if(req.method!=='GET'&&req.method!=='HEAD') return jsonError(res,405,'Méthode non autorisée');
    return staticFile(req,res,url);
  } catch(error){ const status=Number(error.statusCode||500); if(status>=500)console.error(error); return jsonError(res,status,status>=500?'Erreur interne':error.message,process.env.NODE_ENV==='development'?String(error.stack||''):null); }
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`Backlog V${VERSION} — http://0.0.0.0:${PORT}`);
  console.log(`SQLite : ${databasePath}`);
  console.log(`Bibliothèque : ${database.discoverLibrarySource()?.table||'aucune table compatible détectée'}`);
  console.log(`Ollama : ${aiEngine.config.ollamaBaseUrl} (${aiEngine.config.analysisModel} / ${aiEngine.config.embeddingModel})`);
  console.log(`SearXNG : ${aiEngine.config.searxngBaseUrl?'configuré':'optionnel, non configuré'}`);
});

function shutdown(){ aiEngine.stop(); server.close(()=>{discovery.close();fastSemantic.close();similarityExperiment.close();database.close();process.exit(0);}); setTimeout(()=>process.exit(1),5000).unref(); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);

module.exports={server,database,aiEngine,similarityExperiment,networkCompletion,fastSemantic,discovery,VERSION};
