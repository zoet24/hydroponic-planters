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

/**
 * How overdue something scheduled is. Shared by the pH check-in and the nutrient
 * dose, which are the same shape of question asked of different clocks.
 */
export type DueState = 'ok' | 'soon' | 'due' | 'overdue';

export interface DueOptions {
  /** Flag it this long before it falls due. */
  soonDays?: number;
  /** Past this much beyond the due date, call it overdue rather than due. */
  overdueDays?: number;
}

export function dueState(
  dueAt: number | null,
  now: number,
  { soonDays = 1, overdueDays = OVERDUE_GRACE_DAYS }: DueOptions = {},
): DueState {
  // Nothing scheduled is not the same as nothing owed — there is simply no
  // preset, so there is nothing to be late for.
  if (dueAt === null || !Number.isFinite(dueAt)) return 'ok';

  if (now >= dueAt + overdueDays * DAY_MS) return 'overdue';
  if (now >= dueAt) return 'due';
  if (dueAt - now <= soonDays * DAY_MS) return 'soon';
  return 'ok';
}
