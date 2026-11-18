'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');

const PROFILE_SCHEMA_VERSION = '2.0';
const EVIDENCE_STATUS_VALUES = ['documented', 'interpreted', 'unknown', 'contradictory', 'human_corrected'];
const EVIDENCE_STATUSES = new Set(EVIDENCE_STATUS_VALUES);
const RESERVED_PROFILE_VALUES = new Set(EVIDENCE_STATUS_VALUES);
const confidenceSchema = { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] };
const textSchema = (minLength = 24) => ({ type: 'string', minLength });
const stringListSchema = { type: 'array', items: { type: 'string', minLength: 2 }, maxItems: 8 };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const PROFILE_FIELDS = {
  summary: { type: 'string', label: 'Résumé de l’expérience', schema: nullable(textSchema(80)) },
  gameplay_loops: { type: 'array', label: 'Boucles de gameplay', schema: { type: 'array', maxItems: 8, items: { type: 'object', properties: { action: textSchema(3), objective: textSchema(3), cadence: { type: 'string', enum: ['continuous','recurring','session_based','situational'] }, centrality: { type: 'string', enum: ['core','supporting','optional'] }, description: textSchema(24) }, required: ['action','objective','cadence','centrality','description'], additionalProperties: false } } },
  narrative: { type: 'object', label: 'Narration', schema: nullable({ type: 'object', properties: { importance: { type: 'string', enum: ['absent','very_low','low','moderate','high','central'] }, structure: { type: 'string', enum: ['none','emergent','linear','branching','environmental','hybrid'] }, delivery: stringListSchema, player_agency: { type: 'string', enum: ['none','low','moderate','high'] }, description: textSchema(24) }, required: ['importance','structure','delivery','player_agency','description'], additionalProperties: false }) },
  exploration: { type: 'object', label: 'Exploration', schema: nullable({ type: 'object', properties: { freedom: { type: 'string', enum: ['none','guided','semi_open','open'] }, topology: { type: 'string', enum: ['linear','hub_based','interconnected','open_world','network','procedural','hybrid'] }, guidance: { type: 'string', enum: ['strict','moderate','light','player_directed'] }, rewards: stringListSchema, description: textSchema(24) }, required: ['freedom','topology','guidance','rewards','description'], additionalProperties: false }) },
  structure: { type: 'object', label: 'Structure', schema: nullable({ type: 'object', properties: { world: { type: 'string', enum: ['linear','levels','hub_based','interconnected','open_world','sandbox','procedural','hybrid'] }, activity_model: { type: 'string', enum: ['campaign','missions','contracts','runs','objectives','self_directed','hybrid'] }, session_model: { type: 'string', enum: ['continuous','chapter_based','mission_based','run_based','open_ended'] }, linearity: { type: 'string', enum: ['linear','mostly_linear','mixed','nonlinear','player_directed'] }, description: textSchema(24) }, required: ['world','activity_model','session_model','linearity','description'], additionalProperties: false }) },
  atmosphere_themes: { type: 'object', label: 'Ambiance et thèmes', schema: nullable({ type: 'object', properties: { tone: stringListSchema, themes: stringListSchema, sensory_style: stringListSchema, description: textSchema(24) }, required: ['tone','themes','sensory_style','description'], additionalProperties: false }) },
  pace: { type: 'object', label: 'Rythme', schema: nullable({ type: 'object', properties: { baseline: { type: 'string', enum: ['very_slow','slow','moderate','fast','very_fast','variable'] }, variation: { type: 'string', enum: ['steady','calm_to_tense','bursty','escalating','player_driven','variable'] }, intensity: { type: 'string', enum: ['very_low','low','low_to_moderate','moderate','moderate_to_high','high','variable'] }, player_control: { type: 'string', enum: ['low','moderate','high'] }, description: textSchema(24) }, required: ['baseline','variation','intensity','player_control','description'], additionalProperties: false }) },
  progression: { type: 'object', label: 'Progression', schema: nullable({ type: 'object', properties: { systems: stringListSchema, scope: { type: 'string', enum: ['none','character','equipment','economy','base','technology','organization','multi_system'] }, pacing: { type: 'string', enum: ['flat','slow','steady','accelerating','tiered','player_driven'] }, persistence: { type: 'string', enum: ['none','session','campaign','permanent','mixed'] }, description: textSchema(24) }, required: ['systems','scope','pacing','persistence','description'], additionalProperties: false }) },
  difficulty_friction: { type: 'object', label: 'Difficulté et friction', schema: nullable({ type: 'object', properties: { baseline: { type: 'string', enum: ['very_low','low','moderate','high','very_high','variable'] }, adjustability: { type: 'string', enum: ['none','limited','moderate','high'] }, failure_cost: { type: 'string', enum: ['negligible','low','moderate','high','variable'] }, friction_sources: stringListSchema, skill_demands: stringListSchema, description: textSchema(24) }, required: ['baseline','adjustability','failure_cost','friction_sources','skill_demands','description'], additionalProperties: false }) },
  multiplayer: { type: 'object', label: 'Multijoueur', schema: nullable({ type: 'object', properties: { availability: { type: 'string', enum: ['none','optional','central'] }, modes: stringListSchema, cooperation: { type: 'string', enum: ['none','limited','supported','central'] }, competition: { type: 'string', enum: ['none','limited','supported','central'] }, persistence: { type: 'string', enum: ['none','session','persistent','mixed'] }, description: textSchema(24) }, required: ['availability','modes','cooperation','competition','persistence','description'], additionalProperties: false }) },
  distinctive_elements: { type: 'array', label: 'Éléments distinctifs', schema: { type: 'array', maxItems: 8, items: { type: 'object', properties: { element: textSchema(3), role: { type: 'string', enum: ['core','supporting','optional','technical'] }, description: textSchema(24) }, required: ['element','role','description'], additionalProperties: false } } },
  uncertainties: { type: 'array', label: 'Limites et incertitudes', schema: { type: 'array', maxItems: 12, items: { type: 'object', properties: { claim: textSchema(3), reason: textSchema(12), impact: { type: 'string', enum: ['low','moderate','high'] } }, required: ['claim','reason','impact'], additionalProperties: false } } }
};
const PROFILE_SCHEMA = { schema_version: PROFILE_SCHEMA_VERSION, ...Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key, definition]) => [key, definition.type === 'array' ? [] : null])) };

const fieldStatusSchema = { type: 'object', properties: { status: { type: 'string', enum: EVIDENCE_STATUS_VALUES }, source_ids: { type: 'array', items: { type: 'string', pattern: '^SOURCE-[1-9][0-9]*$' } }, confidence: confidenceSchema, note: { type: 'string' } }, required: ['status','source_ids','confidence','note'], additionalProperties: false };
const PROFILE_FORMAT = { type: 'object', properties: { schema_version: { type: 'string', enum: [PROFILE_SCHEMA_VERSION] }, ...Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key, definition]) => [key, definition.schema])), field_status: { type: 'object', properties: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key, fieldStatusSchema])), required: Object.keys(PROFILE_FIELDS), additionalProperties: false } }, required: ['schema_version', ...Object.keys(PROFILE_FIELDS), 'field_status'], additionalProperties: false };

const QUERY_FACETS = [
  { key: 'gameplay', suffix: 'gameplay mechanics progression review', supports: ['gameplay_loops', 'progression', 'difficulty_friction'] },
  { key: 'structure', suffix: 'story structure exploration campaign open world', supports: ['narrative', 'exploration', 'structure'] },
  { key: 'experience', suffix: 'review atmosphere pacing player experience', supports: ['atmosphere_themes', 'pace', 'distinctive_elements'] },
  { key: 'official', suffix: 'official features developer', supports: ['summary', 'gameplay_loops', 'multiplayer'] }
];

function normalizeBaseUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function parseMaybeJson(value, fallback = null) { if (value == null || value === '') return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return fallback; } }
function stripHtml(value) { return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function primitiveText(value) { if (Array.isArray(value)) return value.map(primitiveText).filter(Boolean).join('\n'); if (value && typeof value === 'object') return Object.values(value).map(primitiveText).filter(Boolean).join('\n'); return value == null ? '' : String(value); }


function normalizedToken(value) { return String(value ?? '').trim().toLowerCase().replace(/[\s._-]+/g, '_'); }
function isEmptyProfileValue(value) { return value == null || value === '' || (Array.isArray(value) && value.length === 0); }
function assertSchema(value, schema, path = 'profil') {
  if (schema.anyOf) {
    const errors=[];
    for (const candidate of schema.anyOf) { try { assertSchema(value,candidate,path); return; } catch(error) { errors.push(error.message); } }
    throw new Error(`${path}: valeur incompatible avec le schéma (${errors[0]})`);
  }
  const allowed=Array.isArray(schema.type)?schema.type:[schema.type];
  const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
  if (!allowed.includes(actual)) throw new Error(`${path}: type ${actual} invalide, attendu ${allowed.join(' ou ')}`);
  if (actual==='null') return;
  if (actual==='string') {
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: valeur non autorisée`);
    if (schema.minLength && value.trim().length<schema.minLength) throw new Error(`${path}: texte trop court`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) throw new Error(`${path}: format invalide`);
    return;
  }
  if (actual==='array') {
    if (schema.minItems!=null && value.length<schema.minItems) throw new Error(`${path}: liste trop courte`);
    if (schema.maxItems!=null && value.length>schema.maxItems) throw new Error(`${path}: liste trop longue`);
    value.forEach((item,index)=>assertSchema(item,schema.items,`${path}[${index}]`));
    return;
  }
  if (actual==='object') {
    const required=schema.required||[];
    for (const key of required) if (!(key in value)) throw new Error(`${path}.${key}: champ obligatoire manquant`);
    if (schema.additionalProperties===false) for (const key of Object.keys(value)) if (!(key in (schema.properties||{}))) throw new Error(`${path}.${key}: champ non autorisé`);
    for (const [key,child] of Object.entries(schema.properties||{})) if (key in value) assertSchema(value[key],child,`${path}.${key}`);
  }
}
function assertNoReservedProfileValues(value, path = 'profil') {
  if (typeof value==='string' && RESERVED_PROFILE_VALUES.has(normalizedToken(value))) throw new Error(`${path}: « ${value} » est un statut documentaire, pas un contenu de profil`);
  if (Array.isArray(value)) value.forEach((item,index)=>assertNoReservedProfileValues(item,`${path}[${index}]`));
  else if (value && typeof value==='object') for (const [key,item] of Object.entries(value)) assertNoReservedProfileValues(item,`${path}.${key}`);
}
function descriptionScore(value) {
  const text=String(value||'').trim();
  const words=text.toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g)||[];
  const unique=new Set(words);
  if (text.length<24 || unique.size<4) return 0;
  return Math.min(1,0.45*Math.min(1,text.length/120)+0.55*Math.min(1,unique.size/14));
}
function semanticDimensionScore(key, value) {
  if (isEmptyProfileValue(value)) return 0;
  if (key==='summary') return descriptionScore(value);
  if (Array.isArray(value)) {
    if (!value.length) return 0;
    const itemScores=value.map((item)=>typeof item==='string'?descriptionScore(item):descriptionScore(item.description||item.reason||'') );
    const richness=Math.min(1,value.length/(key==='gameplay_loops'?3:2));
    return 0.75*(itemScores.reduce((sum,item)=>sum+item,0)/itemScores.length)+0.25*richness;
  }
  if (value && typeof value==='object') {
    const description=descriptionScore(value.description||'');
    const informative=Object.entries(value).filter(([name,item])=>name!=='description'&&!isEmptyProfileValue(item)).length;
    const breadth=Math.min(1,informative/3);
    return 0.75*description+0.25*breadth;
  }
  return 0;
}
function validateProfileContent(profile, { sourceCount = null } = {}) {
  if (!profile||typeof profile!=='object'||Array.isArray(profile)) throw new Error('Profil IA invalide');
  assertSchema(profile,PROFILE_FORMAT,'profil');
  for (const key of Object.keys(PROFILE_FIELDS)) {
    const value=profile[key]; const evidence=profile.field_status[key];
    assertNoReservedProfileValues(value,`profil.${key}`);
    if (evidence.status==='unknown') {
      if (!isEmptyProfileValue(value)) throw new Error(`${key}: un statut unknown exige une valeur vide (null ou [])`);
      if (evidence.source_ids.length) throw new Error(`${key}: unknown ne doit pas citer de source`);
    } else {
      if (isEmptyProfileValue(value)) throw new Error(`${key}: contenu manquant pour le statut ${evidence.status}`);
      if (evidence.status!=='human_corrected' && !evidence.source_ids.length) throw new Error(`${key}: le statut ${evidence.status} exige au moins une source`);
      if (semanticDimensionScore(key,value)===0 && !['uncertainties'].includes(key)) throw new Error(`${key}: contenu trop générique pour décrire l’expérience`);
    }
    for (const id of evidence.source_ids) {
      const match=/^SOURCE-([1-9][0-9]*)$/.exec(id);
      if (!match) throw new Error(`${key}: identifiant de source invalide (${id})`);
      if (sourceCount!=null && Number(match[1])>sourceCount) throw new Error(`${key}: source inexistante (${id})`);
    }
  }
  return true;
}
function assessProfileContent(profile, dossier = {}) {
  const weights={summary:10,gameplay_loops:15,narrative:10,exploration:10,structure:10,atmosphere_themes:10,pace:10,progression:10,difficulty_friction:10,multiplayer:5};
  let weighted=0,total=0,evidenced=0,evidenceTotal=0;
  for (const [key,weight] of Object.entries(weights)) {
    total+=weight; weighted+=semanticDimensionScore(key,profile[key])*weight;
    const evidence=profile.field_status?.[key]; evidenceTotal+=weight;
    if (evidence && evidence.status!=='unknown' && evidence.status!=='contradictory' && (evidence.source_ids?.length||evidence.status==='human_corrected')) evidenced+=weight;
  }
  const semanticScore=Math.round(100*weighted/Math.max(total,1));
  const evidenceCoverage=Math.round(100*evidenced/Math.max(evidenceTotal,1));
  const profileCompletenessScore=Math.round(semanticScore*0.85+evidenceCoverage*0.15);
  const profileQuality=profileCompletenessScore>=80?'complete':profileCompletenessScore>=55?'partial':'insufficient';
  return { documentQuality:dossier.quality_status||'insufficient',documentCompletenessScore:Number(dossier.completeness_score||0),profileQuality,profileCompletenessScore,semanticScore,evidenceCoverage };
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot=0, aa=0, bb=0;
  for (let index=0; index<a.length; index+=1) { const x=Number(a[index]); const y=Number(b[index]); if (!Number.isFinite(x)||!Number.isFinite(y)) return null; dot+=x*y; aa+=x*x; bb+=y*y; }
  return aa && bb ? dot / (Math.sqrt(aa)*Math.sqrt(bb)) : null;
}
function profileText(profile) { return Object.keys(PROFILE_FIELDS).map((key) => primitiveText(profile?.[key])).filter(Boolean).join('\n'); }
function compareDimensions(a, b) {
  const keys = ['narrative','exploration','structure','pace','progression','difficulty_friction','multiplayer']; const dimensions = {};
  for (const key of keys) { const av=primitiveText(a?.[key]).toLowerCase(); const bv=primitiveText(b?.[key]).toLowerCase(); const wordsA=new Set(av.match(/[a-zà-ÿ]{4,}/g)||[]); const wordsB=new Set(bv.match(/[a-zà-ÿ]{4,}/g)||[]); const common=[...wordsA].filter((word)=>wordsB.has(word)); dimensions[key]=wordsA.size||wordsB.size ? common.length/Math.max(wordsA.size,wordsB.size,1) : 0; }
  return dimensions;
}
function isPrivateIp(address) {
  if (!address) return true;
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (!net.isIPv4(address)) return false;
  const [a,b] = address.split('.').map(Number);
  return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || a>=224;
}
function sourceRelevance(gameName, result, facet = 'gameplay') {
  const title=String(result.title||'').toLowerCase(); const url=String(result.url||'').toLowerCase(); const content=String(result.content||'').toLowerCase(); const haystack=`${title} ${url} ${content}`; const normalized=String(gameName||'').toLowerCase(); const important=normalized.split(/[^a-z0-9à-ÿ]+/).filter((word)=>word.length>2);
  let score=important.length && important.every((word)=>haystack.includes(word)) ? 4 : important.filter((word)=>haystack.includes(word)).length/Math.max(important.length,1)*2;
  if (/gameplay|mechanic|progress|review|test|critique|walkthrough|feature|official|developer|campaign|story|exploration|pacing|rythme|ambiance/.test(haystack)) score+=2;
  if (facet==='official' && /official|developer|steam|studio|publisher/.test(haystack)) score+=1.5;
  if (/\bdlc\b|downloadable content|expansion|extension|soundtrack|skin pack/.test(haystack) && !/\bdlc\b|expansion/.test(normalized)) score-=4;
  if (/instant-gaming|g2a\.|cdkeys|allkeyshop|amazon\.|ebay\.|jeuxvideo\.com\/tous-les-jeux|list(e|ing)|catalog(ue)?|top \d+/.test(haystack)) score-=3;
  if (/store\.steampowered\.com|igdb\.com|wikipedia\.org|pcgamingwiki\.com|developer|official/.test(url)) score+=1;
  if (content.length<80) score-=1;
  return Number(score.toFixed(2));
}
class ServiceError extends Error { constructor(message, { httpStatus = null, code = 'SERVICE_ERROR', provider = null } = {}) { super(message); this.name='ServiceError'; this.httpStatus=httpStatus; this.code=code; this.provider=provider; } }

class AiEngine {
  constructor({ database, fetchImpl = fetch, env = process.env, logger = console, dnsLookup = dns.lookup }) {
    this.database=database; this.fetch=fetchImpl; this.env=env; this.logger=logger; this.dnsLookup=dnsLookup; this.running=false; this.stopped=false;
    this.config={ollamaBaseUrl:normalizeBaseUrl(env.OLLAMA_BASE_URL||'http://127.0.0.1:11434'),ollamaExplicitlyConfigured:Boolean(String(env.OLLAMA_BASE_URL||'').trim()),analysisModel:env.AI_ANALYSIS_MODEL||'qwen3:32b',embeddingModel:env.AI_EMBEDDING_MODEL||'embeddinggemma',embeddingDimensions:Number(env.AI_EMBEDDING_DIMENSIONS||768),searxngBaseUrl:normalizeBaseUrl(env.SEARXNG_BASE_URL||''),searxngLanguage:env.SEARXNG_LANGUAGE||'fr-FR',promptVersion:'backlog-v0.9.2-profile-1',similarityVersion:'backlog-v0.9.2-cosine-1',maxWebPages:Math.min(12,Math.max(0,Number(env.AI_MAX_WEB_PAGES||8))),maxPageBytes:Math.min(2_000_000,Math.max(100_000,Number(env.AI_MAX_PAGE_BYTES||750_000)))};
  }
  start() { this.stopped=false; this.pump(); }
  stop() { this.stopped=true; }
  enqueue(appId, operation='full') { const job=this.database.createJob(appId,operation); this.pump(); return job; }
  async jsonRequest(url, options={}, provider='service') {
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),Number(options.timeoutMs||60000));
    try { const response=await this.fetch(url,{...options,signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',...(options.headers||{})}}); const text=await response.text(); let payload; try { payload=text?JSON.parse(text):{}; } catch { throw new ServiceError(`${provider}: réponse JSON invalide`,{httpStatus:response.status,code:'INVALID_JSON',provider}); } if(!response.ok)throw new ServiceError(`${provider}: HTTP ${response.status} — ${payload.error||payload.message||text.slice(0,300)}`,{httpStatus:response.status,code:'HTTP_ERROR',provider}); return payload; }
    catch(error){ if(error.name==='AbortError')throw new ServiceError(`${provider}: délai d'attente dépassé`,{code:'TIMEOUT',provider}); if(error instanceof ServiceError)throw error; throw new ServiceError(`${provider}: ${error.message||'service inaccessible'}`,{code:error.code||'NETWORK_ERROR',provider}); }
    finally{clearTimeout(timeout);}
  }
  async testConnection() {
    const started=Date.now(); const result=(data)=>({...data,duration_ms:Date.now()-started,analysis_model:this.config.analysisModel,embedding_model:this.config.embeddingModel,searxng_configured:Boolean(this.config.searxngBaseUrl)}); let parsed;
    try { parsed=new URL(this.config.ollamaBaseUrl); if(!['http:','https:'].includes(parsed.protocol))throw new Error('protocole non pris en charge'); } catch(error){return result({ok:false,step:'configuration',message:`URL Ollama invalide : ${error.message}`,http_status:null});}
    let tags; try{tags=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/tags`,{timeoutMs:Number(this.env.AI_DIAGNOSTIC_TIMEOUT_MS||15000)},'Ollama');}catch(error){return result({ok:false,step:'reachability',message:error.code==='TIMEOUT'?'Délai dépassé : le serveur Ollama ne répond pas.':`Serveur Ollama inaccessible à ${parsed.host}.`,detail:error.message,http_status:error.httpStatus||null});}
    const models=(tags.models||[]).map((model)=>model.name||model.model).filter(Boolean); const available=(wanted)=>models.some((name)=>name===wanted||name.startsWith(`${wanted}:`)||wanted.startsWith(`${name}:`)); const missing=[this.config.analysisModel,this.config.embeddingModel].filter((model)=>!available(model));
    if(missing.length)return result({ok:false,step:'model_check',message:`Modèle(s) absent(s) : ${missing.join(', ')}`,http_status:404,models});
    try{const generation=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/chat`,{method:'POST',body:JSON.stringify({model:this.config.analysisModel,stream:false,think:false,messages:[{role:'user',content:'Réponds uniquement avec le mot OK.'}],options:{temperature:0,num_predict:64}}),timeoutMs:Number(this.env.AI_DIAGNOSTIC_GENERATION_TIMEOUT_MS||60000)},'Ollama/génération');const content=String(generation?.message?.content||'').trim();if(!content){const hasThinking=Boolean(String(generation?.message?.thinking||generation?.thinking||'').trim());throw new ServiceError(hasThinking?'Ollama a renvoyé un raisonnement, mais aucun contenu final dans message.content.':'Ollama a renvoyé une génération vide dans message.content.',{code:'EMPTY_RESPONSE',provider:'Ollama'});}}catch(error){return result({ok:false,step:'generation',message:error.code==='TIMEOUT'?'La génération minimale a dépassé le délai.':'La génération minimale a échoué.',detail:error.message,http_status:error.httpStatus||null,models});}
    return result({ok:true,step:'completed',message:'Ollama répond, les modèles sont présents et la génération minimale fonctionne.',http_status:200,models});
  }
  async pump(){if(this.running||this.stopped)return;this.running=true;try{while(!this.stopped){const job=this.database.nextQueuedJob();if(!job)break;await this.process(job);await sleep(100);}}finally{this.running=false;}}
  async process(job){let step='initialization';const operation=job.operation||'full';try{this.database.updateJob(job.id,{status:'running',current_step:step,message:`Préparation : ${operation}`,attempts:Number(job.attempts||0)+1,started_at:new Date().toISOString(),error_code:null,error_detail:null});const game=this.database.getGame(job.app_id);if(!game)throw new Error(`Jeu ${job.app_id} introuvable dans la bibliothèque existante`);let dossier=this.database.getLatestDossier(game.appId);
      if(operation==='full'||operation==='documents'){step='documents';this.progress(job.id,step,`Construction du dossier documentaire de ${game.name}`);dossier=await this.collectDossier(game);dossier=this.database.insertDossier(game.appId,dossier);if(operation==='documents')return this.completeJob(job.id,'Dossier documentaire actualisé',null);}
      if(!dossier)throw new Error('Aucun dossier documentaire. Lancez d’abord la collecte documentaire.');
      if(operation==='embedding'){const bundle=this.database.getProfileBundle(game.appId);const version=bundle?.candidate||bundle?.active;if(!version)throw new Error('Aucun profil disponible pour générer un embedding');if(version.document_quality==='insufficient'||version.profile_quality==='insufficient')throw new Error('Embedding refusé : dossier ou profil sémantiquement insuffisant');step='embedding';this.progress(job.id,step,`Création de l'embedding avec ${this.config.embeddingModel}`);const embedding=await this.embed(profileText(version.profile));this.checkEmbedding(embedding);this.database.updateProfileEmbedding(version.id,embedding,this.config.embeddingModel);return this.completeJob(job.id,'Embedding généré indépendamment',version.id);}
      step='analysis';this.progress(job.id,step,`Génération du profil de ${game.name} avec ${this.config.analysisModel}`);const profile=await this.generateProfile(game,dossier.sources);this.validateProfile(profile,{sourceCount:dossier.sources.length});const assessment=this.assessProfile(profile,dossier);let embedding=null;if(operation==='full'&&assessment.documentQuality!=='insufficient'&&assessment.profileQuality!=='insufficient'){step='embedding';this.progress(job.id,step,`Création de l'embedding avec ${this.config.embeddingModel}`);embedding=await this.embed(profileText(profile));this.checkEmbedding(embedding);}
      const active=this.database.getActiveProfile(game.appId);step='storage';this.progress(job.id,step,'Enregistrement d’une nouvelle version sans écraser la version active');const version=this.database.insertProfileVersion({appId:game.appId,profile,embedding,sources:dossier.sources,model:this.config.analysisModel,embeddingModel:embedding?this.config.embeddingModel:null,promptVersion:this.config.promptVersion,basedOnVersionId:active?.id||null,lifecycleState:active?'draft':'active',qualityStatus:(assessment.documentQuality==='insufficient'||assessment.profileQuality==='insufficient')?'needs_review':'generated',documentQuality:assessment.documentQuality,completenessScore:assessment.documentCompletenessScore,profileSchemaVersion:profile.schema_version,profileQuality:assessment.profileQuality,profileCompletenessScore:assessment.profileCompletenessScore,semanticQualityScore:assessment.semanticScore,evidenceCoverage:assessment.evidenceCoverage,provenance:profile.field_status||{},sourceFingerprint:dossier.source_fingerprint});if(embedding){step='similarity';this.progress(job.id,step,'Recalcul des similarités');this.database.replaceSimilarities(game.appId,version.id,this.computeSimilarities(game.appId,profile,embedding));}const message=(assessment.documentQuality==='insufficient'||assessment.profileQuality==='insufficient')?'Profil enregistré comme insuffisant, sans embedding définitif':(active?'Nouvelle version prête à être comparée; la version active est conservée':'Profil généré et prêt à être révisé');return this.completeJob(job.id,message,version.id);
    }catch(error){this.logger.error?.(`Analyse ${job.app_id} échouée à l'étape ${step}:`,error);this.database.updateJob(job.id,{status:'error',current_step:step,message:'Analyse échouée',error_code:error.code||error.name||'Error',error_detail:String(error.stack||error.message||error),finished_at:new Date().toISOString()});}}
  completeJob(id,message,targetVersionId){return this.database.updateJob(id,{status:'completed',current_step:'completed',message,finished_at:new Date().toISOString(),target_version_id:targetVersionId||null});}
  progress(id,step,message){this.database.updateJob(id,{current_step:step,message});}
  checkEmbedding(embedding){if(this.config.embeddingDimensions&&embedding.length!==this.config.embeddingDimensions)throw new Error(`Dimension d'embedding inattendue: ${embedding.length}, attendu ${this.config.embeddingDimensions}`);}
  providerDocuments(game){const raw=game.raw||{};const candidates=['provider_cache','provider_cache_json','providers','providers_json'].map((key)=>parseMaybeJson(raw[key],null)).filter(Boolean);const providers=candidates.flatMap((value)=>Array.isArray(value)?value:Object.values(value||{}));const documents=[];for(const provider of providers){if(!provider||typeof provider!=='object'||provider.found===false)continue;const type=String(provider.provider||provider.source||'provider').toLowerCase();const payload={provider:type,provider_id:provider.provider_id||provider.id||null,title:provider.title||game.name,developer:provider.developer||provider.developers||null,genres:provider.genres||[],themes:provider.themes||[],platforms:provider.platforms||[],summary:provider.summary||null,storyline:provider.storyline||null,game_modes:provider.game_modes||provider.modes||[],player_perspectives:provider.player_perspectives||provider.perspectives||[],game_type:provider.game_type||provider.type||null};const text=Object.entries(payload).filter(([,value])=>value!=null&&primitiveText(value)).map(([key,value])=>`${key}: ${primitiveText(value)}`).join('\n');if(text)documents.push({sourceType:type,sourceKey:`${type}:${payload.provider_id||game.appId}`,title:`Données ${type.toUpperCase()} — ${payload.title}`,collectedAt:provider.fetched_at||new Date().toISOString(),excerpt:text.slice(0,12000),supports:['identity','summary','narrative','genres','themes','platforms','multiplayer','structure'],confidence:'high',relevanceScore:8,retrievalStatus:'structured'});}return documents;}
  async collectDossier(game){const collectedAt=new Date().toISOString();const sources=[{sourceType:'library',sourceKey:`library:${game.appId}`,title:'Métadonnées de la bibliothèque Backlog',collectedAt,excerpt:JSON.stringify({name:game.name,genres:game.genres,themes:game.themes,platforms:game.platforms,playtimeMinutes:game.playtimeMinutes,applicationType:game.applicationType}),supports:['identity','genres','themes','platforms'],confidence:'high',relevanceScore:9,retrievalStatus:'structured'},...this.providerDocuments(game)];
    try{const payload=await this.jsonRequest(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(game.appId)}&l=french&cc=fr`,{timeoutMs:20000},'Steam');const data=payload?.[game.appId]?.data;if(data){const structured={name:data.name,short_description:stripHtml(data.short_description),about:stripHtml(data.about_the_game||data.detailed_description),developers:data.developers||[],publishers:data.publishers||[],genres:(data.genres||[]).map((item)=>item.description),categories:(data.categories||[]).map((item)=>item.description),recommendations:data.recommendations?.total||null,release_date:data.release_date?.date||null};sources.push({sourceType:'steam',sourceKey:`steam:${game.appId}`,title:`Page Steam — ${data.name||game.name}`,url:`https://store.steampowered.com/app/${game.appId}`,collectedAt,excerpt:Object.entries(structured).filter(([,value])=>primitiveText(value)).map(([key,value])=>`${key}: ${primitiveText(value)}`).join('\n').slice(0,18000),supports:['summary','gameplay_loops','multiplayer','genres','progression','structure','developer'],confidence:'high',relevanceScore:10,retrievalStatus:'structured'});}}catch(error){this.logger.warn?.(`Steam indisponible pour ${game.appId}: ${error.message}`);}
    if(this.config.searxngBaseUrl){const discovered=[];for(const facet of QUERY_FACETS){try{const url=new URL(`${this.config.searxngBaseUrl}/search`);url.searchParams.set('q',`"${game.name}" ${facet.suffix}`);url.searchParams.set('format','json');url.searchParams.set('language',this.config.searxngLanguage);const payload=await this.jsonRequest(url,{timeoutMs:30000},'SearXNG');for(const result of(payload.results||[]).slice(0,8)){const score=sourceRelevance(game.name,result,facet.key);if(score<2.5||!result.url)continue;discovered.push({...result,facet,score});}}catch(error){this.logger.warn?.(`SearXNG ${facet.key} indisponible pour ${game.appId}: ${error.message}`);}}const seen=new Set();const deduped=discovered.sort((a,b)=>b.score-a.score).filter((item)=>{const key=String(item.url).replace(/#.*$/,'');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,this.config.maxWebPages);for(const item of deduped){let excerpt=String(item.content||'').slice(0,3000);let status='snippet';try{const page=await this.fetchUsefulPage(item.url);if(page.length>=250){excerpt=page.slice(0,14000);status='full_text';}}catch(error){this.logger.warn?.(`Page ignorée ${item.url}: ${error.message}`);status=`snippet:${error.code||'fetch_error'}`;}sources.push({sourceType:'web',sourceKey:`web:${sha256(item.url).slice(0,24)}`,title:item.title||item.url,url:item.url,collectedAt,supports:item.facet.supports,excerpt,confidence:item.score>=6?'high':item.score>=4?'medium':'low',relevanceScore:item.score,retrievalStatus:status});}}
    const quality=this.assessDossier(sources);const fingerprint=sha256(JSON.stringify(sources.map((source)=>[source.sourceKey,source.collectedAt,sha256(source.excerpt||'')])));return{sources,quality_status:quality.status,completeness_score:quality.score,dimensions:quality.dimensions,notes:quality.notes,source_fingerprint:fingerprint,created_at:collectedAt};}
  async validateExternalUrl(value){let url;try{url=new URL(value);}catch{throw Object.assign(new Error('URL invalide'),{code:'UNSAFE_URL'});}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Object.assign(new Error('URL externe non autorisée'),{code:'UNSAFE_URL'});if(['localhost','localhost.localdomain'].includes(url.hostname.toLowerCase()))throw Object.assign(new Error('Hôte local interdit'),{code:'UNSAFE_URL'});const direct=net.isIP(url.hostname);const addresses=direct?[{address:url.hostname}]:await this.dnsLookup(url.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some((entry)=>isPrivateIp(entry.address)))throw Object.assign(new Error('Adresse privée ou réservée interdite'),{code:'UNSAFE_URL'});return url;}
  async fetchUsefulPage(value){let url=await this.validateExternalUrl(value);for(let redirect=0;redirect<4;redirect+=1){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),Number(this.env.AI_PAGE_TIMEOUT_MS||15000));try{const response=await this.fetch(url,{signal:controller.signal,redirect:'manual',headers:{accept:'text/html, text/plain;q=0.9','user-agent':'Backlog/0.9.2 documentary-fetcher'}});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw new Error('Redirection sans destination');url=await this.validateExternalUrl(new URL(location,url).toString());continue;}if(!response.ok)throw new ServiceError(`Page HTTP ${response.status}`,{httpStatus:response.status,code:'HTTP_ERROR',provider:'web'});const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html')&&!type.includes('text/plain')&&!type.includes('application/xhtml'))throw Object.assign(new Error('Type de contenu non textuel'),{code:'UNSUPPORTED_CONTENT'});const length=Number(response.headers.get('content-length')||0);if(length>this.config.maxPageBytes)throw Object.assign(new Error('Page trop volumineuse'),{code:'PAGE_TOO_LARGE'});const text=await response.text();if(Buffer.byteLength(text)>this.config.maxPageBytes)throw Object.assign(new Error('Page trop volumineuse'),{code:'PAGE_TOO_LARGE'});return stripHtml(text);}catch(error){if(error.name==='AbortError')throw Object.assign(new Error('Délai de téléchargement dépassé'),{code:'TIMEOUT'});throw error;}finally{clearTimeout(timeout);}}throw Object.assign(new Error('Trop de redirections'),{code:'TOO_MANY_REDIRECTS'});}
  assessDossier(sources){const dimensions={};for(const key of Object.keys(PROFILE_FIELDS))dimensions[key]=false;for(const source of sources)for(const key of source.supports||[])if(key in dimensions)dimensions[key]=true;const covered=Object.values(dimensions).filter(Boolean).length;const rich=sources.filter((source)=>String(source.excerpt||'').length>=500).length;const trusted=sources.filter((source)=>source.confidence==='high').length;const score=Math.round(Math.min(100,(covered/Object.keys(dimensions).length)*55+Math.min(rich,5)*6+Math.min(trusted,3)*5));const status=score>=78?'complete':score>=48?'partial':'insufficient';const notes=[];if(!dimensions.gameplay_loops)notes.push('Gameplay non documenté');if(!dimensions.progression)notes.push('Progression non documentée');if(rich<2)notes.push('Trop peu de contenu détaillé');if(!sources.some((source)=>source.sourceType==='steam'))notes.push('Description Steam indisponible');return{status,score,dimensions,notes};}
  async generateProfile(game,sources){const dossier=sources.map((source,index)=>`SOURCE-${index+1} [${source.sourceType||source.source_type||'source'}; confiance=${source.confidence||'unknown'}] ${source.title}\n${source.excerpt||''}`).join('\n\n');const system=`Tu construis un profil d’expérience vidéoludique vérifiable en français, conforme au schéma JSON fourni. Les caractéristiques décrivent le jeu; field_status décrit uniquement comment elles sont connues. Il est interdit d’utiliser documented, interpreted, unknown, contradictory ou human_corrected comme valeur de caractéristique. Pour une dimension réellement inconnue, renvoie null (ou [] pour une liste), status=unknown, source_ids=[] et explique la lacune dans note et uncertainties. Une absence établie (par exemple aucune campagne centrale) est une caractéristique connue: décris-la avec les valeurs prévues, ne la marque pas unknown. Ne déclare une contradiction que si deux sources parlent de la même mesure, du même périmètre et de la même période. Ne confonds jamais temps de jeu personnel, durée de session, campagne, objectif particulier et complétion. Classe les éléments distinctifs par rôle: core, supporting, optional ou technical; une fonction technique ou un outil de développement ne doit pas devenir central sans preuve. Chaque description doit être précise, discriminante et expliquer l’expérience concrète. N’invente rien et réponds uniquement avec l’objet JSON.`;const user=`Jeu: ${game.name} (Steam AppID ${game.appId}).\n\nDOSSIER DOCUMENTAIRE:\n${dossier.slice(0,52000)}\n\nProduis le profil schema_version ${PROFILE_SCHEMA_VERSION}. Cite uniquement les SOURCE-N réellement utilisées dans field_status.`;const payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/chat`,{method:'POST',body:JSON.stringify({model:this.config.analysisModel,stream:false,think:false,format:PROFILE_FORMAT,messages:[{role:'system',content:system},{role:'user',content:user}],options:{temperature:0.1}}),timeoutMs:Number(this.env.AI_ANALYSIS_TIMEOUT_MS||480000)},'Ollama/Qwen');const content=payload?.message?.content||payload?.response;if(!content)throw new Error('Ollama n’a renvoyé aucun profil');try{return typeof content==='string'?JSON.parse(content):content;}catch{const match=String(content).match(/\{[\s\S]*\}/);if(!match)throw new Error('Profil Qwen non JSON');return JSON.parse(match[0]);}}
  validateProfile(profile,options={}){return validateProfileContent(profile,options);}
  assessProfile(profile,dossier){return assessProfileContent(profile,dossier);}
  async embed(input){let payload;try{payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/embed`,{method:'POST',body:JSON.stringify({model:this.config.embeddingModel,input}),timeoutMs:Number(this.env.AI_EMBEDDING_TIMEOUT_MS||120000)},'Ollama/Embedding');}catch(error){payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/embeddings`,{method:'POST',body:JSON.stringify({model:this.config.embeddingModel,prompt:input}),timeoutMs:Number(this.env.AI_EMBEDDING_TIMEOUT_MS||120000)},'Ollama/Embedding');}const vector=payload.embedding||payload.embeddings?.[0];if(!Array.isArray(vector)||!vector.length)throw new Error('Embedding absent');return vector.map(Number);}
  computeSimilarities(appId,profile,embedding){return this.database.activeEmbeddings(appId).map((candidate)=>{const score=cosine(embedding,candidate.embedding);if(score==null)return null;const dimensions=compareDimensions(profile,candidate.profile);const ranked=Object.entries(dimensions).sort((a,b)=>b[1]-a[1]);return{appId:candidate.app_id,versionId:candidate.id,score,reasons:ranked.slice(0,3).filter(([,value])=>value>0).map(([key])=>key),differences:ranked.slice(-2).filter(([,value])=>value<0.2).map(([key])=>key),dimensions};}).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,20);}
}
module.exports={AiEngine,cosine,profileText,PROFILE_SCHEMA,PROFILE_FORMAT,PROFILE_SCHEMA_VERSION,PROFILE_FIELDS,sourceRelevance,isPrivateIp,validateProfileContent,assessProfileContent,semanticDimensionScore};
