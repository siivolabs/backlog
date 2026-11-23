import { analyzeGame } from './ollama.js';
import { transaction } from './db.js';

function setting(db, key, fallback = '') { return db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value ?? fallback; }
function setSetting(db, key, value) { db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(key, String(value)); }

export function enqueueMissing(db) {
  return db.prepare(`
    INSERT OR IGNORE INTO enrichment_queue(app_id,status,updated_at)
    SELECT CAST(g.app_id AS TEXT),'pending',CURRENT_TIMESTAMP FROM games g
    LEFT JOIN profiles p ON CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT)
    WHERE p.app_id IS NULL
  `).run().changes;
}

function claim(db) {
  let appId = null;
  transaction(db, () => {
    const row = db.prepare(`SELECT app_id FROM enrichment_queue WHERE status='pending' ORDER BY attempts,updated_at LIMIT 1`).get();
    if (!row) return;
    const result = db.prepare(`UPDATE enrichment_queue SET status='running',attempts=attempts+1,locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE app_id=? AND status='pending'`).run(row.app_id);
    if (result.changes) appId = String(row.app_id);
  });
  return appId;
}

async function processOne(db, config, appId) {
  const game = db.prepare('SELECT * FROM games WHERE CAST(app_id AS TEXT)=?').get(appId);
  if (!game) return;
  try {
    const { source, profile, embedding } = await analyzeGame(config, game);
    db.prepare(`
      INSERT INTO profiles(app_id,profile_json,embedding_json,schema_version,analysis_model,embedding_model,confidence,source_json,created_at,updated_at)
      VALUES(?,?,?,'core-v1',?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(app_id) DO UPDATE SET profile_json=excluded.profile_json,embedding_json=excluded.embedding_json,
        schema_version=excluded.schema_version,analysis_model=excluded.analysis_model,embedding_model=excluded.embedding_model,
        confidence=excluded.confidence,source_json=excluded.source_json,updated_at=CURRENT_TIMESTAMP
    `).run(appId, JSON.stringify(profile), JSON.stringify(embedding), config.analysisModel, config.embeddingModel, Number(profile.confidence) || null, JSON.stringify(source));
    db.prepare(`UPDATE enrichment_queue SET status='completed',last_error=NULL,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE app_id=?`).run(appId);
  } catch (error) {
    db.prepare(`UPDATE enrichment_queue SET status='error',last_error=?,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE app_id=?`).run(String(error?.message || error).slice(0, 2000), appId);
  }
}

export function enrichmentStatus(db) {
  enqueueMissing(db);
  const counts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) count FROM enrichment_queue GROUP BY status').all().map((row) => [row.status, row.count]));
  const totalGames = db.prepare('SELECT COUNT(*) count FROM games').get().count;
  const profiles = db.prepare('SELECT COUNT(*) count FROM profiles').get().count;
  const lastError = db.prepare(`SELECT app_id,last_error,updated_at FROM enrichment_queue WHERE status='error' ORDER BY updated_at DESC LIMIT 1`).get() || null;
  return { total_games: totalGames, profiles, queue: { pending: counts.pending || 0, running: counts.running || 0, completed: counts.completed || 0, error: counts.error || 0 }, paused: setting(db, 'enrichment_paused', '0') === '1', last_error: lastError };
}

export function setPaused(db, paused) { setSetting(db, 'enrichment_paused', paused ? '1' : '0'); return enrichmentStatus(db); }
export function retryErrors(db) { const result = db.prepare(`UPDATE enrichment_queue SET status='pending',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='error'`).run(); return { retried: result.changes }; }

export function startEnrichmentWorker(db, config) {
  let stopped = false; let active = 0; let timer;
  const tick = async () => {
    if (stopped) return;
    try {
      if (setting(db, 'enrichment_paused', '0') !== '1') {
        enqueueMissing(db);
        while (active < config.enrichmentConcurrency) {
          const appId = claim(db); if (!appId) break;
          active += 1;
          processOne(db, config, appId).finally(() => { active -= 1; });
        }
      }
    } finally { timer = setTimeout(tick, config.enrichmentPollMs); timer.unref?.(); }
  };
  if (config.autoEnrich) tick();
  return () => { stopped = true; clearTimeout(timer); };
}
