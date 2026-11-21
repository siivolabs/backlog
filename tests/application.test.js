import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { tempDir, v1Database, until } from './helpers.js';

async function runningApp(processor = async (game) => ({ profile: { summary: game.title }, embedding: [1,0], source: {}, analysisModel: 'test', embeddingModel: 'test', confidence: .7 })) {
  const db = v1Database(path.join(tempDir(), 'app.sqlite'));
  const app = createApp({ db, processor, config: { version: '1.1.3', port: 0, databasePath: '', adminToken: 'secret', ollamaBaseUrl: '', analysisModel: 'test', embeddingModel: 'test', steamEnrichmentEnabled: false, requestTimeoutMs: 1000 }, embed: async () => [1,0,0] });
  await app.listen(0, '127.0.0.1');
  const { port } = app.server.address();
  return { app, base: `http://127.0.0.1:${port}` };
}

test('parcours HTTP protège les mutations par jeton administrateur', async () => {
  const { app, base } = await runningApp();
  let response = await fetch(`${base}/api/enrichment/start`, { method: 'POST' });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/enrichment/start`, { method: 'POST', headers: { 'x-admin-token': 'secret' } });
  assert.equal(response.status, 200);
  await until(async () => (await (await fetch(`${base}/api/enrichment/status`)).json()).campaign.status === 'completed');
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.status, 'ok');
  await app.close();
});

test('interface livre l’identité bleue, les couvertures, la Découverte et le suivi des erreurs', async () => {
  const { app, base } = await runningApp();
  const html = await (await fetch(base)).text();
  const css = await (await fetch(`${base}/styles.css`)).text();
  assert.match(html, /Jeton administrateur/);
  assert.match(html, /Importer l’inventaire/);
  assert.match(html, /Suivi des erreurs/);
  assert.match(html, /Découverte/);
  assert.match(html, /gameGrid/);
  assert.match(css, /--blue:#2188ff/);
  const library = await (await fetch(`${base}/api/library?pageSize=10`)).json();
  assert.ok(library.items.every((item) => item.cover_url));
  await app.close();
});
