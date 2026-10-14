import Fastify from 'fastify';
import { routes } from './api';
import { config } from './config';
import { pruneOldReadings } from './db';
import { startMqtt } from './mqtt';
import { hydrate, seedPresets } from './registry';

const app = Fastify({ logger: false });

async function main(): Promise<void> {
  seedPresets();
  hydrate();
  const pruned = pruneOldReadings();
  if (pruned > 0) console.log(`[db] pruned ${pruned} old reading(s)`);

  startMqtt();
  await app.register(routes);
  await app.listen({ port: config.port, host: config.host });

  console.log(`[backend] http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
