import { dueState, formatUntil, nextPumpRun, type DueState } from '@planter/shared';
import type { PlanterView } from '../types';

/**
 * Unconfirmed settings are only worth showing while the device is reachable.
 * The backend still reports them as pending — correctly, they are — but telling
 * someone an offline planter is "still syncing" blames the wrong thing.
 */
export const isSyncing = (p: PlanterView): boolean => p.online && p.syncing;

export const waterLabel = (ok: boolean | undefined): string =>
  ok === undefined ? 'No data' : ok ? 'OK' : 'Low';

export const tempLabel = (c: number | undefined): string =>
  typeof c === 'number' ? `${c.toFixed(1)}\u00a0°C` : 'No data';

/** "Basil preset, real planter" — the subtitle under a card's name. */
export function describePlanter(p: PlanterView): string {
  const origin = p.simulated ? 'simulated' : 'real planter';
  return p.preset ? `${p.preset.name} preset, ${origin}` : `No preset yet, ${origin}`;
}

export function relativeTime(ts: number | null, now = Date.now()): string {
  if (!ts) return 'never';
  const mins = Math.round((now - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export interface Readout {
  label: string;
  value: string;
  muted?: boolean;
}

/**
 * The third readout is contextual, matching the artboard: a countdown when the
 * pump is armed and idle, otherwise why it is not going to run.
 */
export function pumpReadout(p: PlanterView, now = Date.now()): Readout {
  if (!p.online) return { label: 'Pump', value: 'Unknown', muted: true };
  if (p.reported.pumpOn === true) return { label: 'Pump', value: 'Running' };
  if (p.reported.waterOk === false || p.reported.pumpEnable === false) {
    return { label: 'Pump', value: 'Paused' };
  }

  const interval = p.reported.intervalHours ?? p.desired.intervalHours;
  const next = typeof interval === 'number' ? nextPumpRun(interval, now) : null;
  return next
    ? { label: 'Next pump', value: formatUntil(next.inHours) }
    : { label: 'Pump', value: 'Unknown', muted: true };
}

/** "3 planters: 1 low on water, 1 offline" */
export function fleetSummary(planters: PlanterView[]): string {
  const count = `${planters.length} planter${planters.length === 1 ? '' : 's'}`;
  if (planters.length === 0) return 'No planters yet';

  const problems: string[] = [];
  const lowWater = planters.filter((p) => p.online && p.reported.waterOk === false).length;
  const offline = planters.filter((p) => !p.online).length;
  const syncing = planters.filter(isSyncing).length;

  if (lowWater) problems.push(`${lowWater} low on water`);
  if (offline) problems.push(`${offline} offline`);
  if (syncing) problems.push(`${syncing} still syncing`);

  return problems.length === 0 ? `${count}, all well` : `${count}: ${problems.join(', ')}`;
}

/** Per-field labels for the sync chips. Order follows DESIRED_FIELDS. */
export const FIELD_LABELS: Record<string, string> = {
  pumpEnable: 'Enable',
  speedPercent: 'Speed',
  intervalHours: 'Interval',
  runtimeMinutes: 'Runtime',
};

export interface DueChip {
  tone: 'amber' | 'grey';
  label: string;
}

/**
 * The pH and nutrient chips. Both answer the same question of different clocks,
 * so they share the wording: nothing at all until it is nearly time, then the
 * same escalation. Silent when there is no preset — nothing is scheduled, so
 * nothing can be late.
 */
export function phChip(p: PlanterView, now = Date.now()): DueChip | null {
  return chipFor(dueState(p.phCheckDueAt, now), 'pH check');
}

export function nutrientChip(p: PlanterView, now = Date.now()): DueChip | null {
  if (p.nutrientsStatus === null) return null;
  // The backend already worked this out; only the warning window is ours.
  const state: DueState =
    p.nutrientsStatus === 'ok' ? dueState(p.nutrientsDueAt, now) : p.nutrientsStatus;
  return chipFor(state, 'Nutrients');
}

function chipFor(state: DueState, noun: string): DueChip | null {
  switch (state) {
    case 'soon':
      // Amber, matching the artboard's "pH check due soon". The label carries
      // the distinction between soon, due and overdue, not the colour.
      return { tone: 'amber', label: `${noun} due soon` };
    case 'due':
      return { tone: 'amber', label: `${noun} due` };
    case 'overdue':
      return { tone: 'amber', label: `${noun} overdue` };
    default:
      return null;
  }
}


function relativeDays(ts: number, now: number): string {
  const days = Math.round((now - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * How long the plant has been in. Days up to a fortnight, then weeks, because
 * "Growing for 43 days" is harder to picture than "Growing for 6 weeks".
 */
export function growingFor(plantedAt: number | null, now = Date.now()): string | null {
  if (plantedAt === null) return null;
  const days = Math.floor((now - plantedAt) / 86_400_000);
  if (days < 0) return 'Planted in the future';
  if (days === 0) return 'Planted today';
  if (days === 1) return 'Growing for 1 day';
  if (days < 14) return `Growing for ${days} days`;
  const weeks = Math.round(days / 7);
  return `Growing for ${weeks} weeks`;
}

/**
 * How far off a due date is, in either direction.
 *
 * The mirror of relativeTime: that one looks back at something recorded, this
 * one looks forward at something owed.
 */
export function dueIn(dueAt: number | null, now = Date.now()): string {
  if (dueAt === null) return 'No schedule';
  const days = Math.round((dueAt - now) / 86_400_000);
  if (days > 1) return `Next feed in ${days} days`;
  if (days === 1) return 'Next feed tomorrow';
  if (days === 0) return 'Due today';
  if (days === -1) return '1 day overdue';
  return `${Math.abs(days)} days overdue`;
}
