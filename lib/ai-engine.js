'use strict';

const crypto = require('node:crypto');

const PROFILE_SCHEMA = {
  summary: '', gameplay_loops: [], narrative: '', exploration: '', structure: '',
  atmosphere_themes: [], pace: '', progression: '', difficulty_friction: '',
  multiplayer: '', distinctive_elements: [], uncertainties: []
};

function normalizeBaseUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot=0, aa=0, bb=0;
  for (let index=0; index<a.length; index+=1) { const x=Number(a[index]); const y=Number(b[index]); if (!Number.isFinite(x)||!Number.isFinite(y)) return null; dot+=x*y; aa+=x*x; bb+=y*y; }
  return aa && bb ? dot / (Math.sqrt(aa)*Math.sqrt(bb)) : null;
}

function profileText(profile) {
  return [profile.summary, ...(profile.gameplay_loops||[]), profile.narrative, profile.exploration, profile.structure, ...(profile.atmosphere_themes||[]), profile.pace, profile.progression, profile.difficulty_friction, profile.multiplayer, ...(profile.distinctive_elements||[])].filter(Boolean).join('\n');
}

function compareDimensions(a, b) {
  const keys = ['narrative','exploration','structure','pace','progression','difficulty_friction','multiplayer'];
  const dimensions = {};
  for (const key of keys) {
    const av=String(a[key]||'').toLowerCase(); const bv=String(b[key]||'').toLowerCase();
    const wordsA=new Set(av.match(/[a-zà-ÿ]{4,}/g)||[]); const wordsB=new Set(bv.match(/[a-zà-ÿ]{4,}/g)||[]);
    const common=[...wordsA].filter((word)=>wordsB.has(word));
    dimensions[key]=wordsA.size||wordsB.size ? common.length/Math.max(wordsA.size,wordsB.size,1) : 0;
  }
  return dimensions;
}

class AiEngine {
  constructor({ database, fetchImpl = fetch, env = process.env, logger = console }) {
    this.database=database; this.fetch=fetchImpl; this.env=env; this.logger=logger; this.running=false; this.stopped=false;
    this.config={
      ollamaBaseUrl: normalizeBaseUrl(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'),
      analysisModel: env.AI_ANALYSIS_MODEL || 'qwen3:32b',
      embeddingModel: env.AI_EMBEDDING_MODEL || 'embeddinggemma',
      embeddingDimensions: Number(env.AI_EMBEDDING_DIMENSIONS || 768),
      searxngBaseUrl: normalizeBaseUrl(env.SEARXNG_BASE_URL || ''),
      searxngLanguage: env.SEARXNG_LANGUAGE || 'fr-FR',
      promptVersion: 'backlog-v0.9-profile-1',
      similarityVersion: 'backlog-v0.9-cosine-1'
    };
  }

  start() { this.stopped=false; this.pump(); }
  stop() { this.stopped=true; }
  enqueue(appId) { const job=this.database.createJob(appId); this.pump(); return job; }

  async jsonRequest(url, options={}, provider='service') {
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),Number(options.timeoutMs||60000));
    try {
      const response=await this.fetch(url,{...options,signal:controller.signal,headers:{'content-type':'application/json',...(options.headers||{})}});
      const text=await response.text(); let payload;
      try { payload=text?JSON.parse(text):{}; } catch { throw new Error(`${provider}: réponse JSON invalide`); }
      if (!response.ok) throw new Error(`${provider}: HTTP ${response.status} — ${payload.error||payload.message||text.slice(0,300)}`);
      return payload;
    } catch (error) {
      if (error.name==='AbortError') throw new Error(`${provider}: délai d'attente dépassé`);
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async testConnection() {
    const payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/tags`,{},'Ollama');
    const models=(payload.models||[]).map((model)=>model.name||model.model);
    const available=(wanted)=>models.some((name)=>name===wanted||name.startsWith(`${wanted}:`)||wanted.startsWith(`${name}:`));
    return { analysisModel:this.config.analysisModel, embeddingModel:this.config.embeddingModel, analysisModelAvailable:available(this.config.analysisModel), embeddingModelAvailable:available(this.config.embeddingModel), models, searxngConfigured:Boolean(this.config.searxngBaseUrl) };
  }

  async pump() {
    if (this.running||this.stopped) return;
    this.running=true;
    try {
      while (!this.stopped) {
        const job=this.database.nextQueuedJob();
        if (!job) break;
        await this.process(job);
        await sleep(100);
      }
    } finally { this.running=false; }
  }

  async process(job) {
    let step='initialization';
    try {
      this.database.updateJob(job.id,{status:'running',current_step:step,message:'Préparation de la réanalyse',attempts:Number(job.attempts||0)+1,started_at:new Date().toISOString(),error_code:null,error_detail:null});
      const game=this.database.getGame(job.app_id);
      if (!game) throw new Error(`Jeu ${job.app_id} introuvable dans la bibliothèque existante`);
      step='sources'; this.progress(job.id,step,`Construction du dossier documentaire de ${game.name}`);
      const sources=await this.collectSources(game);
      step='analysis'; this.progress(job.id,step,`Génération du profil de ${game.name} avec ${this.config.analysisModel}`);
      const profile=await this.generateProfile(game,sources);
      this.validateProfile(profile);
      step='embedding'; this.progress(job.id,step,`Création de l'embedding avec ${this.config.embeddingModel}`);
      const embedding=await this.embed(profileText(profile));
      if (this.config.embeddingDimensions && embedding.length!==this.config.embeddingDimensions) throw new Error(`Dimension d'embedding inattendue: ${embedding.length}, attendu ${this.config.embeddingDimensions}`);
      const active=this.database.getActiveProfile(game.appId);
      step='storage'; this.progress(job.id,step,'Enregistrement d’une nouvelle version sans écraser la version active');
      const version=this.database.insertProfileVersion({appId:game.appId,profile,embedding,sources,model:this.config.analysisModel,embeddingModel:this.config.embeddingModel,promptVersion:this.config.promptVersion,basedOnVersionId:active?.id||null,lifecycleState:active?'draft':'active',qualityStatus:'generated',sourceFingerprint:sha256(JSON.stringify(sources.map((source)=>[source.sourceKey,source.collectedAt]))) });
      step='similarity'; this.progress(job.id,step,'Recalcul des similarités');
      const candidates=this.computeSimilarities(game.appId,profile,embedding);
      this.database.replaceSimilarities(game.appId,version.id,candidates);
      this.database.updateJob(job.id,{status:'completed',current_step:'completed',message:active?'Nouvelle version prête à être révisée; la version active est conservée':'Profil généré et prêt à être révisé',finished_at:new Date().toISOString(),target_version_id:version.id});
    } catch (error) {
      this.logger.error?.(`Analyse ${job.app_id} échouée à l'étape ${step}:`,error);
      this.database.updateJob(job.id,{status:'error',current_step:step,message:'Analyse échouée',error_code:error.name||'Error',error_detail:String(error.stack||error.message||error),finished_at:new Date().toISOString()});
    }
  }

  progress(id,step,message){ this.database.updateJob(id,{current_step:step,message}); }

  async collectSources(game) {
    const sources=[{sourceType:'library',sourceKey:`library:${game.appId}`,title:'Métadonnées de la bibliothèque Backlog',collectedAt:new Date().toISOString(),excerpt:JSON.stringify({name:game.name,genres:game.genres,themes:game.themes,platforms:game.platforms,playtimeMinutes:game.playtimeMinutes}),supports:['identity','genres','platforms']}];
    try {
      const payload=await this.jsonRequest(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(game.appId)}&l=french`,{timeoutMs:20000},'Steam');
      const data=payload?.[game.appId]?.data;
      if (data) sources.push({sourceType:'steam',sourceKey:`steam:${game.appId}`,title:`Page Steam — ${data.name||game.name}`,url:`https://store.steampowered.com/app/${game.appId}`,collectedAt:new Date().toISOString(),excerpt:[data.short_description,data.about_the_game].filter(Boolean).join('\n').replace(/<[^>]+>/g,' ').slice(0,9000),supports:['summary','gameplay_loops','multiplayer','genres']});
    } catch (error) { this.logger.warn?.(`Steam indisponible pour ${game.appId}: ${error.message}`); }
    if (this.config.searxngBaseUrl && sources.map((source)=>source.excerpt||'').join('').length<5000) {
      try {
        const url=new URL(`${this.config.searxngBaseUrl}/search`); url.searchParams.set('q',`${game.name} jeu gameplay narration test`); url.searchParams.set('format','json'); url.searchParams.set('language',this.config.searxngLanguage);
        const payload=await this.jsonRequest(url,{timeoutMs:30000},'SearXNG');
        for (const result of (payload.results||[]).slice(0,5)) sources.push({sourceType:'searxng',sourceKey:`searxng:${sha256(`${result.url||''}:${result.title||''}`).slice(0,24)}`,title:result.title||result.url,url:result.url||null,collectedAt:new Date().toISOString(),excerpt:String(result.content||'').slice(0,2400),supports:['summary','narrative','atmosphere_themes','distinctive_elements']});
      } catch (error) { this.logger.warn?.(`SearXNG indisponible pour ${game.appId}: ${error.message}`); }
    }
    return sources;
  }

  async generateProfile(game,sources) {
    const dossier=sources.map((source,index)=>`SOURCE ${index+1} [${source.sourceType}] ${source.title}\n${source.excerpt||''}`).join('\n\n');
    const system=`Tu construis une base de connaissances vérifiable sur les jeux vidéo. Réponds uniquement avec un objet JSON. Sépare les faits des interprétations, n'invente rien et place toute incertitude dans uncertainties. Les clés obligatoires sont: ${Object.keys(PROFILE_SCHEMA).join(', ')}. Les listes sont gameplay_loops, atmosphere_themes, distinctive_elements et uncertainties; les autres valeurs sont des chaînes en français.`;
    const user=`Jeu: ${game.name} (Steam AppID ${game.appId}).\n\nDOSSIER:\n${dossier.slice(0,28000)}\n\nProduis un profil précis, discriminant et non générique.`;
    const format={type:'object',properties:Object.fromEntries(Object.entries(PROFILE_SCHEMA).map(([key,value])=>[key,Array.isArray(value)?{type:'array',items:{type:'string'}}:{type:'string'}])),required:Object.keys(PROFILE_SCHEMA),additionalProperties:false};
    const payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/chat`,{method:'POST',body:JSON.stringify({model:this.config.analysisModel,stream:false,format,messages:[{role:'system',content:system},{role:'user',content:user}],options:{temperature:0.2}}),timeoutMs:Number(this.env.AI_ANALYSIS_TIMEOUT_MS||480000)},'Ollama/Qwen');
    const content=payload?.message?.content||payload?.response;
    if (!content) throw new Error('Ollama n’a renvoyé aucun profil');
    try { return typeof content==='string'?JSON.parse(content):content; }
    catch { const match=String(content).match(/\{[\s\S]*\}/); if (!match) throw new Error('Profil Qwen non JSON'); return JSON.parse(match[0]); }
  }

  validateProfile(profile) {
    if (!profile||typeof profile!=='object'||Array.isArray(profile)) throw new Error('Profil IA invalide');
    for (const [key,defaultValue] of Object.entries(PROFILE_SCHEMA)) {
      if (!(key in profile)) throw new Error(`Champ obligatoire manquant: ${key}`);
      if (Array.isArray(defaultValue)&&!Array.isArray(profile[key])) throw new Error(`Le champ ${key} doit être une liste`);
      if (!Array.isArray(defaultValue)&&typeof profile[key]!=='string') throw new Error(`Le champ ${key} doit être du texte`);
    }
    if (profileText(profile).length<180) throw new Error('Profil trop court ou générique');
  }

  async embed(input) {
    let payload;
    try { payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/embed`,{method:'POST',body:JSON.stringify({model:this.config.embeddingModel,input}),timeoutMs:Number(this.env.AI_EMBEDDING_TIMEOUT_MS||120000)},'Ollama/Embedding'); }
    catch (error) { payload=await this.jsonRequest(`${this.config.ollamaBaseUrl}/api/embeddings`,{method:'POST',body:JSON.stringify({model:this.config.embeddingModel,prompt:input}),timeoutMs:Number(this.env.AI_EMBEDDING_TIMEOUT_MS||120000)},'Ollama/Embedding'); }
    const vector=payload.embedding||payload.embeddings?.[0];
    if (!Array.isArray(vector)||!vector.length) throw new Error('Embedding absent');
    return vector.map(Number);
  }

  computeSimilarities(appId,profile,embedding) {
    return this.database.activeEmbeddings(appId).map((candidate)=>{
      const score=cosine(embedding,candidate.embedding); if (score==null) return null;
      const dimensions=compareDimensions(profile,candidate.profile); const ranked=Object.entries(dimensions).sort((a,b)=>b[1]-a[1]);
      return {appId:candidate.app_id,versionId:candidate.id,score,reasons:ranked.slice(0,3).filter(([,value])=>value>0).map(([key])=>key),differences:ranked.slice(-2).filter(([,value])=>value<0.2).map(([key])=>key),dimensions};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,20);
  }
}

module.exports={AiEngine,cosine,profileText,PROFILE_SCHEMA};
