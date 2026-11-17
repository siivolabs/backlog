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
