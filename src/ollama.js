import { normalizeVector, parseJson } from './utils.js';

async function post(config, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.ollamaUrl}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${text.slice(0, 300)}`);
    return parseJson(text, {});
  } finally { clearTimeout(timer); }
}

export async function embedText(config, text) {
  let data;
  try { data = await post(config, '/api/embed', { model: config.embeddingModel, input: text }); }
  catch (first) {
    try { data = await post(config, '/api/embeddings', { model: config.embeddingModel, prompt: text }); }
    catch { throw first; }
  }
  const vector = normalizeVector(data?.embeddings?.[0] || data?.embedding);
  if (!vector.length) throw new Error('Ollama n’a retourné aucun embedding exploitable.');
  return vector;
}

export async function analyzeGame(config, game) {
  const source = {
    app_id: String(game.app_id), title: game.title, studio: game.studio, genres: game.genres,
    description: game.description, playtime_minutes: game.playtime_minutes,
    inventory: parseJson(game.inventory_json, null), steam: parseJson(game.steam_json, null)
  };
  const prompt = `Tu analyses une expérience vidéoludique sans inventer ce que les sources ne permettent pas d'établir.\n` +
    `Retourne uniquement un objet JSON avec les clés summary, motivations (tableau d'objets key,label,weight,evidence), pace, challenge, agency, social, tone, confidence.\n` +
    `confidence doit être comprise entre 0 et 1 et refléter la qualité documentaire, pas la popularité. Si les informations sont insuffisantes, dis-le explicitement dans summary, laisse les motivations non étayées absentes et donne une faible confidence.\n` +
    `Source : ${JSON.stringify(source)}`;
  const data = await post(config, '/api/generate', { model: config.analysisModel, prompt, stream: false, format: 'json' });
  const profile = parseJson(data?.response, data?.response);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Profil JSON Ollama invalide.');
  const embeddingText = [profile.summary, ...(profile.motivations || []).map((m) => `${m.label || m.key}: ${m.evidence || ''}`), profile.pace, profile.challenge, profile.agency, profile.social, profile.tone].filter(Boolean).join('\n');
  const embedding = await embedText(config, embeddingText || JSON.stringify(profile));
  return { source, profile, embedding };
}
