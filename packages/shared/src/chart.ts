/**
 * Chart geometry, taken from the Dashboard artboard: a 700x130 viewBox with the
 * plot running x 44 -> 700 and y 20 (top) -> 100 (bottom).
 */
export const PLOT = { x0: 44, x1: 700, y0: 20, y1: 100 } as const;

export interface Point {
  ts: number;
  value: number;
}

/** A domain rounded to readable tick values rather than the raw data extent. */
export function niceDomain(values: number[], zeroFloor = false): [number, number] {
  if (values.length === 0) return zeroFloor ? [0, 1] : [0, 1];

  let min = Math.min(...values);
  let max = Math.max(...values);

  if (zeroFloor) min = 0;
  if (max === min) {
    // A dead-flat series still needs a band, or every point lands on one line.
    max = min + (zeroFloor ? 1 : 2);
  }

  // Aim for about four intervals. Two produced a step so coarse that a 4 degree
  // spread rendered on a 15-to-25 axis, wasting half the plot height.
  const step = niceStep((max - min) / 4);
  const lo = zeroFloor ? 0 : Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return [lo, hi === lo ? lo + step : hi];
}

/** 1, 2, 5 x 10^n — the steps people read without thinking. */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const snapped = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return snapped * magnitude;
}

export const xAt = (ts: number, from: number, to: number): number =>
  PLOT.x0 + ((ts - from) / Math.max(1, to - from)) * (PLOT.x1 - PLOT.x0);

export const yAt = (value: number, [lo, hi]: [number, number]): number =>
  PLOT.y1 - ((value - lo) / Math.max(1e-9, hi - lo)) * (PLOT.y1 - PLOT.y0);

/** Three gridline values: bottom, middle, top — matching the artboard. */
export const ticksFor = ([lo, hi]: [number, number]): number[] => [hi, (lo + hi) / 2, lo];

/** Drops a trailing .0, so an axis reads "21 °C" rather than "21.0 °C". */
export const trimZero = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

export const timeLabel = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
