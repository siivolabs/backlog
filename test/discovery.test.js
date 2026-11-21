import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { DiscoveryEngine, motivationKey } from '../src/discovery.js';
import { createFaithfulV1Database, tempDatabase, insertProfile } from './helpers.js';

test('découverte utilise tous les profils V1.0 et mémorise session et correction', async () => {
  const temp = tempDatabase(); const fixture = createFaithfulV1Database(temp.file, 3);
  insertProfile(fixture,'1001',[1,0,0]); insertProfile(fixture,'1002',[0.9,0.1,0]); insertProfile(fixture,'1003',[0,1,0]); fixture.close();
  const db = openDatabase(temp.file); const engine = new DiscoveryEngine({ db, embedText: async () => [1,0,0] });
  const first = await engine.discover({ referenceAppId:'1001', motivationText:'exploration intime', limit:2 });
  assert.equal(first.results[0].app_id,'1002'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discovery_sessions').get().n,1);
  engine.saveFeedback({ referenceAppId:'1001', candidateAppId:'1002', motivationText:'exploration intime', verdict:'negative', note:'déjà connu' });
  const row = db.prepare('SELECT * FROM discovery_feedback').get();
  assert.equal(row.motivation_key,motivationKey('exploration intime')); assert.equal(row.verdict,'negative');
  const second = await engine.discover({ referenceAppId:'1001', motivationText:'exploration intime', limit:2 });
  assert.ok(second.results.find((r)=>r.app_id==='1002').score < first.results.find((r)=>r.app_id==='1002').score);
  db.close(); temp.cleanup();
});
