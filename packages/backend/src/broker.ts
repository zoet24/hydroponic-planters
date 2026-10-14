import { createServer } from 'node:net';
import { Aedes, type Client } from 'aedes';

/**
 * A real MQTT broker, embedded, so `pnpm dev` needs no system install.
 *
 * ESPHome talks to this perfectly well — it is a standards-compliant 3.1.1
 * broker with retained messages and last-will support. Swap in Mosquitto when
 * you want `mosquitto_sub` for debugging real hardware; see infra/mosquitto.conf.
 */
const port = Number(process.env.MQTT_PORT ?? 1883);

// Aedes 1.x initialises asynchronously. `new Aedes()` returns an object whose
// handle() accepts sockets but never answers CONNECT, so clients sit waiting for
// a CONNACK that never arrives. The factory is the only correct construction.
const broker = await Aedes.createBroker();

const server = createServer((stream) => broker.handle(stream));

broker.on('client', (c: Client) => console.log(`[broker] + ${c.id}`));
broker.on('clientDisconnect', (c: Client) => console.log(`[broker] - ${c.id}`));

server.on('error', (err) => {
  console.error(`[broker] ${err.message}`);
  process.exit(1);
});

// No host argument: binds :: dual-stack, so 127.0.0.1, ::1 and the hotspot
// address all work. Binding '0.0.0.0' is IPv4-only, and Node resolves
// `localhost` to ::1 first on macOS — clients then hang with no error.
server.listen(port, () => {
  console.log(`[broker] listening on :${port} (dual-stack)`);
});
