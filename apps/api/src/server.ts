import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = createApp({ config });
app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
