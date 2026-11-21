async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Délai dépassé après ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaClient {
  constructor({ baseUrl, analysisModel, embeddingModel, timeoutMs, numPredict, temperature }) {
    Object.assign(this, { baseUrl, analysisModel, embeddingModel, timeoutMs, numPredict, temperature });
  }

  async generateJson(prompt, schema) {
    const data = await requestJson(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.analysisModel,
        prompt,
        stream: false,
        format: schema,
        options: { temperature: this.temperature, num_predict: this.numPredict }
      })
    }, this.timeoutMs);
    if (!data.response) throw new Error('Ollama n’a renvoyé aucun contenu d’analyse');
    try { return JSON.parse(data.response); }
    catch { throw new Error(`Réponse JSON invalide du modèle: ${String(data.response).slice(0, 400)}`); }
  }

  async embed(input) {
    const inputs = Array.isArray(input) ? input : [input];
    try {
      const data = await requestJson(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, input: inputs })
      }, this.timeoutMs);
      if (!Array.isArray(data.embeddings) || !Array.isArray(data.embeddings[0])) throw new Error('Embeddings absents');
      return Array.isArray(input) ? data.embeddings : data.embeddings[0];
    } catch (primaryError) {
      if (inputs.length !== 1) throw primaryError;
      const legacy = await requestJson(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, prompt: inputs[0] })
      }, this.timeoutMs);
      if (!Array.isArray(legacy.embedding)) throw primaryError;
      return legacy.embedding;
    }
  }
}
