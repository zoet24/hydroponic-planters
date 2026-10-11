import { nextPumpRun, runsPerDayToIntervalHours, TOWER_PUMP, waterTempC } from '@planter/shared';
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
const DAY_MS = 86_400_000;

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
      // The pH and nutrient markers sit deliberately before the readings window,
      // so clear them by type rather than by time or they would accumulate.
      db.prepare(
        "DELETE FROM events WHERE planter_id = ? AND type IN ('ph_checkin', 'nutrients_added')",
      ).run(planterId);
      db.prepare('DELETE FROM ph_checkins WHERE planter_id = ?').run(planterId);
    }

    const seed = seedFor(planterId);
    const row = db.prepare('SELECT preset_id FROM planters WHERE id = ?').get(planterId) as
      | { preset_id: string | null }
      | undefined;
    const preset = resolvePreset(row?.preset_id ?? null);
    const interval = preset ? runsPerDayToIntervalHours(preset.pump.runsPerDay) : 6;
    const runtime = TOWER_PUMP.runtimeMinutes;

    let readings = 0;
    for (let ts = from; ts <= now; ts += STEP_MS) {
      insertReading.run(planterId, ts, 'water_temp_c', waterTempC(ts, seed));
      readings += 1;
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

    /*
     * The pH and nutrient markers are placed relative to the preset's own
     * intervals, so both read as "due soon" rather than landing wherever the
     * seed window happens to fall. They sit outside the readings window on
     * purpose — an earlier version guarded them with `ts >= from` and the 24
     * hour default silently dropped both, leaving every chip blank.
     */
    if (preset) {
      const phTs = now - (preset.ph.checkIntervalDays - 1) * DAY_MS;
      db.prepare(
        'INSERT INTO ph_checkins (planter_id, ts, ph, status, action, advice) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(planterId, phTs, 6.1, 'in_range', 'none', 'pH 6.1 is within the target. Nothing to do.');
      insertEvent.run(planterId, phTs, 'ph_checkin', JSON.stringify({ ph: 6.1, status: 'in_range' }));

      const nutrientTs = now - (preset.nutrients.scheduleDays - 1) * DAY_MS;
      insertEvent.run(
        planterId,
        nutrientTs,
        'nutrients_added',
        JSON.stringify({ strengthMultiplier: preset.nutrients.strengthMultiplier }),
      );
    }

    // One low-water blip a few hours back, so the timeline has an incident in it.
    const blipTs = now - 6 * 3_600_000;
    if (blipTs >= from) insertEvent.run(planterId, blipTs, 'low_water', null);

    return { readings, runs };
  });

  return run();
}
