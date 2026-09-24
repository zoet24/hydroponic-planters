import mqtt from 'mqtt';
import { isFaultKind, SIM_TOPICS, TIME_SCALE } from '@planter/shared';
import { VirtualPlanter } from './planter';

/**
 * N virtual planters on one MQTT connection. They publish and accept exactly the
 * topics a real board does; the only thing that marks them as simulated is the
 * retained roster on $sim/roster, which the backend reads to badge them in the UI.
 */

const BROKER = process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const COUNT = Math.max(1, Number(process.env.SIM_COUNT ?? 3));
const TICK_MS = 2000;

const IDS = Array.from({ length: COUNT }, (_, i) => `planter-${String(i + 1).padStart(3, '0')}`);

// Distinct personalities, so the fleet does not look like one planter copied.
const PROFILES = [
  { peakLux: 6500, baseTempC: 21 },
  { peakLux: 2200, baseTempC: 19.5 }, // a dim shelf — will trip the light alert
  { peakLux: 8000, baseTempC: 23 },
];

let timeScale: number = TIME_SCALE.default;
let virtualNow = Date.now();
let lastRealTick = Date.now();

const client = mqtt.connect(BROKER, {
  clientId: `simulator-${process.pid}`,
  clean: true,
  // One will per connection, so the roster is what disappears if we die.
  will: { topic: SIM_TOPICS.roster, payload: '[]', retain: true, qos: 0 },
});

const planters = new Map<string, VirtualPlanter>();

client.on('connect', () => {
  console.log(`[simulator] connected to ${BROKER}, ${COUNT} planter(s)`);

  for (const [i, id] of IDS.entries()) {
    const profile = PROFILES[i % PROFILES.length]!;
    const planter = new VirtualPlanter(client, { id, seed: i * 17 + 3, ...profile });
    planters.set(id, planter);
    client.subscribe(planter.commandTopics);
    planter.announce(virtualNow);
  }

  client.subscribe([SIM_TOPICS.faultWildcard, SIM_TOPICS.timeScale]);
  client.publish(SIM_TOPICS.roster, JSON.stringify(IDS), { retain: true, qos: 0 });
});

client.on('message', (topic, payload) => {
  const raw = payload.toString();

  if (topic === SIM_TOPICS.timeScale) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      timeScale = Math.min(TIME_SCALE.max, Math.max(TIME_SCALE.min, n));
      console.log(`[simulator] time scale ${timeScale}x`);
    }
    return;
  }

  if (topic.endsWith('/fault')) {
    const id = topic.split('/')[1];
    const planter = id ? planters.get(id) : undefined;
    if (!planter) return;
    try {
      const { kind, on } = JSON.parse(raw) as { kind: string; on: boolean };
      if (isFaultKind(kind)) {
        planter.setFault(kind, Boolean(on));
        console.log(`[simulator] ${id} fault ${kind} ${on ? 'ON' : 'off'}`);
      }
    } catch {
      console.warn(`[simulator] bad fault payload on ${topic}`);
    }
    return;
  }

  for (const planter of planters.values()) {
    if (planter.commandTopics.includes(topic)) planter.handleCommand(topic, raw);
  }
});

client.on('error', (err) => console.error('[simulator] mqtt error:', err.message));

setInterval(() => {
  const realNow = Date.now();
  virtualNow += (realNow - lastRealTick) * timeScale;
  lastRealTick = realNow;
  for (const planter of planters.values()) planter.tick(virtualNow);
}, TICK_MS);

const shutdown = () => {
  client.publish(SIM_TOPICS.roster, '[]', { retain: true, qos: 0 });
  client.end(false, {}, () => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
