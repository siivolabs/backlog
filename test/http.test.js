import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/db.js';
import { createBacklogServer } from '../src/http.js';

test('démarre, expose healthz et permet de marquer un jeu terminé', async (t) => {
  const db = openDatabase(':memory:', { backup: false });
  db.prepare("INSERT INTO games(app_id,title) VALUES ('400','Portal')").run();
  db.prepare("INSERT OR IGNORE INTO game_user_state(app_id,completed) VALUES ('400',0)").run();
  const config = { dbPath: ':memory:', adminToken: 'secret', discoveryMinQuality: 0.45, recentDays: 30, enrichmentBatchSize: 10 };
  const { server } = createBacklogServer(config, { db, backup: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.status, 'ok'); assert.equal(health.version, '1.2.1'); assert.equal(health.games, 1);
  const response = await fetch(`${base}/api/games/400/completed`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: true }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, 1);
});
