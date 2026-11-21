const baseUrl = () => (process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434').replace(/\/$/, '');
const analysisModel = () => process.env.AI_ANALYSIS_MODEL || 'qwen3:32b';
const embeddingModel = () => process.env.AI_EMBEDDING_MODEL || 'embeddinggemma';

function deterministicEmbedding(text, size = 64) {
  const vector = Array(size).fill(0);
  for (let index = 0; index < text.length; index += 1) vector[index % size] += (text.charCodeAt(index) % 97) / 97;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

async function postJson(url, body, timeoutMs = 180000) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

function parseGeneratedJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('Ollama a renvoyé un profil non JSON.');
}

export class EnrichmentService {
  async enrich(game, onStep = () => {}) {
    if (process.env.MOCK_AI === '1') {
      const text = `${game.name} ${game.developer || ''} ${game.genres || ''} ${game.description || ''}`;
      return {
        model: 'mock', embeddingModel: 'mock', source: { game },
        profile: { summary: `Profil de test pour ${game.name}`, experiences: [game.genres || 'inconnu'], uncertainties: [] },
        embedding: deterministicEmbedding(text)
      };
    }

    onStep('steam');
    let steam = {};
    try {
      const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(game.app_id)}&l=french`, { signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      steam = payload?.[game.app_id]?.data || {};
    } catch (error) {
      steam = { warning: `Steam indisponible: ${error.message}` };
    }

    const source = {
      app_id: game.app_id, name: game.name, developer: game.developer,
      genres: game.genres, description: game.description,
      steam: {
        short_description: steam.short_description,
        detailed_description: steam.detailed_description,
        developers: steam.developers,
        genres: steam.genres,
        categories: steam.categories,
        warning: steam.warning
      }
    };
    onStep('analysis');
    const prompt = `Analyse ce jeu comme une expérience vécue, sans inventer. Retourne uniquement un JSON avec les clés summary, core_loops, player_intentions, experiential_signature, resonances et uncertainties. Source:\n${JSON.stringify(source)}`;
    const generated = await postJson(`${baseUrl()}/api/generate`, { model: analysisModel(), prompt, stream: false, format: 'json' });
    const profile = parseGeneratedJson(generated.response);

    onStep('embedding');
    const text = JSON.stringify(profile);
    let embedding;
    try {
      const embedded = await postJson(`${baseUrl()}/api/embed`, { model: embeddingModel(), input: text });
      embedding = embedded.embeddings?.[0];
    } catch {
      const embedded = await postJson(`${baseUrl()}/api/embeddings`, { model: embeddingModel(), prompt: text });
      embedding = embedded.embedding;
    }
    if (!Array.isArray(embedding) || !embedding.length) throw new Error('Ollama n’a renvoyé aucun embedding.');
    return { model: analysisModel(), embeddingModel: embeddingModel(), source, profile, embedding };
  }

  async embedMotivation(text) {
    if (process.env.MOCK_AI === '1') return deterministicEmbedding(text);
    try {
      const result = await postJson(`${baseUrl()}/api/embed`, { model: embeddingModel(), input: text }, 60000);
      return result.embeddings?.[0] || [];
    } catch {
      const result = await postJson(`${baseUrl()}/api/embeddings`, { model: embeddingModel(), prompt: text }, 60000);
      return result.embedding || [];
    }
  }
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
