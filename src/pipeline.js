import { parseJson } from './db.js';

function text(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function createPipeline({ steam, ollama, analysisModel, embeddingModel }) {
  return async function enrichGame(game, onStep = () => {}) {
    onStep('steam');
    let steamData = null;
    try { steamData = await steam.appDetails(game.app_id); }
    catch (error) {
      if (!game.description) throw error;
    }

    const source = {
      app_id: game.app_id,
      title: game.title,
      studio: game.studio,
      genres: parseJson(game.genres, game.genres),
      description: game.description,
      playtime_minutes: game.playtime_minutes,
      inventory: parseJson(game.inventory_metadata_json, {}),
      steam: steamData ? {
        name: steamData.name,
        developers: steamData.developers,
        publishers: steamData.publishers,
        genres: steamData.genres,
        categories: steamData.categories,
        short_description: text(steamData.short_description),
        about_the_game: text(steamData.about_the_game),
        release_date: steamData.release_date,
        recommendations: steamData.recommendations
      } : null,
      fetched_at: new Date().toISOString()
    };

    onStep('analysis');
    const profile = await ollama.profile(`Analyse l'expérience proposée par ce jeu sans inventer. Retourne un objet JSON avec exactement ces clés : summary (chaîne), experiential_axes (tableau de chaînes), player_motivations (tableau de chaînes), emotional_tone (tableau de chaînes), rhythm (chaîne), agency (chaîne), social_mode (chaîne), confidence (nombre entre 0 et 1).\nSOURCE:\n${JSON.stringify(source)}`);

    const canonical = JSON.stringify({
      title: game.title,
      summary: profile.summary,
      experiential_axes: profile.experiential_axes,
      player_motivations: profile.player_motivations,
      emotional_tone: profile.emotional_tone,
      rhythm: profile.rhythm,
      agency: profile.agency,
      social_mode: profile.social_mode
    });
    onStep('embedding');
    const embedding = await ollama.embed(canonical);
    onStep('persist');
    return {
      schema_version: 'core-profile-1.0',
      profile_json: JSON.stringify(profile),
      embedding_json: JSON.stringify(embedding),
      source_json: JSON.stringify(source),
      analysis_model: analysisModel,
      embedding_model: embeddingModel,
      confidence: Math.max(0, Math.min(1, Number(profile.confidence) || 0))
    };
  };
}
