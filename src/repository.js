import { json, transaction } from './db.js';

export class Repository {
  constructor(db) { this.db = db; }

  summary() {
    const scalar = (sql, ...params) => Number(Object.values(this.db.prepare(sql).get(...params))[0]);
    const campaign = this.campaign();
    return {
      games: scalar('SELECT COUNT(*) FROM games'),
      enriched: scalar('SELECT COUNT(*) FROM profiles'),
      pending: scalar("SELECT COUNT(*) FROM enrichment_jobs WHERE status='pending'"),
      processing: scalar("SELECT COUNT(*) FROM enrichment_jobs WHERE status='processing'"),
      failed: scalar("SELECT COUNT(*) FROM enrichment_jobs WHERE status='failed'"),
      campaign
    };
  }

  listGames({ search = '', status = 'all', limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (search) {
      clauses.push('(g.name LIKE ? COLLATE NOCASE OR g.developer LIKE ? COLLATE NOCASE OR g.genres LIKE ? COLLATE NOCASE)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status === 'enriched') clauses.push('p.app_id IS NOT NULL');
    if (status === 'pending') clauses.push('p.app_id IS NULL');
    if (status === 'failed') clauses.push("j.status='failed'");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT g.*, CASE WHEN p.app_id IS NULL THEN 0 ELSE 1 END AS enriched,
             COALESCE(j.status, CASE WHEN p.app_id IS NULL THEN 'unqueued' ELSE 'completed' END) AS enrichment_status,
             j.error AS enrichment_error
      FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id
      LEFT JOIN enrichment_jobs j ON j.app_id=g.app_id
      ${where} ORDER BY g.name COLLATE NOCASE LIMIT ? OFFSET ?
    `).all(...params, Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0));
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN enrichment_jobs j ON j.app_id=g.app_id ${where}`).get(...params).count);
    return { rows, total };
  }

  game(appId) {
    const row = this.db.prepare(`SELECT g.*, p.profile_json, p.embedding_json, p.updated_at AS profile_updated_at,
      j.status AS enrichment_status, j.error AS enrichment_error
      FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id LEFT JOIN enrichment_jobs j ON j.app_id=g.app_id
      WHERE g.app_id=?`).get(appId);
    if (!row) return null;
    return { ...row, profile: json(row.profile_json, null), embedding: json(row.embedding_json, []) };
  }

  campaign() {
    const campaign = this.db.prepare('SELECT * FROM enrichment_campaign WHERE id=1').get();
    const counts = Object.fromEntries(['pending','processing','completed','failed'].map((status) => [status,
      Number(this.db.prepare('SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status=?').get(status).count)
    ]));
    return { ...campaign, counts };
  }

  startCampaign() {
    return transaction(this.db, () => {
      this.db.exec(`INSERT OR IGNORE INTO enrichment_jobs(app_id,status,attempts,queued_at)
        SELECT g.app_id,'pending',0,CURRENT_TIMESTAMP FROM games g
        LEFT JOIN profiles p ON p.app_id=g.app_id WHERE p.app_id IS NULL`);
      this.db.exec(`UPDATE enrichment_campaign SET status='running',
        started_at=COALESCE(started_at,CURRENT_TIMESTAMP),completed_at=NULL,updated_at=CURRENT_TIMESTAMP,
        last_error=NULL WHERE id=1`);
      return this.campaign();
    });
  }

  requestPause() {
    this.db.exec("UPDATE enrichment_campaign SET status=CASE WHEN status='running' THEN 'pausing' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE id=1");
    return this.campaign();
  }

  resumeCampaign() {
    this.db.exec("UPDATE enrichment_campaign SET status='running', completed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND status IN ('paused','pausing','completed_with_errors')");
    return this.campaign();
  }

  retryFailed() {
    return transaction(this.db, () => {
      this.db.exec("UPDATE enrichment_jobs SET status='pending',error=NULL,current_step=NULL,started_at=NULL,finished_at=NULL,duration_ms=NULL,queued_at=CURRENT_TIMESTAMP WHERE status='failed'");
      this.db.exec("UPDATE enrichment_campaign SET status='running',completed_at=NULL,updated_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=1");
      return this.campaign();
    });
  }

  recoverInterruptedJobs() {
    transaction(this.db, () => {
      this.db.exec("UPDATE enrichment_jobs SET status='pending',current_step='recovered',started_at=NULL WHERE status='processing'");
      const campaign = this.db.prepare('SELECT status FROM enrichment_campaign WHERE id=1').get();
      if (campaign?.status === 'pausing') this.db.exec("UPDATE enrichment_campaign SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=1");
    });
  }

  claimNextJob() {
    return transaction(this.db, () => {
      const campaign = this.db.prepare('SELECT status FROM enrichment_campaign WHERE id=1').get();
      if (campaign?.status !== 'running') return null;
      const job = this.db.prepare("SELECT j.*,g.* FROM enrichment_jobs j JOIN games g ON g.app_id=j.app_id WHERE j.status='pending' ORDER BY j.queued_at,j.app_id LIMIT 1").get();
      if (!job) return null;
      this.db.prepare("UPDATE enrichment_jobs SET status='processing',attempts=attempts+1,current_step='starting',error=NULL,started_at=CURRENT_TIMESTAMP WHERE app_id=?").run(job.app_id);
      this.db.prepare("UPDATE enrichment_campaign SET current_app_id=?,current_step='starting',updated_at=CURRENT_TIMESTAMP WHERE id=1").run(job.app_id);
      return job;
    });
  }

  setStep(appId, step) {
    this.db.prepare("UPDATE enrichment_jobs SET current_step=? WHERE app_id=?").run(step, appId);
    this.db.prepare("UPDATE enrichment_campaign SET current_step=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").run(step);
  }

  completeJob(appId, result, durationMs) {
    transaction(this.db, () => {
      this.db.prepare(`INSERT INTO profiles(app_id,schema_version,pipeline_version,model,embedding_model,source_json,profile_json,embedding_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(app_id) DO UPDATE SET schema_version=excluded.schema_version,pipeline_version=excluded.pipeline_version,
          model=excluded.model,embedding_model=excluded.embedding_model,source_json=excluded.source_json,
          profile_json=excluded.profile_json,embedding_json=excluded.embedding_json,updated_at=CURRENT_TIMESTAMP`)
        .run(appId, 'core-1', '1.1.1', result.model, result.embeddingModel,
          JSON.stringify(result.source || {}), JSON.stringify(result.profile || {}), JSON.stringify(result.embedding || []));
      this.db.prepare("UPDATE enrichment_jobs SET status='completed',current_step='completed',error=NULL,finished_at=CURRENT_TIMESTAMP,duration_ms=? WHERE app_id=?").run(durationMs, appId);
      this.db.exec("UPDATE enrichment_campaign SET current_app_id=NULL,current_step=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1");
    });
  }

  failJob(appId, error, durationMs) {
    transaction(this.db, () => {
      this.db.prepare("UPDATE enrichment_jobs SET status='failed',current_step='failed',error=?,finished_at=CURRENT_TIMESTAMP,duration_ms=? WHERE app_id=?").run(String(error).slice(0, 4000), durationMs, appId);
      this.db.prepare("UPDATE enrichment_campaign SET current_app_id=NULL,current_step=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").run(String(error).slice(0, 4000));
    });
  }

  settleCampaignIfDone() {
    const pending = Number(this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status IN ('pending','processing')").get().count);
    if (pending) return false;
    const failed = Number(this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='failed'").get().count);
    this.db.prepare("UPDATE enrichment_campaign SET status=?,completed_at=CURRENT_TIMESTAMP,current_app_id=NULL,current_step=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1")
      .run(failed ? 'completed_with_errors' : 'completed');
    return true;
  }

  settlePause() {
    const campaign = this.db.prepare('SELECT status FROM enrichment_campaign WHERE id=1').get();
    if (campaign?.status === 'pausing') {
      this.db.exec("UPDATE enrichment_campaign SET status='paused',current_app_id=NULL,current_step=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1");
      return true;
    }
    return false;
  }

  profileCandidates(excludeAppId = null) {
    return this.db.prepare(`SELECT g.app_id,g.name,g.cover_url,g.developer,g.genres,p.profile_json,p.embedding_json
      FROM profiles p JOIN games g ON g.app_id=p.app_id WHERE (? IS NULL OR g.app_id<>?)`).all(excludeAppId, excludeAppId)
      .map((row) => ({ ...row, profile: json(row.profile_json, {}), embedding: json(row.embedding_json, []) }));
  }

  addFeedback({ appId, motivation, verdict, note = null }) {
    const result = this.db.prepare('INSERT INTO discovery_feedback(app_id,motivation,verdict,note,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)')
      .run(appId, motivation, verdict, note);
    return { id: Number(result.lastInsertRowid) };
  }

  compatibility() {
    return this.db.prepare('SELECT * FROM migration_compatibility WHERE migration_version=10101 ORDER BY table_name').all();
  }
}
