/**
 * Nutrient schedule. Pure, like the pH engine, and deliberately blind to pH:
 * nutrient timing comes from the preset's schedule and the last recorded dose,
 * never from a reading.
 */

export type NutrientStatus = 'ok' | 'due' | 'overdue';

export interface NutrientInput {
  /** Epoch ms of the last nutrients_added event, or null if never recorded. */
  lastAddedAt: number | null;
  /** From the active preset. */
  scheduleDays: number;
  /** Epoch ms. Passed in so the function stays pure. */
  now: number;
}

export interface NutrientResult {
  status: NutrientStatus;
  /** Negative once overdue. Rounded to one decimal place. */
  dueInDays: number;
  /** Epoch ms, or null when nothing has been recorded yet. */
  dueAt: number | null;
}

const DAY_MS = 86_400_000;

/** Past this much beyond the due date we stop saying "due" and say "overdue". */
export const OVERDUE_GRACE_DAYS = 1;

export function nutrientStatus(input: NutrientInput): NutrientResult {
  const { lastAddedAt, scheduleDays, now } = input;

  // Never recorded: report due rather than pretending everything is fine.
  if (lastAddedAt === null || !Number.isFinite(lastAddedAt)) {
    return { status: 'due', dueInDays: 0, dueAt: null };
  }

  const interval = Math.max(1, scheduleDays) * DAY_MS;
  const dueAt = lastAddedAt + interval;
  const dueInDays = round1((dueAt - now) / DAY_MS);

  const status: NutrientStatus =
    now < dueAt ? 'ok' : now > dueAt + OVERDUE_GRACE_DAYS * DAY_MS ? 'overdue' : 'due';

  return { status, dueInDays, dueAt };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
