import path from 'node:path';

function integer(name, fallback, min = 0) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function number(name, fallback, min = 0) {
  const value = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(value) && value >= min ? value : fallback;
}

const dataDir = process.env.DATA_DIR || '/data';

export const config = Object.freeze({
  host: process.env.HOST || '0.0.0.0',
  port: integer('PORT', 3000, 1),
  dataDir,
  databasePath: process.env.CORE_DATABASE_PATH || path.join(dataDir, 'backlog-core.sqlite'),
  legacyDatabasePath: process.env.LEGACY_DATABASE_PATH || path.join(dataDir, 'backlog.sqlite'),
  publicDir: process.env.PUBLIC_DIR || path.resolve('public'),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
  analysisModel: process.env.AI_ANALYSIS_MODEL || 'qwen3:32b',
  embeddingModel: process.env.AI_EMBEDDING_MODEL || 'embeddinggemma',
  steamDetailsUrl: process.env.STEAM_DETAILS_URL || 'https://store.steampowered.com/api/appdetails',
  httpTimeoutMs: integer('HTTP_TIMEOUT_MS', 120000, 1000),
  steamTimeoutMs: integer('STEAM_TIMEOUT_MS', 20000, 1000),
  maxAttempts: integer('ENRICHMENT_MAX_ATTEMPTS', 1, 1),
  retryDelayMs: integer('ENRICHMENT_RETRY_DELAY_MS', 2000, 0),
  pollDelayMs: integer('WORKER_POLL_DELAY_MS', 750, 50),
  numPredict: integer('AI_NUM_PREDICT', 1200, 128),
  temperature: number('AI_TEMPERATURE', 0.15, 0),
  discoveryShortlist: integer('DISCOVERY_SHORTLIST', 20, 5),
  discoveryLimit: integer('DISCOVERY_LIMIT', 5, 1),
  logLevel: process.env.LOG_LEVEL || 'info'
});
