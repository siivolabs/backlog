'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cosine, profileText, PROFILE_SCHEMA, PROFILE_FORMAT, VERIFICATION_FORMAT, PROFILE_SCHEMA_VERSION, ProfileValidationError, formatAnalysisError } = require('../lib/ai-engine');

test('cosine calcule la similarité et refuse les dimensions incohérentes',()=>{
  assert.equal(cosine([1,0],[1,0]),1);
  assert.equal(cosine([1,0],[0,1]),0);
  assert.equal(cosine([1],[1,2]),null);
});

test('profileText conserve toutes les dimensions utiles à l’embedding',()=>{
  const profile={...PROFILE_SCHEMA,summary:'Résumé',gameplay_loops:[{action:'Conduire',objective:'Livrer',description:'Acheminer des marchandises entre plusieurs villes.'}],narrative:{description:'Une narration décrite de façon structurée.'},atmosphere_themes:{description:'Une ambiance mystérieuse et enveloppante.'},distinctive_elements:[{element:'Portails',description:'Manipulation spatiale au cœur des énigmes.'}]};
  const text=profileText(profile);
  for(const value of ['Résumé','Conduire','structurée','mystérieuse','Portails'])assert.match(text,new RegExp(value,'i'));
});

const { AiEngine, sourceRelevance, isPrivateIp } = require('../lib/ai-engine');

test('le classement documentaire pénalise les DLC commerciaux et favorise une analyse du jeu principal',()=>{
  const useful=sourceRelevance('Euro Truck Simulator 2',{title:'Euro Truck Simulator 2 gameplay review',url:'https://example.com/review',content:'Detailed gameplay mechanics, progression and driving experience.'});
  const dlc=sourceRelevance('Euro Truck Simulator 2',{title:'Acheter Euro Truck Simulator 2 Italia DLC',url:'https://instant-gaming.com/item',content:'Page commerciale pour une extension.'});
  assert.ok(useful>dlc);
  assert.ok(dlc<2.5);
});

test('la protection SSRF reconnaît les adresses locales et privées',()=>{
  for(const value of ['127.0.0.1','10.0.0.4','172.16.2.3','192.168.1.2','169.254.1.1','::1'])assert.equal(isPrivateIp(value),true);
  assert.equal(isPrivateIp('8.8.8.8'),false);
});

test('Tester Ollama renvoie un diagnostic structuré quand un modèle manque',async()=>{
  const fakeFetch=async(url)=>({ok:true,status:200,text:async()=>JSON.stringify({models:[{name:'qwen3:32b'}]})});
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434',AI_ANALYSIS_MODEL:'qwen3:32b',AI_EMBEDDING_MODEL:'embeddinggemma'}});
  const result=await engine.testConnection();
  assert.equal(result.ok,false);
  assert.equal(result.step,'model_check');
  assert.equal(result.http_status,404);
  assert.ok(Number.isFinite(result.duration_ms));
});

test('Tester Ollama vérifie une génération minimale sans streaming',async()=>{
  const calls=[];
  const fakeFetch=async(url,options={})=>{calls.push({url:String(url),body:options.body});if(String(url).endsWith('/api/tags'))return{ok:true,status:200,text:async()=>JSON.stringify({models:[{name:'qwen3:32b'},{name:'embeddinggemma:latest'}]})};return{ok:true,status:200,text:async()=>JSON.stringify({message:{role:'assistant',content:'OK'},done:true,done_reason:'stop'})};};
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.testConnection();
  assert.equal(result.ok,true);
  assert.equal(result.step,'completed');
  const generation=JSON.parse(calls.find((call)=>call.url.endsWith('/api/chat')).body);
  assert.equal(generation.stream,false);
  assert.equal(generation.think,false);
  assert.equal(generation.options.num_predict,64);
  assert.deepEqual(generation.messages,[{role:'user',content:'Réponds uniquement avec le mot OK.'}]);
});

test('Tester Ollama explique une réponse Qwen sans contenu final',async()=>{
  const fakeFetch=async(url)=>String(url).endsWith('/api/tags')
    ? {ok:true,status:200,text:async()=>JSON.stringify({models:[{name:'qwen3:32b'},{name:'embeddinggemma:latest'}]})}
    : {ok:true,status:200,text:async()=>JSON.stringify({message:{role:'assistant',content:'',thinking:'Je réfléchis'}})};
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.testConnection();
  assert.equal(result.ok,false);
  assert.equal(result.step,'generation');
  assert.match(result.detail,/raisonnement.*aucun contenu final/i);
});

test('l’analyse normale utilise Ollama Chat en streaming sans limite minuscule de tokens',async()=>{
  const calls=[];
  const fakeFetch=async(url,options={})=>{
    calls.push({url:String(url),body:JSON.parse(options.body)});
    return {ok:true,status:200,text:async()=>JSON.stringify({message:{content:'{}'}})};
  };
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  await engine.generateProfile({appId:'1',name:'Jeu de test'},[]);
  assert.equal(calls[0].url,'http://ollama:11434/api/chat');
  assert.equal(calls[0].body.stream,true);
  assert.equal(calls[0].body.options.temperature,0.05);
  assert.equal(calls[0].body.think,false);
  assert.equal(calls[0].body.format.properties.schema_version.enum[0],PROFILE_SCHEMA_VERSION);
  assert.equal(PROFILE_FORMAT.properties.pace.anyOf[0].type,'object');
  assert.equal('num_predict' in calls[0].body.options,false);
  assert.deepEqual(calls[0].body.messages.map((message)=>message.role),['system','user']);
});

test('le streaming Qwen réassemble les fragments NDJSON et tolère une génération longue tant que des fragments arrivent',async()=>{
  const encoder=new TextEncoder();
  const body={async *[Symbol.asyncIterator](){yield encoder.encode('{"message":{"content":"{\\"schema_version\\":\\"2.1\\""}}\n');await new Promise((resolve)=>setTimeout(resolve,5));yield encoder.encode('{"message":{"content":"}"},"done":true}\n');}};
  const fakeFetch=async()=>({ok:true,status:200,statusText:'OK',body,text:async()=>''});
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434',AI_ANALYSIS_INACTIVITY_TIMEOUT_MS:'100'}});
  const result=await engine.streamJsonRequest('http://ollama:11434/api/chat',{method:'POST',body:'{}',timeoutMs:100},'Ollama/Qwen');
  assert.equal(result.message.content,'{"schema_version":"2.1"}');
});

test('les erreurs HTTP conservent statut, corps, URL et cause dans le détail technique',async()=>{
  const fakeFetch=async()=>({ok:false,status:502,statusText:'Bad Gateway',text:async()=>'proxy upstream reset'});
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  await assert.rejects(()=>engine.jsonRequest('http://ollama:11434/api/tags',{},'Ollama'),(error)=>{
    const detail=formatAnalysisError(error,'analysis');
    assert.match(detail,/Statut HTTP : 502 Bad Gateway/);
    assert.match(detail,/proxy upstream reset/);
    assert.match(detail,/http:\/\/ollama:11434\/api\/tags/);
    return true;
  });
});

test('la seconde passe vérifie factuellement le profil avec un schéma strict',async()=>{
  const calls=[];
  const fakeFetch=async(url,options={})=>{calls.push(JSON.parse(options.body));return{ok:true,status:200,text:async()=>JSON.stringify({message:{content:JSON.stringify({status:'passed',checked_claims:4,issues:[]})}})};};
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.verifyProfile({appId:'1',name:'Jeu de test'},[{title:'Source officielle',excerpt:'La carte est fixe et la progression est sauvegardée.'}],{schema_version:PROFILE_SCHEMA_VERSION},{fieldCorrections:[]});
  assert.equal(result.status,'passed');
  assert.equal(calls[0].temperature,undefined);
  assert.equal(calls[0].options.temperature,0);
  assert.equal(calls[0].format.properties.status.enum[0],VERIFICATION_FORMAT.properties.status.enum[0]);
});

test('le détail d’une erreur de chemin est lisible sans consulter les logs Docker',()=>{
  const error=new ProfileValidationError('atmosphere_themes: chemin de preuve invalide (atmosphere_theme.tone)',{code:'INVALID_EVIDENCE_PATH',details:{dimension:'atmosphere_themes',received:'atmosphere_theme.tone',expected:'atmosphere_themes.tone',repair_attempted:true,repair_detail:'Proposition ambiguë'}});
  const detail=formatAnalysisError(error,'path_repair');
  assert.match(detail,/Erreur de validation du profil/);
  assert.match(detail,/Dimension : atmosphere_themes/);
  assert.match(detail,/Chemin reçu : atmosphere_theme\.tone/);
  assert.match(detail,/Chemin attendu : atmosphere_themes\.tone/);
  assert.match(detail,/Réparation contrôlée : tentée sans succès/);
});

test('le détail d’une collision incompatible explique les supports et les sources',()=>{
  const error=new ProfileValidationError('summary: preuves incompatibles pour un même chemin (summary)',{code:'CONFLICTING_EVIDENCE_CLAIMS',details:{dimension:'summary',received:'summary',conflicting_supports:['direct','contradictory'],conflicting_source_ids:['SOURCE-1','SOURCE-2'],conflict_reason:'Les sources ne soutiennent pas la même valeur.'}});
  const detail=formatAnalysisError(error,'path_repair');
  assert.match(detail,/Code : CONFLICTING_EVIDENCE_CLAIMS/);
  assert.match(detail,/Supports incompatibles : direct, contradictory/);
  assert.match(detail,/Sources concernées : SOURCE-1, SOURCE-2/);
  assert.match(detail,/Motif : Les sources ne soutiennent pas la même valeur/);
});
