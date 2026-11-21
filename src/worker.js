import { transaction } from './db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EnrichmentWorker {
  constructor({ db, pipeline, logger, pollDelayMs = 750, retryDelayMs = 2000, maxAttempts = 1 }) {
    Object.assign(this, { db, pipeline, logger, pollDelayMs, retryDelayMs, maxAttempts });
    this.loopPromise = null;
    this.stopping = false;
  }

  recover() {
    const campaign = this.db.prepare('SELECT * FROM enrichment_campaign WHERE id=1').get();
    transaction(this.db, () => {
      this.db.prepare("UPDATE enrichment_jobs SET status='pending', current_step=NULL, started_at=NULL WHERE status='processing'").run();
      if (campaign.status === 'pausing') {
        this.db.prepare("UPDATE enrichment_campaign SET status='paused', current_app_id=NULL, current_step=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
      }
    });
    if (campaign.status === 'running') this.kick();
    return this.status();
  }

  queueMissing() {
    return this.db.prepare(`
      INSERT OR IGNORE INTO enrichment_jobs (app_id, status)
      SELECT g.app_id, 'pending' FROM games g
      LEFT JOIN profiles p ON p.app_id=g.app_id
      WHERE p.app_id IS NULL
    `).run().changes;
  }

  start() {
    transaction(this.db, () => {
      this.queueMissing();
      const pending = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='pending'").get().count;
      if (pending > 0) {
        this.db.prepare(`
          UPDATE enrichment_campaign SET status='running', started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
            completed_at=NULL, updated_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=1
        `).run();
      } else {
        this.finishCampaign();
      }
    });
    this.kick();
    return this.status();
  }

  pause() {
    const processing = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='processing'").get().count;
    this.db.prepare(`
      UPDATE enrichment_campaign SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND status='running'
    `).run(processing > 0 ? 'pausing' : 'paused');
    return this.status();
  }

  resume() {
    const campaign = this.db.prepare('SELECT status FROM enrichment_campaign WHERE id=1').get();
    if (!['paused', 'pausing', 'completed_with_errors', 'completed', 'idle'].includes(campaign.status)) return this.status();
    this.queueMissing();
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='pending'").get().count;
    if (pending > 0) {
      this.db.prepare("UPDATE enrichment_campaign SET status='running', completed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
      this.kick();
    } else {
      this.finishCampaign();
    }
    return this.status();
  }

  retryFailures() {
    transaction(this.db, () => {
      this.db.prepare("UPDATE enrichment_jobs SET status='pending', attempts=0, error=NULL, current_step=NULL, started_at=NULL, finished_at=NULL, duration_ms=NULL WHERE status='failed'").run();
      const pending = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='pending'").get().count;
      if (pending > 0) this.db.prepare("UPDATE enrichment_campaign SET status='running', completed_at=NULL, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
    });
    this.kick();
    return this.status();
  }

  kick() {
    if (!this.loopPromise) {
      this.loopPromise = this.loop().catch((error) => {
        this.logger.error('Arrêt inattendu de l’orchestrateur', error);
        this.db.prepare("UPDATE enrichment_campaign SET status='paused', last_error=?, current_app_id=NULL, current_step=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run(error.message);
      }).finally(() => { this.loopPromise = null; });
    }
    return this.loopPromise;
  }

  async loop() {
    while (!this.stopping) {
      const campaign = this.db.prepare('SELECT status FROM enrichment_campaign WHERE id=1').get();
      if (campaign.status === 'pausing') {
        this.db.prepare("UPDATE enrichment_campaign SET status='paused', current_app_id=NULL, current_step=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
        return;
      }
      if (campaign.status !== 'running') return;

      const job = this.db.prepare(`
        SELECT j.*, g.name, g.cover_url, g.developer, g.genres, g.playtime_minutes
        FROM enrichment_jobs j JOIN games g ON g.app_id=j.app_id
        WHERE j.status='pending' ORDER BY j.queued_at, j.app_id LIMIT 1
      `).get();
      if (!job) {
        this.finishCampaign();
        return;
      }
      await this.processJob(job);
      await sleep(this.pollDelayMs);
    }
  }

  async processJob(game) {
    const started = Date.now();
    transaction(this.db, () => {
      this.db.prepare("UPDATE enrichment_jobs SET status='processing', attempts=attempts+1, started_at=CURRENT_TIMESTAMP, finished_at=NULL, error=NULL WHERE app_id=?").run(game.app_id);
      this.db.prepare("UPDATE enrichment_campaign SET current_app_id=?, current_step='démarrage', updated_at=CURRENT_TIMESTAMP WHERE id=1").run(game.app_id);
    });
    const onStep = (step) => {
      this.db.prepare("UPDATE enrichment_jobs SET current_step=? WHERE app_id=?").run(step, game.app_id);
      this.db.prepare("UPDATE enrichment_campaign SET current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").run(step);
    };
    try {
      const output = await this.pipeline.run(game, onStep);
      transaction(this.db, () => {
        this.db.prepare(`
          INSERT INTO profiles (app_id, schema_version, pipeline_version, model, embedding_model, source_json, profile_json, embedding_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(app_id) DO UPDATE SET
            schema_version=excluded.schema_version, pipeline_version=excluded.pipeline_version,
            model=excluded.model, embedding_model=excluded.embedding_model, source_json=excluded.source_json,
            profile_json=excluded.profile_json, embedding_json=excluded.embedding_json, updated_at=CURRENT_TIMESTAMP
        `).run(game.app_id, output.schemaVersion, output.pipelineVersion, output.model, output.embeddingModel,
          JSON.stringify(output.source), JSON.stringify(output.profile), JSON.stringify(output.embedding));
        this.db.prepare("UPDATE enrichment_jobs SET status='completed', current_step='terminé', finished_at=CURRENT_TIMESTAMP, duration_ms=? WHERE app_id=?").run(Date.now() - started, game.app_id);
        this.db.prepare("UPDATE enrichment_campaign SET current_app_id=NULL, current_step=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
      });
      this.logger.info('Jeu enrichi', { appId: game.app_id, name: game.name, durationMs: Date.now() - started });
    } catch (error) {
      const attempts = this.db.prepare('SELECT attempts FROM enrichment_jobs WHERE app_id=?').get(game.app_id).attempts;
      const retry = attempts < this.maxAttempts;
      this.db.prepare(`
        UPDATE enrichment_jobs SET status=?, current_step=NULL, error=?, finished_at=CURRENT_TIMESTAMP, duration_ms=? WHERE app_id=?
      `).run(retry ? 'pending' : 'failed', String(error.message || error).slice(0, 2000), Date.now() - started, game.app_id);
      this.db.prepare("UPDATE enrichment_campaign SET current_app_id=NULL, current_step=NULL, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").run(String(error.message || error).slice(0, 2000));
      this.logger.warn(retry ? 'Échec temporaire, nouvelle tentative planifiée' : 'Jeu en échec, campagne poursuivie', { appId: game.app_id, error: error.message });
      if (retry) await sleep(this.retryDelayMs);
    }
  }

  finishCampaign() {
    const failed = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status='failed'").get().count;
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs WHERE status IN ('pending','processing')").get().count;
    const status = pending > 0 ? 'paused' : (failed > 0 ? 'completed_with_errors' : 'completed');
    this.db.prepare("UPDATE enrichment_campaign SET status=?, completed_at=CASE WHEN ? IN ('completed','completed_with_errors') THEN CURRENT_TIMESTAMP ELSE completed_at END, current_app_id=NULL, current_step=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1").run(status, status);
  }

  status() {
    const campaign = this.db.prepare(`
      SELECT c.*, g.name AS current_game_name
      FROM enrichment_campaign c LEFT JOIN games g ON g.app_id=c.current_app_id WHERE c.id=1
    `).get();
    const counts = this.db.prepare(`
      SELECT COUNT(*) AS queued,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        AVG(CASE WHEN status='completed' THEN duration_ms END) AS average_ms
      FROM enrichment_jobs
    `).get();
    const totalGames = Number(this.db.prepare('SELECT COUNT(*) AS count FROM games').get().count || 0);
    const enriched = Number(this.db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count || 0);
    const averageMs = Number(counts.average_ms || 0);
    const remaining = Math.max(0, totalGames - enriched - Number(counts.failed || 0));
    return {
      ...campaign,
      totalGames,
      enriched,
      queued: Number(counts.queued || 0),
      pending: Number(counts.pending || 0),
      processing: Number(counts.processing || 0),
      completedJobs: Number(counts.completed || 0),
      failed: Number(counts.failed || 0),
      remaining,
      percent: totalGames ? Math.round((enriched / totalGames) * 10000) / 100 : 0,
      averageMs: Math.round(averageMs),
      estimatedRemainingMs: averageMs > 0 ? Math.round(averageMs * remaining) : null
    };
  }

  async stop() {
    this.stopping = true;
    if (this.loopPromise) await this.loopPromise;
  }
}
