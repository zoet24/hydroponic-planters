import { describe, expect, it } from 'vitest';
import { formatUntil, nextPumpRun } from './schedule';

/** Local time, because that is the basis the firmware uses. */
const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m, 0, 0).getTime();

describe('nextPumpRun', () => {
  it('finds the next hour divisible by the interval', () => {
    const run = nextPumpRun(4, at(13, 20))!;
    expect(new Date(run.at).getHours()).toBe(16);
  });

  it('never returns the current hour, even exactly on it', () => {
    const run = nextPumpRun(4, at(12, 0))!;
    expect(new Date(run.at).getHours()).toBe(16);
  });

  it('lands on the next hour when the interval is 1', () => {
    const run = nextPumpRun(1, at(13, 20))!;
    expect(new Date(run.at).getHours()).toBe(14);
  });

  it('rolls over midnight', () => {
    const run = nextPumpRun(12, at(23, 10))!;
    expect(new Date(run.at).getHours()).toBe(0);
    expect(run.at).toBeGreaterThan(at(23, 10));
  });

  it('reports the wait in hours', () => {
    expect(nextPumpRun(4, at(14, 0))!.inHours).toBe(2);
  });

  it.each([0, -1, 25, NaN, Infinity])('returns null for an impossible interval (%p)', (h) => {
    expect(nextPumpRun(h, at(13))).toBeNull();
  });

  it('always lands in the future', () => {
    for (const interval of [1, 2, 3, 4, 6, 8, 12, 24]) {
      for (let h = 0; h < 24; h++) {
        const now = at(h, 37);
        expect(nextPumpRun(interval, now)!.at, `${interval}h at ${h}:37`).toBeGreaterThan(now);
      }
    }
  });
});

describe('formatUntil', () => {
  it.each([
    [0, 'now'],
    [-1, 'now'],
    [0.5, '30 min'],
    [0.01, '1 min'],
    [2, '2 h'],
    [2.4, '2 h'],
  ])('formats %p as %p', (input, expected) => expect(formatUntil(input)).toBe(expected));
});
