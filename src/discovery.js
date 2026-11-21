import crypto from 'node:crypto';
import { parseJson } from './db.js';

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]), y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export function motivationKey(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLocaleLowerCase('fr')).digest('hex').slice(0, 24);
}

function explanation(reference, candidate, motivation) {
  const refProfile = parseJson(reference.profile_json, {});
  const candidateProfile = parseJson(candidate.profile_json, {});
  const refAxes = new Set(refProfile.experiential_axes || []);
  const overlap = (candidateProfile.experiential_axes || []).filter((axis) => refAxes.has(axis)).slice(0, 3);
  if (overlap.length) return `Résonance expérientielle : ${overlap.join(', ')}.`;
  if (motivation) return `Ce profil se rapproche de la motivation « ${motivation.slice(0, 120)} » au-delà des genres.`;
  return `Proximité globale avec l'expérience de ${reference.title}.`;
}

export class DiscoveryEngine {
  constructor({ db, embedText }) {
    this.db = db;
    this.embedText = embedText;
  }

  async discover({ referenceAppId, motivationText = '', limit = 12 }) {
    const reference = this.db.prepare(`SELECT g.*,p.profile_json,p.embedding_json FROM games g JOIN profiles p ON p.app_id=g.app_id WHERE g.app_id=?`).get(String(referenceAppId));
    if (!reference) throw new Error('Le jeu de référence doit être enrichi.');
    const referenceEmbedding = parseJson(reference.embedding_json, null);
    if (!Array.isArray(referenceEmbedding)) throw new Error('Le profil de référence ne possède pas d’embedding.');
    const motivation = String(motivationText || '').trim();
    const motivationEmbedding = motivation ? await this.embedText(motivation) : null;
    const key = motivationKey(motivation);
    const feedback = new Map(this.db.prepare(`SELECT candidate_app_id,verdict FROM discovery_feedback WHERE reference_app_id=? AND motivation_key=?`).all(String(referenceAppId), key).map((row) => [row.candidate_app_id, row.verdict]));
    const candidates = this.db.prepare(`
      SELECT g.app_id,g.title,g.studio,g.cover_url,g.genres,p.profile_json,p.embedding_json,p.confidence
      FROM games g JOIN profiles p ON p.app_id=g.app_id WHERE g.app_id<>?
    `).all(String(referenceAppId));
    const results = candidates.map((candidate) => {
      const vector = parseJson(candidate.embedding_json, null);
      const referenceScore = cosine(referenceEmbedding, vector);
      const motivationScore = motivationEmbedding ? cosine(motivationEmbedding, vector) : referenceScore;
      const verdict = feedback.get(candidate.app_id);
      const adjustment = verdict === 'positive' ? 0.04 : verdict === 'negative' ? -0.08 : 0;
      const score = Math.max(0, Math.min(1, 0.65 * referenceScore + 0.35 * motivationScore + adjustment));
      return {
        app_id: candidate.app_id, title: candidate.title, studio: candidate.studio,
        cover_url: candidate.cover_url, genres: candidate.genres,
        score: Number(score.toFixed(4)), reference_score: Number(referenceScore.toFixed(4)),
        motivation_score: Number(motivationScore.toFixed(4)), previous_verdict: verdict || null,
        explanation: explanation(reference, candidate, motivation)
      };
    }).filter((item) => Number.isFinite(item.score)).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(50, Number(limit) || 12)));

    const insert = this.db.prepare(`INSERT INTO discovery_sessions (reference_app_id,motivation_text,motivations_json,results_json) VALUES (?,?,?,?)`);
    const saved = insert.run(String(referenceAppId), motivation, JSON.stringify({ text: motivation, key }), JSON.stringify(results));
    return { session_id: Number(saved.lastInsertRowid), reference: { app_id: reference.app_id, title: reference.title }, motivation_key: key, results };
  }

  saveFeedback({ referenceAppId, candidateAppId, motivationText = '', verdict, note = null }) {
    if (!['positive', 'negative', 'neutral'].includes(verdict)) throw new Error('Verdict invalide.');
    const key = motivationKey(motivationText);
    this.db.prepare(`
      INSERT INTO discovery_feedback (reference_app_id,candidate_app_id,motivation_key,verdict,note)
      VALUES (?,?,?,?,?) ON CONFLICT(reference_app_id,candidate_app_id,motivation_key)
      DO UPDATE SET verdict=excluded.verdict,note=excluded.note,updated_at=datetime('now')
    `).run(String(referenceAppId), String(candidateAppId), key, verdict, note == null ? null : String(note));
    return { saved: true, motivation_key: key };
  }
}
