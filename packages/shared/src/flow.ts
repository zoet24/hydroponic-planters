/**
 * Estimated flow, derived from pump speed. There is no flow sensor in this
 * iteration, so every number out of here is an estimate and the UI must say so.
 *
 * CALIBRATE ME: measure with a jug and a stopwatch once the pump is wired, then
 * replace these points. Until then they are plausible, not measured.
 */

/** [speed percent, litres per minute], ascending by speed. */
export const FLOW_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [20, 0.35],
  [40, 0.8],
  [60, 1.2],
  [80, 1.6],
  [100, 1.9],
];

/** The label the UI shows. Never render a bare number from this module. */
export const FLOW_ESTIMATE_SUFFIX = '(estimated)';

/**
 * Linear interpolation between calibration points. Returns 0 when the pump is
 * off, whatever the speed setting says.
 */
export function estimateFlowLpm(pumpOn: boolean, speedPercent: number): number {
  if (!pumpOn || !Number.isFinite(speedPercent) || speedPercent <= 0) return 0;

  const speed = Math.min(100, Math.max(0, speedPercent));

  for (let i = 1; i < FLOW_CURVE.length; i++) {
    const lo = FLOW_CURVE[i - 1]!;
    const hi = FLOW_CURVE[i]!;
    if (speed <= hi[0]) {
      const span = hi[0] - lo[0];
      const t = span === 0 ? 0 : (speed - lo[0]) / span;
      return round2(lo[1] + t * (hi[1] - lo[1]));
    }
  }

  return FLOW_CURVE[FLOW_CURVE.length - 1]![1];
}

export function formatFlow(lpm: number): string {
  return `≈ ${lpm.toFixed(1)} L/min ${FLOW_ESTIMATE_SUFFIX}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
