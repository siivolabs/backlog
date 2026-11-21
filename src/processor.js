import { fetchSteamDetails, generateProfile, embedText } from './ollama.js';
import { json } from './db.js';

export function buildSource(game, steam) {
  return {
    app_id: String(game.app_id),
    title: game.title,
    studio: game.studio || steam?.developers?.join(', ') || null,
    genres: game.genres || steam?.genres?.map((item) => item.description).join(', ') || null,
    description: game.description || steam?.short_description || null,
    playtime_minutes: game.playtime_minutes || 0,
    last_played_at: game.last_played_at || null,
    inventory: json(game.inventory_metadata_json, {}),
    steam: steam ? {
      type: steam.type,
      categories: steam.categories?.map((item) => item.description) || [],
      genres: steam.genres?.map((item) => item.description) || [],
      release_date: steam.release_date?.date || null,
      metacritic: steam.metacritic?.score || null
    } : null
  };
}

export function createProcessor(config) {
  return async function processGame(game, reportStep = () => {}) {
    reportStep('sources');
    let steam = null;
    try { steam = await fetchSteamDetails(game.app_id, config); } catch (error) {
      // Steam est une source d'appoint : les données V1.0 restent utilisables.
      steam = { warning: error.message };
    }
    const source = buildSource(game, steam?.warning ? null : steam);
    reportStep('profil');
    const profile = await generateProfile(source, config);
    reportStep('embedding');
    const embeddingText = [profile.summary, ...(profile.motivations || []).map((item) => `${item.label}: ${item.evidence}`), profile.pace, profile.challenge, profile.agency, profile.social, profile.tone].filter(Boolean).join('\n');
    const embedding = await embedText(embeddingText, config);
    return {
      source,
      profile,
      embedding,
      analysisModel: config.analysisModel,
      embeddingModel: config.embeddingModel,
      confidence: Number.isFinite(Number(profile.confidence)) ? Number(profile.confidence) : 0
    };
  };
}
