import test from 'node:test';
import assert from 'node:assert/strict';
import { importInventory, listLibrary, profileDetails, searchLibrary, setCompleted } from '../src/library.js';
import { seededDb } from './helpers.js';

test('la bibliothèque recherche titre, studio et AppID', () => {
  const db = seededDb();
  assert.equal(searchLibrary(db, 'Mushroom')[0].app_id, '101');
  assert.ok(searchLibrary(db, 'Studio').length >= 2);
  assert.equal(searchLibrary(db, '102')[0].title, 'Everything'); db.close();
});

test('le statut Terminé peut être activé puis annulé', () => {
  const db = seededDb();
  assert.equal(setCompleted(db, '101', true).completed, true);
  assert.equal(listLibrary(db, { status: 'completed' }).items[0].app_id, '101');
  assert.equal(setCompleted(db, '101', false).completed, false);
  assert.equal(listLibrary(db, { status: 'completed' }).total, 0); db.close();
});

test('la fiche restitue profil, source, embedding et modèles', () => {
  const db = seededDb(); const details = profileDetails(db, '101');
  assert.equal(details.title, 'Mushroom 11'); assert.ok(details.profile.summary); assert.deepEqual(details.embedding, [0.98, 0.1, 0]); assert.equal(details.analysis_model, 'test'); db.close();
});

test('l’import Steam préserve les profils existants', () => {
  const db = seededDb();
  const result = importInventory(db, { response: { games: [{ appid: 101, name: 'Mushroom 11 mis à jour', playtime_forever: 270 }, { appid: 999, name: 'Nouveau jeu' }] } });
  assert.equal(result.imported, 2); assert.ok(db.prepare('SELECT 1 found FROM profiles WHERE app_id=?').get('101')); assert.equal(db.prepare('SELECT title FROM games WHERE app_id=?').get('101').title, 'Mushroom 11 mis à jour'); db.close();
});

test('la pagination reste bornée après un filtre vide', () => {
  const db = seededDb(); const page = listLibrary(db, { page: 99, pageSize: 2, search: 'aucun résultat' });
  assert.equal(page.total, 0); assert.equal(page.page, 1); assert.equal(page.pages, 1); db.close();
});
