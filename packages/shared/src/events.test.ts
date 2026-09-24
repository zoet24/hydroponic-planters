import { describe, expect, it } from 'vitest';
import {
  collapsePumpRuns,
  describeEvent,
  eventTime,
  eventTone,
  type PlanterEvent,
} from './events';

let nextId = 1;
const ev = (type: string, ts: number, payload: Record<string, unknown> | null = null): PlanterEvent => ({
  id: nextId++,
  ts,
  type,
  payload,
});

const MIN = 60_000;
const base = Date.UTC(2026, 8, 24, 12, 0, 0);

describe('collapsePumpRuns', () => {
  it('folds a start and stop into one run', () => {
    // Newest first, as the API returns.
    const items = collapsePumpRuns([
      ev('pump_run', base + 3 * MIN, { on: false }),
      ev('pump_run', base, { on: true }),
    ]);
    expect(items).toHaveLength(1);
    expect(describeEvent(items[0]!)).toBe('Pump ran for 3 minutes');
  });

  it('anchors the folded row to the start time, not the stop', () => {
    const items = collapsePumpRuns([
      ev('pump_run', base + 3 * MIN, { on: false }),
      ev('pump_run', base, { on: true }),
    ]);
    expect(items[0]!.ts).toBe(base);
  });

  it('reports a run still in progress', () => {
    const items = collapsePumpRuns([ev('pump_run', base, { on: true })]);
    expect(describeEvent(items[0]!)).toBe('Pump running');
  });

  it('keeps several runs separate', () => {
    const items = collapsePumpRuns([
      ev('pump_run', base + 63 * MIN, { on: false }),
      ev('pump_run', base + 60 * MIN, { on: true }),
      ev('pump_run', base + 3 * MIN, { on: false }),
      ev('pump_run', base, { on: true }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => describeEvent(i) === 'Pump ran for 3 minutes')).toBe(true);
  });

  it('leaves other event types alone and in order', () => {
    const items = collapsePumpRuns([
      ev('low_water', base + 10 * MIN),
      ev('pump_run', base + 3 * MIN, { on: false }),
      ev('pump_run', base, { on: true }),
      ev('claimed', base - MIN),
    ]);
    expect(items.map((i) => i.type)).toEqual(['low_water', 'pump_run', 'claimed']);
  });

  it('survives a stop with no matching start', () => {
    const items = collapsePumpRuns([ev('pump_run', base, { on: false })]);
    expect(describeEvent(items[0]!)).toBe('Pump stopped');
  });

  it('rounds a sub-minute run up rather than saying zero minutes', () => {
    const items = collapsePumpRuns([
      ev('pump_run', base + 20_000, { on: false }),
      ev('pump_run', base, { on: true }),
    ]);
    expect(describeEvent(items[0]!)).toBe('Pump ran for 1 minute');
  });
});

describe('describeEvent', () => {
  it.each([
    ['preset_applied', { name: 'Basil' }, 'Basil preset sent'],
    ['low_water', null, 'Low water detected'],
    ['ph_checkin', { ph: 6.1, status: 'in_range' }, 'pH reading logged: 6.1, in range'],
    ['nutrients_added', { strengthMultiplier: 0.5 }, 'Nutrients added at 0.5× label strength'],
    ['claimed', null, 'Planter claimed'],
  ])('describes %s', (type, payload, expected) => {
    expect(describeEvent(ev(type, base, payload))).toBe(expected);
  });

  it('degrades gracefully for a type it does not know', () => {
    expect(describeEvent(ev('something_new', base))).toBe('something new');
  });
});

describe('eventTone', () => {
  it('reserves red for the two states that need attention', () => {
    expect(eventTone('low_water')).toBe('red');
    expect(eventTone('offline')).toBe('red');
    expect(eventTone('pump_run')).toBe('green');
  });
});

describe('eventTime', () => {
  const now = new Date(2026, 8, 24, 12, 0, 0).getTime();
  const at = (d: number, h: number) => new Date(2026, 8, 24 - d, h, 20, 0).getTime();

  it('labels today, yesterday and older days', () => {
    expect(eventTime(at(0, 9), now)).toMatch(/^Today 09:20$/);
    expect(eventTime(at(1, 14), now)).toMatch(/^Yesterday 14:20$/);
    expect(eventTime(at(2, 21), now)).toMatch(/^2 days ago 21:20$/);
  });

  it('treats just after midnight as today', () => {
    expect(eventTime(new Date(2026, 8, 24, 0, 5).getTime(), now)).toMatch(/^Today/);
  });
});
