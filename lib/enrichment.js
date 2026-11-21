'use strict';

function compactText(value, max = 8000) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
function tokens(text) { return new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{4,}/g) || []); }
function overlap(a, b) { const left = tokens(a), right = tokens(b); if (!left.size || !right.size) return 0; let n = 0; for (const x of left) if (right.has(x)) n++; return n / Math.sqrt(left.size * right.size); }
function profileText(profile) { return [profile.overview, ...(profile.loops || []), ...(profile.experiential_intentions || []), ...(profile.signatures || []), profile.structure, profile.progression, profile.difficulty].filter(Boolean).join('\n'); }

class EnrichmentService {
  constructor({ database, ollama, steamApiBase, steamFetchEnabled = true, fetchImpl = fetch }) {
    this.database = database; this.ollama = ollama; this.steamApiBase = steamApiBase || 'https://store.steampowered.com/api';
    this.steamFetchEnabled = steamFetchEnabled; this.fetch = fetchImpl; this.running = false; this.pauseRequested = false;
  }
  status() { return { running: this.running, pauseRequested: this.pauseRequested, run: this.database.latestRun() }; }
  async officialFacts(game) {
    const local = { source: 'inventaire historique', appId: game.app_id, title: game.title, studio: game.studio, genres: game.genres, description: game.description };
    if (!this.steamFetchEnabled || !/^\d+$/.test(game.app_id)) return [local];
    try {
      const url = `${this.steamApiBase}/appdetails?appids=${encodeURIComponent(game.app_id)}&l=french`;
      const response = await this.fetch(url, { headers: { 'user-agent': 'Backlog-Core/1.0' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(); const data = payload?.[game.app_id]?.data;
      if (!data) return [local];
      return [local, { source: 'Steam Store API', appId: game.app_id, title: data.name, type: data.type, developers: data.developers, publishers: data.publishers, genres: data.genres?.map((x) => x.description), categories: data.categories?.map((x) => x.description), shortDescription: compactText(data.short_description), about: compactText(data.about_the_game), recommendations: data.recommendations?.total, releaseDate: data.release_date?.date }];
    } catch (error) { return [local, { source: 'Steam Store API', unavailable: true, reason: String(error.message || error) }]; }
  }
  makePrompt(game, sources) {
    return `Jeu: ${game.title} (Steam AppID ${game.app_id})\n\nSources factuelles fraîches:\n${JSON.stringify(sources, null, 2)}\n\nProduis un profil backlog-core-profile/1.0 centré sur les boucles de jeu, les intentions expérientielles, la structure, la progression, la difficulté et les traits distinctifs. Les informations absentes doivent rester inconnues.`;
  }
  async processItem(runId, game) {
    this.database.updateItem(runId, game.app_id, { status: 'running', step: 'collecting', started_at: new Date().toISOString(), error: null });
    const sources = await this.officialFacts(game);
    this.database.updateItem(runId, game.app_id, { step: 'analyzing' });
    const profile = await this.ollama.profile(this.makePrompt(game, sources));
    this.database.updateItem(runId, game.app_id, { step: 'embedding' });
    const embedding = await this.ollama.embed(profileText(profile));
    if (!embedding?.length) throw new Error('Embedding absent');
    this.database.saveProfile(game.app_id, { profile, embedding, sources, analysisModel: this.ollama.analysisModel, embeddingModel: this.ollama.embeddingModel });
    this.database.updateItem(runId, game.app_id, { status: 'completed', step: 'completed', completed_at: new Date().toISOString() });
  }
  async run(runId = null) {
    if (this.running) throw Object.assign(new Error('Un enrichissement est déjà en cours'), { statusCode: 409 });
    this.running = true; this.pauseRequested = false;
    let run = runId ? this.database.getRun(runId) : this.database.createRun({ analysisModel: this.ollama.analysisModel, embeddingModel: this.ollama.embeddingModel });
    this.database.setRunStatus(run.id, 'running');
    try {
      for (const item of run.items) {
        if (!['pending','running'].includes(item.status)) continue;
        if (this.pauseRequested) { this.database.setRunStatus(run.id, 'paused'); return this.database.getRun(run.id); }
        const game = this.database.getGame(item.app_id); this.database.setRunStatus(run.id, 'running', { currentAppId: item.app_id });
        try { await this.processItem(run.id, game); } catch (error) { this.database.updateItem(run.id, item.app_id, { status: 'failed', step: 'failed', error: String(error.message || error), completed_at: new Date().toISOString() }); }
      }
      run = this.database.getRun(run.id); this.database.setRunStatus(run.id, run.failed_count ? 'completed_with_errors' : 'completed');
      return this.database.getRun(run.id);
    } catch (error) { this.database.setRunStatus(run.id, 'failed', { error: String(error.message || error) }); throw error; }
    finally { this.running = false; this.pauseRequested = false; }
  }
  pause() { if (this.running) this.pauseRequested = true; return this.status(); }
  resume() { const run = this.database.resumableRun(); if (!run) throw Object.assign(new Error('Aucun enrichissement suspendu'), { statusCode: 404 }); return this.run(run.id); }

  async discover({ referenceAppId, motivationText, limit = 5 }) {
    const reference = this.database.getProfile(referenceAppId); if (!reference) throw Object.assign(new Error('Le jeu de référence doit être analysé'), { statusCode: 400 });
    motivationText = compactText(motivationText, 2000); if (!motivationText) throw Object.assign(new Error('Expliquez ce que vous recherchez'), { statusCode: 400 });
    const queryEmbedding = await this.ollama.embed(`${profileText(reference.profile)}\nMotivations du joueur: ${motivationText}`);
    const prior = new Map(this.database.feedback(referenceAppId).map((x) => [x.candidate_app_id, x.verdict]));
    const candidates = this.database.allProfiles(referenceAppId).map((candidate) => {
      const semantic = cosine(queryEmbedding, candidate.embedding); const experiential = overlap(motivationText, profileText(candidate.profile));
      const memory = prior.get(candidate.app_id) === 'relevant' ? 0.08 : prior.get(candidate.app_id) === 'not_relevant' ? -0.25 : 0;
      const score = Math.max(0, Math.min(1, semantic * 0.72 + experiential * 0.28 + memory));
      const intentions = candidate.profile.experiential_intentions || [];
      const reasons = intentions.sort((a,b) => overlap(motivationText,b)-overlap(motivationText,a)).slice(0,2);
      return { appId: candidate.app_id, title: candidate.title, studio: candidate.studio, genres: candidate.genres, coverUrl: candidate.cover_url, score, reasons, overview: candidate.profile.overview, confidence: candidate.confidence };
    }).filter((x) => x.score >= 0.35).sort((a,b) => b.score-a.score).slice(0, Math.min(5, Math.max(1, Number(limit)||5)));
    const motivations = motivationText.split(/[\n.;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    const sessionId = this.database.saveDiscovery(referenceAppId, motivationText, motivations, candidates);
    return { sessionId, reference: this.database.getGame(referenceAppId), motivations, items: candidates };
  }
}

module.exports = { EnrichmentService, cosine, overlap, profileText };
