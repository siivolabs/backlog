'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfile, cosine } = require('../lib/profile');
const { scorePair, buildPairs } = require('../lib/network');

test('normalise des profils hétérogènes vers les dimensions communes', () => {
  const profile = normalizeProfile({
    gameplay_loops: [{ action: 'Construction et automatisation d’usines', cadence: 'continuous' }],
    narrative_structure: { form: 'environmental', agency: 'low' },
    world_exploration: { structure: 'open world', traversal: ['vehicles', 'jetpack'] },
    atmosphere_theme: { themes: ['industrial', 'exploration'] },
    distinctive_elements: ['first-person factory building']
  });
  assert.ok(profile.dimensions.gameplay.includes('construction'));
  assert.ok(profile.dimensions.atmosphere.includes('industrial'));
  assert.equal(profile.populatedDimensions, 5);
  assert.equal(profile.totalDimensions, 11);
});

test('cosine renvoie une similarité normalisée', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), 0);
  assert.equal(cosine([1], [1, 2]), null);
});

test('le score structuré fonctionne sans embedding', () => {
  const left = normalizeProfile({ gameplay: ['automation', 'factory'], atmosphere: ['industrial'] });
  const right = normalizeProfile({ gameplay: ['automation', 'logistics'], atmosphere: ['industrial'] });
  const result = scorePair(left, right, null, null);
  assert.equal(result.mode, 'structured-only');
  assert.ok(result.score > 0.4);
  assert.equal(result.semanticScore, null);
});

test('50 profils produisent 1225 paires uniques', () => {
  const profiles = Array.from({ length: 50 }, (_, index) => ({
    appId: String(index + 1), versionId: index + 100,
    normalized: normalizeProfile({ gameplay: [`loop-${index % 5}`], structure: ['mission'] }),
    embedding: [1, index / 50, 0.5]
  }));
  const pairs = buildPairs(profiles);
  assert.equal(pairs.length, 1225);
  assert.equal(new Set(pairs.map((pair) => `${pair.leftAppId}:${pair.rightAppId}`)).size, 1225);
});
