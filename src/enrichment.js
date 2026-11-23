import { asJson, parseJson } from './json.js';

async function postJson(url, body, timeout = 120000) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function embedText(config, text) {
  const result = await postJson(`${config.ollamaUrl}/api/embed`, { model: config.embeddingModel, input: text });
  const embedding = result.embeddings?.[0] || result.embedding;
  if (!Array.isArray(embedding) || !embedding.length) throw new Error('Ollama n’a renvoyé aucun embedding.');
  return embedding;
}

function profilePrompt(game) {
  return `Analyse factuellement ce jeu pour un moteur de recommandation expérientielle. N'invente rien. Si les données sont insuffisantes, indique-le explicitement. Réponds en JSON avec: summary, experience, mechanics, pacing, mood, originality, duration, evidence, uncertainty.\nJEU: ${JSON.stringify(game)}`;
}

export async function enrichOne(db, config, appId) {
  const game = db.prepare('SELECT * FROM games WHERE CAST(app_id AS TEXT)=?').get(String(appId));
  if (!game) throw new Error('Jeu introuvable.');
  db.prepare("UPDATE enrichment_queue SET status='running',attempts=attempts+1,locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE app_id=?").run(String(appId));
  try {
    const generated = await postJson(`${config.ollamaUrl}/api/generate`, { model: config.analysisModel, prompt: profilePrompt(game), stream: false, format: 'json' });
    const profile = parseJson(generated.response, { summary: generated.response });
    const profileText = JSON.stringify(profile);
    const embedding = await embedText(config, profileText);
    const evidence = Array.isArray(profile.evidence) ? profile.evidence : [];
    const uncertainty = String(profile.uncertainty || '');
    const confidence = Math.max(0, Math.min(1, 0.35 + Math.min(0.35, evidence.length * 0.08) - (/insuffisant|unknown|inconnu|absence/i.test(uncertainty) ? 0.25 : 0)));
    db.prepare(`INSERT INTO profiles(app_id,profile_json,embedding_json,schema_version,analysis_model,embedding_model,confidence,source_json,updated_at)
      VALUES (?,?,?,'core-v1.2.1',?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(app_id) DO UPDATE SET profile_json=excluded.profile_json,embedding_json=excluded.embedding_json,
      schema_version=excluded.schema_version,analysis_model=excluded.analysis_model,embedding_model=excluded.embedding_model,
      confidence=excluded.confidence,source_json=excluded.source_json,updated_at=CURRENT_TIMESTAMP`).run(String(appId), asJson(profile, {}), asJson(embedding, []), config.analysisModel, config.embeddingModel, confidence, asJson(evidence, []));
    db.prepare("UPDATE enrichment_queue SET status='completed',last_error=NULL,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE app_id=?").run(String(appId));
    return { appId: String(appId), confidence };
  } catch (error) {
    db.prepare("UPDATE enrichment_queue SET status='error',last_error=?,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE app_id=?").run(String(error.message).slice(0, 2000), String(appId));
    throw error;
  }
}

export async function runEnrichmentBatch(db, config, requestedLimit) {
  const paused = db.prepare("SELECT value FROM app_settings WHERE key='enrichment_paused'").get()?.value === '1';
  if (paused) return { paused: true, processed: [] };
  const limit = Math.min(100, Math.max(1, Number(requestedLimit) || config.enrichmentBatchSize));
  const items = db.prepare("SELECT app_id FROM enrichment_queue WHERE status IN ('pending','error') ORDER BY attempts,updated_at LIMIT ?").all(limit);
  const processed = [];
  for (const item of items) {
    try { processed.push({ ok: true, ...(await enrichOne(db, config, item.app_id)) }); }
    catch (error) { processed.push({ ok: false, appId: item.app_id, error: error.message }); }
  }
  return { paused: false, processed };
}
