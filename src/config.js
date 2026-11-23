import path from 'node:path';

function integer(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || '/data';
  return {
    port: integer(env.PORT, 3000, 1, 65535),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbPath: env.DB_PATH || path.join(dataDir, 'backlog-core.sqlite'),
    adminToken: env.ADMIN_TOKEN || '',
    ollamaUrl: (env.OLLAMA_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
    analysisModel: env.OLLAMA_ANALYSIS_MODEL || 'qwen2.5:7b',
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    discoveryMinQuality: Number(env.DISCOVERY_MIN_QUALITY || 0.45),
    recentDays: integer(env.DISCOVERY_RECENT_DAYS, 30, 0, 365),
    enrichmentBatchSize: integer(env.ENRICHMENT_BATCH_SIZE, 10, 1, 100)
  };
}
