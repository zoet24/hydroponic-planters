/**
 * pH rules engine. A pure function over one reading and the active preset:
 * no clock, no storage, no I/O. Everything it needs arrives in PhInput.
 */

/** Widest reading a reservoir probe can plausibly produce. Outside this, suspect the probe. */
export const PH_PLAUSIBLE_RANGE = { min: 3, max: 9 } as const;

/** Readings this close to a target edge count as in range — pens drift by about this much. */
export const PH_DEADBAND = 0.1;

export type PhStatus = 'in_range' | 'too_low' | 'too_high' | 'invalid';
export type PhAction = 'add_ph_down' | 'add_ph_up' | 'none';

export interface PhRange {
  min: number;
  max: number;
}

export interface PhInput {
  /** The reading from the pH pen. */
  ph: number;
  /** The active preset's target range. */
  range: PhRange;
  /** How old the reading is. Feeds `stale` only — never the status. */
  readingAgeHours: number;
  /** The active preset's check-in interval, used as the staleness threshold. */
  checkIntervalDays: number;
}

export interface PhResult {
  status: PhStatus;
  action: PhAction;
  advice: string;
  /** Orthogonal to status: an in-range reading can still be too old to trust. */
  stale: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const fmt = (n: number): string => n.toFixed(1);

const isUsableRange = (range: PhRange): boolean =>
  Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max;

/**
 * Advice is always "small increments, mix, retest" and defers dosing to the product
 * label. It never returns a quantity, and because exactly one branch below produces
 * the result, it can never recommend both directions at once.
 */
export function phAdvice(input: PhInput): PhResult {
  const { ph, range, readingAgeHours, checkIntervalDays } = input;

  const stale = readingAgeHours > checkIntervalDays * 24;

  if (!isUsableRange(range)) {
    return {
      status: 'invalid',
      action: 'none',
      advice:
        'This planter has no usable pH target, so there is nothing to compare the reading against. Check the preset.',
      stale,
    };
  }

  if (!Number.isFinite(ph)) {
    return {
      status: 'invalid',
      action: 'none',
      advice: 'That reading did not come through as a number. Re-enter it and try again.',
      stale,
    };
  }

  if (ph < PH_PLAUSIBLE_RANGE.min || ph > PH_PLAUSIBLE_RANGE.max) {
    return {
      status: 'invalid',
      action: 'none',
      advice: `A reading of ${fmt(ph)} is outside anything this system should act on. Rinse the probe, recalibrate it if needed, and retest.`,
      stale,
    };
  }

  const target = `${fmt(range.min)}–${fmt(range.max)}`;
  const value = round2(ph);
  const floor = round2(range.min - PH_DEADBAND);
  const ceiling = round2(range.max + PH_DEADBAND);

  if (value < floor) {
    return {
      status: 'too_low',
      action: 'add_ph_up',
      advice: `pH ${fmt(ph)} is below the ${target} target. Add pH Up in small increments, mix the reservoir, and retest after about half an hour. Follow the dosing on the product label.`,
      stale,
    };
  }

  if (value > ceiling) {
    return {
      status: 'too_high',
      action: 'add_ph_down',
      advice: `pH ${fmt(ph)} is above the ${target} target. Add pH Down in small increments, mix the reservoir, and retest after about half an hour. Follow the dosing on the product label.`,
      stale,
    };
  }

  const insideTarget = value >= round2(range.min) && value <= round2(range.max);

  return {
    status: 'in_range',
    action: 'none',
    advice: insideTarget
      ? `pH ${fmt(ph)} is within the ${target} target. Nothing to do.`
      : `pH ${fmt(ph)} is just outside the ${target} target, but close enough to be measurement noise. Leave it and retest at the next check-in.`,
    stale,
  };
}
