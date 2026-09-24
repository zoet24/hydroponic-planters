import { describe, expect, it } from 'vitest';
import { estimateFlowLpm, formatFlow } from './flow';

describe('estimateFlowLpm', () => {
  it('is zero whenever the pump is off, whatever the speed says', () => {
    expect(estimateFlowLpm(false, 100)).toBe(0);
  });

  it('is zero at zero speed', () => expect(estimateFlowLpm(true, 0)).toBe(0));

  it('interpolates between calibration points', () => {
    expect(estimateFlowLpm(true, 50)).toBeCloseTo(1.0, 1);
  });

  it('rises monotonically with speed', () => {
    let prev = -1;
    for (let s = 0; s <= 100; s += 5) {
      const f = estimateFlowLpm(true, s);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('clamps out-of-range speeds instead of extrapolating', () => {
    expect(estimateFlowLpm(true, 150)).toBe(estimateFlowLpm(true, 100));
  });

  it('always labels the number as an estimate', () => {
    expect(formatFlow(1.2)).toContain('(estimated)');
  });
});
