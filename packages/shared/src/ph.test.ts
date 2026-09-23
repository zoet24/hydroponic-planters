import { describe, expect, it } from 'vitest';
import { PH_DEADBAND, PH_PLAUSIBLE_RANGE, phAdvice, type PhInput, type PhResult } from './ph';

const BASIL = { min: 5.5, max: 6.2 };

/** A reading taken an hour ago, against a 3-day check-in. Fresh unless a test says otherwise. */
const read = (ph: number, over: Partial<PhInput> = {}): PhResult =>
  phAdvice({ ph, range: BASIL, readingAgeHours: 1, checkIntervalDays: 3, ...over });

describe('in range', () => {
  it('accepts a mid-range reading and asks for nothing', () => {
    const r = read(5.8);
    expect(r.status).toBe('in_range');
    expect(r.action).toBe('none');
    expect(r.advice).toContain('Nothing to do');
  });

  it('treats both target edges as in range', () => {
    expect(read(BASIL.min).status).toBe('in_range');
    expect(read(BASIL.max).status).toBe('in_range');
  });

  it('absorbs readings within the deadband of an edge', () => {
    expect(read(BASIL.min - PH_DEADBAND).status).toBe('in_range');
    expect(read(BASIL.max + PH_DEADBAND).status).toBe('in_range');
  });

  it('says a deadband reading is noise rather than pretending it is on target', () => {
    expect(read(BASIL.max + PH_DEADBAND).advice).toContain('measurement noise');
    expect(read(5.8).advice).not.toContain('measurement noise');
  });
});

describe('out of range', () => {
  it('sends a low reading to pH Up', () => {
    const r = read(4.9);
    expect(r.status).toBe('too_low');
    expect(r.action).toBe('add_ph_up');
  });

  it('sends a high reading to pH Down', () => {
    const r = read(7.4);
    expect(r.status).toBe('too_high');
    expect(r.action).toBe('add_ph_down');
  });

  it('acts on the first reading past the deadband', () => {
    expect(read(5.39).status).toBe('too_low');
    expect(read(6.31).status).toBe('too_high');
  });

  it('defers dosing to the product label', () => {
    expect(read(4.9).advice).toContain('product label');
    expect(read(7.4).advice).toContain('product label');
  });
});

describe('invalid input', () => {
  it.each([NaN, Infinity, -Infinity])('rejects %p', (ph) => {
    const r = read(ph);
    expect(r.status).toBe('invalid');
    expect(r.action).toBe('none');
  });

  it.each([
    ['below what a probe can mean', PH_PLAUSIBLE_RANGE.min - 0.1],
    ['above what a probe can mean', PH_PLAUSIBLE_RANGE.max + 0.1],
  ])('rejects a reading %s', (_label, ph) => {
    expect(read(ph).status).toBe('invalid');
  });

  it.each([
    ['inverted', { min: 6.2, max: 5.5 }],
    ['zero width', { min: 6.0, max: 6.0 }],
    ['not a number', { min: NaN, max: 6.2 }],
  ])('rejects a %s target range', (_label, range) => {
    const r = read(5.8, { range });
    expect(r.status).toBe('invalid');
    expect(r.action).toBe('none');
    expect(r.advice).toContain('preset');
  });
});

describe('staleness', () => {
  it('is false for a fresh reading', () => {
    expect(read(5.8, { readingAgeHours: 12 }).stale).toBe(false);
  });

  it('is false exactly on the check-in interval', () => {
    expect(read(5.8, { readingAgeHours: 72, checkIntervalDays: 3 }).stale).toBe(false);
  });

  it('is true once the reading outlives the interval', () => {
    expect(read(5.8, { readingAgeHours: 73, checkIntervalDays: 3 }).stale).toBe(true);
  });

  it('is orthogonal to status — an out-of-range reading can also be stale', () => {
    const r = read(4.9, { readingAgeHours: 200, checkIntervalDays: 3 });
    expect(r.status).toBe('too_low');
    expect(r.stale).toBe(true);
  });

  it('does not let age change the status', () => {
    const fresh = read(5.8, { readingAgeHours: 1 });
    const old = read(5.8, { readingAgeHours: 500 });
    expect(old.status).toBe(fresh.status);
    expect(old.action).toBe(fresh.action);
  });
});

describe('invariants across the whole plausible range', () => {
  const sweep: PhResult[] = [];
  for (let ph = 2.5; ph <= 9.5; ph = round(ph + 0.05)) sweep.push(read(ph));
  function round(n: number) {
    return Math.round(n * 100) / 100;
  }

  it('pairs exactly one action with each status', () => {
    const allowed: Record<string, string> = {
      in_range: 'none',
      invalid: 'none',
      too_low: 'add_ph_up',
      too_high: 'add_ph_down',
    };
    for (const r of sweep) expect(r.action).toBe(allowed[r.status]);
  });

  it('never recommends a quantity', () => {
    const dose = /\d+(\.\d+)?\s*(ml|millilit|litre|liter|grams?|mg|drops?|tsp|tbsp|teaspoons?|tablespoons?|capfuls?)/i;
    for (const r of sweep) expect(r.advice).not.toMatch(dose);
  });

  it('always produces non-empty advice', () => {
    for (const r of sweep) expect(r.advice.length).toBeGreaterThan(0);
  });

  it('is deterministic and does not mutate its input', () => {
    const input: PhInput = { ph: 6.35, range: { ...BASIL }, readingAgeHours: 5, checkIntervalDays: 3 };
    const snapshot = structuredClone(input);
    expect(phAdvice(input)).toEqual(phAdvice(input));
    expect(input).toEqual(snapshot);
  });
});
