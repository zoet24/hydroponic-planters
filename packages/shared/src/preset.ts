import { z } from 'zod';

/**
 * Hard safety bounds. Nothing reaches a device outside these, whoever proposed
 * it — a built-in preset, a human, or a model.
 */
export const SAFETY = {
  pump: {
    /**
     * Divisors of 24 only. The firmware silently snaps a non-divisor to the
     * nearest divisor while still reporting the value you sent, so allowing
     * anything else would make reported state a lie.
     */
    intervalHoursAllowed: [1, 2, 3, 4, 6, 8, 12, 24] as const,
    /**
     * What a preset actually authors. The inverse of the allowed intervals, so
     * the two can never disagree, and the unit a grower thinks in.
     */
    runsPerDayAllowed: [1, 2, 3, 4, 6, 8, 12, 24] as const,
    /**
     * Mirrors the firmware's own 1-30 limit. The real constraint is maxDutyCycle
     * below: capping runtime at 15 instead would make the duty-cycle rule
     * unreachable (15/60 = 0.25 exactly at the shortest interval), while also
     * forbidding harmless presets like 30 min every 12h.
     */
    runtimeMinutes: { min: 1, max: 30 },
    speedPercent: { min: 20, max: 100 }, // below ~20% the pump stalls
    maxDutyCycle: 0.25, // runtime / (interval * 60)
  },
  waterTempC: { min: 5, max: 35, minSpan: 2 },
  ph: { min: 4, max: 8, minSpan: 0.2, checkIntervalDays: { min: 1, max: 14 } },
  nutrients: {
    strengthMultiplier: { min: 0.25, max: 1.5 }, // relative to the product label
    scheduleDays: { min: 1, max: 28 },
  },
} as const;

export const dutyCycle = (intervalHours: number, runtimeMinutes: number): number =>
  runtimeMinutes / (intervalHours * 60);

/**
 * PresetShape is the plain object: field types and simple bounds, no cross-field
 * rules. It is what gets converted to JSON Schema for a model, because zod
 * refinements do not survive that conversion.
 */
export const PresetShape = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(40),
  plantType: z.string().min(1).max(40),
  /** One line for the preset card. Optional: a proposal without one still parses. */
  description: z.string().min(1).max(80).optional(),
  /**
   * How often, and nothing else.
   *
   * Runtime and speed used to live here too, varying by plant. They are
   * properties of the tower -- its height, the pump's head, the bore of the
   * tubing, how the medium holds water -- and none of that changes when basil
   * is swapped for kale. They now sit in TOWER_PUMP, calibrated once.
   */
  pump: z.object({
    runsPerDay: z.number().int().min(1).max(24),
  }),
  waterTempC: z.object({
    min: z.number().min(SAFETY.waterTempC.min).max(SAFETY.waterTempC.max),
    max: z.number().min(SAFETY.waterTempC.min).max(SAFETY.waterTempC.max),
  }),
  ph: z.object({
    targetMin: z.number().min(SAFETY.ph.min).max(SAFETY.ph.max),
    targetMax: z.number().min(SAFETY.ph.min).max(SAFETY.ph.max),
    checkIntervalDays: z
      .number()
      .int()
      .min(SAFETY.ph.checkIntervalDays.min)
      .max(SAFETY.ph.checkIntervalDays.max),
  }),
  nutrients: z.object({
    /** The kind of feed to use, e.g. "Balanced leafy-green feed". */
    type: z.string().min(1).max(60),
    strengthMultiplier: z
      .number()
      .min(SAFETY.nutrients.strengthMultiplier.min)
      .max(SAFETY.nutrients.strengthMultiplier.max),
    /** Static, plant-specific advice. Shown with the reminder; never derived. */
    guidance: z.string().min(1).max(160),
    scheduleDays: z
      .number()
      .int()
      .min(SAFETY.nutrients.scheduleDays.min)
      .max(SAFETY.nutrients.scheduleDays.max),
  }),
});

/**
 * Pump settings that belong to the tower, not the plant.
 *
 * Measured once on the real tower and shared by every preset. Keeping them out
 * of the plant data stops ten made-up variations standing in for one number
 * nobody had measured.
 */
export const TOWER_PUMP = { runtimeMinutes: 2, speedPercent: 70 } as const;

/** Runs per day is the authored unit; the device speaks interval hours. */
export const runsPerDayToIntervalHours = (runsPerDay: number): number => 24 / runsPerDay;

/**
 * Preset is PresetShape plus the cross-field rules. This is what anything
 * touching a device must satisfy. The duty-cycle rule is the important one: a
 * plausible-sounding "every hour for 20 minutes" is a pump running a third of
 * its life and a flooded desk.
 */
export const Preset = PresetShape.refine(
  (p) => (SAFETY.pump.runsPerDayAllowed as readonly number[]).includes(p.pump.runsPerDay),
  { error: 'runs per day must divide 24 evenly', path: ['pump', 'runsPerDay'] },
)
  // The duty-cycle rule has moved to DesiredState. With runtime fixed by
  // TOWER_PUMP a preset cannot reach the cap -- 2/60 is 0.033 against 0.25 --
  // so a rule here would be unreachable. It now guards the one path where
  // runtime can still vary: anything setting desired state directly.
  .refine((p) => p.waterTempC.max - p.waterTempC.min >= SAFETY.waterTempC.minSpan, {
    error: `water temperature range must span at least ${SAFETY.waterTempC.minSpan}°C`,
    path: ['waterTempC'],
  })
  .refine((p) => p.ph.targetMax - p.ph.targetMin >= SAFETY.ph.minSpan, {
    error: `pH range must span at least ${SAFETY.ph.minSpan}`,
    path: ['ph'],
  });

export type Preset = z.infer<typeof PresetShape>;
export type PresetSource = 'builtin' | 'custom' | 'ai';

export interface ClampResult {
  preset: Preset;
  warnings: string[];
}

const clampNumber = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

const nearestAllowedRuns = (runsPerDay: number): number => {
  const allowed = SAFETY.pump.runsPerDayAllowed;
  let best = allowed[0] as number;
  for (const candidate of allowed) {
    if (Math.abs(candidate - runsPerDay) < Math.abs(best - runsPerDay)) best = candidate;
  }
  return best;
};

/**
 * Bring a shape-valid preset inside the safety bounds, reporting every change.
 *
 * Only ever applied to proposals from outside the codebase. Built-in presets are
 * expected to pass `Preset` untouched, and their tests assert exactly that.
 */
export function clampToSafety(input: Preset): ClampResult {
  const warnings: string[] = [];
  const p: Preset = structuredClone(input);

  if (!(SAFETY.pump.runsPerDayAllowed as readonly number[]).includes(p.pump.runsPerDay)) {
    const snapped = nearestAllowedRuns(p.pump.runsPerDay);
    warnings.push(
      `${p.pump.runsPerDay} runs a day does not divide 24 evenly, so the device would not honour it. Using ${snapped}.`,
    );
    p.pump.runsPerDay = snapped;
  }

  const tempBefore = { ...p.waterTempC };
  p.waterTempC.min = clampNumber(p.waterTempC.min, SAFETY.waterTempC.min, SAFETY.waterTempC.max);
  p.waterTempC.max = clampNumber(p.waterTempC.max, SAFETY.waterTempC.min, SAFETY.waterTempC.max);
  if (p.waterTempC.max - p.waterTempC.min < SAFETY.waterTempC.minSpan) {
    p.waterTempC.max = clampNumber(
      p.waterTempC.min + SAFETY.waterTempC.minSpan,
      SAFETY.waterTempC.min,
      SAFETY.waterTempC.max,
    );
    p.waterTempC.min = round1(p.waterTempC.max - SAFETY.waterTempC.minSpan);
  }
  if (p.waterTempC.min !== tempBefore.min || p.waterTempC.max !== tempBefore.max) {
    warnings.push(
      `Water temperature range ${tempBefore.min}–${tempBefore.max}°C adjusted to ${p.waterTempC.min}–${p.waterTempC.max}°C.`,
    );
  }

  const phBefore = { ...p.ph };
  p.ph.targetMin = clampNumber(p.ph.targetMin, SAFETY.ph.min, SAFETY.ph.max);
  p.ph.targetMax = clampNumber(p.ph.targetMax, SAFETY.ph.min, SAFETY.ph.max);
  if (p.ph.targetMax - p.ph.targetMin < SAFETY.ph.minSpan) {
    p.ph.targetMax = round1(clampNumber(p.ph.targetMin + SAFETY.ph.minSpan, SAFETY.ph.min, SAFETY.ph.max));
    p.ph.targetMin = round1(p.ph.targetMax - SAFETY.ph.minSpan);
  }
  if (p.ph.targetMin !== phBefore.targetMin || p.ph.targetMax !== phBefore.targetMax) {
    warnings.push(
      `pH target ${phBefore.targetMin}–${phBefore.targetMax} adjusted to ${p.ph.targetMin}–${p.ph.targetMax}.`,
    );
  }

  const checkDays = Math.round(
    clampNumber(
      p.ph.checkIntervalDays,
      SAFETY.ph.checkIntervalDays.min,
      SAFETY.ph.checkIntervalDays.max,
    ),
  );
  if (checkDays !== p.ph.checkIntervalDays) {
    warnings.push(`pH check interval adjusted to every ${checkDays} days.`);
    p.ph.checkIntervalDays = checkDays;
  }

  const strength = clampNumber(
    p.nutrients.strengthMultiplier,
    SAFETY.nutrients.strengthMultiplier.min,
    SAFETY.nutrients.strengthMultiplier.max,
  );
  if (strength !== p.nutrients.strengthMultiplier) {
    warnings.push(`Nutrient strength ${p.nutrients.strengthMultiplier}× adjusted to ${strength}×.`);
    p.nutrients.strengthMultiplier = strength;
  }

  const schedule = Math.round(
    clampNumber(
      p.nutrients.scheduleDays,
      SAFETY.nutrients.scheduleDays.min,
      SAFETY.nutrients.scheduleDays.max,
    ),
  );
  if (schedule !== p.nutrients.scheduleDays) {
    warnings.push(`Nutrient schedule adjusted to every ${schedule} days.`);
    p.nutrients.scheduleDays = schedule;
  }

  return { preset: p, warnings };
}
