import { createBacklogServer } from './src/http.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const { server, db } = createBacklogServer(config);
server.listen(config.port, config.host, () => {
  console.log(`Backlog Core v1.2.1 écoute sur http://${config.host}:${config.port}`);
  if (db.migrationBackupPath) console.log(`Sauvegarde pré-migration: ${db.migrationBackupPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
