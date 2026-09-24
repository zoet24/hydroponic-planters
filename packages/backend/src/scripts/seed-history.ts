import { lightLux, nextPumpRun, waterTempC } from '@planter/shared';
import { db } from '../db';
import { resolvePreset } from '../registry';

/**
 * Plausible history, shared by `pnpm seed` and `pnpm demo:reset`.
 *
 * Time acceleration does not produce this: the backend stamps readings with real
 * time and throttles on real time, so running the simulator fast changes how
 * quickly values move, not how much history exists.
 */

const STEP_MS = 600_000; // one reading per metric every 10 minutes

/** Fixed per planter, so a recorded demo and a live one draw the same shape. */
const seedFor = (planterId: string): number =>
  [...planterId].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 97;

export interface SeedResult {
  readings: number;
  runs: number;
}

const insertReading = db.prepare(
  'INSERT INTO readings (planter_id, ts, metric, value) VALUES (?, ?, ?, ?)',
);
const insertEvent = db.prepare(
  'INSERT INTO events (planter_id, ts, type, payload) VALUES (?, ?, ?, ?)',
);

export function seedHistory(planterId: string, hours = 24, replace = true): SeedResult {
  const now = Date.now();
  const from = now - hours * 3_600_000;

  const run = db.transaction((): SeedResult => {
    if (replace) {
      db.prepare('DELETE FROM readings WHERE planter_id = ? AND ts >= ?').run(planterId, from);
      db.prepare('DELETE FROM events WHERE planter_id = ? AND ts >= ?').run(planterId, from);
      db.prepare('DELETE FROM ph_checkins WHERE planter_id = ? AND ts >= ?').run(planterId, from);
    }

    const seed = seedFor(planterId);
    const row = db.prepare('SELECT preset_id FROM planters WHERE id = ?').get(planterId) as
      | { preset_id: string | null }
      | undefined;
    const preset = resolvePreset(row?.preset_id ?? null);
    const interval = preset?.pump.intervalHours ?? 6;
    const runtime = preset?.pump.runtimeMinutes ?? 2;

    let readings = 0;
    for (let ts = from; ts <= now; ts += STEP_MS) {
      insertReading.run(planterId, ts, 'water_temp_c', waterTempC(ts, seed));
      insertReading.run(planterId, ts, 'light_lux', lightLux(ts, seed));
      readings += 2;
    }

    // On the hour, matching the firmware's `hour % interval === 0`.
    let runs = 0;
    for (let cursor = from; cursor < now; ) {
      const next = nextPumpRun(interval, cursor);
      if (!next || next.at > now) break;
      insertEvent.run(planterId, next.at, 'pump_run', JSON.stringify({ on: true }));
      insertEvent.run(planterId, next.at + runtime * 60_000, 'pump_run', JSON.stringify({ on: false }));
      cursor = next.at + 60_000;
      runs += 1;
    }

    // Enough of a story that the timeline is worth looking at, and so the pH
    // and nutrient chips have something to count from.
    const phTs = now - 2 * 86_400_000 + 3_600_000;
    if (phTs >= from && preset) {
      db.prepare(
        'INSERT INTO ph_checkins (planter_id, ts, ph, status, action, advice) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(planterId, phTs, 6.1, 'in_range', 'none', 'pH 6.1 is within the target. Nothing to do.');
      insertEvent.run(planterId, phTs, 'ph_checkin', JSON.stringify({ ph: 6.1, status: 'in_range' }));
    }

    const nutrientTs = now - 5 * 86_400_000;
    if (nutrientTs >= from) {
      insertEvent.run(
        planterId,
        nutrientTs,
        'nutrients_added',
        JSON.stringify({ strengthMultiplier: preset?.nutrients.strengthMultiplier ?? 1 }),
      );
    }

    // One low-water blip a few hours back, so the timeline has an incident in it.
    const blipTs = now - 6 * 3_600_000;
    if (blipTs >= from) insertEvent.run(planterId, blipTs, 'low_water', null);

    return { readings, runs };
  });

  return run();
}
