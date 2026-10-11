import { z } from 'zod';
import { dutyCycle, runsPerDayToIntervalHours, SAFETY, TOWER_PUMP, type Preset } from './preset';

/**
 * Desired versus reported state. Desired is what the app wants; reported is what
 * the device last said. A field is "pending" until the two agree.
 */

/** The only fields the app can set. Everything else is telemetry. */
export const DESIRED_FIELDS = ['pumpEnable', 'speedPercent', 'intervalHours', 'runtimeMinutes'] as const;
export type DesiredField = (typeof DESIRED_FIELDS)[number];

const DesiredStateShape = z.object({
  pumpEnable: z.boolean(),
  speedPercent: z.number().int().min(0).max(100),
  intervalHours: z.number().int().min(1).max(24),
  runtimeMinutes: z.number().min(1).max(30),
});

/**
 * Desired state, with the duty-cycle cap attached.
 *
 * The rule used to sit on Preset, but presets no longer carry a runtime --
 * TOWER_PUMP fixes it, and 2 min in the shortest interval is 0.033 against a
 * 0.25 cap, so the rule there could never fire. Here it guards the one path
 * where runtime still varies: anything writing desired state directly.
 */
export const DesiredState = DesiredStateShape.refine(
  (d) => dutyCycle(d.intervalHours, d.runtimeMinutes) <= SAFETY.pump.maxDutyCycle,
  {
    error: `pump duty cycle above ${SAFETY.pump.maxDutyCycle * 100}%`,
    path: ['runtimeMinutes'],
  },
);
export type DesiredState = z.infer<typeof DesiredStateShape>;

/** The plain shape, for the partial patches the API accepts. */
export const DesiredStatePatch = DesiredStateShape.partial();

/** Everything the device reports. All optional: it may not have said yet. */
export const ReportedState = z.object({
  waterTempC: z.number().optional(),
  waterOk: z.boolean().optional(),
  /** Monotonic count of doses logged on the device itself. */
  nutrientDoses: z.number().optional(),
  pumpBlocked: z.boolean().optional(),
  pumpOn: z.boolean().optional(),
  speedPercent: z.number().optional(),
  pumpEnable: z.boolean().optional(),
  intervalHours: z.number().optional(),
  runtimeMinutes: z.number().optional(),
  lastRunHour: z.string().optional(),
  nextScheduledRuns: z.string().optional(),
});
export type ReportedState = z.infer<typeof ReportedState>;

/** Expand a preset into the settings we push to a device. */
export function presetToDesired(preset: Preset, pumpEnable = true): DesiredState {
  return {
    pumpEnable,
    // Plant decides how often; the tower decides how long and how hard.
    speedPercent: TOWER_PUMP.speedPercent,
    intervalHours: runsPerDayToIntervalHours(preset.pump.runsPerDay),
    runtimeMinutes: TOWER_PUMP.runtimeMinutes,
  };
}

/** Numbers arrive over MQTT as floats; compare with a tolerance, not equality. */
const EPSILON = 0.001;

const matches = (want: number | boolean, got: number | boolean | undefined): boolean => {
  if (got === undefined) return false;
  if (typeof want === 'boolean' || typeof got === 'boolean') return want === got;
  return Math.abs(want - got) < EPSILON;
};

/**
 * Fields the device has not yet confirmed, in a stable order so the UI clears
 * chips predictably rather than reshuffling them.
 */
export function pendingFields(desired: DesiredState, reported: ReportedState): DesiredField[] {
  return DESIRED_FIELDS.filter((field) => !matches(desired[field], reported[field]));
}

export const isSyncing = (desired: DesiredState, reported: ReportedState): boolean =>
  pendingFields(desired, reported).length > 0;

/** How long a field may stay unconfirmed before the UI calls it stale. */
export const SYNC_STALE_AFTER_MS = 10_000;

export const isSyncStale = (desiredSetAt: number, now: number): boolean =>
  now - desiredSetAt > SYNC_STALE_AFTER_MS;
