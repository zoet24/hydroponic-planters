import { rmSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// db.ts opens its database at module load, so point it somewhere disposable
// before importing it.
const DB_PATH = `/tmp/planter-test-${process.pid}.db`;
process.env.DB_PATH = DB_PATH;

const { db, peakLuxLast24h, recordReading, recordEvent, recentEvents } = await import('./db');

const HOUR = 3_600_000;
const now = Date.now();

beforeEach(() => {
  db.exec('DELETE FROM readings; DELETE FROM events;');
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
});

const rowCount = (planterId: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM readings WHERE planter_id = ?').get(planterId) as { n: number }).n;

describe('recordReading throttle', () => {
  it('keeps one row per metric per throttle window', () => {
    recordReading('p1', 'water_temp_c', 20, now);
    recordReading('p1', 'water_temp_c', 21, now + 1_000);
    recordReading('p1', 'water_temp_c', 22, now + 2_000);
    expect(rowCount('p1')).toBe(1);
  });

  it('writes again once the window has passed', () => {
    recordReading('p2', 'water_temp_c', 20, now);
    recordReading('p2', 'water_temp_c', 21, now + 11_000);
    expect(rowCount('p2')).toBe(2);
  });

  it('throttles each metric independently', () => {
    recordReading('p3', 'water_temp_c', 20, now);
    recordReading('p3', 'light_lux', 500, now);
    expect(rowCount('p3')).toBe(2);
  });
});

describe('peakLuxLast24h', () => {
  const spread = (planterId: string, points: [hoursAgo: number, lux: number][]) => {
    for (const [h, lux] of points) {
      db.prepare("INSERT INTO readings (planter_id, ts, metric, value) VALUES (?, ?, 'light_lux', ?)").run(
        planterId,
        now - h * HOUR,
        lux,
      );
    }
  };

  it('returns nothing when there is no history at all', () => {
    expect(peakLuxLast24h('empty', now)).toBeUndefined();
  });

  it('refuses to judge a fresh database, rather than reporting a false low', () => {
    // Twenty minutes of dim dawn readings is not evidence of a dark corner.
    spread('fresh', [[0.3, 40], [0.2, 90], [0.1, 150]]);
    expect(peakLuxLast24h('fresh', now)).toBeUndefined();
  });

  it('judges once the readings span enough of the day', () => {
    spread('settled', [[20, 10], [14, 6200], [2, 800]]);
    expect(peakLuxLast24h('settled', now)).toBe(6200);
  });

  it('ignores readings older than 24 hours', () => {
    spread('old', [[40, 90_000], [20, 10], [2, 500]]);
    expect(peakLuxLast24h('old', now)).toBe(500);
  });
});

describe('events', () => {
  it('round-trips a payload and returns newest first', () => {
    recordEvent('p9', 'preset_applied', { presetId: 'basil' }, now - 1000);
    recordEvent('p9', 'low_water', undefined, now);
    const events = recentEvents('p9');
    expect(events[0]!.type).toBe('low_water');
    expect(JSON.parse(events[1]!.payload!)).toEqual({ presetId: 'basil' });
  });
});
