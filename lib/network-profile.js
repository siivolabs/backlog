'use strict';

const { clamp, getPath, round } = require('./network-utils');

const PROFILE_ADAPTER_VERSION = 'backlog-network-adapter/2.0';

const DIMENSIONS = Object.freeze({
  gameplay: [
    'gameplay_loops', 'core_gameplay', 'gameplay', 'profile.gameplay_loops',
    'mechanics.core', 'experience.gameplay', 'boucles_de_gameplay', 'boucles_de_jeu',
    'jouabilite', 'mecaniques', 'mecaniques_de_jeu'
  ],
  narrative: [
    'narrative_structure', 'narrative', 'story', 'profile.narrative_structure',
    'experience.narrative', 'narration', 'recit', 'histoire', 'structure_narrative'
  ],
  exploration: [
    'world_exploration', 'exploration', 'world', 'profile.world_exploration',
    'experience.exploration', 'exploration_du_monde', 'monde'
  ],
  structure: [
    'game_structure', 'structure', 'world_structure', 'profile.game_structure',
    'structure_du_jeu', 'structure_monde'
  ],
  pace: ['pacing', 'pace', 'rhythm', 'profile.pacing', 'rythme', 'cadence'],
  progression: [
    'progression_systems', 'progression', 'progression_economy',
    'profile.progression_systems', 'systemes_de_progression', 'economie_progression'
  ],
  difficulty: [
    'difficulty', 'challenge', 'profile.difficulty', 'difficulty_friction',
    'profile.difficulty_friction', 'difficulte', 'defi', 'friction'
  ],
  atmosphere: [
    'atmosphere_themes', 'atmosphere_theme', 'atmosphere', 'themes',
    'sensory_style', 'profile.atmosphere_themes', 'ambiance', 'ambiance_themes',
    'themes_ambiance', 'style_sensoriel'
  ],
  mode: [
    'multiplayer', 'game_modes', 'mode', 'cooperation_competition',
    'profile.multiplayer', 'multijoueur', 'modes_de_jeu', 'cooperation', 'competition'
  ],
  perspective: [
    'perspective', 'camera', 'viewpoint', 'presentation.perspective',
    'profile.perspective', 'point_de_vue', 'vue', 'presentation_camera'
  ],
  identity: [
    'distinctive_elements', 'identity', 'unique_features',
    'profile.distinctive_elements', 'elements_distinctifs', 'identite',
    'caracteristiques_uniques', 'signature'
  ]
});

const STOP_WORDS = new Set([
  'a','au','aux','avec','ce','ces','dans','de','des','du','elle','en','et','eux','il','je','la','le','les','leur','lui','ma','mais','me','meme','mes','moi','mon','ne','nos','notre','nous','on','ou','par','pas','pour','qu','que','qui','sa','se','ses','son','sur','ta','te','tes','toi','ton','tu','un','une','vos','votre','vous',
  'the','and','for','with','from','into','that','this','are','is','of','to','in','on','or','as','an','a','be','by','it','its','game','player','players','jeu','joueur','joueurs'
]);

const IGNORED_KEYS = new Set([
  'source','sources','evidence','evidences','provenance','confidence','review','reviews',
  'url','urls','field_status','verification','metadata','meta','debug','raw'
]);

function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value) {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const ALIAS_INDEX = new Map();
for (const [dimension, aliases] of Object.entries(DIMENSIONS)) {
  for (const alias of [dimension, ...aliases]) {
    const normalized = normalizeKey(alias.split('.').at(-1));
    if (normalized && !ALIAS_INDEX.has(normalized)) ALIAS_INDEX.set(normalized, dimension);
  }
}

function collectText(value, out = [], depth = 0) {
  if (value === null || value === undefined || depth > 7) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!IGNORED_KEYS.has(normalizeKey(key)) && !/^(id|source_ids?)$/i.test(key)) collectText(item, out, depth + 1);
    }
  }
  return out;
}

function hasMeaningfulValue(value) {
  return collectText(value).join(' ').trim().length > 0;
}

function tokenize(value) {
  const text = stripDiacritics(collectText(value).join(' ').toLowerCase());
  return [...new Set(text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9_+-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && token.length < 42 && !STOP_WORDS.has(token)))];
}

function firstPresent(profile, paths) {
  for (const path of paths) {
    const value = getPath(profile, path);
    if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) {
      return { path, value };
    }
  }
  return { path: null, value: null };
}

function entryDimension(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const labelKey = ['dimension','key','name','label','id','axis','category'].find((key) => typeof value[key] === 'string');
  if (!labelKey) return null;
  return ALIAS_INDEX.get(normalizeKey(value[labelKey])) || null;
}

function entryContent(value) {
  for (const key of ['value','content','description','summary','text','tags','items','features','data']) {
    if (hasMeaningfulValue(value?.[key])) return value[key];
  }
  const omitted = new Set(['dimension','key','name','label','id','axis','category']);
  const rest = Object.fromEntries(Object.entries(value || {}).filter(([key]) => !omitted.has(key)));
  return hasMeaningfulValue(rest) ? rest : null;
}

function scanLegacyCandidates(profile) {
  const found = new Map();
  const visit = (value, path = '', depth = 0) => {
    if (value === null || value === undefined || depth > 8) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        const dimension = entryDimension(item);
        const content = dimension ? entryContent(item) : null;
        if (dimension && hasMeaningfulValue(content) && !found.has(dimension)) {
          found.set(dimension, { path: `${path}[${index}]`, value: content, method: 'dimension_entry' });
        }
        visit(item, `${path}[${index}]`, depth + 1);
      }
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (IGNORED_KEYS.has(normalizedKey)) continue;
      const itemPath = path ? `${path}.${key}` : key;
      const dimension = ALIAS_INDEX.get(normalizedKey);
      if (dimension && hasMeaningfulValue(item)) {
        const existing = found.get(dimension);
        const weight = collectText(item).join(' ').length;
        if (!existing || weight > existing.weight) found.set(dimension, { path: itemPath, value: item, method: 'recursive_alias', weight });
      }
      visit(item, itemPath, depth + 1);
    }
  };
  visit(profile);
  return found;
}

function adaptProfile(profile = {}) {
  const comparable = {};
  const sourcePaths = {};
  const methods = {};
  const legacy = scanLegacyCandidates(profile);
  for (const [name, paths] of Object.entries(DIMENSIONS)) {
    const direct = firstPresent(profile, paths);
    const picked = direct.path ? { ...direct, method: 'direct_alias' } : legacy.get(name) || { path: null, value: null, method: null };
    comparable[name] = picked.value;
    sourcePaths[name] = picked.path;
    methods[name] = picked.method;
  }
  const recognizedDimensions = Object.values(comparable).filter(hasMeaningfulValue).length;
  const canonicalKeys = new Set(Object.values(DIMENSIONS).flatMap((aliases) => aliases.filter((alias) => !alias.includes('.'))));
  const sourceKeys = Object.values(sourcePaths).filter(Boolean);
  const adapted = sourceKeys.some((path) => path.includes('.') || path.includes('[') || !canonicalKeys.has(path));
  return { comparable, sourcePaths, methods, recognizedDimensions, adapted, adapterVersion: PROFILE_ADAPTER_VERSION };
}

function normalizeProfile(profile = {}) {
  const adaptation = adaptProfile(profile);
  const dimensions = {};
  for (const name of Object.keys(DIMENSIONS)) dimensions[name] = tokenize(adaptation.comparable[name]);
  const populated = Object.values(dimensions).filter((tokens) => tokens.length).length;
  const completeness = populated / Object.keys(DIMENSIONS).length;
  const tokenCount = Object.values(dimensions).reduce((total, tokens) => total + tokens.length, 0);
  return {
    schemaVersion: 'backlog-common-profile/1.1',
    adapterVersion: PROFILE_ADAPTER_VERSION,
    dimensions,
    sourcePaths: adaptation.sourcePaths,
    methods: adaptation.methods,
    adapted: adaptation.adapted,
    completeness: round(completeness),
    populatedDimensions: populated,
    totalDimensions: Object.keys(DIMENSIONS).length,
    tokenCount
  };
}

function jaccard(left = [], right = []) {
  if (!left.length || !right.length) return null;
  const a = new Set(left); const b = new Set(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function overlap(left = [], right = [], max = 6) {
  if (!left.length || !right.length) return [];
  const other = new Set(right);
  return left.filter((token) => other.has(token)).slice(0, max);
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null;
  let dot = 0; let normA = 0; let normB = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = Number(left[i]); const b = Number(right[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b; normA += a * a; normB += b * b;
  }
  if (!normA || !normB) return null;
  return clamp((dot / (Math.sqrt(normA) * Math.sqrt(normB)) + 1) / 2);
}

function compactForEmbedding(profile) {
  const normalized = normalizeProfile(profile);
  return Object.entries(normalized.dimensions)
    .filter(([, tokens]) => tokens.length)
    .map(([name, tokens]) => `${name}: ${tokens.join(' ')}`)
    .join('\n');
}

module.exports = {
  DIMENSIONS, PROFILE_ADAPTER_VERSION, adaptProfile, normalizeProfile, tokenize, jaccard, overlap, cosine, compactForEmbedding
};
