'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { BacklogDatabase, resolveDatabasePath } = require('./lib/database');
const { AiEngine } = require('./lib/ai-engine');

const VERSION = '0.9.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const databasePath = resolveDatabasePath(process.env);
const database = new BacklogDatabase(databasePath);
const aiEngine = new AiEngine({ database, env: process.env });
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
  return { version:VERSION, adminTokenRequired:Boolean(process.env.ADMIN_TOKEN), analysisModel:aiEngine.config.analysisModel, embeddingModel:aiEngine.config.embeddingModel, embeddingDimensions:aiEngine.config.embeddingDimensions, searxngConfigured:Boolean(aiEngine.config.searxngBaseUrl), databaseFile:path.basename(databasePath), librarySource:database.discoverLibrarySource()?.table||null };
}

function addGameNames(items) {
  return items.map((item)=>{ const game=database.getGame(item.to_app_id||item.appId); return {...item,game:game?{appId:game.appId,name:game.name,coverUrl:game.coverUrl}:null}; });
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
    return send(res,200,{...database.attachAiState(game),profile:database.getProfileBundle(appId),experience:database.getExperience(appId)});
  }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/(profile|sources|similarities|history|experience)$/);
  if (method==='GET'&&match) {
    const appId=decodeURIComponent(match[1]); const type=match[2]; const bundle=database.getProfileBundle(appId);
    if(type==='profile') return send(res,200,{bundle});
    if(type==='sources') return send(res,200,{items:bundle?.displayed?.sources||[]});
    if(type==='similarities') return send(res,200,{items:addGameNames(database.similarities(appId))});
    if(type==='history') return send(res,200,{items:database.history(appId)});
    return send(res,200,{experience:database.getExperience(appId)});
  }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/reanalyze$/);
  if(method==='POST'&&match){ requireAdmin(req); const appId=decodeURIComponent(match[1]); if(!database.getGame(appId))return jsonError(res,404,'Jeu introuvable'); const job=aiEngine.enqueue(appId); return send(res,202,{job}); }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/retry$/);
  if(method==='POST'&&match){ requireAdmin(req); const appId=decodeURIComponent(match[1]); const job=aiEngine.enqueue(appId); return send(res,202,{job}); }
  match=pathname.match(/^\/api\/v09\/games\/([^/]+)\/experience$/);
  if(method==='PUT'&&match){ requireAdmin(req); const body=await readJson(req); return send(res,200,{experience:database.saveExperience(decodeURIComponent(match[1]),body)}); }

  match=pathname.match(/^\/api\/v09\/jobs\/(\d+)$/);
  if(method==='GET'&&match){ const job=database.getJob(match[1]); return job?send(res,200,{job}):jsonError(res,404,'Tâche introuvable'); }
  match=pathname.match(/^\/api\/v09\/profiles\/(\d+)\/review$/);
  if(method==='PATCH'&&match){ requireAdmin(req); const body=await readJson(req); const profile=database.reviewProfile(match[1],body); return profile?send(res,200,{profile}):jsonError(res,404,'Version introuvable'); }
  match=pathname.match(/^\/api\/v09\/profiles\/(\d+)\/fields\/(.+)\/review$/);
  if(method==='PUT'&&match){ requireAdmin(req); const body=await readJson(req); const review=database.saveFieldReview(match[1],decodeURIComponent(match[2]),body); return send(res,200,{review}); }
  if(method==='PUT'&&pathname==='/api/v09/feedback/similarity'){ requireAdmin(req); const body=await readJson(req); return send(res,200,{feedback:database.saveSimilarityFeedback(body)}); }
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

function shutdown(){ aiEngine.stop(); server.close(()=>{database.close();process.exit(0);}); setTimeout(()=>process.exit(1),5000).unref(); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);

module.exports={server,database,aiEngine,VERSION};
