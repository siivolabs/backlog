import { json } from './db.js';
import { steamCover } from './library.js';
import { embedText } from './ollama.js';

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export async function discover(db, input, config, embed = embedText) {
  const referenceAppId = String(input.reference_app_id || '').trim();
  const motivation = String(input.motivation_text || '').trim();
  const limit = Math.min(30, Math.max(1, Number(input.limit) || 12));
  const referenceKey = referenceAppId || '__motivation__';
  if (!referenceAppId && !motivation) throw new Error('Choisissez un jeu de référence ou décrivez une motivation.');
  let target = null;
  if (motivation) target = await embed(motivation, config);
  if (!target && referenceAppId) target = json(db.prepare('SELECT embedding_json FROM profiles WHERE CAST(app_id AS TEXT)=?').get(referenceAppId)?.embedding_json, null);
  if (!target) throw new Error('Aucun embedding exploitable pour cette découverte.');
  const feedback = new Map(db.prepare('SELECT candidate_app_id, verdict FROM discovery_feedback WHERE reference_app_id=?').all(referenceKey).map((row) => [String(row.candidate_app_id), row.verdict]));
  const results = db.prepare(`
    SELECT g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,p.profile_json,p.embedding_json
    FROM profiles p JOIN games g ON CAST(g.app_id AS TEXT)=CAST(p.app_id AS TEXT)
    WHERE CAST(g.app_id AS TEXT)<>?
  `).all(referenceAppId).map((row) => {
    const score = cosine(target, json(row.embedding_json, []));
    const verdict = feedback.get(String(row.app_id));
    const adjusted = score + (verdict === 'positive' ? 0.03 : verdict === 'negative' ? -0.08 : 0);
    const profile = json(row.profile_json, {});
    return { app_id: String(row.app_id), title: row.title, studio: row.studio, genres: row.genres, cover_url: row.cover_url || steamCover(row.app_id), summary: profile.summary || row.description, score: Math.round(adjusted * 1000) / 1000, feedback: verdict || null };
  }).filter((row) => Number.isFinite(row.score)).sort((a, b) => b.score - a.score).slice(0, limit);
  db.prepare('INSERT INTO discovery_sessions(reference_app_id,motivation_text,motivations_json,results_json) VALUES(?,?,?,?)').run(referenceKey, motivation, JSON.stringify(motivation ? [motivation] : []), JSON.stringify(results));
  return results;
}

export function saveFeedback(db, input) {
  const reference = String(input.reference_app_id || '').trim();
  const candidate = String(input.candidate_app_id || '').trim();
  const key = String(input.motivation_key || '').trim();
  const verdict = String(input.verdict || '').trim();
  if (!reference || !candidate || !['positive', 'negative', 'neutral'].includes(verdict)) throw new Error('Feedback incomplet ou invalide.');
  db.prepare(`
    INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,note,updated_at)
    VALUES(?,?,?,?,?,datetime('now'))
    ON CONFLICT(reference_app_id,candidate_app_id,motivation_key) DO UPDATE SET verdict=excluded.verdict,note=excluded.note,updated_at=datetime('now')
  `).run(reference, candidate, key, verdict, input.note || null);
  return { saved: true };
}
