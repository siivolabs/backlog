import { columns } from './db.js';

export function recordFeedback(db, input) {
  const candidate = String(input.candidateAppId || input.candidate_app_id || '');
  const reference = String(input.referenceAppId || input.reference_app_id || '');
  const motivation = String(input.motivationKey || input.motivation_key || '');
  const verdict = input.verdict;
  if (!candidate || !['positive', 'negative'].includes(verdict)) throw Object.assign(new Error('Retour de découverte invalide.'), { status: 400 });
  const available = columns(db, 'discovery_feedback');
  if (!['reference_app_id', 'candidate_app_id', 'motivation_key', 'verdict'].every((name) => available.has(name))) {
    throw Object.assign(new Error('Historique de retours incompatible; aucune table ne sera créée automatiquement.'), { status: 409 });
  }
  if (available.has('updated_at') && !available.has('created_at')) {
    db.prepare(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(reference_app_id,candidate_app_id,motivation_key) DO UPDATE SET verdict=excluded.verdict,updated_at=CURRENT_TIMESTAMP`)
      .run(reference, candidate, motivation, verdict);
  } else {
    db.prepare(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`)
      .run(reference, candidate, motivation, verdict);
  }
  return { candidateAppId: candidate, verdict };
}
