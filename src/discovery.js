import crypto from 'node:crypto';
import { parseJson, clamp } from './json.js';
import { assessProfile } from './profile-quality.js';
import { columns, tableExists } from './db.js';
import { steamCover } from './library.js';

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
function latestVerdict(db, candidate, reference, motivation) {
  const feedback = columns(db, 'discovery_feedback');
  if (!['candidate_app_id', 'reference_app_id', 'motivation_key', 'verdict'].every((name) => feedback.has(name))) return null;
  const order = feedback.has('created_at') ? 'created_at DESC' : feedback.has('updated_at') ? 'updated_at DESC' : 'rowid DESC';
  return db.prepare(`SELECT verdict FROM discovery_feedback WHERE CAST(candidate_app_id AS TEXT)=? AND (CAST(reference_app_id AS TEXT)=? OR motivation_key=?) ORDER BY ${order} LIMIT 1`)
    .get(candidate, reference, motivation)?.verdict || null;
}
function candidateRows(db, reference) {
  const state = columns(db, 'game_user_state');
  const stateJoin = state.has('app_id') && state.has('completed') ? 'LEFT JOIN game_user_state us ON CAST(us.app_id AS TEXT)=CAST(g.app_id AS TEXT)' : '';
  const stateFilter = stateJoin ? 'COALESCE(us.completed,0)=0' : '1=1';
  const history = columns(db, 'recommendation_history');
  const historyId = history.has('candidate_app_id') ? 'candidate_app_id' : history.has('app_id') ? 'app_id' : null;
  const historyDate = history.has('presented_at') ? 'presented_at' : history.has('created_at') ? 'created_at' : history.has('updated_at') ? 'updated_at' : null;
  const last = historyId && historyDate ? `(SELECT MAX(h.${historyDate}) FROM recommendation_history h WHERE CAST(h.${historyId} AS TEXT)=CAST(g.app_id AS TEXT))` : 'NULL';
  const count = historyId ? `(SELECT COUNT(*) FROM recommendation_history h WHERE CAST(h.${historyId} AS TEXT)=CAST(g.app_id AS TEXT))` : '0';
  return db.prepare(`SELECT CAST(g.app_id AS TEXT) app_id,g.title,g.studio,g.genres,g.cover_url,g.description,g.playtime_minutes,
    p.profile_json,p.embedding_json,p.confidence,p.source_json,p.analysis_model,p.embedding_model,
    ${last} last_presented_at,${count} times_presented
    FROM games g JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT) ${stateJoin}
    WHERE ${stateFilter} AND CAST(g.app_id AS TEXT)<>?`).all(reference || '');
}
function writeHistoryIfAvailable(db, requestKey, reference, motivation, results) {
  const history = columns(db, 'recommendation_history');
  const candidate = history.has('candidate_app_id') ? 'candidate_app_id' : history.has('app_id') ? 'app_id' : null;
  if (candidate && history.has('request_key') && history.has('rank')) {
    const names = ['request_key', 'reference_app_id', 'motivation_key', candidate, 'rank'];
    const optional = ['similarity', 'profile_quality', 'presented_at'].filter((name) => history.has(name));
    const statement = db.prepare(`INSERT INTO recommendation_history(${[...names, ...optional].join(',')}) VALUES (${[...names, ...optional].map((name) => name === 'presented_at' ? 'CURRENT_TIMESTAMP' : '?').join(',')})`);
    for (const item of results) {
      const values = [requestKey, reference, motivation, String(item.app_id), item.rank];
      if (history.has('similarity')) values.push(item.similarity);
      if (history.has('profile_quality')) values.push(item.profileQuality);
      statement.run(...values);
    }
    return;
  }
  const sessions = columns(db, 'discovery_sessions');
  if (['reference_app_id', 'motivation_text', 'motivations_json', 'results_json'].every((name) => sessions.has(name))) {
    db.prepare('INSERT INTO discovery_sessions(reference_app_id,motivation_text,motivations_json,results_json) VALUES(?,?,?,?)')
      .run(reference, motivation, JSON.stringify(motivation ? [motivation] : []), JSON.stringify(results.map(({ vector, genresSet, ...item }) => item)));
  }
}
export function discover(db, options = {}) {
  const limit = Math.min(24, Math.max(1, Number(options.limit) || 12));
  const minQuality = clamp(options.minQuality ?? 0.35);
  const recentDays = Math.max(0, Number(options.recentDays) || 30);
  const referenceAppId = String(options.referenceAppId || options.reference_app_id || '');
  const motivationKey = String(options.motivationKey || options.motivation_key || options.query || options.motivation_text || (options.surprise ? 'surprise' : ''));
  let target = Array.isArray(options.embedding) ? options.embedding : null;
  if (!target && referenceAppId) target = parseJson(db.prepare('SELECT embedding_json FROM profiles WHERE CAST(app_id AS TEXT)=?').get(referenceAppId)?.embedding_json, null);
  if (!target && !options.surprise) throw Object.assign(new Error('Aucun embedding exploitable pour cette découverte.'), { status: 422 });
  const seed = options.requestKey || `${new Date().toISOString().slice(0, 10)}:${motivationKey}:${referenceAppId}`;
  const scored = [];
  const rows = candidateRows(db, referenceAppId);
  for (const row of rows) {
    const quality = assessProfile(row);
    if (!quality.eligible || quality.score < minQuality) continue;
    const similarity = target ? cosine(target, quality.embedding) : 0;
    const verdict = latestVerdict(db, row.app_id, referenceAppId, motivationKey);
    const feedback = verdict === 'positive' ? 0.035 : verdict === 'negative' ? -0.15 : 0;
    const age = row.last_presented_at ? (Date.now() - Date.parse(row.last_presented_at)) / 86400000 : Infinity;
    const recentPenalty = age < recentDays ? 0.18 * (1 - age / Math.max(1, recentDays)) : 0;
    const exploration = stableNoise(seed, row.app_id) * (options.surprise ? 0.3 : 0.04);
    const base = options.surprise ? quality.score * 0.65 + exploration : similarity * 0.72 + quality.score * 0.24 + exploration;
    const profile = parseJson(row.profile_json, {}) || {};
    scored.push({ ...row, cover_url: row.cover_url || steamCover(row.app_id), summary: profile.summary || row.description || '', similarity,
      profileQuality: quality.score, qualityReasons: quality.reasons, score: base + feedback - recentPenalty, genresSet: genreSet(row.genres), verdict,
      previously_presented: Number(row.times_presented) || 0 });
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
  const results = selected.slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  const requestKey = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
  writeHistoryIfAvailable(db, requestKey, referenceAppId, motivationKey, results);
  return { requestKey, results: results.map(({ genresSet, vector, diversifiedScore, ...item }) => item), excludedForQuality: rows.length - scored.length,
    message: results.length ? null : 'Aucun profil suffisamment documenté ne correspond à cette demande.' };
}
