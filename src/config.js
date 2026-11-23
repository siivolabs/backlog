import path from 'node:path';

function integer(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function loadConfig(env = process.env) {
  const historical = env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : null;
  const alias = env.DB_PATH ? path.resolve(env.DB_PATH) : null;
  if (historical && alias && historical !== alias) {
    throw new Error(`DATABASE_PATH et DB_PATH ciblent deux fichiers différents (${historical} / ${alias}). Démarrage refusé.`);
  }
  const databasePath = historical || alias || '/data/backlog-core.sqlite';
  return {
    version: '1.2.1-historical-db-hotfix',
    port: integer(env.PORT, 3000, 1, 65535),
    host: env.HOST || '0.0.0.0',
    databasePath: path.resolve(databasePath),
    databasePathSource: historical ? 'DATABASE_PATH' : alias ? 'DB_PATH' : 'default',
    adminToken: env.ADMIN_TOKEN || '',
    ollamaUrl: (env.OLLAMA_URL || env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
    analysisModel: env.OLLAMA_ANALYSIS_MODEL || env.AI_ANALYSIS_MODEL || 'qwen3:32b',
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL || env.AI_EMBEDDING_MODEL || 'embeddinggemma',
    discoveryMinQuality: Number(env.DISCOVERY_MIN_QUALITY || 0.35),
    recentDays: integer(env.DISCOVERY_RECENT_DAYS, 30, 0, 365),
    enrichmentBatchSize: integer(env.ENRICHMENT_BATCH_SIZE, 10, 1, 100),
    enrichmentEnabled: boolean(env.ENRICHMENT_ENABLED, false)
  };
}
