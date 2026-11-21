'use strict';

class OllamaClient {
  constructor({ baseUrl, analysisModel, embeddingModel, timeoutMs = 180000 }) {
    this.baseUrl = String(baseUrl || 'http://host.docker.internal:11434').replace(/\/$/, '');
    this.analysisModel = analysisModel || 'qwen3:32b';
    this.embeddingModel = embeddingModel || 'embeddinggemma';
    this.timeoutMs = Number(timeoutMs) || 180000;
  }
  async request(path, body) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ollama ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } finally { clearTimeout(timer); }
  }
  async profile(prompt) {
    const schema = { type: 'object', properties: {
      overview: { type: 'string' }, loops: { type: 'array', items: { type: 'string' } },
      experiential_intentions: { type: 'array', items: { type: 'string' } }, signatures: { type: 'array', items: { type: 'string' } },
      structure: { type: 'string' }, progression: { type: 'string' }, difficulty: { type: 'string' },
      uncertainties: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' }
    }, required: ['overview','loops','experiential_intentions','signatures','structure','progression','difficulty','uncertainties','confidence'] };
    const data = await this.request('/api/chat', { model: this.analysisModel, stream: false, think: false, format: schema, options: { temperature: 0, num_predict: 1200 }, messages: [
      { role: 'system', content: "Tu produis un profil expérientiel de jeu vidéo homogène. Distingue les faits des interprétations. N'invente rien; place toute lacune dans uncertainties. Réponds exclusivement selon le schéma JSON demandé." },
      { role: 'user', content: prompt }
    ] });
    const raw = data.message?.content || data.response || '';
    try { return JSON.parse(raw); } catch { const match = String(raw).match(/\{[\s\S]*\}/); if (!match) throw new Error('Réponse de profil non JSON'); return JSON.parse(match[0]); }
  }
  async embed(input) {
    try {
      const data = await this.request('/api/embed', { model: this.embeddingModel, input });
      return data.embeddings?.[0] || data.embedding || null;
    } catch (error) {
      const data = await this.request('/api/embeddings', { model: this.embeddingModel, prompt: input });
      return data.embedding || null;
    }
  }
}

module.exports = { OllamaClient };
