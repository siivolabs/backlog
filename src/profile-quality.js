import { clamp, parseJson } from './json.js';

const UNCERTAIN = /(inconnu|inconnue|unknown|non renseign|absence de donn|sans information|sp[ée]cul|impossible.{0,30}(analy|détermin)|aucune information)/gi;

function text(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value ?? ''); } catch { return ''; }
}

export function assessProfile(row) {
  const profile = parseJson(row.profile_json, {});
  const sources = parseJson(row.source_json, []);
  const profileText = text(profile);
  const sourceCount = Array.isArray(sources) ? sources.length : sources && typeof sources === 'object' ? Object.keys(sources).length : 0;
  const present = [row.title, row.studio, row.genres, row.description].filter((value) => String(value || '').trim()).length;
  const embedding = parseJson(row.embedding_json, []);
  const embeddingOk = Array.isArray(embedding) && embedding.length >= 8 && embedding.every(Number.isFinite);
  const uncertaintyHits = (profileText.match(UNCERTAIN) || []).length;
  const confidence = Number.isFinite(Number(row.confidence)) ? clamp(row.confidence) : null;

  let score = confidence ?? 0.32;
  score += Math.min(0.2, present * 0.05);
  score += Math.min(0.15, sourceCount * 0.05);
  if (sourceCount === 0) score -= 0.15;
  if (profileText.length >= 250) score += 0.08;
  if (embeddingOk) score += 0.1;
  score -= Math.min(0.55, uncertaintyHits * 0.14);
  score = clamp(score);

  const reasons = [];
  if (!embeddingOk) reasons.push('embedding absent ou inexploitable');
  if (present < 2) reasons.push('métadonnées du jeu insuffisantes');
  if (sourceCount === 0) reasons.push('aucune source documentaire enregistrée');
  if (uncertaintyHits) reasons.push(`${uncertaintyHits} marqueur(s) d’incertitude`);
  return { score, eligible: embeddingOk && score >= 0.45, reasons, sourceCount, uncertaintyHits, embedding };
}
