'use strict';

const { clamp, getPath, round } = require('./utils');

const DIMENSIONS = Object.freeze({
  gameplay: [
    'gameplay_loops', 'core_gameplay', 'gameplay', 'profile.gameplay_loops',
    'mechanics.core', 'experience.gameplay'
  ],
  narrative: [
    'narrative_structure', 'narrative', 'story', 'profile.narrative_structure',
    'experience.narrative'
  ],
  exploration: [
    'world_exploration', 'exploration', 'world', 'profile.world_exploration',
    'experience.exploration'
  ],
  structure: [
    'game_structure', 'structure', 'world_structure', 'profile.game_structure'
  ],
  pace: ['pacing', 'pace', 'rhythm', 'profile.pacing'],
  progression: [
    'progression_systems', 'progression', 'progression_economy',
    'profile.progression_systems'
  ],
  difficulty: ['difficulty', 'challenge', 'profile.difficulty'],
  atmosphere: [
    'atmosphere_themes', 'atmosphere_theme', 'atmosphere', 'themes',
    'sensory_style', 'profile.atmosphere_themes'
  ],
  mode: [
    'multiplayer', 'game_modes', 'mode', 'cooperation_competition',
    'profile.multiplayer'
  ],
  perspective: [
    'perspective', 'camera', 'viewpoint', 'presentation.perspective',
    'profile.perspective'
  ],
  identity: [
    'distinctive_elements', 'identity', 'unique_features',
    'profile.distinctive_elements'
  ]
});

const STOP_WORDS = new Set([
  'a','au','aux','avec','ce','ces','dans','de','des','du','elle','en','et','eux','il','je','la','le','les','leur','lui','ma','mais','me','meme','mes','moi','mon','ne','nos','notre','nous','on','ou','par','pas','pour','qu','que','qui','sa','se','ses','son','sur','ta','te','tes','toi','ton','tu','un','une','vos','votre','vous',
  'the','and','for','with','from','into','that','this','are','is','of','to','in','on','or','as','an','a','be','by','it','its','game','player','players','jeu','joueur','joueurs'
]);

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
      if (!/^(source|sources|evidence|provenance|confidence|review|url|id)$/i.test(key)) {
        collectText(item, out, depth + 1);
      }
    }
  }
  return out;
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

function normalizeProfile(profile = {}) {
  const dimensions = {};
  const sourcePaths = {};
  for (const [name, paths] of Object.entries(DIMENSIONS)) {
    const picked = firstPresent(profile, paths);
    dimensions[name] = tokenize(picked.value);
    sourcePaths[name] = picked.path;
  }
  const populated = Object.values(dimensions).filter((tokens) => tokens.length).length;
  const completeness = populated / Object.keys(DIMENSIONS).length;
  const tokenCount = Object.values(dimensions).reduce((total, tokens) => total + tokens.length, 0);
  return {
    schemaVersion: 'backlog-common-profile/1.0',
    dimensions,
    sourcePaths,
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
  DIMENSIONS, normalizeProfile, tokenize, jaccard, overlap, cosine, compactForEmbedding
};
