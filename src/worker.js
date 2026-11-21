import { transaction } from './db.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EnrichmentWorker {
  constructor(db, processor, options = {}) {
    this.db = db;
    this.processor = processor;
    this.pollDelayMs = options.pollDelayMs ?? 50;
    this.running = false;
    this.stopped = false;
  }

  recover() {
    transaction(this.db, () => {
      this.db.prepare("UPDATE core_background_queue SET status='pending', current_step=NULL, started_at=NULL WHERE status='processing'").run();
      const campaign = this.db.prepare('SELECT * FROM core_background_campaign WHERE id=1').get();
      if (campaign?.status === 'pausing') {
        this.db.prepare("UPDATE core_background_campaign SET status='paused', pause_requested=1, current_app_id=NULL, current_step=NULL, updated_at=datetime('now') WHERE id=1").run();
      }
    });
    const status = this.db.prepare('SELECT status FROM core_background_campaign WHERE id=1').get()?.status;
    if (status === 'running') this.kick();
  }

  enqueueAll() {
    transaction(this.db, () => {
      this.db.prepare(`
        INSERT OR IGNORE INTO core_background_queue(app_id, status)
        SELECT CAST(g.app_id AS TEXT), 'pending' FROM games g
        WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE CAST(p.app_id AS TEXT)=CAST(g.app_id AS TEXT))
      `).run();
      this.db.prepare(`
        UPDATE core_background_queue SET status='completed', error=NULL, current_step=NULL, finished_at=COALESCE(finished_at,datetime('now'))
        WHERE EXISTS (SELECT 1 FROM profiles p WHERE CAST(p.app_id AS TEXT)=core_background_queue.app_id)
      `).run();
      this.db.prepare(`
        UPDATE core_background_campaign SET status='running', pause_requested=0,
          started_at=COALESCE(started_at,datetime('now')), completed_at=NULL,
          last_error=NULL, updated_at=datetime('now') WHERE id=1
      `).run();
    });
    this.kick();
    return this.status();
  }

  pause() {
    const current = this.db.prepare('SELECT current_app_id FROM core_background_campaign WHERE id=1').get();
    const nextStatus = current?.current_app_id ? 'pausing' : 'paused';
    this.db.prepare("UPDATE core_background_campaign SET status=?, pause_requested=1, updated_at=datetime('now') WHERE id=1").run(nextStatus);
    return this.status();
  }

  resume() {
    this.db.prepare("UPDATE core_background_campaign SET status='running', pause_requested=0, completed_at=NULL, updated_at=datetime('now') WHERE id=1").run();
    this.kick();
    return this.status();
  }

  retryFailed() {
    transaction(this.db, () => {
      this.db.prepare("UPDATE core_background_queue SET status='pending', error=NULL, current_step=NULL, started_at=NULL, finished_at=NULL, duration_ms=NULL WHERE status='failed'").run();
      this.db.prepare("UPDATE core_background_campaign SET status='running', pause_requested=0, completed_at=NULL, last_error=NULL, updated_at=datetime('now') WHERE id=1").run();
    });
    this.kick();
    return this.status();
  }

  stop() { this.stopped = true; }

  kick() {
    if (this.running || this.stopped) return;
    this.running = true;
    setImmediate(() => this.loop().finally(() => { this.running = false; }));
  }

  async loop() {
    while (!this.stopped) {
      const campaign = this.db.prepare('SELECT * FROM core_background_campaign WHERE id=1').get();
      if (!campaign || campaign.status !== 'running') return;
      if (campaign.pause_requested) {
        this.db.prepare("UPDATE core_background_campaign SET status='paused', current_app_id=NULL, current_step=NULL, updated_at=datetime('now') WHERE id=1").run();
        return;
      }
      const item = this.db.prepare("SELECT * FROM core_background_queue WHERE status='pending' ORDER BY queued_at, rowid LIMIT 1").get();
      if (!item) {
        const failures = Number(this.db.prepare("SELECT COUNT(*) AS count FROM core_background_queue WHERE status='failed'").get().count);
        this.db.prepare("UPDATE core_background_campaign SET status=?, completed_at=datetime('now'), current_app_id=NULL, current_step=NULL, updated_at=datetime('now') WHERE id=1").run(failures ? 'completed_with_errors' : 'completed');
        return;
      }
      const game = this.db.prepare('SELECT * FROM games WHERE CAST(app_id AS TEXT)=?').get(item.app_id);
      if (!game) {
        this.fail(item.app_id, new Error('Jeu absent de la bibliothèque.'));
        continue;
      }
      const started = Date.now();
      transaction(this.db, () => {
        this.db.prepare("UPDATE core_background_queue SET status='processing', attempts=attempts+1, current_step='préparation', error=NULL, started_at=datetime('now'), finished_at=NULL WHERE app_id=?").run(item.app_id);
        this.db.prepare("UPDATE core_background_campaign SET current_app_id=?, current_step='préparation', updated_at=datetime('now') WHERE id=1").run(item.app_id);
      });
      try {
        const result = await this.processor(game, (step) => {
          this.db.prepare("UPDATE core_background_queue SET current_step=? WHERE app_id=?").run(step, item.app_id);
          this.db.prepare("UPDATE core_background_campaign SET current_step=?, updated_at=datetime('now') WHERE id=1").run(step);
        });
        transaction(this.db, () => {
          this.db.prepare(`
            INSERT INTO profiles(app_id,schema_version,profile_json,embedding_json,source_json,analysis_model,embedding_model,confidence,created_at,updated_at)
            VALUES(?, 'core-v1', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(app_id) DO UPDATE SET schema_version=excluded.schema_version, profile_json=excluded.profile_json,
              embedding_json=excluded.embedding_json, source_json=excluded.source_json, analysis_model=excluded.analysis_model,
              embedding_model=excluded.embedding_model, confidence=excluded.confidence, updated_at=datetime('now')
          `).run(String(game.app_id), JSON.stringify(result.profile), JSON.stringify(result.embedding), JSON.stringify(result.source), result.analysisModel || null, result.embeddingModel || null, result.confidence ?? 0);
          this.db.prepare("UPDATE core_background_queue SET status='completed', current_step=NULL, error=NULL, finished_at=datetime('now'), duration_ms=? WHERE app_id=?").run(Date.now() - started, item.app_id);
          this.db.prepare("UPDATE core_background_campaign SET current_app_id=NULL, current_step=NULL, last_error=NULL, updated_at=datetime('now') WHERE id=1").run();
        });
      } catch (error) {
        this.fail(item.app_id, error, Date.now() - started);
      }
      const pause = this.db.prepare('SELECT pause_requested FROM core_background_campaign WHERE id=1').get()?.pause_requested;
      if (pause) {
        this.db.prepare("UPDATE core_background_campaign SET status='paused', current_app_id=NULL, current_step=NULL, updated_at=datetime('now') WHERE id=1").run();
        return;
      }
      await delay(this.pollDelayMs);
    }
  }

  fail(appId, error, durationMs = null) {
    const message = String(error?.message || error).slice(0, 2000);
    transaction(this.db, () => {
      this.db.prepare("UPDATE core_background_queue SET status='failed', current_step=NULL, error=?, finished_at=datetime('now'), duration_ms=? WHERE app_id=?").run(message, durationMs, appId);
      this.db.prepare("UPDATE core_background_campaign SET current_app_id=NULL, current_step=NULL, last_error=?, updated_at=datetime('now') WHERE id=1").run(message);
    });
  }

  status() {
    const campaign = this.db.prepare('SELECT * FROM core_background_campaign WHERE id=1').get();
    const counts = this.db.prepare(`
      SELECT COUNT(*) total,
        SUM(status='pending') pending, SUM(status='processing') processing,
        SUM(status='completed') completed, SUM(status='failed') failed
      FROM core_background_queue
    `).get();
    const games = Number(this.db.prepare('SELECT COUNT(*) AS count FROM games').get().count);
    const enriched = Number(this.db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count);
    const total = Number(counts.total || 0);
    const completed = Number(counts.completed || 0);
    return {
      campaign,
      library: { games, enriched, remaining: Math.max(0, games - enriched) },
      queue: {
        total, pending: Number(counts.pending || 0), processing: Number(counts.processing || 0),
        completed, failed: Number(counts.failed || 0),
        progress_percent: total ? Math.round((completed / total) * 1000) / 10 : (games && enriched >= games ? 100 : 0)
      }
    };
  }
}
