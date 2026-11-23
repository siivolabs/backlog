import path from 'node:path';

function integer(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function loadConfig(env = process.env) {
  return {
    version: '1.2.0',
    host: env.HOST || '0.0.0.0',
    port: integer(env.PORT, 3000, 1, 65535),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    databasePath: path.resolve(env.DATABASE_PATH || path.join(env.DATA_DIR || './data', 'backlog.sqlite')),
    adminToken: env.ADMIN_TOKEN || '',
    ollamaUrl: String(env.OLLAMA_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
    analysisModel: env.OLLAMA_ANALYSIS_MODEL || 'qwen3:32b',
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL || 'embeddinggemma',
    autoEnrich: boolean(env.AUTO_ENRICH, true),
    enrichmentConcurrency: integer(env.ENRICHMENT_CONCURRENCY, 1, 1, 4),
    enrichmentPollMs: integer(env.ENRICHMENT_POLL_MS, 2500, 250, 60000),
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 120000, 1000, 600000),
    discoveryLimit: integer(env.DISCOVERY_LIMIT, 12, 1, 50),
    minProfileQuality: Math.min(0.95, Math.max(0.1, Number(env.MIN_PROFILE_QUALITY || 0.35))),
    trustProxy: boolean(env.TRUST_PROXY, false)
  };
}
