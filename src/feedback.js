export function recordFeedback(db, input) {
  const candidate = String(input.candidateAppId || input.candidate_app_id || '');
  const verdict = input.verdict;
  if (!candidate || !['positive', 'negative'].includes(verdict)) throw Object.assign(new Error('Retour de découverte invalide.'), { status: 400 });
  db.prepare(`INSERT INTO discovery_feedback(reference_app_id,candidate_app_id,motivation_key,verdict,created_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)`).run(String(input.referenceAppId || ''), candidate, String(input.motivationKey || ''), verdict);
  return { candidateAppId: candidate, verdict };
}
