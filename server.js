import { createBacklogServer } from './src/http.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const { server, db } = createBacklogServer(config);
server.listen(config.port, config.host, () => {
  console.log(`Backlog Core ${config.version} écoute sur http://${config.host}:${config.port}`);
  console.log(`Base historique active: ${db.databasePath} (source: ${config.databasePathSource})`);
  console.log(db.migrationBackupPath
    ? `Sauvegarde de sécurité créée avant l’ajout de l’état V1.2: ${db.migrationBackupPath}`
    : 'État V1.2 déjà présent; aucune migration nécessaire.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
