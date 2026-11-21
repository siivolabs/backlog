import path from 'node:path';

const integer = (name, fallback, minimum = 0) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} doit être un entier >= ${minimum}`);
  return value;
};

export function loadConfig() {
  const dataDir = process.env.DATA_DIR || '/data';
  return {
    host: process.env.HOST || '0.0.0.0',
    port: integer('PORT', 3000, 1),
    databasePath: process.env.DATABASE_PATH || path.join(dataDir, 'backlog-core.sqlite'),
    legacyDatabasePath: process.env.LEGACY_DATABASE_PATH || path.join(dataDir, 'backlog.sqlite'),
    ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434').replace(/\/$/, ''),
    analysisModel: process.env.AI_ANALYSIS_MODEL || 'qwen3:32b',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'embeddinggemma',
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 180000, 1000),
    retryLimit: integer('ENRICHMENT_RETRY_LIMIT', 3, 1),
    loopDelayMs: integer('ENRICHMENT_LOOP_DELAY_MS', 750, 0),
    publicDir: path.resolve(process.cwd(), 'public')
  };
}
