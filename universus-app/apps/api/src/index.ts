import { config } from './config.ts';
import { buildServer } from './server.ts';

const app = await buildServer();
try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
