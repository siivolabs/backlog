'use strict';

const { compactForEmbedding } = require('./network-profile');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  }

  publicPlan() {
    return this.experiment.completionPlan().map(({ profile, ...item }) => item);
  }

  async waitForJob(id) {
    const deadline = Date.now() + this.jobTimeoutMs;
    while (Date.now() < deadline) {
      const job = this.database.getJob(id);
      if (!job) throw new Error(`Tâche IA ${id} introuvable`);
      if (job.status === 'completed') return job;
      if (['error', 'interrupted', 'cancelled'].includes(job.status)) {
        throw new Error([job.message || 'Régénération échouée', job.error_code, job.error_detail].filter(Boolean).join(' — '));
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(`Délai dépassé pour la tâche IA ${id}`);
  }

  async processItem(item) {
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

    if (item.action === 'regenerate') {
      const job = this.aiEngine.enqueue(item.appId, 'network');
      await this.waitForJob(job.id);
      const profile = this.experiment.chooseProfiles([item.appId])[0];
      if (!profile || profile.normalized.completeness < this.experiment.usableThreshold) {
        throw new Error('Le profil régénéré reste insuffisant pour le réseau');
      }
      if (!profile.embedding) throw new Error('Le profil régénéré ne possède pas d’embedding exploitable');
      if (this.experiment.needsComparableAdapter(profile)) this.experiment.saveComparableAdapter(profile);
      return { resultVersionId: profile.versionId, regenerated: 1, embedded: 1 };
    }

    throw new Error(`Action de complétion inconnue : ${item.action}`);
  }

  async run({ onProgress = () => {} } = {}) {
    if (this.running) throw Object.assign(new Error('Une complétion du réseau est déjà en cours'), { statusCode: 409 });
    this.running = true;
    const plan = this.experiment.completionPlan();
    const runId = this.experiment.startCompletionRun(plan);
    const counts = { reused: 0, converted: 0, embedded: 0, regenerated: 0, failed: 0 };
    const results = [];
    onProgress({ phase: 'planning', runId, current: 0, total: plan.length, plan: this.publicPlan() });

    try {
      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        this.experiment.updateCompletionItem(runId, item.appId, { status: 'running', started_at: new Date().toISOString(), message: item.reason });
        onProgress({ phase: item.action, runId, current: index, total: plan.length, appId: item.appId, action: item.action, counts: { ...counts } });
        try {
          const outcome = await this.processItem(item);
          for (const key of ['reused','converted','embedded','regenerated']) counts[key] += Number(outcome[key] || 0);
          const result = { appId: item.appId, action: item.action, status: 'completed', resultVersionId: outcome.resultVersionId || null };
          results.push(result);
          this.experiment.updateCompletionItem(runId, item.appId, {
            status: 'completed', result_version_id: outcome.resultVersionId || null,
            message: 'Profil comparable prêt pour le réseau', completed_at: new Date().toISOString()
          });
        } catch (error) {
          counts.failed += 1;
          const message = String(error.message || error);
          results.push({ appId: item.appId, action: item.action, status: 'failed', error: message });
          this.experiment.updateCompletionItem(runId, item.appId, { status: 'failed', message, completed_at: new Date().toISOString() });
          this.logger.error?.(`Complétion réseau ${item.appId} échouée: ${message}`);
        }
        onProgress({ phase: 'processing', runId, current: index + 1, total: plan.length, appId: item.appId, action: item.action, result: results.at(-1), counts: { ...counts } });
      }

      onProgress({ phase: 'rebuild', runId, current: plan.length, total: plan.length, counts: { ...counts } });
      const network = this.experiment.rebuildNetwork();
      const status = counts.failed ? 'completed_with_errors' : 'completed';
      const persisted = this.experiment.finishCompletionRun(runId, {
        status, counts, pairCount: network.pairCount,
        notes: counts.failed ? `${counts.failed} jeu(x) n’ont pas pu être complétés automatiquement` : 'Tous les jeux sélectionnés sont traités'
      });
      return { runId, status, selected: plan.length, counts, network, results, persisted };
    } catch (error) {
      this.experiment.finishCompletionRun(runId, { status: 'failed', counts, notes: String(error.message || error) });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { NetworkCompletionService };
