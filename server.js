import { loadConfig } from './src/config.js';
import { createBacklogServer } from './src/http.js';

const config = loadConfig();
const { server } = createBacklogServer(config);
server.listen(config.port, config.host, () => {
  console.log(`Backlog Core ${config.version} écoute sur http://${config.host}:${config.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
