import { clamp, normalizeText, parseJson } from './utils.js';

function substantive(value, length) { return normalizeText(value).length >= length; }

function motivationList(profile) {
  if (Array.isArray(profile?.motivations)) return profile.motivations;
  if (Array.isArray(profile?.intentions)) return profile.intentions;
  return [];
}

export function assessProfileQuality(row) {
  const profile = parseJson(row.profile_json, {}) || {};
  const source = parseJson(row.source_json, {}) || {};
  const motivations = motivationList(profile);
  const confidenceRaw = row.confidence ?? profile.confidence;
  const confidence = Number.isFinite(Number(confidenceRaw)) ? clamp(confidenceRaw) : null;
  const description = row.description || source.description || source.short_description || '';
  const summary = profile.summary || profile.resume || '';
  const evidence = motivations.filter((item) => substantive(item?.evidence || item?.justification, 20));
  const metadata = [row.studio || source.studio || source.developer, row.genres || source.genres].filter((v) => normalizeText(v).length > 1).length;
  const dimensions = ['pace', 'challenge', 'agency', 'social', 'tone']
    .filter((key) => substantive(profile[key], 8)).length;

  let score = 0;
  const reasons = [];
  if (confidence !== null) score += confidence * 0.25;
  else reasons.push('confiance non renseignée');
  if (substantive(description, 120)) score += 0.20;
  else if (substantive(description, 50)) score += 0.10;
  else reasons.push('description source trop courte');
  if (metadata >= 2) score += 0.10;
  else if (metadata === 1) score += 0.05;
  else reasons.push('studio et genres absents');
  if (substantive(summary, 100)) score += 0.15;
  else if (substantive(summary, 45)) score += 0.08;
  else reasons.push('résumé expérientiel insuffisant');
  if (evidence.length >= 2) score += 0.20;
  else if (evidence.length === 1) score += 0.10;
  else reasons.push('aucune motivation étayée');
  if (dimensions >= 4) score += 0.10;
  else if (dimensions >= 2) score += 0.05;
  else reasons.push('dimensions expérientielles trop peu décrites');

  const hasGrounding = substantive(description, 50) || substantive(summary, 45) || evidence.length > 0;
  score = Math.round(clamp(score) * 1000) / 1000;
  const label = !hasGrounding || score < 0.35 ? 'insuffisante' : score < 0.55 ? 'fragile' : score < 0.75 ? 'suffisante' : 'solide';
  return { score, label, reasons, hasGrounding, confidence };
}
