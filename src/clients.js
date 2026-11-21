function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function jsonFetch(url, options, timeoutMs) {
  const response = await fetch(url, { ...options, signal: timeoutSignal(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} pour ${url}`);
  return response.json();
}

export class SteamClient {
  constructor({ timeoutMs = 30000, fetchImpl = jsonFetch } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async appDetails(appId) {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=french&cc=fr`;
    const payload = await this.fetchImpl(url, { headers: { 'user-agent': 'BacklogCore/1.1.2' } }, this.timeoutMs);
    const entry = payload?.[String(appId)];
    if (!entry?.success || !entry.data) throw new Error(`Steam ne fournit aucune fiche pour ${appId}`);
    return entry.data;
  }
}

export class OllamaClient {
  constructor({ baseUrl, analysisModel, embeddingModel, timeoutMs = 180000, fetchImpl = jsonFetch }) {
    this.baseUrl = baseUrl;
    this.analysisModel = analysisModel;
    this.embeddingModel = embeddingModel;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async profile(prompt) {
    const payload = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.analysisModel, stream: false, format: 'json',
        messages: [{ role: 'system', content: 'Tu produis uniquement un objet JSON valide, factuel et compact.' }, { role: 'user', content: prompt }]
      })
    }, this.timeoutMs);
    const content = payload?.message?.content;
    if (!content) throw new Error('Réponse Ollama vide');
    try { return JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { throw new Error('Ollama a renvoyé un profil JSON invalide'); }
  }

  async embed(input) {
    try {
      const payload = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, input })
      }, this.timeoutMs);
      const vector = payload?.embeddings?.[0];
      if (!Array.isArray(vector) || !vector.length) throw new Error('embedding absent');
      return vector;
    } catch (firstError) {
      const payload = await this.fetchImpl(`${this.baseUrl}/api/embeddings`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, prompt: input })
      }, this.timeoutMs);
      if (!Array.isArray(payload?.embedding) || !payload.embedding.length) throw firstError;
      return payload.embedding;
    }
  }
}
