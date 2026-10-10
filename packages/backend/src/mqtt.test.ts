import { rmSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts opens its database at module load, so point it somewhere disposable
// before importing anything that pulls it in.
const DB_PATH = `/tmp/planter-mqtt-test-${process.pid}.db`;
process.env.DB_PATH = DB_PATH;

type Handler = (...args: never[]) => void;

// vi.mock is hoisted, so the collectors have to be hoisted with it.
const harness = vi.hoisted(() => ({
  published: [] as Array<{ topic: string; payload: string }>,
  handlers: {} as Record<string, Handler>,
}));

/**
 * A fake broker. It records what the backend publishes and keeps hold of the
 * message handler, which lets a test play the part of the device.
 */
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

const { startMqtt } = await import('./mqtt');
const { ensurePlanter, toView } = await import('./registry');
const { AVAILABILITY, deviceTopics } = await import('@planter/shared');
const { db } = await import('./db');

startMqtt();

const DEVICE = 'planter-reassert';
const t = deviceTopics(DEVICE);

const send = (topic: string, payload: string): void => {
  const handler = harness.handlers.message as unknown as (tp: string, p: Buffer) => void;
  handler(topic, Buffer.from(payload));
};

const topicsPublished = (): string[] => harness.published.map((m) => m.topic);
const payloadFor = (topic: string): string | undefined =>
  harness.published.find((m) => m.topic === topic)?.payload;

beforeEach(() => {
  harness.published.length = 0;
  const record = ensurePlanter(DEVICE);
  record.online = false;
  record.reported = {};
  record.desiredSetAt = 0;
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
});

describe('desired state is re-asserted on the birth message', () => {
  it('publishes every desired field when a device announces itself', () => {
    const record = ensurePlanter(DEVICE);
    send(t.status, AVAILABILITY.online);

    expect(topicsPublished()).toEqual(
      expect.arrayContaining([
        t.pumpEnableCommand,
        t.pumpSpeedCommand,
        t.intervalHoursCommand,
        t.runtimeMinutesCommand,
      ]),
    );
    expect(Number(payloadFor(t.pumpSpeedCommand))).toBe(record.desired.speedPercent);
    expect(Number(payloadFor(t.intervalHoursCommand))).toBe(record.desired.intervalHours);
  });

  it('stays quiet while the device remains online', () => {
    send(t.status, AVAILABILITY.online);
    harness.published.length = 0;

    send(t.status, AVAILABILITY.online);
    expect(harness.published).toHaveLength(0);
  });

  it('stays quiet when the device drops offline', () => {
    send(t.status, AVAILABILITY.online);
    harness.published.length = 0;

    send(t.status, AVAILABILITY.offline);
    expect(harness.published).toHaveLength(0);
  });

  it('re-asserts again after a reconnect', () => {
    send(t.status, AVAILABILITY.online);
    send(t.status, AVAILABILITY.offline);
    harness.published.length = 0;

    send(t.status, AVAILABILITY.online);
    expect(topicsPublished()).toContain(t.pumpSpeedCommand);
  });

  it('clears the stuck speed chip a reboot used to leave behind', () => {
    const record = ensurePlanter(DEVICE);

    // The fan boots at speed 0 whatever the app last asked for, so desired and
    // reported disagree the moment the device comes up.
    send(t.status, AVAILABILITY.online);
    send(t.pumpSpeedState, '0');
    expect(toView(record).pending).toContain('speedPercent');

    // The re-assert went out with the birth message. Echo it back as the device
    // would once it has applied it.
    const asserted = payloadFor(t.pumpSpeedCommand);
    expect(asserted).toBeDefined();
    send(t.pumpSpeedState, String(asserted));
    send(t.pumpEnableState, record.desired.pumpEnable ? 'ON' : 'OFF');
    send(t.intervalHoursState, String(record.desired.intervalHours));
    send(t.runtimeMinutesState, String(record.desired.runtimeMinutes));

    expect(toView(record).pending).toEqual([]);
  });

  it('restarts the stale timer, so the chip is not amber on arrival', () => {
    const record = ensurePlanter(DEVICE);
    record.desiredSetAt = Date.now() - 60_000; // long stale from a past session

    send(t.status, AVAILABILITY.online);
    send(t.pumpSpeedState, '0');

    const view = toView(record);
    expect(view.pending).toContain('speedPercent');
    expect(view.syncStale).toBe(false);
  });
});
