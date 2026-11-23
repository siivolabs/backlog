import crypto from 'node:crypto';
import { parseJson, clamp } from './json.js';
import { assessProfile } from './profile-quality.js';

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]), y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function stableNoise(seed, appId) {
  const bytes = crypto.createHash('sha256').update(`${seed}:${appId}`).digest();
  return bytes.readUInt32BE(0) / 0xffffffff;
}

function genreSet(value) {
  const parsed = parseJson(value, null);
  const list = Array.isArray(parsed) ? parsed : String(value || '').split(',');
  return new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count / Math.min(a.size, b.size);
}

export function discover(db, options = {}) {
  const limit = Math.min(24, Math.max(1, Number(options.limit) || 12));
  const minQuality = clamp(options.minQuality ?? 0.45);
  const recentDays = Math.max(0, Number(options.recentDays) || 30);
  const referenceAppId = String(options.referenceAppId || '');
  const motivationKey = String(options.motivationKey || options.query || (options.surprise ? 'surprise' : ''));
  let target = Array.isArray(options.embedding) ? options.embedding : null;
  if (!target && referenceAppId) {
    target = parseJson(db.prepare('SELECT embedding_json FROM profiles WHERE CAST(app_id AS TEXT)=?').get(referenceAppId)?.embedding_json, null);
  }
  if (!target && !options.surprise) throw Object.assign(new Error('Aucun embedding exploitable pour cette découverte.'), { status: 422 });

  const rows = db.prepare(`
    SELECT g.app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,
      p.profile_json,p.embedding_json,p.confidence,p.source_json,p.analysis_model,p.embedding_model,
      COALESCE(s.completed,0) completed,
      (SELECT verdict FROM discovery_feedback f WHERE CAST(f.candidate_app_id AS TEXT)=CAST(g.app_id AS TEXT)
       ORDER BY COALESCE(f.created_at,'') DESC,f.rowid DESC LIMIT 1) verdict,
      (SELECT MAX(presented_at) FROM recommendation_history h WHERE CAST(h.candidate_app_id AS TEXT)=CAST(g.app_id AS TEXT)) last_presented_at
    FROM games g JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    LEFT JOIN game_user_state s ON CAST(s.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE COALESCE(s.completed,0)=0 AND CAST(g.app_id AS TEXT)<>?
  `).all(referenceAppId);

  const seed = options.requestKey || `${new Date().toISOString().slice(0, 10)}:${motivationKey}:${referenceAppId}`;
  const scored = [];
  for (const row of rows) {
    const quality = assessProfile(row);
    if (!quality.eligible || quality.score < minQuality) continue;
    const similarity = target ? cosine(target, quality.embedding) : 0;
    const feedback = row.verdict === 'positive' ? 0.035 : row.verdict === 'negative' ? -0.15 : 0;
    const age = row.last_presented_at ? (Date.now() - Date.parse(row.last_presented_at)) / 86400000 : Infinity;
    const recentPenalty = age < recentDays ? 0.18 * (1 - age / Math.max(1, recentDays)) : 0;
    const exploration = stableNoise(seed, row.app_id) * (options.surprise ? 0.3 : 0.04);
    const base = options.surprise ? quality.score * 0.65 + exploration : similarity * 0.72 + quality.score * 0.24 + exploration;
    scored.push({ ...row, similarity, profileQuality: quality.score, qualityReasons: quality.reasons, score: base + feedback - recentPenalty, genresSet: genreSet(row.genres) });
  }
  scored.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), 'fr'));

  const selected = [];
  for (const candidate of scored) {
    const duplicatePenalty = selected.reduce((max, item) => Math.max(max, overlap(candidate.genresSet, item.genresSet)), 0) * 0.12;
    candidate.diversifiedScore = candidate.score - duplicatePenalty;
    const insertion = selected.findIndex((item) => candidate.diversifiedScore > item.diversifiedScore);
    if (insertion < 0) selected.push(candidate); else selected.splice(insertion, 0, candidate);
    if (selected.length > limit * 2) selected.length = limit * 2;
  }
  const results = selected.slice(0, limit).map(({ genresSet, ...row }, index) => ({ ...row, rank: index + 1 }));
  const requestKey = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
  const insert = db.prepare(`INSERT INTO recommendation_history
    (request_key,reference_app_id,motivation_key,candidate_app_id,rank,similarity,profile_quality,presented_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
  for (const item of results) insert.run(requestKey, referenceAppId, motivationKey, String(item.app_id), item.rank, item.similarity, item.profileQuality);
  return { requestKey, results, excludedForQuality: rows.length - scored.length, message: results.length ? null : 'Aucun profil suffisamment documenté ne correspond à cette demande.' };
}
