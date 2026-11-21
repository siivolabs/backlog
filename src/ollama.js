function withTimeout(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function requestJson(url, options, timeoutMs) {
  const response = await fetch(url, { ...options, signal: withTimeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Réponse JSON invalide de ${url}`); }
}

export async function fetchSteamDetails(appId, config) {
  if (!config.steamEnrichmentEnabled) return null;
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=french`;
  const payload = await requestJson(url, { headers: { accept: 'application/json' } }, Math.min(config.requestTimeoutMs, 30000));
  return payload?.[String(appId)]?.success ? payload[String(appId)].data : null;
}

export async function generateProfile(source, config) {
  const prompt = `Tu analyses une expérience de jeu, sans recommander d'achat. Réponds en JSON strict.\n\nDonnées source:\n${JSON.stringify(source)}\n\nStructure attendue:\n{"summary":"...","motivations":[{"key":"...","label":"...","weight":0.0,"evidence":"..."}],"pace":"...","challenge":"...","agency":"...","social":"...","tone":"...","confidence":0.0}`;
  const body = {
    model: config.analysisModel,
    stream: false,
    format: 'json',
    messages: [
      { role: 'system', content: 'Tu produis des profils expérientiels de jeux factuels, compacts et homogènes. Aucun commentaire hors JSON.' },
      { role: 'user', content: prompt }
    ],
    options: { temperature: 0.2 }
  };
  const payload = await requestJson(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }, config.requestTimeoutMs);
  const content = payload?.message?.content;
  if (!content) throw new Error('Ollama n’a retourné aucun profil.');
  try { return JSON.parse(content); } catch { throw new Error('Le profil Ollama n’est pas un JSON valide.'); }
}

export async function embedText(input, config) {
  try {
    const payload = await requestJson(`${config.ollamaBaseUrl}/api/embed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.embeddingModel, input })
    }, config.requestTimeoutMs);
    const vector = payload?.embeddings?.[0];
    if (!Array.isArray(vector) || !vector.length) throw new Error('Embedding vide.');
    return vector;
  } catch (primary) {
    const payload = await requestJson(`${config.ollamaBaseUrl}/api/embeddings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.embeddingModel, prompt: input })
    }, config.requestTimeoutMs).catch(() => { throw primary; });
    if (!Array.isArray(payload?.embedding) || !payload.embedding.length) throw primary;
    return payload.embedding;
  }
}
