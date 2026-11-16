'use strict';

const crypto = require('node:crypto');

const AI_PROFILE_PROMPT_VERSION = 'experience-profile-v1';
const AI_SIMILARITY_VERSION = 'hybrid-embedding-profile-v1';
const AI_EMBEDDING_DIMENSIONS = 768;
const PROFILE_STATUS = new Set(['queued', 'analyzing', 'completed', 'error']);

const nowIso = () => new Date().toISOString();
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const clamp01 = (value) => Math.min(1, Math.max(0, Number(value)));
const cleanText = (value, maximum = 4000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function initializeAiDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      selection_json TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      prompt_version TEXT NOT NULL,
      analysis_model TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_game_profiles (
      appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      profile_json TEXT,
      canonical_text TEXT,
      source_hash TEXT,
      local_source_hash TEXT,
      prompt_version TEXT NOT NULL,
      analysis_model TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      queued_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('queued', 'analyzing', 'completed', 'error'))
    );
    CREATE TABLE IF NOT EXISTS ai_document_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_key TEXT NOT NULL,
      title TEXT,
      url TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      used_for_profile INTEGER NOT NULL DEFAULT 1,
      UNIQUE(appid, source_type, source_key)
    );
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_similarities (
      reference_appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
      candidate_appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
      algorithm_version TEXT NOT NULL,
      embedding_score REAL NOT NULL,
      profile_score REAL NOT NULL,
      overall_score REAL NOT NULL,
      similarities_json TEXT NOT NULL,
      differences_json TEXT NOT NULL,
      calculated_at TEXT NOT NULL,
      PRIMARY KEY(reference_appid, candidate_appid)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_profiles_status ON ai_game_profiles(status);
    CREATE INDEX IF NOT EXISTS idx_ai_sources_appid ON ai_document_sources(appid);
    CREATE INDEX IF NOT EXISTS idx_ai_similarities_reference ON ai_similarities(reference_appid, overall_score DESC);
    UPDATE ai_game_profiles SET status = 'queued', error = NULL
      WHERE status = 'analyzing';
    UPDATE ai_analysis_runs SET status = 'interrupted', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running';
  `);
  const profileColumns = new Set(db.prepare('PRAGMA table_info(ai_game_profiles)').all().map((row) => row.name));
  if (!profileColumns.has('local_source_hash')) db.exec('ALTER TABLE ai_game_profiles ADD COLUMN local_source_hash TEXT');
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? clamp01(number) : null;
}

function normalizeProfile(raw) {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const section = (name, keys) => {
    const source = object[name] && typeof object[name] === 'object' ? object[name] : {};
    return Object.fromEntries(keys.map((key) => [key, numberOrNull(source[key])]));
  };
  const enumValue = (value, allowed, fallback = 'unknown') => allowed.includes(value) ? value : fallback;
  return {
    narrative: section('narrative', ['importance', 'complexity', 'linearity', 'environmental_storytelling']),
    gameplay: section('gameplay', ['combat', 'exploration', 'puzzles', 'stealth', 'traversal', 'strategy']),
    structure: section('structure', ['open_world', 'hub_based', 'mission_based', 'procedural']),
    tone: section('tone', ['mystery', 'horror', 'humor', 'science_fiction', 'fantasy', 'realism']),
    experience: {
      difficulty_pressure: numberOrNull(object.experience?.difficulty_pressure),
      pace_intensity: numberOrNull(object.experience?.pace_intensity),
      perspective: enumValue(object.experience?.perspective, ['first_person', 'third_person', 'top_down', 'side_view', 'isometric', 'mixed', 'unknown']),
      primary_mode: enumValue(object.experience?.primary_mode, ['single_player', 'cooperative', 'competitive_multiplayer', 'mixed', 'unknown']),
      production_scope: enumValue(object.experience?.production_scope, ['indie', 'aa', 'aaa', 'mixed', 'unknown'])
    },
    summary: cleanText(object.summary, 1200),
    evidence: Array.isArray(object.evidence) ? object.evidence.map((item) => cleanText(item, 400)).filter(Boolean).slice(0, 20) : [],
    missing_information: Array.isArray(object.missing_information) ? object.missing_information.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, 20) : []
  };
}

function validateProfile(profile) {
  if (!profile.summary) throw new Error('Le profil IA ne contient pas de résumé.');
  const numeric = [
    ...Object.values(profile.narrative), ...Object.values(profile.gameplay),
    ...Object.values(profile.structure), ...Object.values(profile.tone),
    profile.experience.difficulty_pressure, profile.experience.pace_intensity
  ];
  if (numeric.filter((value) => value !== null).length < 8) {
    throw new Error('Le profil IA ne contient pas assez de dimensions exploitables.');
  }
  return profile;
}

function profileTemplate() {
  return {
    narrative: { importance: 0, complexity: 0, linearity: 0, environmental_storytelling: 0 },
    gameplay: { combat: 0, exploration: 0, puzzles: 0, stealth: 0, traversal: 0, strategy: 0 },
    structure: { open_world: 0, hub_based: 0, mission_based: 0, procedural: 0 },
    tone: { mystery: 0, horror: 0, humor: 0, science_fiction: 0, fantasy: 0, realism: 0 },
    experience: {
      difficulty_pressure: 0,
      pace_intensity: 0,
      perspective: 'first_person|third_person|top_down|side_view|isometric|mixed|unknown',
      primary_mode: 'single_player|cooperative|competitive_multiplayer|mixed|unknown',
      production_scope: 'indie|aa|aaa|mixed|unknown'
    },
    summary: 'Description factuelle de l’expérience en 2 à 4 phrases.',
    evidence: ['Affirmations directement soutenues par le dossier.'],
    missing_information: ['Informations importantes absentes du dossier.']
  };
}

function canonicalProfileText(game, profile) {
  const lines = [
    `Titre: ${game.name}`,
    `Résumé: ${profile.summary}`,
    `Perspective: ${profile.experience.perspective}`,
    `Mode principal: ${profile.experience.primary_mode}`,
    `Échelle de production: ${profile.experience.production_scope}`
  ];
  for (const [group, values] of Object.entries(profile)) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || group === 'experience') continue;
    for (const [key, value] of Object.entries(values)) {
      if (value !== null) lines.push(`${group}.${key}: ${value.toFixed(3)}`);
    }
  }
  lines.push(`experience.difficulty_pressure: ${profile.experience.difficulty_pressure ?? 'unknown'}`);
  lines.push(`experience.pace_intensity: ${profile.experience.pace_intensity ?? 'unknown'}`);
  return lines.join('\n');
}

function flattenNumeric(profile) {
  const values = new Map();
  for (const group of ['narrative', 'gameplay', 'structure', 'tone']) {
    for (const [key, value] of Object.entries(profile[group] || {})) {
      if (value !== null && Number.isFinite(value)) values.set(`${group}.${key}`, value);
    }
  }
  for (const key of ['difficulty_pressure', 'pace_intensity']) {
    const value = profile.experience?.[key];
    if (value !== null && Number.isFinite(value)) values.set(`experience.${key}`, value);
  }
  return values;
}

const DIMENSION_LABELS = {
  'narrative.importance': 'importance du récit', 'narrative.complexity': 'complexité narrative',
  'narrative.linearity': 'linéarité du récit', 'narrative.environmental_storytelling': 'narration environnementale',
  'gameplay.combat': 'place du combat', 'gameplay.exploration': 'importance de l’exploration',
  'gameplay.puzzles': 'place des énigmes', 'gameplay.stealth': 'place de l’infiltration',
  'gameplay.traversal': 'importance des déplacements', 'gameplay.strategy': 'dimension stratégique',
  'structure.open_world': 'structure en monde ouvert', 'structure.hub_based': 'structure en hubs',
  'structure.mission_based': 'structure par missions', 'structure.procedural': 'génération procédurale',
  'tone.mystery': 'mystère', 'tone.horror': 'horreur', 'tone.humor': 'humour',
  'tone.science_fiction': 'science-fiction', 'tone.fantasy': 'fantasy', 'tone.realism': 'réalisme',
  'experience.difficulty_pressure': 'pression de la difficulté', 'experience.pace_intensity': 'intensité du rythme'
};

function cosine(left, right) {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function profileComparison(left, right) {
  const a = flattenNumeric(left);
  const b = flattenNumeric(right);
  const dimensions = [];
  for (const [key, value] of a) {
    if (!b.has(key)) continue;
    const difference = Math.abs(value - b.get(key));
    dimensions.push({ key, difference, similarity: 1 - difference, left: value, right: b.get(key) });
  }
  const categorical = [
    ['experience.perspective', left.experience?.perspective, right.experience?.perspective],
    ['experience.primary_mode', left.experience?.primary_mode, right.experience?.primary_mode],
    ['experience.production_scope', left.experience?.production_scope, right.experience?.production_scope]
  ].filter(([, one, two]) => one && two && one !== 'unknown' && two !== 'unknown');
  const numericScore = dimensions.length ? dimensions.reduce((sum, item) => sum + item.similarity, 0) / dimensions.length : 0;
  const categoricalScore = categorical.length ? categorical.reduce((sum, [, one, two]) => sum + Number(one === two), 0) / categorical.length : numericScore;
  const score = dimensions.length ? numericScore * 0.85 + categoricalScore * 0.15 : categoricalScore;
  const similarities = dimensions.filter((item) => item.similarity >= 0.78)
    .sort((one, two) => two.similarity - one.similarity).slice(0, 4)
    .map((item) => `${DIMENSION_LABELS[item.key] || item.key} proche (${Math.round(item.similarity * 100)} %)`);
  const differences = dimensions.filter((item) => item.difference >= 0.28)
    .sort((one, two) => two.difference - one.difference).slice(0, 4)
    .map((item) => `${DIMENSION_LABELS[item.key] || item.key} sensiblement différent (${Math.round(item.difference * 100)} points)`);
  for (const [key, one, two] of categorical) {
    const label = DIMENSION_LABELS[key] || key.split('.').pop().replaceAll('_', ' ');
    if (one === two && similarities.length < 5) similarities.push(`${label} identique : ${one}`);
    if (one !== two && differences.length < 5) differences.push(`${label} différent : ${one} / ${two}`);
  }
  return { score: clamp01(score), similarities, differences };
}

function floatArrayToBuffer(values) {
  const array = Float32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function bufferToFloatArray(buffer) {
  const values = new Float32Array(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getFloat32(index * 4, true);
  return values;
}

async function jsonRequest(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  try {
    const response = await fetchImpl(url, { method: options.method || 'GET', headers: options.headers || {}, body: options.body, signal: controller.signal });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error(`Réponse JSON invalide de ${options.provider || 'service'} (${response.status}).`); }
    if (!response.ok) throw new Error(`${options.provider || 'Service'} HTTP ${response.status}: ${cleanText(payload.error || payload.message || text, 500)}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${options.provider || 'Service'} n’a pas répondu dans le délai prévu.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAiEngine({ db, settings, fetchImpl, env, allPublicGames, gameByAppid, transaction, HttpError }) {
  initializeAiDatabase(db);
  const ollamaBaseUrl = normalizeBaseUrl(env.OLLAMA_BASE_URL || 'http://192.168.1.77:11434');
  const analysisModel = String(env.OLLAMA_ANALYSIS_MODEL || 'qwen3:32b');
  const embeddingModel = String(env.OLLAMA_EMBEDDING_MODEL || 'embeddinggemma');
  const searxngBaseUrl = normalizeBaseUrl(env.SEARXNG_BASE_URL || '');
  const searxngLanguage = String(env.SEARXNG_LANGUAGE || 'fr-FR');
  const analysisTimeoutMs = Math.max(10000, Number(env.AI_ANALYSIS_TIMEOUT_MS || 300000));
  const embeddingTimeoutMs = Math.max(10000, Number(env.AI_EMBEDDING_TIMEOUT_MS || 120000));
  const job = {
    running: false, pauseRequested: false, runId: null, currentAppid: null, currentName: null,
    lastMessage: 'En attente d’un lancement manuel.', startedAt: null, stoppedAt: null
  };

  function selectedAppids() {
    const stored = safeJsonParse(settings.get('ai_pilot_selection_appids', '[]'), []);
    const confirmedAt = settings.get('ai_pilot_selection_confirmed_at');
    if (!confirmedAt || !Array.isArray(stored) || !stored.length) return [];
    const available = new Set(db.prepare('SELECT appid FROM games').all().map((row) => Number(row.appid)));
    return [...new Set(stored.map(Number).filter((appid) => Number.isInteger(appid) && available.has(appid)))];
  }

  function localDossier(game) {
    const stored = db.prepare(`SELECT steam_short_description, steam_about, steam_categories, igdb_summary, igdb_storyline
      FROM games WHERE appid = ?`).get(game.appid) || {};
    const cache = db.prepare(`SELECT provider, provider_id, name, genres, themes, platforms, game_type, summary, storyline, found, fetched_at
      FROM metadata_cache WHERE external_id = ? ORDER BY provider`).all(String(game.appid));
    const payload = {
      appid: game.appid,
      title: game.name,
      playtime_minutes: game.playtime_forever,
      last_played_unix: game.rtime_last_played,
      application_type: game.application_type,
      genres: game.genres || [], themes: game.themes || [], platforms: game.platforms || [],
      classification: { reason: game.classification_reason, confidence: game.classification_confidence },
      metadata_sources: game.metadata_sources || [],
      steam_document: {
        short_description: stored.steam_short_description || null,
        about: stored.steam_about || null,
        categories: safeJsonParse(stored.steam_categories, [])
      },
      igdb_document: { summary: stored.igdb_summary || null, storyline: stored.igdb_storyline || null },
      provider_cache: cache.map((row) => ({
        provider: row.provider, provider_id: row.provider_id, title: row.name,
        genres: safeJsonParse(row.genres, []), themes: safeJsonParse(row.themes, []),
        platforms: safeJsonParse(row.platforms, []), game_type: row.game_type,
        summary: row.summary || null, storyline: row.storyline || null,
        found: Boolean(row.found), fetched_at: row.fetched_at
      }))
    };
    return { sourceType: 'local', sourceKey: `local:${game.appid}`, title: `Données locales de ${game.name}`, url: null, content: JSON.stringify(payload) };
  }

  function localDossierNeedsDocuments(game) {
    const stored = db.prepare(`SELECT steam_short_description, steam_about, igdb_summary, igdb_storyline FROM games WHERE appid = ?`).get(game.appid) || {};
    if (stored.steam_about || stored.steam_short_description || stored.igdb_summary || stored.igdb_storyline) return false;
    const signalCount = (game.genres?.length || 0) + (game.themes?.length || 0) + (game.platforms?.length || 0);
    return signalCount < 8 || !game.themes?.length;
  }

  async function searxngDossier(game) {
    if (!searxngBaseUrl) return [];
    const query = `${game.name} jeu vidéo gameplay histoire exploration structure ambiance`;
    const url = new URL(`${searxngBaseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', searxngLanguage);
    url.searchParams.set('safesearch', '1');
    const payload = await jsonRequest(fetchImpl, url, { provider: 'SearXNG', timeoutMs: 30000 });
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.slice(0, 6).map((result, index) => ({
      sourceType: 'searxng',
      sourceKey: `searxng:${sha256(`${result.url || ''}:${result.title || ''}`).slice(0, 24)}`,
      title: cleanText(result.title || `Résultat ${index + 1}`, 300),
      url: cleanText(result.url, 2000) || null,
      content: cleanText(result.content || result.snippet, 1800)
    })).filter((item) => item.content);
  }

  function persistSources(appid, sources) {
    const statement = db.prepare(`INSERT INTO ai_document_sources(appid, source_type, source_key, title, url, content, content_hash, fetched_at, used_for_profile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(appid, source_type, source_key) DO UPDATE SET
        title = excluded.title, url = excluded.url, content = excluded.content,
        content_hash = excluded.content_hash, fetched_at = excluded.fetched_at, used_for_profile = 1`);
    db.prepare('UPDATE ai_document_sources SET used_for_profile = 0 WHERE appid = ?').run(appid);
    for (const source of sources) statement.run(appid, source.sourceType, source.sourceKey, source.title, source.url, source.content, sha256(source.content), nowIso());
  }

  function promptDossier(sources) {
    return sources.map((source, index) => ({
      source_id: `source_${index + 1}`,
      type: source.sourceType,
      title: source.title,
      content: source.content
    }));
  }

  async function generateProfile(game, sources) {
    const request = {
      model: analysisModel,
      stream: false,
      format: 'json',
      think: false,
      options: { temperature: 0, seed: 42, num_ctx: 16384 },
      messages: [
        {
          role: 'system',
          content: [
            'Tu es le module d’analyse hors ligne de Backlog.',
            'Analyse uniquement le dossier textuel fourni par Backlog.',
            'Tu n’as pas accès à Internet et tu ne dois jamais ouvrir, visiter ou demander un lien.',
            'Les URL ne sont volontairement pas incluses dans le dossier.',
            'N’utilise aucune caractéristique qui ne soit soutenue par le dossier.',
            'Utilise null lorsqu’une dimension ne peut pas être évaluée.',
            'Les nombres sont compris entre 0 et 1.',
            'Réponds exclusivement avec un objet JSON valide et reproductible, sans Markdown.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Version du prompt: ${AI_PROFILE_PROMPT_VERSION}`,
            `Jeu à analyser: ${game.name} (AppID ${game.appid})`,
            'Construis un profil d’expérience, pas une recommandation.',
            'Chaque élément de evidence doit citer un source_id du dossier.',
            `Forme exacte attendue: ${JSON.stringify(profileTemplate())}`,
            `Dossier documentaire contrôlé: ${JSON.stringify(promptDossier(sources))}`
          ].join('\n')
        }
      ]
    };
    const payload = await jsonRequest(fetchImpl, `${ollamaBaseUrl}/api/chat`, {
      method: 'POST', provider: 'Ollama/qwen3', timeoutMs: analysisTimeoutMs,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    if (typeof payload.message?.content !== 'string') throw new Error('Ollama n’a pas renvoyé message.content.');
    let raw;
    try { raw = JSON.parse(payload.message.content); } catch { throw new Error('Qwen a renvoyé un profil JSON invalide.'); }
    return validateProfile(normalizeProfile(raw));
  }

  async function createEmbedding(canonicalText) {
    const payload = await jsonRequest(fetchImpl, `${ollamaBaseUrl}/api/embed`, {
      method: 'POST', provider: 'Ollama/embeddinggemma', timeoutMs: embeddingTimeoutMs,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, input: [canonicalText], truncate: true, dimensions: AI_EMBEDDING_DIMENSIONS })
    });
    const vector = Array.isArray(payload.embeddings?.[0]) ? payload.embeddings[0] : null;
    if (!vector || vector.length !== AI_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error(`embeddinggemma doit renvoyer exactement ${AI_EMBEDDING_DIMENSIONS} dimensions.`);
    }
    return vector.map(Number);
  }

  function profileIsCurrent(appid) {
    const row = db.prepare('SELECT status, prompt_version, analysis_model, local_source_hash FROM ai_game_profiles WHERE appid = ?').get(appid);
    const embedding = db.prepare('SELECT model, dimensions FROM ai_embeddings WHERE appid = ?').get(appid);
    const game = gameByAppid(appid);
    const localSourceHash = sha256(localDossier(game).content);
    return row?.status === 'completed' && row.prompt_version === AI_PROFILE_PROMPT_VERSION && row.analysis_model === analysisModel
      && row.local_source_hash === localSourceHash && embedding?.model === embeddingModel
      && Number(embedding.dimensions) === AI_EMBEDDING_DIMENSIONS;
  }

  async function analyzeOne(appid) {
    const game = gameByAppid(appid);
    job.currentAppid = appid;
    job.currentName = game.name;
    job.lastMessage = `Analyse de ${game.name}…`;
    db.prepare(`INSERT INTO ai_game_profiles(appid, status, prompt_version, analysis_model, attempts, queued_at, started_at, updated_at)
      VALUES (?, 'analyzing', ?, ?, 1, ?, ?, ?)
      ON CONFLICT(appid) DO UPDATE SET status = 'analyzing', prompt_version = excluded.prompt_version,
        analysis_model = excluded.analysis_model, attempts = ai_game_profiles.attempts + 1,
        error = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at`)
      .run(appid, AI_PROFILE_PROMPT_VERSION, analysisModel, nowIso(), nowIso(), nowIso());
    try {
      const sources = [localDossier(game)];
      const localSourceHash = sha256(sources[0].content);
      if (localDossierNeedsDocuments(game) && searxngBaseUrl) {
        job.lastMessage = `Construction du dossier documentaire de ${game.name} via SearXNG…`;
        sources.push(...await searxngDossier(game));
      }
      persistSources(appid, sources);
      const sourceHash = sha256(JSON.stringify(sources.map((source) => [source.sourceType, source.title, source.content])));
      job.lastMessage = `Profil d’expérience de ${game.name} avec ${analysisModel}…`;
      const profile = await generateProfile(game, sources);
      const canonicalText = canonicalProfileText(game, profile);
      job.lastMessage = `Embedding 768 dimensions de ${game.name}…`;
      const vector = await createEmbedding(canonicalText);
      const timestamp = nowIso();
      transaction(db, () => {
        db.prepare(`UPDATE ai_game_profiles SET status = 'completed', profile_json = ?, canonical_text = ?, source_hash = ?, local_source_hash = ?,
          prompt_version = ?, analysis_model = ?, error = NULL, completed_at = ?, updated_at = ? WHERE appid = ?`)
          .run(JSON.stringify(profile), canonicalText, sourceHash, localSourceHash, AI_PROFILE_PROMPT_VERSION, analysisModel, timestamp, timestamp, appid);
        db.prepare(`INSERT INTO ai_embeddings(appid, model, dimensions, vector, source_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(appid) DO UPDATE SET model = excluded.model, dimensions = excluded.dimensions,
            vector = excluded.vector, source_hash = excluded.source_hash, created_at = excluded.created_at`)
          .run(appid, embeddingModel, AI_EMBEDDING_DIMENSIONS, floatArrayToBuffer(vector), sourceHash, timestamp);
      });
      return true;
    } catch (error) {
      db.prepare(`UPDATE ai_game_profiles SET status = 'error', error = ?, updated_at = ? WHERE appid = ?`)
        .run(cleanText(error.message, 1500), nowIso(), appid);
      throw error;
    } finally {
      job.currentAppid = null;
      job.currentName = null;
    }
  }

  function rebuildSimilarities(appids) {
    const profiles = new Map();
    const embeddings = new Map();
    const names = new Map(allPublicGames().map((game) => [game.appid, game.name]));
    for (const appid of appids) {
      const profile = db.prepare(`SELECT profile_json FROM ai_game_profiles WHERE appid = ? AND status = 'completed'`).get(appid);
      const embedding = db.prepare(`SELECT vector, dimensions FROM ai_embeddings WHERE appid = ? AND model = ?`).get(appid, embeddingModel);
      if (!profile || !embedding || Number(embedding.dimensions) !== AI_EMBEDDING_DIMENSIONS) continue;
      profiles.set(appid, safeJsonParse(profile.profile_json, null));
      embeddings.set(appid, bufferToFloatArray(embedding.vector));
    }
    const usable = [...profiles.keys()].filter((appid) => embeddings.has(appid));
    const timestamp = nowIso();
    transaction(db, () => {
      const placeholders = appids.map(() => '?').join(', ');
      if (placeholders) db.prepare(`DELETE FROM ai_similarities WHERE reference_appid IN (${placeholders})`).run(...appids);
      const insert = db.prepare(`INSERT INTO ai_similarities(reference_appid, candidate_appid, algorithm_version,
        embedding_score, profile_score, overall_score, similarities_json, differences_json, calculated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const reference of usable) {
        for (const candidate of usable) {
          if (reference === candidate) continue;
          const embeddingScore = clamp01((cosine(embeddings.get(reference), embeddings.get(candidate)) + 1) / 2);
          const comparison = profileComparison(profiles.get(reference), profiles.get(candidate));
          const overall = clamp01(embeddingScore * 0.6 + comparison.score * 0.4);
          const similarities = comparison.similarities.length ? comparison.similarities : [`Profil sémantique proche de ${names.get(candidate) || candidate}.`];
          const differences = comparison.differences.length ? comparison.differences : ['Aucune différence majeure mesurable dans les dimensions documentées.'];
          insert.run(reference, candidate, AI_SIMILARITY_VERSION, embeddingScore, comparison.score, overall,
            JSON.stringify(similarities), JSON.stringify(differences), timestamp);
        }
      }
    });
    return usable.length;
  }

  function counts(appids) {
    const result = { queued: 0, analyzing: 0, completed: 0, error: 0 };
    if (!appids.length) return result;
    const placeholders = appids.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT status, COUNT(*) AS total FROM ai_game_profiles WHERE appid IN (${placeholders}) GROUP BY status`).all(...appids);
    const seen = rows.reduce((sum, row) => sum + Number(row.total), 0);
    for (const row of rows) if (PROFILE_STATUS.has(row.status)) result[row.status] = Number(row.total);
    result.queued += appids.length - seen;
    return result;
  }

  function statusSnapshot() {
    const appids = selectedAppids();
    const statusCounts = counts(appids);
    const processed = statusCounts.completed + statusCounts.error;
    const latestRun = db.prepare(`SELECT * FROM ai_analysis_runs ORDER BY id DESC LIMIT 1`).get() || null;
    return {
      configured: Boolean(ollamaBaseUrl), ollamaBaseUrl, analysisModel, embeddingModel,
      embeddingDimensions: AI_EMBEDDING_DIMENSIONS, searxngConfigured: Boolean(searxngBaseUrl),
      selectionConfirmed: Boolean(appids.length), selected: appids.length, counts: statusCounts,
      processed, percent: appids.length ? Math.round((processed / appids.length) * 1000) / 10 : 0,
      running: job.running, pauseRequested: job.pauseRequested, currentAppid: job.currentAppid,
      currentName: job.currentName, lastMessage: job.lastMessage, startedAt: job.startedAt,
      stoppedAt: job.stoppedAt, run: latestRun ? { ...latestRun, selection: safeJsonParse(latestRun.selection_json, []) } : null
    };
  }

  async function runAnalysis() {
    const appids = selectedAppids();
    const timestamp = nowIso();
    const run = db.prepare(`INSERT INTO ai_analysis_runs(status, selection_json, total, processed, succeeded, failed,
      prompt_version, analysis_model, embedding_model, started_at, updated_at)
      VALUES ('running', ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`)
      .run(JSON.stringify(appids), appids.length, AI_PROFILE_PROMPT_VERSION, analysisModel, embeddingModel, timestamp, timestamp);
    job.running = true; job.pauseRequested = false; job.runId = Number(run.lastInsertRowid);
    job.startedAt = timestamp; job.stoppedAt = null; job.lastMessage = 'Démarrage de l’analyse IA.';
    let succeeded = 0; let failed = 0; let processed = 0;
    try {
      for (const appid of appids) {
        if (job.pauseRequested) break;
        if (profileIsCurrent(appid)) { succeeded += 1; processed += 1; continue; }
        try { await analyzeOne(appid); succeeded += 1; }
        catch (error) { failed += 1; job.lastMessage = `Erreur pour l’AppID ${appid} : ${cleanText(error.message, 300)}`; }
        processed += 1;
        db.prepare(`UPDATE ai_analysis_runs SET processed = ?, succeeded = ?, failed = ?, updated_at = ? WHERE id = ?`)
          .run(processed, succeeded, failed, nowIso(), job.runId);
      }
      if (job.pauseRequested) {
        job.lastMessage = 'Analyse IA suspendue. Utilise Reprendre pour continuer.';
        db.prepare(`UPDATE ai_analysis_runs SET status = 'paused', processed = ?, succeeded = ?, failed = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
          .run(processed, succeeded, failed, nowIso(), nowIso(), job.runId);
      } else {
        job.lastMessage = 'Calcul des similarités du lot validé…';
        const comparable = rebuildSimilarities(appids);
        const finalStatus = failed ? 'completed_with_errors' : 'completed';
        job.lastMessage = `${succeeded} profil(s) prêt(s), ${failed} erreur(s), similarités calculées pour ${comparable} jeu(x).`;
        db.prepare(`UPDATE ai_analysis_runs SET status = ?, processed = ?, succeeded = ?, failed = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
          .run(finalStatus, processed, succeeded, failed, nowIso(), nowIso(), job.runId);
      }
    } catch (error) {
      job.lastMessage = `Analyse IA interrompue : ${cleanText(error.message, 500)}`;
      db.prepare(`UPDATE ai_analysis_runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
        .run(cleanText(error.message, 1500), nowIso(), nowIso(), job.runId);
    } finally {
      job.running = false; job.pauseRequested = false; job.currentAppid = null; job.currentName = null; job.stoppedAt = nowIso();
    }
  }

  function start() {
    const appids = selectedAppids();
    if (!appids.length) throw new HttpError(409, 'Valide d’abord une sélection de jeux pour le POC.', 'ai_selection_not_confirmed');
    if (job.running) throw new HttpError(409, 'Une analyse IA est déjà en cours.', 'ai_job_running');
    void runAnalysis();
    return statusSnapshot();
  }

  function pause() {
    if (!job.running) throw new HttpError(409, 'Aucune analyse IA n’est en cours.', 'ai_job_not_running');
    job.pauseRequested = true;
    job.lastMessage = 'Suspension demandée après le jeu en cours.';
    return statusSnapshot();
  }

  async function testConnection() {
    const payload = await jsonRequest(fetchImpl, `${ollamaBaseUrl}/api/tags`, { provider: 'Ollama', timeoutMs: 15000 });
    const models = Array.isArray(payload.models) ? payload.models.map((model) => model.name).filter(Boolean) : [];
    return {
      reachable: true, models, analysisModel, embeddingModel,
      analysisModelAvailable: models.some((name) => name === analysisModel || name.startsWith(`${analysisModel}:`)),
      embeddingModelAvailable: models.some((name) => name === embeddingModel || name.startsWith(`${embeddingModel}:`))
    };
  }

  function similarGames(appid, limit = 10) {
    gameByAppid(appid);
    const rows = db.prepare(`SELECT s.*, g.name, g.playtime_forever, g.metadata_cover_url, g.application_type
      FROM ai_similarities s JOIN games g ON g.appid = s.candidate_appid
      WHERE s.reference_appid = ? ORDER BY s.overall_score DESC, g.name COLLATE NOCASE LIMIT ?`).all(Number(appid), limit);
    return rows.map((row) => ({
      appid: Number(row.candidate_appid), name: row.name,
      header_image: row.metadata_cover_url || `https://cdn.cloudflare.steamstatic.com/steam/apps/${Number(row.candidate_appid)}/header.jpg`,
      playtime_forever: Number(row.playtime_forever || 0), application_type: row.application_type,
      score: Math.round(Number(row.overall_score) * 1000) / 10,
      embedding_score: Math.round(Number(row.embedding_score) * 1000) / 10,
      profile_score: Math.round(Number(row.profile_score) * 1000) / 10,
      similarities: safeJsonParse(row.similarities_json, []), differences: safeJsonParse(row.differences_json, []),
      algorithm: row.algorithm_version, calculated_at: row.calculated_at
    }));
  }

  function profileFor(appid) {
    gameByAppid(appid);
    const row = db.prepare(`SELECT appid, status, profile_json, source_hash, prompt_version, analysis_model,
      attempts, error, queued_at, started_at, completed_at, updated_at FROM ai_game_profiles WHERE appid = ?`).get(Number(appid));
    if (!row) return null;
    return { ...row, profile: safeJsonParse(row.profile_json, null) };
  }

  return {
    job, start, pause, statusSnapshot, testConnection, similarGames, profileFor, rebuildSimilarities,
    config: { ollamaBaseUrl, analysisModel, embeddingModel, embeddingDimensions: AI_EMBEDDING_DIMENSIONS,
      searxngConfigured: Boolean(searxngBaseUrl), promptVersion: AI_PROFILE_PROMPT_VERSION, similarityVersion: AI_SIMILARITY_VERSION }
  };
}

module.exports = {
  createAiEngine, initializeAiDatabase, normalizeProfile, profileComparison,
  AI_PROFILE_PROMPT_VERSION, AI_SIMILARITY_VERSION, AI_EMBEDDING_DIMENSIONS
};
