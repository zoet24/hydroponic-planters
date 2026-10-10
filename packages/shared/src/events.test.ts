import { describe, expect, it } from 'vitest';
import { collapsePumpRuns, describeEvent, eventNote, eventTime, eventTone, type PlanterEvent } from './events';

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
      ev('added', base - MIN),
    ]);
    expect(items.map((i) => i.type)).toEqual(['low_water', 'pump_run', 'added']);
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
    ['added', null, 'Planter added'],
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

describe('eventNote', () => {
  it('returns the note a pH check-in carried', () => {
    expect(eventNote({ type: 'ph_checkin', payload: { ph: 6.1, note: 'pen recalibrated' } }))
      .toBe('pen recalibrated');
  });

  it('returns the note a nutrient record carried', () => {
    expect(eventNote({ type: 'nutrients_added', payload: { note: 'half strength' } }))
      .toBe('half strength');
  });

  it('is null when nothing was written', () => {
    expect(eventNote({ type: 'nutrients_added', payload: {} })).toBeNull();
    expect(eventNote({ type: 'pump_run', payload: { on: true } })).toBeNull();
  });

  it('ignores whitespace-only notes', () => {
    expect(eventNote({ type: 'ph_checkin', payload: { note: '   ' } })).toBeNull();
  });

  // The note event's text is already the entry itself.
  it('adds nothing to a note event, which would otherwise repeat itself', () => {
    expect(eventNote({ type: 'note', payload: { text: 'looking perky' } })).toBeNull();
  });
});
