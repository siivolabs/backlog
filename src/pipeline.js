const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'player_actions', 'experiential_intentions', 'distinctive_traits', 'uncertainties'],
  properties: {
    summary: { type: 'string' },
    player_actions: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    experiential_intentions: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    distinctive_traits: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    uncertainties: { type: 'array', items: { type: 'string' }, maxItems: 6 }
  }
};

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Délai Steam dépassé après ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Backlog-Core/1.1' } });
    if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function profileText(game, profile) {
  return [
    game.name,
    profile.summary,
    `Actions du joueur: ${(profile.player_actions || []).join('; ')}`,
    `Intentions expérientielles: ${(profile.experiential_intentions || []).join('; ')}`,
    `Traits distinctifs: ${(profile.distinctive_traits || []).join('; ')}`
  ].filter(Boolean).join('\n');
}

export class EnrichmentPipeline {
  constructor({ ollama, steamDetailsUrl, steamTimeoutMs, pipelineVersion = 'core-1.1' }) {
    Object.assign(this, { ollama, steamDetailsUrl, steamTimeoutMs, pipelineVersion });
  }

  async fetchSource(game, onStep = () => {}) {
    onStep('collecte_steam');
    const url = new URL(this.steamDetailsUrl);
    url.searchParams.set('appids', String(game.app_id));
    url.searchParams.set('l', 'french');
    url.searchParams.set('cc', 'FR');
    let steam = null;
    try {
      const payload = await fetchJson(url, this.steamTimeoutMs);
      const envelope = payload?.[String(game.app_id)];
      if (envelope?.success && envelope.data) steam = envelope.data;
    } catch (error) {
      // L'inventaire reste une source exploitable; la panne Steam est conservée comme incertitude par le prompt.
      steam = { source_error: error.message };
    }
    return {
      app_id: game.app_id,
      name: steam?.name || game.name,
      developer: steam?.developers?.join(', ') || game.developer || null,
      publisher: steam?.publishers?.join(', ') || null,
      genres: steam?.genres?.map((item) => item.description) || (game.genres ? [game.genres] : []),
      categories: steam?.categories?.map((item) => item.description) || [],
      short_description: stripHtml(steam?.short_description || ''),
      about_the_game: stripHtml(steam?.about_the_game || '').slice(0, 8000),
      source_error: steam?.source_error || null
    };
  }

  async run(game, onStep = () => {}) {
    const source = await this.fetchSource(game, onStep);
    onStep('analyse');
    const prompt = `Tu produis le profil expérientiel compact et homogène d'un jeu vidéo pour Backlog Core.\n\n` +
      `Règles:\n- Décris ce que le joueur fait et vit, pas une publicité.\n- N'invente aucun fait absent des données.\n- Place les informations ambiguës ou manquantes dans uncertainties.\n- Réponds exclusivement selon le schéma JSON demandé.\n\n` +
      `Données de référence:\n${JSON.stringify(source, null, 2)}`;
    const profile = await this.ollama.generateJson(prompt, PROFILE_SCHEMA);
    onStep('embedding');
    const embedding = await this.ollama.embed(profileText(game, profile));
    if (!Array.isArray(embedding) || embedding.length < 2 || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error('Embedding invalide');
    }
    onStep('enregistrement');
    return {
      source,
      profile,
      embedding,
      schemaVersion: '1.0',
      pipelineVersion: this.pipelineVersion,
      model: this.ollama.analysisModel,
      embeddingModel: this.ollama.embeddingModel
    };
  }
}
