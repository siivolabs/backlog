'use strict';

const { cosine, jaccard, overlap } = require('./profile');
const { round } = require('./utils');

const GROUPS = Object.freeze({
  gameplay: { weight: 0.20, dimensions: ['gameplay'] },
  narrativeAtmosphere: { weight: 0.20, dimensions: ['narrative', 'atmosphere'] },
  structureExploration: { weight: 0.15, dimensions: ['structure', 'exploration'] },
  other: { weight: 0.05, dimensions: ['pace', 'progression', 'difficulty', 'mode', 'perspective', 'identity'] }
});

function average(values) {
  const usable = values.filter((value) => value !== null && Number.isFinite(value));
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

function dimensionScores(left, right) {
  return Object.fromEntries(Object.keys(left.dimensions).map((name) => [
    name,
    jaccard(left.dimensions[name], right.dimensions[name])
  ]));
}

function scorePair(left, right, leftEmbedding, rightEmbedding) {
  const dimensions = dimensionScores(left, right);
  const semantic = cosine(leftEmbedding, rightEmbedding);
  const components = {};
  for (const [name, group] of Object.entries(GROUPS)) {
    components[name] = average(group.dimensions.map((dimension) => dimensions[dimension]));
  }

  const available = [];
  if (semantic !== null) available.push({ name: 'semantic', value: semantic, weight: 0.40 });
  for (const [name, group] of Object.entries(GROUPS)) {
    if (components[name] !== null) available.push({ name, value: components[name], weight: group.weight });
  }
  const totalWeight = available.reduce((total, item) => total + item.weight, 0);
  const score = totalWeight
    ? available.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight
    : 0;

  const ranked = Object.entries(dimensions)
    .filter(([, value]) => value !== null)
    .sort((a, b) => b[1] - a[1]);
  const similarities = ranked.slice(0, 2).map(([dimension, value]) => ({
    dimension,
    score: round(value),
    shared: overlap(left.dimensions[dimension], right.dimensions[dimension])
  }));
  const differences = ranked.slice(-2).reverse().map(([dimension, value]) => ({
    dimension,
    score: round(value)
  }));

  return {
    score: round(score),
    semanticScore: semantic === null ? null : round(semantic),
    structuredScore: round(average(Object.values(components)) || 0),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value === null ? null : round(value)])),
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, value === null ? null : round(value)])),
    explanation: { similarities, differences },
    mode: semantic === null ? 'structured-only' : 'hybrid'
  };
}

function buildPairs(profiles) {
  const pairs = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const left = profiles[i]; const right = profiles[j];
      pairs.push({
        leftAppId: left.appId,
        rightAppId: right.appId,
        leftVersionId: left.versionId,
        rightVersionId: right.versionId,
        ...scorePair(left.normalized, right.normalized, left.embedding, right.embedding)
      });
    }
  }
  return pairs;
}

module.exports = { GROUPS, scorePair, buildPairs };
