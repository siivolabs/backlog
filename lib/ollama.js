'use strict';

const { compactForEmbedding } = require('./profile');

class OllamaClient {
  constructor(baseUrl, model = 'embeddinggemma') {
    this.baseUrl = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = model;
  }

  async request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.OLLAMA_TIMEOUT_MS || 120000));
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal
      });
      if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return response.json();
    } finally { clearTimeout(timeout); }
  }

  async embedText(text) {
    if (!String(text || '').trim()) throw new Error('Profil vide: embedding impossible');
    let data;
    try {
      data = await this.request('/api/embed', { model: this.model, input: text, truncate: true });
      if (Array.isArray(data.embeddings?.[0])) return data.embeddings[0];
    } catch (firstError) {
      data = await this.request('/api/embeddings', { model: this.model, prompt: text });
      if (Array.isArray(data.embedding)) return data.embedding;
      throw firstError;
    }
    if (Array.isArray(data.embedding)) return data.embedding;
    throw new Error('Réponse Ollama sans embedding exploitable');
  }

  async backfill(database, limit = 50, onProgress = () => {}) {
    const profiles = database.profilesNeedingEmbeddings(limit);
    const results = [];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      try {
        const embedding = await this.embedText(compactForEmbedding(profile.profile));
        database.saveEmbedding(profile.versionId, embedding, this.model);
        results.push({ appId: profile.appId, versionId: profile.versionId, status: 'completed', dimensions: embedding.length });
      } catch (error) {
        results.push({ appId: profile.appId, versionId: profile.versionId, status: 'failed', error: String(error.message || error) });
      }
      onProgress({ current: index + 1, total: profiles.length, result: results.at(-1) });
    }
    return {
      requested: profiles.length,
      completed: results.filter((item) => item.status === 'completed').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results
    };
  }
}

module.exports = { OllamaClient };
