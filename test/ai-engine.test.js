'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cosine, profileText, PROFILE_SCHEMA } = require('../lib/ai-engine');

test('cosine calcule la similarité et refuse les dimensions incohérentes',()=>{
  assert.equal(cosine([1,0],[1,0]),1);
  assert.equal(cosine([1,0],[0,1]),0);
  assert.equal(cosine([1],[1,2]),null);
});

test('profileText conserve toutes les dimensions utiles à l’embedding',()=>{
  const profile={...PROFILE_SCHEMA,summary:'Résumé',gameplay_loops:['Boucle'],narrative:'Narration',atmosphere_themes:['Mystère'],distinctive_elements:['Élément']};
  const text=profileText(profile);
  for(const value of ['Résumé','Boucle','Narration','Mystère','Élément'])assert.match(text,new RegExp(value));
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
  const fakeFetch=async(url,options={})=>{calls.push({url:String(url),body:options.body});if(String(url).endsWith('/api/tags'))return{ok:true,status:200,text:async()=>JSON.stringify({models:[{name:'qwen3:32b'},{name:'embeddinggemma:latest'}]})};return{ok:true,status:200,text:async()=>JSON.stringify({response:'OK'})};};
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.testConnection();
  assert.equal(result.ok,true);
  assert.equal(result.step,'completed');
  const generation=JSON.parse(calls.find((call)=>call.url.endsWith('/api/generate')).body);
  assert.equal(generation.stream,false);
});
