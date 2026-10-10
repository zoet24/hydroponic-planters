import { rmSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const DB_PATH = `/tmp/planter-add-test-${process.pid}.db`;
process.env.DB_PATH = DB_PATH;

type Handler = (...args: never[]) => void;

const harness = vi.hoisted(() => ({
  published: [] as Array<{ topic: string; payload: string }>,
  handlers: {} as Record<string, Handler>,
}));

vi.mock('mqtt', () => ({
  default: {
    connect: () => ({
      on(event: string, cb: Handler) {
        harness.handlers[event] = cb;
        return this;
      },
      subscribe() {
        return this;
      },
      publish(topic: string, payload: string) {
        harness.published.push({ topic, payload });
        return this;
      },
    }),
  },
}));

const { routes } = await import('./api');
const { startMqtt } = await import('./mqtt');
const { ensurePlanter, seedPresets } = await import('./registry');
const { db } = await import('./db');

seedPresets();
startMqtt();

const DEVICE = 'planter-addtest';
let app: FastifyInstance;

beforeEach(async () => {
  harness.published.length = 0;
  const record = ensurePlanter(DEVICE);
  record.addedAt = null;
  record.name = DEVICE;
  record.presetId = null;

  await app?.close();
  app = Fastify({ logger: false });
  await app.register(routes);
});

afterAll(async () => {
  await app?.close();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
});

const view = async (id = DEVICE) =>
  (await app.inject({ method: 'GET', url: `/api/planters/${id}` })).json();

describe('adding a planter to the dashboard', () => {
  it('leaves a discovered planter off the dashboard', async () => {
    expect((await view()).added).toBe(false);
  });

  it('adds it with a name and a preset, and sends the preset to the device', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/add`,
      payload: { name: 'Kitchen basil', presetId: 'basil' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(true);
    expect(body.name).toBe('Kitchen basil');
    expect(body.presetId).toBe('basil');

    // Basil is 4h / 3min / 70% — the device has to be told, not just the database.
    const topics = harness.published.map((m) => m.topic);
    expect(topics).toContain(`${DEVICE}/number/pump_interval_hours/command`);
    expect(topics).toContain(`${DEVICE}/number/pump_runtime/command`);
    expect(Number(harness.published.find((m) => m.topic.endsWith('pump_interval_hours/command'))?.payload)).toBe(4);
  });

  it('works without a preset, so one can be chosen later', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/add`,
      payload: { name: 'Unnamed bench unit' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(true);
    expect(res.json().presetId).toBeNull();
  });

  it('is idempotent, so a double tap is harmless', async () => {
    await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/add`, payload: { name: 'One' } });
    const second = await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/add`,
      payload: { name: 'Two' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().added).toBe(true);
    expect(second.json().name).toBe('Two');
  });

  it('rejects an unknown preset without adding the planter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/add`,
      payload: { name: 'Nope', presetId: 'triffid' },
    });
    expect(res.statusCode).toBe(404);
    // The record must be untouched, not half-added.
    expect((await view()).added).toBe(false);
    expect((await view()).name).toBe(DEVICE);
  });

  it('404s for a planter that was never discovered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/planters/planter-ghost/add',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('pump controls', () => {
  const online = () => {
    const record = ensurePlanter(DEVICE);
    record.online = true;
    return record;
  };

  it('stops a run by turning the fan off, which needs no firmware change', async () => {
    online();
    const res = await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/pump/stop` });

    expect(res.statusCode).toBe(200);
    const stop = harness.published.find((m) => m.topic === `${DEVICE}/fan/pump/command`);
    expect(stop).toBeDefined();
    expect(stop?.payload).toBe('OFF');
  });

  it('presses the firmware button for a run', async () => {
    online();
    const res = await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/pump/run-now` });

    expect(res.statusCode).toBe(200);
    expect(harness.published).toContainEqual({
      topic: `${DEVICE}/button/run_pump_now/command`,
      payload: 'PRESS',
    });
  });

  // Previously this answered {ok:true} and published to nobody, so a dead
  // planter and a working one were indistinguishable from the app.
  it('refuses to run an offline planter instead of reporting success', async () => {
    const record = ensurePlanter(DEVICE);
    record.online = false;

    const res = await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/pump/run-now` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/offline/);
    expect(harness.published).toHaveLength(0);
  });

  it('refuses to stop an offline planter', async () => {
    const record = ensurePlanter(DEVICE);
    record.online = false;

    const res = await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/pump/stop` });
    expect(res.statusCode).toBe(409);
    expect(harness.published).toHaveLength(0);
  });

  it('404s for a planter that does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/planters/planter-ghost/pump/stop' });
    expect(res.statusCode).toBe(404);
  });

  // The app's fetch helper used to send this header on every POST, body or not,
  // which 500'd and made Run pump now look like it worked while doing nothing.
  it('accepts a bodyless POST that still declares JSON', async () => {
    online();
    const res = await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/pump/stop`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('removing a planter from the dashboard', () => {
  it('takes it off but keeps its name and preset', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/planters/${DEVICE}/add`,
      payload: { name: 'Kitchen basil', presetId: 'basil' },
    });

    const res = await app.inject({ method: 'POST', url: `/api/planters/${DEVICE}/remove` });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(false);
    expect(res.json().name).toBe('Kitchen basil');
    expect(res.json().presetId).toBe('basil');
  });
});
