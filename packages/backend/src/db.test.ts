import { rmSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// db.ts opens its database at module load, so point it somewhere disposable
// before importing it.
const DB_PATH = `/tmp/planter-test-${process.pid}.db`;
process.env.DB_PATH = DB_PATH;

const { db, recordReading, recordEvent, recentEvents } = await import('./db');

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
    recordReading('p3', 'pump_speed', 70, now);
    expect(rowCount('p3')).toBe(2);
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
