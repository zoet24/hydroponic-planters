/**
 * The event vocabulary the timeline reads. Pure, so the phrasing and the
 * start/stop pairing are testable rather than tangled into a component.
 */

export interface PlanterEvent {
  id: number;
  ts: number;
  type: string;
  payload: Record<string, unknown> | null;
}

/** A pump run after its start and stop rows have been folded together. */
export interface TimelineItem extends PlanterEvent {
  /** Present only on a completed pump run. */
  durationMs?: number;
  running?: boolean;
}

export type EventTone = 'green' | 'amber' | 'red' | 'grey';
export type EventIcon = 'pump' | 'preset' | 'ph' | 'nutrients' | 'water' | 'plug' | 'note' | 'dot';

/**
 * Fold "pump started" and "pump stopped" into one row.
 *
 * The device reports both edges, which is right for the data but doubles the
 * length of the timeline and reads like stuttering. Expects newest-first input,
 * as the API returns it.
 */
export function collapsePumpRuns(events: PlanterEvent[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const consumed = new Set<number>();

  for (const [i, event] of events.entries()) {
    if (consumed.has(event.id)) continue;

    if (event.type !== 'pump_run') {
      out.push(event);
      continue;
    }

    if (event.payload?.on === true) {
      // A start with no stop after it: still running.
      out.push({ ...event, running: true });
      continue;
    }

    // A stop: find the most recent start before it.
    const start = events.slice(i + 1).find((e) => e.type === 'pump_run' && e.payload?.on === true);
    if (!start) {
      out.push(event);
      continue;
    }
    consumed.add(start.id);
    out.push({ ...start, durationMs: event.ts - start.ts });
  }

  return out;
}

export function describeEvent(e: TimelineItem): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'pump_run': {
      if (e.running) return 'Pump running';
      if (e.durationMs === undefined) return 'Pump stopped';
      const minutes = Math.max(1, Math.round(e.durationMs / 60_000));
      return `Pump ran for ${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    case 'preset_applied':
      return `${String(p.name ?? 'Preset')} preset sent`;
    case 'low_water':
      return 'Low water detected';
    case 'offline':
      return 'Planter went offline';
    case 'online':
      return 'Planter came online';
    case 'ph_checkin':
      return `pH reading logged: ${String(p.ph)}, ${String(p.status ?? '').replace(/_/g, ' ')}`;
    case 'nutrients_added':
      return p.strengthMultiplier
        ? `Nutrients added at ${String(p.strengthMultiplier)}× label strength`
        : 'Nutrients added';
    case 'added':
      return 'Planter added';
    case 'note':
      return typeof p.text === 'string' && p.text.trim() !== '' ? p.text : 'Note';
    default:
      return e.type.replace(/_/g, ' ');
  }
}

/**
 * The free text a grower attached to a record, if any.
 *
 * A `note` event carries its text as the whole entry, so it has none to add —
 * returning it twice would show the same sentence above itself.
 */
export function eventNote(e: { type: string; payload?: Record<string, unknown> | null }): string | null {
  if (e.type === 'note') return null;
  const note = e.payload?.note;
  return typeof note === 'string' && note.trim() !== '' ? note : null;
}

export function eventTone(type: string): EventTone {
  switch (type) {
    case 'low_water':
    case 'offline':
      return 'red';
    case 'preset_applied':
      return 'amber';
    case 'pump_run':
    case 'online':
    case 'added':
      return 'green';
    case 'note':
      return 'grey';
    default:
      return 'grey';
  }
}

export function eventIcon(type: string): EventIcon {
  switch (type) {
    case 'pump_run':
      return 'pump';
    case 'preset_applied':
      return 'preset';
    case 'ph_checkin':
      return 'ph';
    case 'nutrients_added':
      return 'nutrients';
    case 'note':
      return 'note';
    case 'low_water':
      return 'water';
    case 'online':
    case 'offline':
    case 'added':
      return 'plug';
    default:
      return 'dot';
  }
}

/** "Today 09:52", "Yesterday 14:20", "2 days ago 21:15" — as the artboard reads. */
export function eventTime(ts: number, now = Date.now()): string {
  const time = new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (ts >= midnight.getTime()) return `Today ${time}`;
  const days = Math.ceil((midnight.getTime() - ts) / 86_400_000);
  if (days === 1) return `Yesterday ${time}`;
  return `${days} days ago ${time}`;
}
