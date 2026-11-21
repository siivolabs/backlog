export class EnrichmentWorker {
  constructor(repository, service, { idleDelay = 1000 } = {}) {
    this.repository = repository;
    this.service = service;
    this.idleDelay = idleDelay;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.repository.recoverInterruptedJobs();
    this.schedule(10);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  wake() { if (this.running) this.schedule(0); }

  schedule(delay = this.idleDelay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick().catch((error) => {
      console.error('[worker]', error);
      this.schedule(this.idleDelay);
    }), delay);
    this.timer.unref?.();
  }

  async tick() {
    if (!this.running) return;
    if (this.repository.settlePause()) return this.schedule();
    const job = this.repository.claimNextJob();
    if (!job) {
      const campaign = this.repository.campaign();
      if (campaign.status === 'running') this.repository.settleCampaignIfDone();
      return this.schedule();
    }
    const started = Date.now();
    try {
      const result = await this.service.enrich(job, (step) => this.repository.setStep(job.app_id, step));
      this.repository.completeJob(job.app_id, result, Date.now() - started);
    } catch (error) {
      this.repository.failJob(job.app_id, error?.stack || error?.message || error, Date.now() - started);
    }
    this.schedule(10);
  }
}
