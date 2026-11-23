import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProfileQuality } from '../src/quality.js';
import { profile } from './helpers.js';

test('un profil étayé obtient une fiabilité suffisante ou solide', () => {
  const p = profile('Jeu');
  const result = assessProfileQuality({ profile_json: JSON.stringify(p), source_json: JSON.stringify({ description: 'x'.repeat(160), studio: 'Studio', genres: 'Aventure' }), description: 'x'.repeat(160), studio: 'Studio', genres: 'Aventure', confidence: 0.8 });
  assert.ok(result.score >= 0.75); assert.equal(result.hasGrounding, true); assert.equal(result.label, 'solide');
});

test('un embedding sans contenu n’est pas considéré comme une preuve', () => {
  const result = assessProfileQuality({ profile_json: JSON.stringify({ summary: 'Analyse spéculative.', confidence: 0.1 }), source_json: '{}', description: '', studio: '', genres: '', confidence: 0.1 });
  assert.equal(result.hasGrounding, false); assert.equal(result.label, 'insuffisante'); assert.ok(result.score < 0.35);
});

test('la qualité documentaire ne dépend pas de la popularité', () => {
  const p = profile('Indépendant', 0.7);
  const result = assessProfileQuality({ profile_json: JSON.stringify(p), source_json: JSON.stringify({ description: 'd'.repeat(130) }), description: 'd'.repeat(130), studio: '', genres: '', confidence: 0.7 });
  assert.equal(result.hasGrounding, true); assert.ok(result.score >= 0.55);
});
