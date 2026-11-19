'use strict';

const { compactForEmbedding } = require('./network-profile');
const { classifyAnalysisError } = require('./error-classifier');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const timestamp = () => new Date().toISOString();

class NetworkCompletionService {
  constructor({ experiment, database, aiEngine, embeddingClient, pollIntervalMs = 500, jobTimeoutMs = 45 * 60 * 1000, logger = console }) {
    this.experiment = experiment;
    this.database = database;
    this.aiEngine = aiEngine;
    this.embeddingClient = embeddingClient;
    this.pollIntervalMs = Number(pollIntervalMs);
    this.jobTimeoutMs = Number(jobTimeoutMs);
    this.logger = logger;
    this.running = false;
    this.pauseRequested = false;
    this.currentRunId = null;
  }

  publicPlan({ mode = 'smart' } = {}) {
    return this.experiment.completionPlan({ forceFull: mode === 'full' }).map(({ profile, ...item }) => item);
  }

  status() {
    const run = this.currentRunId ? this.experiment.completionRun(this.currentRunId) : (this.experiment.latestResumableRun() || this.experiment.latestCompletionRun());
    return { running: this.running, pauseRequested: this.pauseRequested, run };
  }

  pause() {
    const run = this.currentRunId ? this.experiment.completionRun(this.currentRunId) : this.experiment.latestResumableRun();
    if (!run) throw Object.assign(new Error('Aucune campagne active à suspendre'), { statusCode: 409 });
    this.pauseRequested = true;
    this.currentRunId = run.id;
    this.experiment.setCompletionRunState(run.id, 'pausing', { pauseRequested: true, notes: 'Suspension demandée; arrêt au point de reprise sûr le plus proche' });
    this.aiEngine?.pause?.();
    return this.status();
  }

  async resume({ onProgress = () => {} } = {}) {
    const run = this.experiment.latestResumableRun();
    if (!run) throw Object.assign(new Error('Aucune campagne suspendue ou interrompue à reprendre'), { statusCode: 409 });
    this.pauseRequested = false;
    this.aiEngine?.resume?.();
    return this.run({ resumeRunId: run.id, mode: run.mode || 'smart', onProgress });
  }

  prioritize(runId, appId, priority = 100) { return this.experiment.setCompletionItemPriority(runId, appId, priority); }
  remove(runId, appId) { return this.experiment.cancelCompletionItem(runId, appId); }
  retryErrors(runId) { return this.experiment.retryFailedCompletionItems(runId); }

  itemTelemetry(jobId) {
    const detail = this.database.jobDetail?.(jobId) || this.database.getJob(jobId);
    if (!detail) return null;
    const durations = Object.fromEntries((detail.checkpoints || []).filter((item) => item.duration_ms != null).map((item) => [item.step, item.duration_ms]));
    const log = (detail.events || []).slice(-100).map((event) => ({ at: event.created_at, level: event.level, step: event.step, type: event.event_type, message: event.message }));
    return { job: detail, durations, log, checkpoints: detail.checkpoints || [] };
  }

  async waitForJob(id, { runId = null, appId = null, onProgress = () => {} } = {}) {
    const deadline = Date.now() + this.jobTimeoutMs;
    while (Date.now() < deadline) {
      const telemetry = this.itemTelemetry(id);
      const job = telemetry?.job;
      if (!job) throw new Error(`Tâche IA ${id} introuvable`);
      if (runId && appId) this.experiment.updateCompletionItem(runId, appId, { current_step: job.current_step, message: job.message, durations_json: telemetry.durations, log_json: telemetry.log, error_category: job.error_category, error_code: job.error_code });
      onProgress({ phase: 'analysis', runId, appId, currentStep: job.current_step, message: job.message, telemetry });
      if (job.status === 'completed') return job;
      if (['error', 'interrupted', 'cancelled'].includes(job.status)) {
        const error = new Error([job.message || 'Régénération échouée', job.error_code, job.error_detail].filter(Boolean).join(' — '));
        error.job = job;
        error.classification = { category: job.error_category || 'technique', code: job.error_code || 'Error', retryable: job.error_category === 'technique', autoPause: job.error_category === 'infrastructure' };
        throw error;
      }
      if (this.pauseRequested && job.status === 'queued') {
        const error = new Error('Campagne suspendue avant le démarrage de la tâche'); error.pauseRequested = true; throw error;
      }
      await sleep(this.pollIntervalMs);
    }
    const error = new Error(`Délai dépassé pour la tâche IA ${id}`); error.code = 'TIMEOUT'; throw error;
  }

  async processItem(item, { runId, mode = 'smart', onProgress = () => {} } = {}) {
    if (item.action === 'reuse') return { resultVersionId: item.sourceVersionId, reused: 1 };

    if (item.action === 'convert_reuse') {
      this.experiment.saveComparableAdapter(item.profile);
      return { resultVersionId: item.sourceVersionId, reused: 1, converted: 1 };
    }

    if (item.action === 'embed' || item.action === 'convert_embed') {
      if (item.action === 'convert_embed') this.experiment.saveComparableAdapter(item.profile);
      const embedding = await this.embeddingClient.embedText(compactForEmbedding(item.profile.profile));
      if (this.aiEngine?.checkEmbedding) this.aiEngine.checkEmbedding(embedding);
      this.experiment.saveEmbedding(item.profile.versionId, embedding, this.embeddingClient.model);
      return { resultVersionId: item.profile.versionId, converted: item.action === 'convert_embed' ? 1 : 0, embedded: 1 };
    }

    if (item.action === 'regenerate' || item.action === 'regenerate_full') {
      const persisted = this.experiment.completionRun(runId)?.items.find((candidate) => candidate.app_id === item.appId);
      let job = persisted?.job_id ? this.database.getJob(persisted.job_id) : null;
      if (job && ['error', 'interrupted', 'cancelled'].includes(job.status)) job = this.database.retryJob(job.id, { priority: persisted.priority });
      if (!job || job.status === 'completed') {
        if (job?.status === 'completed') {
          const ready = this.experiment.chooseProfiles([item.appId])[0];
          if (ready?.embedding) return { resultVersionId: ready.versionId, regenerated: 1, embedded: 1 };
        }
        job = this.aiEngine.enqueue(item.appId, 'network', { campaignRunId: runId, priority: persisted?.priority || 0, maxAttempts: persisted?.max_attempts || 2, forceFull: item.action === 'regenerate_full' || mode === 'full' });
      }
      this.experiment.updateCompletionItem(runId, item.appId, { job_id: job.id, current_step: job.current_step, attempt_count: Number(job.attempts || 0) });
      await this.waitForJob(job.id, { runId, appId: item.appId, onProgress });
      const profile = this.experiment.chooseProfiles([item.appId])[0];
      if (!profile || profile.normalized.completeness < this.experiment.usableThreshold) throw new Error('Le profil régénéré reste insuffisant pour le réseau');
      if (!profile.embedding) throw new Error('Le profil régénéré ne possède pas d’embedding exploitable');
      if (this.experiment.needsComparableAdapter(profile)) this.experiment.saveComparableAdapter(profile);
      return { resultVersionId: profile.versionId, regenerated: 1, embedded: 1 };
    }

    throw new Error(`Action de complétion inconnue : ${item.action}`);
  }

  countsFromItems(items) {
    const counts = { reused: 0, converted: 0, embedded: 0, regenerated: 0, failed: 0 };
    for (const item of items) {
      if (item.status === 'failed') { counts.failed += 1; continue; }
      if (item.status !== 'completed') continue;
      if (['reuse', 'convert_reuse'].includes(item.action)) counts.reused += 1;
      if (['convert_reuse', 'convert_embed'].includes(item.action)) counts.converted += 1;
      if (['embed', 'convert_embed', 'regenerate', 'regenerate_full'].includes(item.action)) counts.embedded += 1;
      if (['regenerate', 'regenerate_full'].includes(item.action)) counts.regenerated += 1;
    }
    return counts;
  }

  buildSummary(run, network, counts) {
    const items = run.items || [];
    const errors = {};
    const stepDurations = {};
    for (const item of items) {
      if (item.error_category) errors[item.error_category] = (errors[item.error_category] || 0) + 1;
      for (const [step, value] of Object.entries(item.durations || {})) stepDurations[step] = (stepDurations[step] || 0) + Number(value || 0);
    }
    return {
      selected: run.selected_count,
      completed: items.filter((item) => item.status === 'completed').length,
      cancelled: items.filter((item) => item.status === 'cancelled').length,
      usableProfiles: network.usableCount,
      embeddings: network.embeddedCount,
      pairs: network.pairCount,
      counts,
      errors,
      stepDurations,
      durationMs: run.started_at ? Math.max(0, Date.now() - new Date(run.started_at).valueOf()) : null
    };
  }

  async run({ mode = 'smart', resumeRunId = null, onProgress = () => {} } = {}) {
    if (this.running) throw Object.assign(new Error('Une complétion du réseau est déjà en cours'), { statusCode: 409 });
    this.running = true;
    this.pauseRequested = false;
    let runId = resumeRunId;
    let run = runId ? this.experiment.completionRun(runId) : null;
    if (!run) {
      const plan = this.experiment.completionPlan({ forceFull: mode === 'full' });
      runId = this.experiment.startCompletionRun(plan, { mode });
      run = this.experiment.completionRun(runId);
    } else {
      mode = run.mode || mode;
      this.experiment.setCompletionRunState(runId, 'running', { pauseRequested: false, notes: 'Campagne reprise à partir des étapes persistées' });
      this.database.db.prepare("UPDATE ai_analysis_jobs SET pause_requested=0 WHERE campaign_run_id=? AND status='interrupted'").run(Number(runId));
    }
    this.currentRunId = runId;
    this.aiEngine?.resume?.();
    onProgress({ phase: 'planning', runId, mode, run: this.experiment.completionRun(runId) });

    try {
      while (true) {
        run = this.experiment.completionRun(runId);
        if (this.pauseRequested || run.pause_requested) {
          this.experiment.setCompletionRunState(runId, 'paused', { pauseRequested: true, notes: 'Campagne suspendue; les étapes terminées sont conservées' });
          const paused = this.experiment.completionRun(runId);
          onProgress({ phase: 'paused', runId, run: paused, counts: this.countsFromItems(paused.items) });
          return { runId, status: 'paused', selected: paused.selected_count, counts: this.countsFromItems(paused.items), persisted: paused };
        }
        const pending = run.items.find((item) => item.status === 'pending' || item.status === 'paused' || item.status === 'interrupted');
        if (!pending) break;
        const fresh = this.experiment.completionPlan({ forceFull: mode === 'full' }).find((item) => item.appId === pending.app_id) || { appId: pending.app_id, action: pending.action, sourceVersionId: pending.source_version_id };
        fresh.action = pending.action;
        this.experiment.updateCompletionItem(runId, fresh.appId, { status: 'running', started_at: pending.started_at || timestamp(), completed_at: null, message: fresh.reason || pending.message, attempt_count: Number(pending.attempt_count || 0) + 1 });
        onProgress({ phase: fresh.action, runId, mode, appId: fresh.appId, action: fresh.action, run: this.experiment.completionRun(runId) });
        try {
          const outcome = await this.processItem(fresh, { runId, mode, onProgress });
          this.experiment.updateCompletionItem(runId, fresh.appId, { status: 'completed', result_version_id: outcome.resultVersionId || null, current_step: 'completed', message: 'Profil comparable prêt pour le réseau', completed_at: timestamp(), error_category: null, error_code: null });
        } catch (error) {
          const classification = error.classification || classifyAnalysisError(error, this.experiment.completionRun(runId)?.items.find((item) => item.app_id === fresh.appId)?.current_step || 'processing');
          const interrupted = this.pauseRequested || classification.category === 'interruption' || classification.autoPause;
          this.experiment.updateCompletionItem(runId, fresh.appId, { status: interrupted ? 'interrupted' : 'failed', message: String(error.message || error), completed_at: timestamp(), error_category: classification.category, error_code: classification.code });
          this.logger.error?.(`Complétion réseau ${fresh.appId} échouée: ${error.message || error}`);
          if (classification.autoPause) {
            this.pauseRequested = true;
            this.experiment.setCompletionRunState(runId, 'paused', { pauseRequested: true, notes: 'Ollama indisponible : suspension automatique sans perte des étapes enregistrées' });
          }
        }
        const refreshed = this.experiment.completionRun(runId);
        onProgress({ phase: 'processing', runId, mode, appId: fresh.appId, action: fresh.action, run: refreshed, counts: this.countsFromItems(refreshed.items) });
      }

      run = this.experiment.completionRun(runId);
      onProgress({ phase: 'rebuild', runId, mode, run, counts: this.countsFromItems(run.items) });
      const network = this.experiment.rebuildNetwork();
      const counts = this.countsFromItems(run.items);
      const status = counts.failed ? 'completed_with_errors' : 'completed';
      const summary = this.buildSummary(run, network, counts);
      const persisted = this.experiment.finishCompletionRun(runId, { status, counts, pairCount: network.pairCount, notes: counts.failed ? `${counts.failed} jeu(x) n’ont pas pu être complétés automatiquement` : 'Tous les jeux de la file ont été traités', summary, errorStats: summary.errors });
      const results=persisted.items.map((item)=>({appId:String(item.app_id),action:item.action,status:item.status,resultVersionId:item.result_version_id||null,error:item.status==='failed'?item.message:null,errorCategory:item.error_category||null}));
      return { runId, status, selected: run.selected_count, counts, network, results, summary, persisted };
    } catch (error) {
      const current = this.experiment.completionRun(runId);
      const counts = this.countsFromItems(current?.items || []);
      this.experiment.finishCompletionRun(runId, { status: 'failed', counts, notes: String(error.message || error), errorStats: Object.fromEntries((current?.items || []).filter((item) => item.error_category).map((item) => [item.error_category, 1])) });
      throw error;
    } finally {
      this.running = false;
      this.currentRunId = null;
    }
  }
}

module.exports = { NetworkCompletionService };
