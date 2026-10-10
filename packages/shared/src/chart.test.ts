import { describe, expect, it } from 'vitest';
import { PLOT, axisLabel, niceDomain, phScaleX, stepPh, ticksFor, trimZero, xAt, yAt } from './chart';

describe('niceDomain', () => {
  it('fits a real temperature spread onto the axis the design draws', () => {
    // 18.9-23.1 °C should read 18 / 21 / 24, as on the artboard.
    expect(niceDomain([18.9, 21.4, 23.1])).toEqual([18, 24]);
    expect(ticksFor(niceDomain([18.9, 21.4, 23.1]))).toEqual([24, 21, 18]);
  });

  it('floors light at zero and rounds to a readable top', () => {
    expect(niceDomain([0, 2400, 5800], true)).toEqual([0, 6000]);
  });

  it('does not waste more than about half the plot on empty space', () => {
    for (const spread of [[20, 21], [0, 3], [100, 137], [1.2, 1.9]]) {
      const [lo, hi] = niceDomain(spread);
      const used = (Math.max(...spread) - Math.min(...spread)) / (hi - lo);
      expect(used, `${spread}`).toBeGreaterThan(0.25);
    }
  });

  it('gives a flat series a band instead of a single line', () => {
    const [lo, hi] = niceDomain([21, 21, 21]);
    expect(hi).toBeGreaterThan(lo);
  });

  it('survives an empty series', () => {
    const [lo, hi] = niceDomain([]);
    expect(hi).toBeGreaterThan(lo);
  });

  it('always contains every data point', () => {
    for (const spread of [[18.9, 23.1], [0, 5800], [-4, 12], [999, 1001]]) {
      const [lo, hi] = niceDomain(spread);
      expect(lo).toBeLessThanOrEqual(Math.min(...spread));
      expect(hi).toBeGreaterThanOrEqual(Math.max(...spread));
    }
  });
});

describe('projection', () => {
  it('maps the time range onto the plot area', () => {
    expect(xAt(1000, 1000, 2000)).toBe(PLOT.x0);
    expect(xAt(2000, 1000, 2000)).toBe(PLOT.x1);
    expect(xAt(1500, 1000, 2000)).toBeCloseTo((PLOT.x0 + PLOT.x1) / 2);
  });

  it('puts the domain minimum at the bottom, since SVG y grows downwards', () => {
    expect(yAt(18, [18, 24])).toBe(PLOT.y1);
    expect(yAt(24, [18, 24])).toBe(PLOT.y0);
  });

  it('does not divide by zero on a collapsed range', () => {
    expect(Number.isFinite(xAt(5, 5, 5))).toBe(true);
    expect(Number.isFinite(yAt(5, [5, 5]))).toBe(true);
  });
});

describe('trimZero', () => {
  it.each([[21, '21'], [21.4, '21.4'], [0, '0'], [6000, '6000']])('formats %p as %p', (n, out) =>
    expect(trimZero(n)).toBe(out),
  );
});

describe('phScaleX', () => {
  it('reproduces the artboard geometry exactly', () => {
    // The target band for basil is drawn at x=86.3 with width 60.4, and a
    // reading of 6.8 sits at x=198.5.
    expect(phScaleX(5.5)).toBe(86.3);
    expect(phScaleX(6.2) - phScaleX(5.5)).toBeCloseTo(60.4, 1);
    expect(phScaleX(6.8)).toBe(198.5);
  });

  it('pins the ends of the track', () => {
    expect(phScaleX(4.5)).toBe(0);
    expect(phScaleX(8)).toBe(302);
  });

  it('keeps an out-of-scale reading on the bar', () => {
    expect(phScaleX(3)).toBe(0);
    expect(phScaleX(9)).toBe(302);
  });
});

describe('stepPh', () => {
  it('steps by a tenth without floating point drift', () => {
    let ph = 7;
    for (let i = 0; i < 5; i++) ph = stepPh(ph, -0.1);
    expect(ph).toBe(6.5);
  });

  it('stays inside what the engine will accept, so a stepper cannot make an invalid reading', () => {
    expect(stepPh(3, -0.1)).toBe(3);
    expect(stepPh(9, 0.1)).toBe(9);
  });
});

describe('axisLabel', () => {
  const at = Date.UTC(2026, 9, 10, 14, 30);

  it('shows a clock face for an hour on screen', () => {
    expect(axisLabel(at, 3_600_000)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('still shows times across two days, where they are unambiguous', () => {
    expect(axisLabel(at, 2 * 86_400_000)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('switches to dates once times would repeat', () => {
    expect(axisLabel(at, 7 * 86_400_000)).toMatch(/Oct/);
  });

  it('drops to months across a year', () => {
    expect(axisLabel(at, 400 * 86_400_000)).toMatch(/Oct 26/);
  });
});
