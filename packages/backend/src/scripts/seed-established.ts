import {
  nextPumpRun,
  phAdvice,
  runsPerDayToIntervalHours,
  TOWER_PUMP,
  waterTempC,
  type Preset,
} from '@planter/shared';
import { db } from '../db';

/**
 * A planter that has been running for weeks, with a story in the data.
 *
 * Distinct from `seedHistory`, which produces a flat day of plausible noise for
 * every planter. This builds one tower worth looking at: the pH drifts out of
 * range and is corrected, a cold snap pushes the water below the preset band,
 * the reservoir runs low once, and notes mark what the grower did about it.
 *
 * A chart of pure noise says nothing. The point of showing weeks of history is
 * that the trends mean something, so the trends are authored rather than random.
 */

const DAY_MS = 86_400_000;
const STEP_MS = 600_000; // one reading every 10 minutes
const HOUR_MS = 3_600_000;

const insertReading = db.prepare(
  'INSERT INTO readings (planter_id, ts, metric, value) VALUES (?, ?, ?, ?)',
);
const insertEvent = db.prepare(
  'INSERT INTO events (planter_id, ts, type, payload) VALUES (?, ?, ?, ?)',
);
const insertPh = db.prepare(
  'INSERT INTO ph_checkins (planter_id, ts, ph, status, action, advice, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

const event = (id: string, ts: number, type: string, payload?: unknown): void => {
  insertEvent.run(id, ts, type, payload === undefined ? null : JSON.stringify(payload));
};

export interface EstablishedResult {
  readings: number;
  runs: number;
  phChecks: number;
  feeds: number;
  notes: number;
  /** Start of the seeded window, for the caller to set as the planted date. */
  plantedAt: number;
}

/**
 * The pH story, in days before now: drifts up out of range, is corrected, holds.
 * Authored rather than generated so the shape is the same every rehearsal.
 */
const PH_STORY: { daysAgo: number; ph: number; note?: string }[] = [
  { daysAgo: 20, ph: 6.1 },
  { daysAgo: 17, ph: 6.2 },
  { daysAgo: 14, ph: 6.4 },
  { daysAgo: 11, ph: 6.7, note: 'Drifting up. Added 2 ml pH down.' },
  { daysAgo: 8, ph: 6.3, note: 'Coming back down after the correction.' },
  { daysAgo: 5, ph: 6.1 },
  { daysAgo: 2, ph: 6.0 },
];

const NOTES: { daysAgo: number; text: string }[] = [
  { daysAgo: 21, text: 'Seedlings in. Four pods, two in each of the top collars.' },
  { daysAgo: 16, text: 'First true leaves on three of the four.' },
  { daysAgo: 11, text: 'pH creeping up all week — corrected it today.' },
  { daysAgo: 7, text: 'Cold snap. Moved the tower off the windowsill overnight.' },
  { daysAgo: 3, text: 'Growing well now. Pinched the tips on the two tallest.' },
];

export function seedEstablished(
  planterId: string,
  preset: Preset,
  days = 21,
): EstablishedResult {
  const now = Date.now();
  const from = now - days * DAY_MS;
  const seed = 42;

  const run = db.transaction((): EstablishedResult => {
    db.prepare('DELETE FROM readings WHERE planter_id = ?').run(planterId);
    db.prepare('DELETE FROM events WHERE planter_id = ?').run(planterId);
    db.prepare('DELETE FROM ph_checkins WHERE planter_id = ?').run(planterId);

    // ── temperature, with a cold snap a week back ───────────────────────────
    let readings = 0;
    for (let ts = from; ts <= now; ts += STEP_MS) {
      const daysAgo = (now - ts) / DAY_MS;
      // A three-day dip centred eight days back, deep enough to leave the
      // preset's band so the shaded range on the chart earns its place.
      const snap = daysAgo > 6.5 && daysAgo < 9.5 ? -4.5 : 0;
      // Slow seasonal drift, so three weeks is not three weeks of the same day.
      const drift = -0.06 * daysAgo;
      insertReading.run(planterId, ts, 'water_temp_c', waterTempC(ts, seed, 21 + drift + snap));
      readings += 1;
    }

    // ── pump runs on the preset's schedule ──────────────────────────────────
    const interval = runsPerDayToIntervalHours(preset.pump.runsPerDay);
    let runs = 0;
    for (let cursor = from; cursor < now; ) {
      const next = nextPumpRun(interval, cursor);
      if (!next || next.at > now) break;
      event(planterId, next.at, 'pump_run', { on: true, speedPercent: TOWER_PUMP.speedPercent });
      event(planterId, next.at + TOWER_PUMP.runtimeMinutes * 60_000, 'pump_run', {
        on: false,
        speedPercent: TOWER_PUMP.speedPercent,
      });
      cursor = next.at + 60_000;
      runs += 1;
    }

    // ── pH check-ins, scored by the same function the app uses ──────────────
    let phChecks = 0;
    for (const entry of PH_STORY) {
      if (entry.daysAgo > days) continue;
      const ts = now - entry.daysAgo * DAY_MS;
      const result = phAdvice({
        ph: entry.ph,
        range: { min: preset.ph.targetMin, max: preset.ph.targetMax },
        readingAgeHours: 0,
        checkIntervalDays: preset.ph.checkIntervalDays,
      });
      insertPh.run(
        planterId,
        ts,
        entry.ph,
        result.status,
        result.action,
        result.advice,
        entry.note ?? null,
      );
      event(planterId, ts, 'ph_checkin', {
        ph: entry.ph,
        status: result.status,
        action: result.action,
        note: entry.note,
      });
      phChecks += 1;
    }

    // ── feeds on schedule, the last one landing just inside "due" ───────────
    // The 0.2 of a day puts the most recent feed a shade past its due date but
    // inside the one-day grace, so the dashboard opens with exactly one thing
    // wanting attention -- amber rather than red, and something to action live
    // with Record nutrients. A whole missed cycle would read as neglect.
    const feedDays: number[] = [];
    for (let d = preset.nutrients.scheduleDays + 0.2; d <= days; d += preset.nutrients.scheduleDays) {
      feedDays.push(d);
    }

    let feeds = 0;
    // Oldest first, so the "settling in" note lands on the first feed given.
    for (const [i, d] of [...feedDays].reverse().entries()) {
      event(planterId, now - d * DAY_MS, 'nutrients_added', {
        strengthMultiplier: preset.nutrients.strengthMultiplier,
        note: i === 0 ? 'Half strength while they settle in.' : undefined,
      });
      feeds += 1;
    }

    // ── the grower's notes ──────────────────────────────────────────────────
    let notes = 0;
    for (const n of NOTES) {
      if (n.daysAgo > days) continue;
      event(planterId, now - n.daysAgo * DAY_MS, 'note', { text: n.text });
      notes += 1;
    }

    // ── one low-water incident, five days back ──────────────────────────────
    const blip = now - 5 * DAY_MS - 3 * HOUR_MS;
    if (blip >= from) event(planterId, blip, 'low_water');

    // The planted date is deliberately not written here. It lives on the
    // planter record, which the running backend holds in memory and rewrites
    // on the next MQTT message -- a SQL update is overwritten within
    // milliseconds. The caller sets it through the API instead.
    return { readings, runs, phChecks, feeds, notes, plantedAt: from };
  });

  return run();
}
