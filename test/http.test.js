import test from 'node:test';
import assert from 'node:assert/strict';
import { createBacklogServer } from '../src/http.js';
import { config, seededDb } from './helpers.js';

async function fixture() {
  const db = seededDb(); const { server } = createBacklogServer(config(), { db, disableWorker: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base, close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })) };
}

test('healthz expose la version 1.2.0', async () => { const app = await fixture(); const data = await fetch(`${app.base}/healthz`).then((r) => r.json()); assert.deepEqual(data, { status: 'ok', version: '1.2.0', database: 'ok' }); await app.close(); });

test('la recherche indépendante renvoie le véritable AppID', async () => { const app = await fixture(); const data = await fetch(`${app.base}/api/library/search?q=Mushroom`).then((r) => r.json()); assert.equal(data.items[0].app_id, '101'); await app.close(); });

test('la modification Terminé refuse un jeton absent', async () => { const app = await fixture(); const response = await fetch(`${app.base}/api/library/101/completed`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"completed":true}' }); assert.equal(response.status, 401); await app.close(); });

test('la modification Terminé accepte le jeton administrateur', async () => { const app = await fixture(); const response = await fetch(`${app.base}/api/library/101/completed`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-token': 'secret' }, body: '{"completed":true}' }); assert.equal(response.status, 200); assert.equal((await response.json()).completed, true); await app.close(); });

test('la découverte de référence fonctionne par HTTP', async () => { const app = await fixture(); const response = await fetch(`${app.base}/api/discovery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"reference_app_id":"100"}' }); const data = await response.json(); assert.equal(response.status, 200); assert.ok(data.items.some((item) => item.app_id === '101')); assert.ok(!data.items.some((item) => item.app_id === '103')); await app.close(); });

test('les fichiers statiques reçoivent des en-têtes de sécurité', async () => { const app = await fixture(); const response = await fetch(`${app.base}/`); assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-security-policy'), /default-src/); await app.close(); });
