'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfileContent, assessProfileContent, PROFILE_SCHEMA_VERSION } = require('../lib/ai-engine');

const evidence = (status='documented', source_ids=['SOURCE-1'], note='Caractéristique établie par le dossier documentaire.') => ({status,source_ids,confidence:status==='unknown'?'unknown':'high',note});

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
    exploration:{freedom:'semi_open',topology:'interconnected',guidance:'moderate',rewards:['ressources','contexte'],description:'L’exploration laisse choisir certains itinéraires et récompense l’observation par des ressources et du contexte.'},
    structure:{world:'hybrid',activity_model:'hybrid',session_model:'continuous',linearity:'mixed',description:'L’expérience combine des objectifs dirigés avec des activités libres dans une structure qui reste compréhensible.'},
    atmosphere_themes:{tone:['immersif','contrasté'],themes:['maîtrise','découverte'],sensory_style:['environnements lisibles','identité sonore marquée'],description:'L’ambiance associe une identité visuelle cohérente à des thèmes qui renforcent les actions et les lieux traversés.'},
    pace:{baseline:'moderate',variation:'player_driven',intensity:'moderate',player_control:'high',description:'Le rythme dépend largement des choix du joueur, avec des phases calmes de préparation et des pics d’attention.'},
    progression:{systems:['compétences','équipement','accès'],scope:'multi_system',pacing:'tiered',persistence:'permanent',description:'La progression durable débloque des outils et des possibilités qui modifient progressivement les décisions disponibles.'},
    difficulty_friction:{baseline:'moderate',adjustability:'moderate',failure_cost:'low',friction_sources:['gestion des contraintes','lecture de l’environnement'],skill_demands:['anticipation','précision'],description:'La difficulté vient surtout de la compréhension des systèmes et de l’anticipation plutôt que de pénalités arbitraires.'},
    multiplayer:{availability:'none',modes:[],cooperation:'none',competition:'none',persistence:'none',description:'L’expérience décrite est structurée pour un joueur seul et ne dépend d’aucune interaction multijoueur.'},
    distinctive_elements:[
      {element:'Système central identifiable',role:'core',description:'Une mécanique centrale organise les décisions répétées et distingue clairement l’expérience des jeux voisins.'},
      {element:'Présentation cohérente',role:'supporting',description:'La présentation soutient les systèmes principaux sans être confondue avec une fonctionnalité technique secondaire.'}
    ],
    uncertainties:[],
    field_status:{}
  };
  for(const key of Object.keys(profile).filter((key)=>!['schema_version','field_status'].includes(key))) profile.field_status[key]=evidence();
  profile.field_status.uncertainties=evidence('unknown',[],'Aucune incertitude matérielle n’est conservée dans ce pilote contrôlé.');
  return profile;
}

const pilots={
  'Euro Truck Simulator 2':(()=>{const p=baseProfile('Simulation routière ouverte centrée sur le transport de marchandises, la conduite précise et le développement progressif d’une entreprise de logistique européenne.');p.narrative={importance:'very_low',structure:'emergent',delivery:['carrière du joueur','événements de route'],player_agency:'high',description:'Aucune campagne scénarisée centrale : le récit émerge de la carrière, des trajets choisis et du développement de l’entreprise.'};p.exploration={freedom:'open',topology:'network',guidance:'player_directed',rewards:['nouvelles villes','concessionnaires','agences'],description:'Le joueur parcourt librement un réseau routier européen ouvert, choisit ses contrats et découvre progressivement de nouveaux nœuds.'};p.structure={world:'open_world',activity_model:'contracts',session_model:'open_ended',linearity:'player_directed',description:'La simulation ouverte s’organise autour de contrats de livraison indépendants et d’une carrière sans fin imposée.'};p.pace={baseline:'slow',variation:'calm_to_tense',intensity:'low_to_moderate',player_control:'high',description:'La conduite est généralement lente et contemplative, ponctuée de manœuvres, délais et incidents exigeant une attention soutenue.'};p.progression={systems:['argent','compétences de conduite','camions','garages','chauffeurs'],scope:'multi_system',pacing:'steady',persistence:'permanent',description:'Les revenus et l’expérience développent les compétences, les véhicules, la flotte et l’entreprise de transport sur le long terme.'};p.multiplayer={availability:'optional',modes:['convoi coopératif'],cooperation:'supported',competition:'none',persistence:'session',description:'Le multijoueur reste facultatif et permet de partager des trajets en convoi sans remplacer la carrière principale.'};return p;})(),
  'Control':(()=>{const p=baseProfile('Jeu d’action-aventure surnaturel où Jesse Faden explore un siège fédéral interconnecté, combat avec des pouvoirs télékinétiques et dévoile un mystère paranormal dense.');p.narrative={importance:'central',structure:'environmental',delivery:['cinématiques','dialogues','documents','environnement'],player_agency:'low',description:'Le récit central suit Jesse Faden, tandis que documents, objets altérés et espaces changeants développent le mystère du Bureau.'};p.exploration={freedom:'semi_open',topology:'interconnected',guidance:'moderate',rewards:['pouvoirs','mods','documents','zones secrètes'],description:'L’Ancienne Maison forme un espace interconnecté dont de nouveaux pouvoirs ouvrent des raccourcis, secrets et secteurs auparavant bloqués.'};p.structure={world:'interconnected',activity_model:'missions',session_model:'continuous',linearity:'mixed',description:'Les missions principales et secondaires se déploient dans un même bâtiment interconnecté avec des retours vers les zones connues.'};p.pace={baseline:'moderate',variation:'bursty',intensity:'moderate_to_high',player_control:'moderate',description:'Exploration et lecture alternent avec des combats télékinétiques rapides qui créent des pics réguliers de forte intensité.'};return p;})(),
  'Satisfactory':(()=>{const p=baseProfile('Jeu de construction et d’automatisation en monde ouvert où le joueur extrait des ressources, conçoit des chaînes de production et développe une usine à grande échelle.');p.gameplay_loops=[{action:'Extraire et transformer des ressources',objective:'Alimenter des chaînes de production automatisées',cadence:'continuous',centrality:'core',description:'Le joueur relie extraction, transformation et assemblage pour produire automatiquement des composants toujours plus complexes.'},{action:'Construire et optimiser l’usine',objective:'Augmenter le débit et réduire les goulots d’étranglement',cadence:'recurring',centrality:'core',description:'Chaque extension demande de mesurer les flux, redistribuer l’énergie et réorganiser les lignes de convoyeurs.'},{action:'Explorer le monde ouvert',objective:'Trouver des gisements et débloquer des ressources',cadence:'situational',centrality:'supporting',description:'L’exploration fournit de nouveaux sites, matériaux et possibilités logistiques nécessaires aux paliers suivants.'}];p.structure={world:'open_world',activity_model:'objectives',session_model:'open_ended',linearity:'player_directed',description:'Le monde ouvert accueille une usine persistante; des objectifs de production cadrent la progression sans imposer son agencement.'};p.progression={systems:['paliers technologiques','recettes','bâtiments','énergie','logistique'],scope:'technology',pacing:'tiered',persistence:'permanent',description:'Des livraisons et recherches débloquent par paliers de nouvelles machines, recettes, sources d’énergie et solutions logistiques.'};p.pace={baseline:'slow',variation:'player_driven',intensity:'low_to_moderate',player_control:'high',description:'La planification et la construction imposent un rythme réfléchi que le joueur accélère lors des extensions ou réorganisations.'};return p;})()
};

for(const [name,profile] of Object.entries(pilots)) test(`pilote V0.9.2 valide un profil multidimensionnel pour ${name}`,()=>{
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

test('le validateur refuse un statut documentaire utilisé comme contenu',()=>{
  const profile=structuredClone(pilots.Control);
  profile.gameplay_loops[0].action='documented';
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),/statut documentaire/i);
});

test('une dimension inconnue utilise null et non la chaîne unknown',()=>{
  const profile=structuredClone(pilots.Control);
  profile.multiplayer=null;
  profile.field_status.multiplayer=evidence('unknown',[],'Les sources du pilote ne décrivent aucun mode multijoueur.');
  assert.equal(validateProfileContent(profile,{sourceCount:1}),true);
  profile.multiplayer='unknown';
  assert.throws(()=>validateProfileContent(profile,{sourceCount:1}),/type|string|statut/i);
});

test('la complétude sémantique pénalise une dimension vide même avec un dossier complet',()=>{
  const profile=structuredClone(pilots.Satisfactory);
  profile.pace=null;
  profile.field_status.pace=evidence('unknown',[],'Le rythme ne peut pas être établi à partir des sources retenues.');
  const complete=assessProfileContent(pilots.Satisfactory,{quality_status:'complete',completeness_score:100});
  const incomplete=assessProfileContent(profile,{quality_status:'complete',completeness_score:100});
  assert.ok(incomplete.profileCompletenessScore<complete.profileCompletenessScore);
  assert.equal(incomplete.documentCompletenessScore,100);
});
