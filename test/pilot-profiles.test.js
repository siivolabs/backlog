'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiEngine, validateProfileContent, assessProfileContent, PROFILE_SCHEMA_VERSION, normalizeKnownEvidencePaths, normalizeEmptyUncertaintiesEvidence, mergeCompatibleEvidenceClaims } = require('../lib/ai-engine');

const evidence = (status='documented', source_ids=['SOURCE-1'], note='Caractéristique établie par le dossier documentaire.', path='summary') => ({status,source_ids,confidence:status==='unknown'?'unknown':'high',note,claims:status==='unknown'?[]:[{path,source_ids,support:status==='human_corrected'?'human':'direct',confidence:'high',note:'La caractéristique est soutenue par la preuve indiquée.'}]});

function baseProfile(summary) {
  const profile={
    schema_version:PROFILE_SCHEMA_VERSION,
    summary,
    gameplay_loops:[
      {action:'Agir dans le système principal',objective:'Faire progresser un objectif concret',cadence:'recurring',centrality:'core',description:'Le joueur répète une action centrale, observe ses conséquences puis adapte sa stratégie aux contraintes.'},
      {action:'Préparer les ressources nécessaires',objective:'Améliorer les prochaines actions',cadence:'recurring',centrality:'supporting',description:'La préparation transforme les ressources acquises en options nouvelles qui renforcent la boucle principale.'},
      {action:'Explorer des possibilités secondaires',objective:'Découvrir des avantages complémentaires',cadence:'situational',centrality:'optional',description:'Les activités facultatives récompensent la curiosité sans remplacer les mécaniques centrales de l’expérience.'}
    ],
    narrative:{importance:'moderate',structure:'hybrid',delivery:['dialogues','environnement'],player_agency:'moderate',description:'Le récit accompagne la progression et utilise plusieurs modes de présentation sans masquer les objectifs de jeu.'},
    exploration:{freedom:'semi_open',topology:'interconnected',map_generation:'fixed',guidance:'moderate',rewards:['ressources','contexte'],description:'L’exploration laisse choisir certains itinéraires et récompense l’observation par des ressources et du contexte.'},
    structure:{world:'hybrid',activity_model:'hybrid',session_model:'continuous_save',linearity:'mixed',description:'L’expérience combine des objectifs dirigés avec des activités libres dans une structure qui reste compréhensible.'},
    atmosphere_themes:{tone:['immersif','contrasté'],themes:['maîtrise','découverte'],sensory_style:['environnements lisibles','identité sonore marquée'],description:'L’ambiance associe une identité visuelle cohérente à des thèmes qui renforcent les actions et les lieux traversés.'},
    pace:{baseline:'moderate',variation:'player_driven',intensity:'moderate',player_control:'high',description:'Le rythme dépend largement des choix du joueur, avec des phases calmes de préparation et des pics d’attention.'},
    progression:{systems:['compétences','équipement','accès'],scope:'multi_system',pacing:'tiered',save_persistence:'saved_between_sessions',reset_model:'none',description:'La progression durable débloque des outils et des possibilités qui modifient progressivement les décisions disponibles.'},
    difficulty_friction:{baseline:'moderate',adjustability:'moderate',failure_cost:'low',friction_sources:['gestion des contraintes','lecture de l’environnement'],skill_demands:['anticipation','précision'],description:'La difficulté vient surtout de la compréhension des systèmes et de l’anticipation plutôt que de pénalités arbitraires.'},
    multiplayer:{availability:'none',modes:[],cooperation:'none',competition:'none',world_persistence:'none',description:'L’expérience décrite est structurée pour un joueur seul et ne dépend d’aucune interaction multijoueur.'},
    distinctive_elements:[
      {element:'Système central identifiable',role:'core',description:'Une mécanique centrale organise les décisions répétées et distingue clairement l’expérience des jeux voisins.'},
      {element:'Présentation cohérente',role:'supporting',description:'La présentation soutient les systèmes principaux sans être confondue avec une fonctionnalité technique secondaire.'}
    ],
    uncertainties:[],
    field_status:{}
  };
  for(const key of Object.keys(profile).filter((key)=>!['schema_version','field_status'].includes(key))) profile.field_status[key]=evidence('documented',['SOURCE-1'],'Caractéristique établie par le dossier documentaire.',key==='summary'?key:Array.isArray(profile[key])?`${key}[0]`:`${key}.description`);
  profile.field_status.uncertainties=evidence('unknown',[],'Aucune incertitude matérielle n’est conservée dans ce pilote contrôlé.','uncertainties');
  return profile;
}

const pilots={
  'Euro Truck Simulator 2':(()=>{const p=baseProfile('Simulation routière ouverte centrée sur le transport de marchandises, la conduite précise et le développement progressif d’une entreprise de logistique européenne.');p.narrative={importance:'very_low',structure:'emergent',delivery:['carrière du joueur','événements de route'],player_agency:'high',description:'Aucune campagne scénarisée centrale : le récit émerge de la carrière, des trajets choisis et du développement de l’entreprise.'};p.exploration={freedom:'open',topology:'network',map_generation:'fixed',guidance:'player_directed',rewards:['nouvelles villes','concessionnaires','agences'],description:'Le joueur parcourt librement un réseau routier européen ouvert, choisit ses contrats et découvre progressivement de nouveaux nœuds.'};p.structure={world:'open_world',activity_model:'contracts',session_model:'open_ended',linearity:'player_directed',description:'La simulation ouverte s’organise autour de contrats de livraison indépendants et d’une carrière sans fin imposée.'};p.pace={baseline:'slow',variation:'calm_to_tense',intensity:'low_to_moderate',player_control:'high',description:'La conduite est généralement lente et contemplative, ponctuée de manœuvres, délais et incidents exigeant une attention soutenue.'};p.progression={systems:['argent','compétences de conduite','camions','garages','chauffeurs'],scope:'multi_system',pacing:'steady',save_persistence:'saved_between_sessions',reset_model:'none',description:'Les revenus et l’expérience développent les compétences, les véhicules, la flotte et l’entreprise de transport sur le long terme.'};p.multiplayer={availability:'optional',modes:['convoi coopératif'],cooperation:'supported',competition:'none',world_persistence:'session_only',description:'Le multijoueur reste facultatif et permet de partager des trajets en convoi sans remplacer la carrière principale.'};return p;})(),
  'Control':(()=>{const p=baseProfile('Jeu d’action-aventure surnaturel où Jesse Faden explore un siège fédéral interconnecté, combat avec des pouvoirs télékinétiques et dévoile un mystère paranormal dense.');p.narrative={importance:'central',structure:'environmental',delivery:['cinématiques','dialogues','documents','environnement'],player_agency:'low',description:'Le récit central suit Jesse Faden, tandis que documents, objets altérés et espaces changeants développent le mystère du Bureau.'};p.exploration={freedom:'semi_open',topology:'interconnected',map_generation:'fixed',guidance:'moderate',rewards:['pouvoirs','mods','documents','zones secrètes'],description:'L’Ancienne Maison forme un espace interconnecté dont de nouveaux pouvoirs ouvrent des raccourcis, secrets et secteurs auparavant bloqués.'};p.structure={world:'interconnected',activity_model:'missions',session_model:'continuous_save',linearity:'mixed',description:'Les missions principales et secondaires se déploient dans un même bâtiment interconnecté avec des retours vers les zones connues.'};p.pace={baseline:'moderate',variation:'bursty',intensity:'moderate_to_high',player_control:'moderate',description:'Exploration et lecture alternent avec des combats télékinétiques rapides qui créent des pics réguliers de forte intensité.'};return p;})(),
  'Satisfactory':(()=>{const p=baseProfile('Jeu de construction et d’automatisation en monde ouvert où le joueur extrait des ressources, conçoit des chaînes de production et développe une usine à grande échelle.');p.gameplay_loops=[{action:'Extraire et transformer des ressources',objective:'Alimenter des chaînes de production automatisées',cadence:'continuous',centrality:'core',description:'Le joueur relie extraction, transformation et assemblage pour produire automatiquement des composants toujours plus complexes.'},{action:'Construire et optimiser l’usine',objective:'Augmenter le débit et réduire les goulots d’étranglement',cadence:'recurring',centrality:'core',description:'Chaque extension demande de mesurer les flux, redistribuer l’énergie et réorganiser les lignes de convoyeurs.'},{action:'Explorer le monde ouvert',objective:'Trouver des gisements et débloquer des ressources',cadence:'situational',centrality:'supporting',description:'L’exploration fournit de nouveaux sites, matériaux et possibilités logistiques nécessaires aux paliers suivants.'}];p.structure={world:'open_world',activity_model:'objectives',session_model:'open_ended',linearity:'player_directed',description:'Le monde ouvert accueille une usine persistante; des objectifs de production cadrent la progression sans imposer son agencement.'};p.progression={systems:['paliers technologiques','recettes','bâtiments','énergie','logistique'],scope:'technology',pacing:'tiered',save_persistence:'saved_between_sessions',reset_model:'none',description:'Des livraisons et recherches débloquent par paliers de nouvelles machines, recettes, sources d’énergie et solutions logistiques.'};p.pace={baseline:'slow',variation:'player_driven',intensity:'low_to_moderate',player_control:'high',description:'La planification et la construction imposent un rythme réfléchi que le joueur accélère lors des extensions ou réorganisations.'};return p;})()
};

for(const [name,profile] of Object.entries(pilots)) test(`pilote V0.9.3 valide un profil multidimensionnel pour ${name}`,()=>{
  assert.equal(validateProfileContent(profile,{sourceCount:1}),true);
  const assessment=assessProfileContent(profile,{quality_status:'complete',completeness_score:90});
  assert.notEqual(assessment.profileQuality,'insufficient');
  assert.ok(assessment.semanticScore>=65,`${name}: score sémantique ${assessment.semanticScore}`);
  assert.equal(assessment.documentCompletenessScore,90);
});

test('Euro Truck Simulator 2 représente la faible narration comme caractéristique connue',()=>{
  const profile=pilots['Euro Truck Simulator 2'];
  assert.equal(profile.narrative.importance,'very_low');
  assert.equal(profile.narrative.structure,'emergent');
  assert.equal(profile.field_status.narrative.status,'documented');
});

test('Satisfactory distingue carte fixe, sauvegarde intersession et absence de reset normal',()=>{
  const profile=pilots.Satisfactory;
  assert.equal(profile.exploration.map_generation,'fixed');
  assert.equal(profile.progression.save_persistence,'saved_between_sessions');
  assert.equal(profile.progression.reset_model,'none');
  assert.notEqual(profile.narrative.structure,'linear');
});

test('le validateur refuse un statut documentaire utilisé comme contenu',()=>{
  const profile=structuredClone(pilots.Control);
  profile.gameplay_loops[0].action='documented';
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),/statut documentaire/i);
});

test('une dimension inconnue utilise null et non la chaîne unknown',()=>{
  const profile=structuredClone(pilots.Control);
  profile.multiplayer=null;
  profile.field_status.multiplayer=evidence('unknown',[],'Les sources du pilote ne décrivent aucun mode multijoueur.','multiplayer');
  assert.equal(validateProfileContent(profile,{sourceCount:1}),true);
  profile.multiplayer='unknown';
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),/type|string|statut/i);
});

test('normalise uncertainties vide marqué documented sans inventer de contenu',async()=>{
  const profile=structuredClone(pilots.Control);
  profile.field_status.uncertainties=evidence('documented',['SOURCE-1'],'Les sources ont été examinées.','uncertainties');
  const before=structuredClone(profile);
  const normalized=normalizeEmptyUncertaintiesEvidence(profile);
  assert.deepEqual(profile,before,'la réponse brute ne doit pas être mutée');
  assert.deepEqual(normalized.profile.uncertainties,[],'aucune incertitude ne doit être fabriquée');
  assert.equal(normalized.profile.field_status.uncertainties.status,'unknown');
  assert.deepEqual(normalized.profile.field_status.uncertainties.source_ids,[]);
  assert.equal(normalized.profile.field_status.uncertainties.confidence,'unknown');
  assert.deepEqual(normalized.profile.field_status.uncertainties.claims,[]);
  assert.equal(normalized.normalizations.length,1);
  assert.equal(validateProfileContent(normalized.profile,{sourceCount:1}),true);

  let calls=0;
  const engine=new AiEngine({database:{},fetchImpl:async()=>{calls+=1;throw new Error('Qwen ne doit pas être appelé');},env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const repaired=await engine.repairEvidencePaths(profile);
  assert.equal(calls,0);
  assert.deepEqual(repaired.profile.uncertainties,[]);
  assert.equal(repaired.profile.field_status.uncertainties.status,'unknown');
  assert.equal(repaired.evidenceNormalizations.length,1);
});

test('conserve la validation stricte des dimensions principales vides',()=>{
  const profile=structuredClone(pilots.Control);
  profile.gameplay_loops=[];
  profile.field_status.gameplay_loops=evidence('documented',['SOURCE-1'],'Les sources ont été examinées.','gameplay_loops');
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),/gameplay_loops: contenu manquant pour le statut documented/);
});

test('la complétude sémantique pénalise une dimension vide même avec un dossier complet',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.pace=null;
  profile.field_status.pace=evidence('unknown',[],'Le rythme ne peut pas être établi à partir des sources retenues.','pace');
  const complete=assessProfileContent(pilots.Satisfactory,{quality_status:'complete',completeness_score:100});
  const incomplete=assessProfileContent(profile,{quality_status:'complete',completeness_score:100});
  assert.ok(incomplete.profileCompletenessScore<complete.profileCompletenessScore);
  assert.equal(incomplete.documentCompletenessScore,100);
});

test('normalise l’alias connu atmosphere_theme sans appeler Qwen ni modifier le contenu',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.atmosphere_themes.claims[0].path='atmosphere_theme.description';
  const before=structuredClone(profile);
  const result=normalizeKnownEvidencePaths(profile);
  assert.equal(result.profile.field_status.atmosphere_themes.claims[0].path,'atmosphere_themes.description');
  assert.equal(result.repairs.length,1);
  assert.equal(profile.field_status.atmosphere_themes.claims[0].path,before.field_status.atmosphere_themes.claims[0].path,'la fonction ne mute pas la réponse brute');
  const expected=structuredClone(before);expected.field_status.atmosphere_themes.claims[0].path='atmosphere_themes.description';
  assert.deepEqual(result.profile,expected);
  assert.equal(validateProfileContent(result.profile,{sourceCount:1}),true);
});

test('la validation stricte refuse encore un chemin inexistant dans la bonne dimension',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.atmosphere_themes.claims[0].path='atmosphere_themes.tonality';
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),(error)=>error.code==='INVALID_EVIDENCE_PATH'&&error.details.dimension==='atmosphere_themes'&&error.details.received==='atmosphere_themes.tonality');
});

test('une réparation Qwen contrôlée ne peut changer que vers un chemin autorisé de la même dimension',async()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.atmosphere_themes.claims[0].path='atmosphere_themes.descriptio';
  const expected=structuredClone(profile);expected.field_status.atmosphere_themes.claims[0].path='atmosphere_themes.description';
  const calls=[];
  const fakeFetch=async(url,options)=>{calls.push(JSON.parse(options.body));return{ok:true,status:200,text:async()=>JSON.stringify({message:{content:JSON.stringify({repairs:[{dimension:'atmosphere_themes',from:'atmosphere_themes.descriptio',to:'atmosphere_themes.description'}]})}})};};
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.repairEvidencePaths(profile);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.temperature,0);
  assert.equal(result.repairAttempted,true);
  assert.deepEqual(result.profile,expected,'aucune valeur hors chemin ne doit changer');
  assert.equal(validateProfileContent(result.profile,{sourceCount:1}),true);
});

test('une proposition de réparation hors schéma est ignorée puis rejetée',async()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.atmosphere_themes.claims[0].path='atmosphere_themes.descriptio';
  const fakeFetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({message:{content:JSON.stringify({repairs:[{dimension:'atmosphere_themes',from:'atmosphere_themes.descriptio',to:'progression.description'}]})}})});
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  await assert.rejects(()=>engine.repairEvidencePaths(profile),(error)=>error.code==='INVALID_EVIDENCE_PATH'&&error.details.repair_attempted===true);
});

test('fusionne les preuves compatibles d’un chemin sans perdre leurs sources ni leurs notes',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.summary.source_ids=['SOURCE-1','SOURCE-2'];
  profile.field_status.summary.claims.push({path:'summary',source_ids:['SOURCE-2'],support:'indirect',confidence:'medium',note:'Une seconde source confirme indirectement le même résumé.'});
  const before=structuredClone(profile);
  const result=mergeCompatibleEvidenceClaims(profile);
  assert.equal(result.profile.field_status.summary.claims.length,1);
  assert.deepEqual(result.profile.field_status.summary.claims[0].source_ids,['SOURCE-1','SOURCE-2']);
  assert.equal(result.profile.field_status.summary.claims[0].support,'direct');
  assert.equal(result.profile.field_status.summary.claims[0].confidence,'medium','la confiance fusionnée reste conservatrice');
  assert.match(result.profile.field_status.summary.claims[0].note,/soutenue par la preuve/);
  assert.match(result.profile.field_status.summary.claims[0].note,/seconde source/);
  assert.equal(result.merges.length,1);
  assert.deepEqual(profile,before,'la consolidation ne mute pas la réponse reçue');
  assert.equal(validateProfileContent(result.profile,{sourceCount:2}),true);
});

test('déduplique une collision créée par un alias connu sans appeler Qwen',async()=>{
  const profile=structuredClone(pilots.Satisfactory);
  const evidenceBlock=profile.field_status.atmosphere_themes;
  evidenceBlock.source_ids=['SOURCE-1','SOURCE-2'];
  evidenceBlock.claims.push({path:'atmosphere_theme.description',source_ids:['SOURCE-2'],support:'direct',confidence:'high',note:'La source complémentaire décrit la même ambiance.'});
  let calls=0;
  const engine=new AiEngine({database:{},fetchImpl:async()=>{calls+=1;throw new Error('Qwen ne doit pas être appelé');},env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.repairEvidencePaths(profile);
  assert.equal(calls,0);
  assert.equal(result.repairAttempted,false);
  assert.equal(result.repairs.length,1);
  assert.equal(result.claimMerges.length,1);
  assert.equal(result.profile.field_status.atmosphere_themes.claims.length,1);
  assert.deepEqual(result.profile.field_status.atmosphere_themes.claims[0].source_ids,['SOURCE-1','SOURCE-2']);
  assert.equal(validateProfileContent(result.profile,{sourceCount:2}),true);
});

test('déduplique une collision créée par la réparation Qwen contrôlée',async()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.summary.source_ids=['SOURCE-1','SOURCE-2'];
  profile.field_status.summary.claims.push({path:'summry',source_ids:['SOURCE-2'],support:'direct',confidence:'high',note:'La seconde source décrit le même résumé.'});
  const fakeFetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({message:{content:JSON.stringify({repairs:[{dimension:'summary',from:'summry',to:'summary'}]})}})});
  const engine=new AiEngine({database:{},fetchImpl:fakeFetch,env:{OLLAMA_BASE_URL:'http://ollama:11434'}});
  const result=await engine.repairEvidencePaths(profile);
  assert.equal(result.repairAttempted,true);
  assert.equal(result.repairs.at(-1).to,'summary');
  assert.equal(result.claimMerges.length,1);
  assert.equal(result.profile.field_status.summary.claims.length,1);
  assert.deepEqual(result.profile.field_status.summary.claims[0].source_ids,['SOURCE-1','SOURCE-2']);
  assert.equal(validateProfileContent(result.profile,{sourceCount:2}),true);
});

test('refuse de fusionner une preuve contradictoire avec une preuve qui soutient la valeur',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.summary.source_ids=['SOURCE-1','SOURCE-2'];
  profile.field_status.summary.claims.push({path:'summary',source_ids:['SOURCE-2'],support:'contradictory',confidence:'high',note:'La seconde source contredit la valeur retenue.'});
  assert.throws(()=>mergeCompatibleEvidenceClaims(profile),(error)=>error.code==='CONFLICTING_EVIDENCE_CLAIMS'&&error.details.dimension==='summary'&&error.details.received==='summary'&&error.details.conflicting_supports.includes('contradictory'));
});

test('refuse de confondre une correction humaine et une preuve documentaire sur le même chemin',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.field_status.summary.claims.push({path:'summary',source_ids:[],support:'human',confidence:'high',note:'La valeur a aussi été corrigée manuellement.'});
  assert.throws(()=>mergeCompatibleEvidenceClaims(profile),(error)=>error.code==='CONFLICTING_EVIDENCE_CLAIMS'&&error.details.conflicting_supports.includes('human'));
});
