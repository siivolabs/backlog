'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptProfile, normalizeProfile, compactForEmbedding, PROFILE_ADAPTER_VERSION } = require('../lib/network-profile');

test('convertit un ancien profil V1 imbriqué et francophone vers le socle comparable', () => {
  const legacy = {
    version: 'v1',
    analyse: {
      dimensions: {
        boucles_de_jeu: ['Explorer', 'Combattre', 'Résoudre des énigmes'],
        narration: { structure: 'environnementale', ton: 'mystérieux' },
        exploration_du_monde: 'Monde semi-ouvert interconnecté',
        structure_du_jeu: 'Missions reliées à un hub central',
        rythme: 'Alternance de tension et de respiration',
        systemes_de_progression: ['pouvoirs', 'améliorations'],
        difficulte: 'Défi modulable fondé sur la maîtrise',
        ambiance: ['surnaturelle', 'brutaliste'],
        multijoueur: 'solo',
        point_de_vue: 'troisième personne',
        elements_distinctifs: ['télékinésie', 'architecture mouvante']
      },
      sources: [{ themes: ['ce champ documentaire ne doit pas devenir une dimension'] }]
    }
  };

  const adapted = adaptProfile(legacy);
  const normalized = normalizeProfile(legacy);
  assert.equal(adapted.adapterVersion, PROFILE_ADAPTER_VERSION);
  assert.equal(adapted.recognizedDimensions, 11);
  assert.equal(normalized.populatedDimensions, 11);
  assert.equal(normalized.completeness, 1);
  assert.equal(normalized.adapted, true);
  assert.match(normalized.sourcePaths.gameplay, /boucles_de_jeu/);
  assert.match(compactForEmbedding(legacy), /gameplay:.*explorer/i);
  assert.doesNotMatch(compactForEmbedding(legacy), /champ documentaire/i);
});

test('ne fabrique pas de dimensions à partir d’un profil réellement insuffisant', () => {
  const profile = { schema: 'v1', summary: 'Une courte description générique.', sources: [{ title: 'Source', themes: ['action'] }] };
  const normalized = normalizeProfile(profile);
  assert.equal(normalized.populatedDimensions, 0);
  assert.equal(normalized.completeness, 0);
});
