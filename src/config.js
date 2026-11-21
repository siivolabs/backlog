import path from 'node:path';

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function number(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function loadConfig(env = process.env) {
  return {
    version: '1.1.3',
    port: number(env.PORT, 3000, 1, 65535),
    databasePath: path.resolve(env.DATABASE_PATH || '/data/backlog-core.sqlite'),
    adminToken: env.ADMIN_TOKEN || '',
    ollamaBaseUrl: String(env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
    analysisModel: env.AI_ANALYSIS_MODEL || 'qwen3:32b',
    embeddingModel: env.AI_EMBEDDING_MODEL || 'embeddinggemma',
    steamEnrichmentEnabled: bool(env.STEAM_ENRICHMENT_ENABLED, true),
    requestTimeoutMs: number(env.REQUEST_TIMEOUT_MS, 120000, 1000, 600000)
  };
}
