import { createBacklogServer } from './src/http.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const { server, db } = createBacklogServer(config);
server.listen(config.port, config.host, () => {
  console.log(`Backlog Core ${config.version} écoute sur http://${config.host}:${config.port}`);
  console.log(`Base historique: ${db.databasePath} (source: ${config.databasePathSource}; aucune migration au démarrage)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
