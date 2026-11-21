import { transaction } from './db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSql = "datetime('now')";

export class EnrichmentOrchestrator {
  constructor({ db, processGame, loopDelayMs = 750, retryLimit = 3, logger = console }) {
    this.db = db;
    this.processGame = processGame;
    this.loopDelayMs = loopDelayMs;
    this.retryLimit = retryLimit;
    this.logger = logger;
    this.runningPromise = null;
    this.stopping = false;
  }

  recover() {
    transaction(this.db, () => {
      this.db.prepare("UPDATE autonomous_enrichment_items SET status='pending', current_step=NULL, last_error=COALESCE(last_error,'Interruption Docker : traitement replanifié') WHERE status='running'").run();
      this.syncQueue();
      const control = this.control();
      if (control.desired_state === 'running') {
        this.db.prepare(`UPDATE autonomous_enrichment_control SET lifecycle='running', current_app_id=NULL, current_step='reprise', updated_at=${nowSql} WHERE id=1`).run();
      } else if (control.lifecycle === 'running' || control.lifecycle === 'pausing') {
        this.db.prepare(`UPDATE autonomous_enrichment_control SET lifecycle='paused', current_app_id=NULL, current_step=NULL, updated_at=${nowSql} WHERE id=1`).run();
      }
    });
    if (this.control().desired_state === 'running') this.wake();
  }

  syncQueue() {
    this.db.prepare(`
      INSERT OR IGNORE INTO autonomous_enrichment_items (app_id, status)
      SELECT g.app_id, 'pending' FROM games g LEFT JOIN profiles p ON p.app_id=g.app_id WHERE p.app_id IS NULL
    `).run();
    this.db.prepare(`
      UPDATE autonomous_enrichment_items SET status='completed', current_step=NULL, last_error=NULL,
      finished_at=COALESCE(finished_at, datetime('now'))
      WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.app_id=autonomous_enrichment_items.app_id)
    `).run();
    this.db.prepare(`
      UPDATE autonomous_enrichment_items SET status='pending', current_step=NULL, last_error=NULL,
      started_at=NULL, finished_at=NULL, duration_ms=NULL
      WHERE status='completed'
        AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.app_id=autonomous_enrichment_items.app_id)
    `).run();
  }

  control() {
    return this.db.prepare('SELECT * FROM autonomous_enrichment_control WHERE id=1').get();
  }

  status() {
    this.syncQueue();
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM games) AS total,
        (SELECT COUNT(*) FROM profiles p JOIN games g ON g.app_id=p.app_id) AS completed,
        (SELECT COUNT(*) FROM autonomous_enrichment_items WHERE status='running') AS running,
        (SELECT COUNT(*) FROM autonomous_enrichment_items WHERE status='error') AS errors,
        (SELECT COUNT(*) FROM autonomous_enrichment_items WHERE status='pending') AS pending,
        (SELECT AVG(duration_ms) FROM autonomous_enrichment_items WHERE status='completed' AND duration_ms IS NOT NULL) AS average_duration_ms
    `).get();
    const control = this.control();
    const remaining = Number(counts.pending) + Number(counts.running);
    return {
      ...control, ...counts, remaining,
      progress_percent: counts.total ? Number(((Number(counts.completed) / Number(counts.total)) * 100).toFixed(1)) : 0,
      estimated_remaining_ms: counts.average_duration_ms ? Math.round(Number(counts.average_duration_ms) * remaining) : null
    };
  }

  start() {
    transaction(this.db, () => {
      this.syncQueue();
      this.db.prepare(`UPDATE autonomous_enrichment_control SET desired_state='running', lifecycle='running', started_at=COALESCE(started_at,datetime('now')), completed_at=NULL, updated_at=${nowSql}, last_error=NULL WHERE id=1`).run();
    });
    this.wake();
    return this.status();
  }

  pause() {
    const active = this.db.prepare("SELECT COUNT(*) AS count FROM autonomous_enrichment_items WHERE status='running'").get().count;
    this.db.prepare(`UPDATE autonomous_enrichment_control SET desired_state='paused', lifecycle=?, updated_at=${nowSql} WHERE id=1`).run(active ? 'pausing' : 'paused');
    return this.status();
  }

  retryErrors() {
    this.db.prepare("UPDATE autonomous_enrichment_items SET status='pending', attempts=0, current_step=NULL, last_error=NULL, started_at=NULL, finished_at=NULL, duration_ms=NULL WHERE status='error'").run();
    this.db.prepare(`UPDATE autonomous_enrichment_control SET completed_at=NULL, lifecycle=CASE WHEN desired_state='running' THEN 'running' ELSE 'paused' END, updated_at=${nowSql} WHERE id=1`).run();
    if (this.control().desired_state === 'running') this.wake();
    return this.status();
  }

  wake() {
    if (!this.runningPromise && !this.stopping) {
      this.runningPromise = this.loop().catch((error) => {
        this.logger.error('Orchestrateur arrêté de façon inattendue', error);
        this.db.prepare(`UPDATE autonomous_enrichment_control SET desired_state='paused', lifecycle='paused', last_error=?, updated_at=${nowSql} WHERE id=1`).run(error.message);
      }).finally(() => { this.runningPromise = null; });
    }
    return this.runningPromise;
  }

  async loop() {
    while (!this.stopping) {
      const control = this.control();
      if (control.desired_state !== 'running') {
        this.db.prepare(`UPDATE autonomous_enrichment_control SET lifecycle='paused', current_app_id=NULL, current_step=NULL, updated_at=${nowSql} WHERE id=1`).run();
        return;
      }
      this.syncQueue();
      const game = this.db.prepare(`
        SELECT g.* FROM autonomous_enrichment_items i JOIN games g ON g.app_id=i.app_id
        WHERE i.status='pending' AND i.attempts < ? ORDER BY i.queued_at, i.app_id LIMIT 1
      `).get(this.retryLimit);
      if (!game) {
        const errors = this.db.prepare("SELECT COUNT(*) AS count FROM autonomous_enrichment_items WHERE status='error'").get().count;
        this.db.prepare(`UPDATE autonomous_enrichment_control SET desired_state='paused', lifecycle=?, current_app_id=NULL, current_step=NULL, completed_at=${nowSql}, updated_at=${nowSql} WHERE id=1`).run(errors ? 'completed_with_errors' : 'completed');
        return;
      }
      await this.processOne(game);
      if (this.loopDelayMs) await sleep(this.loopDelayMs);
    }
  }

  async processOne(game) {
    const start = Date.now();
    transaction(this.db, () => {
      this.db.prepare(`UPDATE autonomous_enrichment_items SET status='running', attempts=attempts+1, current_step='préparation', started_at=${nowSql}, finished_at=NULL WHERE app_id=?`).run(game.app_id);
      this.db.prepare(`UPDATE autonomous_enrichment_control SET lifecycle='running', current_app_id=?, current_step='préparation', heartbeat_at=${nowSql}, updated_at=${nowSql} WHERE id=1`).run(game.app_id);
    });
    const onStep = (step) => {
      this.db.prepare(`UPDATE autonomous_enrichment_items SET current_step=? WHERE app_id=?`).run(step, game.app_id);
      this.db.prepare(`UPDATE autonomous_enrichment_control SET current_step=?, heartbeat_at=${nowSql}, updated_at=${nowSql} WHERE id=1`).run(step);
    };
    try {
      const profile = await this.processGame(game, onStep);
      transaction(this.db, () => {
        this.db.prepare(`
          INSERT INTO profiles (app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(app_id) DO UPDATE SET
            schema_version=excluded.schema_version, profile_json=excluded.profile_json,
            embedding_json=excluded.embedding_json, source_json=excluded.source_json,
            analysis_model=excluded.analysis_model, embedding_model=excluded.embedding_model,
            confidence=excluded.confidence, updated_at=datetime('now')
        `).run(game.app_id, profile.schema_version, profile.profile_json, profile.embedding_json, profile.source_json, profile.analysis_model, profile.embedding_model, profile.confidence);
        this.db.prepare(`UPDATE autonomous_enrichment_items SET status='completed', current_step=NULL, last_error=NULL, finished_at=${nowSql}, duration_ms=? WHERE app_id=?`).run(Date.now() - start, game.app_id);
        this.db.prepare(`UPDATE autonomous_enrichment_control SET current_app_id=NULL, current_step=NULL, heartbeat_at=${nowSql}, updated_at=${nowSql} WHERE id=1`).run();
      });
    } catch (error) {
      const message = String(error?.message || error).slice(0, 2000);
      transaction(this.db, () => {
        this.db.prepare(`UPDATE autonomous_enrichment_items SET status='error', current_step=NULL, last_error=?, finished_at=${nowSql}, duration_ms=? WHERE app_id=?`).run(message, Date.now() - start, game.app_id);
        this.db.prepare(`UPDATE autonomous_enrichment_control SET current_app_id=NULL, current_step=NULL, last_error=?, heartbeat_at=${nowSql}, updated_at=${nowSql} WHERE id=1`).run(message);
      });
      this.logger.warn?.(`Échec isolé pour ${game.app_id}: ${message}`);
    }
    if (this.control().desired_state === 'paused') {
      this.db.prepare(`UPDATE autonomous_enrichment_control SET lifecycle='paused', current_app_id=NULL, current_step=NULL, updated_at=${nowSql} WHERE id=1`).run();
    }
  }

  async shutdown() {
    this.stopping = true;
    if (this.runningPromise) await this.runningPromise;
  }
}
