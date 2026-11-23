import { assessProfileQuality } from './quality.js';
import { cosine, hash, normalizeText, parseJson, safeAppId, steamCover } from './utils.js';
import { transaction } from './db.js';
import { embedText } from './ollama.js';

function ageDays(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);
}

function historyPenalty(lastPresented, timesPresented) {
  const age = ageDays(lastPresented); const count = Number(timesPresented) || 0;
  if (!count) return 0;
  if (age <= 7) return Math.min(0.12, 0.07 + count * 0.012);
  if (age <= 30) return Math.min(0.09, 0.04 + count * 0.008);
  if (age <= 90) return Math.min(0.06, 0.02 + count * 0.005);
  return Math.min(0.02, count * 0.002);
}

function latestVerdict(db, candidate, reference, motivation) {
  return db.prepare(`
    SELECT verdict FROM discovery_feedback
    WHERE CAST(candidate_app_id AS TEXT)=?
      AND (reference_app_id=? OR motivation_key=?)
    ORDER BY id DESC LIMIT 1
  `).get(candidate, reference, motivation)?.verdict || null;
}

function candidateRows(db, reference) {
  return db.prepare(`
    SELECT CAST(g.app_id AS TEXT) app_id,g.title,g.studio,g.genres,g.cover_url,g.description,
           p.profile_json,p.embedding_json,p.confidence,p.source_json,
           MAX(rh.presented_at) last_presented,COUNT(rh.id) times_presented
    FROM games g
    JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN game_user_state us ON CAST(us.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN recommendation_history rh ON CAST(rh.candidate_app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE COALESCE(us.completed,0)=0 AND CAST(g.app_id AS TEXT)<>?
    GROUP BY g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,p.profile_json,p.embedding_json,p.confidence,p.source_json
  `).all(reference || '');
}

function selectDiverse(candidates, limit) {
  const pool = [...candidates]; const selected = [];
  while (pool.length && selected.length < limit) {
    let bestIndex = 0; let bestValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const item = pool[i];
      let duplication = 0;
      for (const prior of selected) {
        const similarity = cosine(item.vector, prior.vector);
        if (Number.isFinite(similarity)) duplication = Math.max(duplication, Math.max(0, similarity));
      }
      const diversityPenalty = duplication * 0.055;
      const value = item.ranking_score - diversityPenalty;
      if (value > bestValue) { bestValue = value; bestIndex = i; }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected;
}

export async function discover(db, config, input = {}) {
  const motivation = normalizeText(input.motivation_text);
  const reference = input.reference_app_id ? safeAppId(input.reference_app_id) : '';
  const limit = Math.min(30, Math.max(1, Number(input.limit) || config.discoveryLimit));
  let target = null;
  if (motivation) target = await embedText(config, motivation);
  if (!target && reference) target = parseJson(db.prepare('SELECT embedding_json FROM profiles WHERE CAST(app_id AS TEXT)=?').get(reference)?.embedding_json, null);
  const surprise = !target;
  const motivationKey = motivation.slice(0, 500);

  const rejected = { insufficient_quality: 0, invalid_embedding: 0 };
  const evaluated = [];
  for (const row of candidateRows(db, reference)) {
    const quality = assessProfileQuality(row);
    if (!quality.hasGrounding || quality.score < config.minProfileQuality) { rejected.insufficient_quality += 1; continue; }
    const vector = parseJson(row.embedding_json, []);
    if (!Array.isArray(vector) || !vector.length) { rejected.invalid_embedding += 1; continue; }
    const similarity = surprise ? null : cosine(target, vector);
    if (!surprise && !Number.isFinite(similarity)) { rejected.invalid_embedding += 1; continue; }
    const verdict = latestVerdict(db, row.app_id, reference, motivationKey);
    const feedbackAdjustment = verdict === 'positive' ? 0.03 : verdict === 'negative' ? -0.08 : 0;
    const noveltyPenalty = historyPenalty(row.last_presented, row.times_presented);
    // La qualité sert de garde-fou et de départage ; elle ne transforme pas la similarité en probabilité.
    const base = surprise ? 0.45 + quality.score * 0.30 : similarity;
    const ranking = base + feedbackAdjustment - noveltyPenalty + quality.score * 0.015;
    const profile = parseJson(row.profile_json, {}) || {};
    evaluated.push({
      app_id: row.app_id, title: row.title, studio: row.studio, genres: row.genres,
      cover_url: row.cover_url || steamCover(row.app_id), summary: profile.summary || row.description || '',
      similarity: similarity == null ? null : Math.round(similarity * 1000) / 1000,
      score: similarity == null ? null : Math.round(similarity * 1000) / 1000,
      reliability: quality.label, profile_quality: quality.score,
      reliability_notes: quality.reasons,
      feedback: verdict, previously_presented: Number(row.times_presented) || 0,
      ranking_score: ranking, vector
    });
  }
  evaluated.sort((a, b) => b.ranking_score - a.ranking_score || a.title.localeCompare(b.title, 'fr'));
  const selected = selectDiverse(evaluated.slice(0, Math.max(limit * 8, 80)), limit);
  const requestKey = hash(JSON.stringify({ reference, motivation: motivationKey, surprise, day: new Date().toISOString().slice(0, 10) }));
  transaction(db, () => {
    const insert = db.prepare(`INSERT INTO recommendation_history(request_key,reference_app_id,motivation_key,candidate_app_id,rank,similarity,profile_quality,presented_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
    selected.forEach((row, index) => insert.run(requestKey, reference, motivationKey, row.app_id, index + 1, row.similarity, row.profile_quality));
  });
  return {
    items: selected.map(({ vector, ranking_score, ...row }) => row),
    mode: surprise ? 'surprise' : motivation ? 'motivation' : 'reference',
    rejected,
    notice: 'Le pourcentage affiché mesure une proximité vectorielle, pas une probabilité d’appréciation.'
  };
}

export function recordFeedback(db, input = {}) {
  const candidate = safeAppId(input.candidate_app_id);
  const reference = input.reference_app_id && input.reference_app_id !== '__motivation__' ? safeAppId(input.reference_app_id) : '';
  const motivation = normalizeText(input.motivation_key).slice(0, 500);
  const verdict = input.verdict;
  if (!['positive', 'negative'].includes(verdict)) throw Object.assign(new Error('Verdict invalide.'), { status: 400 });
  db.prepare(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(reference, candidate, motivation, verdict);
  return { ok: true, candidate_app_id: candidate, verdict };
}

export function discoveryHistory(db, limit = 50) {
  return db.prepare(`SELECT request_key,reference_app_id,motivation_key,candidate_app_id,rank,similarity,profile_quality,presented_at FROM recommendation_history ORDER BY id DESC LIMIT ?`)
    .all(Math.min(200, Math.max(1, Number(limit) || 50)));
}
