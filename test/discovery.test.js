import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, recordFeedback } from '../src/discovery.js';
import { addGame, config, seededDb } from './helpers.js';

test('la découverte écarte un profil spéculatif malgré sa forte similarité', async () => {
  const db = seededDb(); const result = await discover(db, config(), { reference_app_id: '100' });
  assert.ok(result.items.some((item) => item.app_id === '101')); assert.ok(!result.items.some((item) => item.app_id === '103')); assert.equal(result.rejected.insufficient_quality, 1); db.close();
});

test('un jeu terminé est exclu mais son profil reste disponible', async () => {
  const db = seededDb(); db.prepare(`UPDATE game_user_state SET completed=1 WHERE app_id='101'`).run();
  const result = await discover(db, config(), { reference_app_id: '100' });
  assert.ok(!result.items.some((item) => item.app_id === '101')); assert.ok(db.prepare(`SELECT 1 found FROM profiles WHERE app_id='101'`).get()); db.close();
});

test('l’historique renouvelle le premier candidat', async () => {
  const db = seededDb();
  for (let i = 0; i < 10; i += 1) db.prepare(`INSERT INTO recommendation_history(request_key,candidate_app_id,rank,presented_at) VALUES('old','101',1,CURRENT_TIMESTAMP)`).run();
  const result = await discover(db, config({ discoveryLimit: 1 }), { reference_app_id: '100' });
  assert.equal(result.items[0].app_id, '102'); db.close();
});

test('un retour négatif dépriorise le candidat sans supprimer son profil', async () => {
  const db = seededDb(); recordFeedback(db, { reference_app_id: '100', candidate_app_id: '101', motivation_key: '', verdict: 'negative' });
  const result = await discover(db, config({ discoveryLimit: 1 }), { reference_app_id: '100' });
  assert.equal(result.items[0].app_id, '102'); assert.ok(db.prepare(`SELECT 1 found FROM profiles WHERE app_id='101'`).get()); db.close();
});

test('le mode Surprends-moi fonctionne sans référence ni motivation', async () => {
  const db = seededDb(); const result = await discover(db, config({ discoveryLimit: 2 }), {});
  assert.equal(result.mode, 'surprise'); assert.equal(result.items.length, 2); assert.ok(result.items.every((item) => item.similarity === null)); db.close();
});

test('les résultats enregistrent une mémoire de présentation', async () => {
  const db = seededDb(); const result = await discover(db, config({ discoveryLimit: 2 }), { reference_app_id: '100' });
  const count = db.prepare('SELECT COUNT(*) count FROM recommendation_history').get().count; assert.equal(count, result.items.length); db.close();
});

test('la sélection favorise aussi la diversité des embeddings', async () => {
  const db = seededDb(); addGame(db, { appId: '104', title: 'Clone proche', vector: [0.981, 0.09, 0] }); addGame(db, { appId: '105', title: 'Piste différente', vector: [0.82, 0.2, 0.5] });
  const result = await discover(db, config({ discoveryLimit: 3 }), { reference_app_id: '100' }); assert.equal(new Set(result.items.map((item) => item.app_id)).size, 3); db.close();
});
