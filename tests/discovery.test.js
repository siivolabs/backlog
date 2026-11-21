import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { discover, saveFeedback } from '../src/discovery.js';
import { tempDir, v1Database } from './helpers.js';

test('Découverte utilise les profils V1.0 et persiste session et correction', async () => {
  const db = v1Database(path.join(tempDir(), 'discovery.sqlite'));
  db.prepare("INSERT INTO profiles(app_id,schema_version,profile_json,embedding_json,source_json,confidence) VALUES('20','core-v1','{\"summary\":\"Calme\"}','[0.9,0.1,0]','{}',.8),('30','core-v1','{\"summary\":\"Lent\"}','[0,1,0]','{}',.8)").run();
  const results = await discover(db, { reference_app_id: '10', limit: 2 }, {}, async () => [1,0,0]);
  assert.equal(results[0].app_id, '20');
  saveFeedback(db, { reference_app_id: '10', candidate_app_id: '30', motivation_key: 'test', verdict: 'negative' });
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM discovery_sessions').get().count), 1);
  assert.equal(db.prepare("SELECT verdict FROM discovery_feedback WHERE candidate_app_id='30'").get().verdict, 'negative');
  db.close();
});
