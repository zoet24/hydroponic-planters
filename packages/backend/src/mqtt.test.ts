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
const { db, recentEvents } = await import('./db');

startMqtt();

const DEVICE = 'planter-reassert';
const t = deviceTopics(DEVICE);

type MessageHandler = (tp: string, p: Buffer, packet: { retain: boolean }) => void;

/** A live publish. The broker clears the retain flag for existing subscribers. */
const send = (topic: string, payload: string): void =>
  (harness.handlers.message as unknown as MessageHandler)(topic, Buffer.from(payload), {
    retain: false,
  });

/** The broker replaying stored state to a subscriber that has just connected. */
const replay = (topic: string, payload: string): void =>
  (harness.handlers.message as unknown as MessageHandler)(topic, Buffer.from(payload), {
    retain: true,
  });

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

  // The case the transition check missed. A device whose offline was never
  // observed -- an ungraceful exit, or the simulator sharing one MQTT will
  // across three planters -- announces itself with `online` already true. If
  // that is not treated as a birth, nothing re-asserts and the planter sits on
  // "not confirmed" for the rest of the session with no way to recover.
  it('re-asserts on a repeated birth, where no offline was ever seen', () => {
    send(t.status, AVAILABILITY.online);
    harness.published.length = 0;

    send(t.status, AVAILABILITY.online);
    expect(topicsPublished()).toContain(t.pumpSpeedCommand);
  });

  it('does not log a second online event for that repeated birth', async () => {
    send(t.status, AVAILABILITY.online);
    const before = recentEvents(DEVICE, 50).filter((e) => e.type === 'online').length;

    send(t.status, AVAILABILITY.online);
    const after = recentEvents(DEVICE, 50).filter((e) => e.type === 'online').length;
    expect(after).toBe(before);
  });

  it('closes an open pump run when the device vanishes mid-run', () => {
    const record = ensurePlanter(DEVICE);
    send(t.status, AVAILABILITY.online);
    send(t.pumpState, 'ON');
    const seenAt = record.lastSeenAt!;

    send(t.status, AVAILABILITY.offline);

    const runs = recentEvents(DEVICE, 50).filter((e) => e.type === 'pump_run');
    const close = runs[0]!;
    const payload = JSON.parse(close.payload!) as { on: boolean; interrupted?: boolean };
    expect(payload.on).toBe(false);
    expect(payload.interrupted).toBe(true);
    // Stamped when we last heard from the device, not when the will arrived:
    // otherwise a planter that dies mid-run and returns days later records a
    // single run spanning the entire outage.
    expect(close.ts).toBe(seenAt);
    expect(record.reported.pumpOn).toBe(false);
  });

  it('leaves an idle planter alone when it drops offline', () => {
    const record = ensurePlanter(DEVICE);
    send(t.status, AVAILABILITY.online);
    send(t.pumpState, 'OFF');
    const before = recentEvents(DEVICE, 50).filter((e) => e.type === 'pump_run').length;

    send(t.status, AVAILABILITY.offline);
    const after = recentEvents(DEVICE, 50).filter((e) => e.type === 'pump_run').length;
    expect(after).toBe(before);
  });

  it('does not count the will as having seen the device', () => {
    const record = ensurePlanter(DEVICE);
    send(t.status, AVAILABILITY.online);
    const seenAt = record.lastSeenAt;

    send(t.status, AVAILABILITY.offline);
    expect(record.lastSeenAt).toBe(seenAt);
  });

  // On a backend restart the broker replays everything it has stored, which
  // made a planter that had been dark since morning report "last seen just
  // now" -- next to an Offline chip, in the same sentence.
  it('does not treat replayed state as having just seen the device', () => {
    const record = ensurePlanter(DEVICE);
    record.lastSeenAt = null;

    replay(t.waterTemperature, '19.4');
    expect(record.lastSeenAt).toBeNull();
    // The reading itself is still taken: it is true, just not current.
    expect(record.reported.waterTempC).toBe(19.4);
  });

  it('still re-asserts on a replayed birth, which is how a backend restart recovers', () => {
    const record = ensurePlanter(DEVICE);
    record.online = false;
    harness.published.length = 0;

    replay(t.status, AVAILABILITY.online);
    expect(topicsPublished()).toContain(t.pumpSpeedCommand);
  });

  it('publishes nothing when the device drops offline', () => {
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
