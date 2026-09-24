import { formatUntil, nextPumpRun } from '@planter/shared';
import type { PlanterView } from '../types';

/**
 * Unconfirmed settings are only worth showing while the device is reachable.
 * The backend still reports them as pending — correctly, they are — but telling
 * someone an offline planter is "still syncing" blames the wrong thing.
 */
export const isSyncing = (p: PlanterView): boolean => p.online && p.syncing;

export const luxLabel = (lux: number | undefined): string =>
  typeof lux === 'number' ? `${Math.round(lux).toLocaleString('en-GB')}\u00a0lux` : 'No data';

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
