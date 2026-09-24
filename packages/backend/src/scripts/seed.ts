import { parseArgs } from 'node:util';
import { lightLux, nextPumpRun, waterTempC } from '@planter/shared';
import { db } from '../db';
import { hydrate, resolvePreset, seedPresets } from '../registry';

/**
 * Seed plausible history so the charts are not empty at the start of a demo.
 *
 * Time acceleration does not do this: the backend stamps readings with real time
 * and throttles on real time, so running the simulator fast changes how quickly
 * values move, not how much history exists.
 *
 *   pnpm seed                    # every planter, 24 hours
 *   pnpm seed --id planter-001 --hours 48
 *   pnpm seed --keep             # add to existing history instead of replacing
 */

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    hours: { type: 'string' },
    keep: { type: 'boolean' },
  },
});

const HOURS = Number(values.hours ?? 24);
const STEP_MS = 600_000; // one reading per metric every 10 minutes

/** Fixed per planter, so a recorded demo and a live one draw the same shape. */
const seedFor = (planterId: string): number =>
  [...planterId].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 97;

function main(): void {
  seedPresets();
  hydrate();

  const ids = values.id
    ? [values.id]
    : (db.prepare('SELECT id FROM planters ORDER BY id').all() as { id: string }[]).map((r) => r.id);

  if (ids.length === 0) {
    console.log('No planters to seed. Start the simulator or run pnpm provision first.');
    return;
  }

  const now = Date.now();
  const from = now - HOURS * 3_600_000;

  const insertReading = db.prepare(
    'INSERT INTO readings (planter_id, ts, metric, value) VALUES (?, ?, ?, ?)',
  );
  const insertEvent = db.prepare(
    'INSERT INTO events (planter_id, ts, type, payload) VALUES (?, ?, ?, ?)',
  );

  const seedOne = db.transaction((planterId: string) => {
    if (!values.keep) {
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

    // Pump runs on the hour, matching the firmware's `hour % interval === 0`.
    let runs = 0;
    for (let cursor = from; cursor < now; ) {
      const next = nextPumpRun(interval, cursor);
      if (!next || next.at > now) break;
      insertEvent.run(planterId, next.at, 'pump_run', JSON.stringify({ on: true }));
      insertEvent.run(planterId, next.at + runtime * 60_000, 'pump_run', JSON.stringify({ on: false }));
      cursor = next.at + 60_000;
      runs += 1;
    }

    // Enough of a story for the timeline to be worth looking at.
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

    console.log(`  ${planterId}: ${readings} readings, ${runs} pump runs`);
  });

  console.log(`Seeding ${HOURS}h of history:`);
  for (const id of ids) seedOne(id);
  console.log('Done. Restart nothing — the charts read straight from the database.');
}

try {
  main();
} finally {
  db.close();
}
