import http from 'node:http';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { importLegacyInventory } from './importer.js';
import { SteamClient, OllamaClient } from './clients.js';
import { createPipeline } from './pipeline.js';
import { EnrichmentOrchestrator } from './orchestrator.js';
import { DiscoveryEngine } from './discovery.js';
import { createApp } from './app.js';

export function buildRuntime(config = loadConfig(), overrides = {}) {
  const db = overrides.db || openDatabase(config.databasePath);
  const importResult = importLegacyInventory(db, config.legacyDatabasePath);
  if (importResult.imported) console.log(`${importResult.imported} jeux importés depuis ${importResult.source}.`);
  const steam = overrides.steam || new SteamClient({ timeoutMs: Math.min(config.requestTimeoutMs, 30000) });
  const ollama = overrides.ollama || new OllamaClient(config);
  const processGame = overrides.processGame || createPipeline({ steam, ollama, analysisModel: config.analysisModel, embeddingModel: config.embeddingModel });
  const orchestrator = overrides.orchestrator || new EnrichmentOrchestrator({ db, processGame, loopDelayMs: config.loopDelayMs, retryLimit: config.retryLimit });
  const discovery = overrides.discovery || new DiscoveryEngine({ db, embedText: (text) => ollama.embed(text) });
  orchestrator.recover();
  const server = http.createServer(createApp({ db, orchestrator, discovery, publicDir: config.publicDir }));
  return { db, orchestrator, discovery, server, importResult };
}

export async function start(config = loadConfig(), overrides = {}) {
  const runtime = buildRuntime(config, overrides);
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(config.port, config.host, resolve);
  });
  console.log(`Backlog Core V1.1.2 écoute sur http://${config.host}:${config.port}`);
  return runtime;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = await start();
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} reçu, arrêt propre…`);
    runtime.server.close();
    await runtime.orchestrator.shutdown();
    runtime.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
