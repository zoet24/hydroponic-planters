/**
 * Plausible telemetry. Deterministic given a seed and a timestamp, so the
 * charts in a recorded demo and the charts on stage have the same shape.
 */

const DAY_MS = 86_400_000;

/** Cheap deterministic noise. Not random, just unpredictable-looking. */
function hashNoise(seed: number, t: number): number {
  const x = Math.sin(seed * 12.9898 + Math.floor(t / 10_000) * 78.233) * 43_758.5453;
  return (x - Math.floor(x)) * 2 - 1; // -1..1
}

const fractionOfDay = (now: number): number => (now % DAY_MS) / DAY_MS;

/**
 * Indoor light: dark overnight, a broad raised-cosine peak through the day.
 * Peaks around 13:00 UTC at roughly `peakLux`.
 */
export function lightLux(now: number, seed: number, peakLux = 6000): number {
  const hour = fractionOfDay(now) * 24;
  const sunrise = 7;
  const sunset = 21;
  if (hour < sunrise || hour > sunset) return 0;

  const t = (hour - sunrise) / (sunset - sunrise); // 0..1 across daylight
  const shape = Math.sin(Math.PI * t) ** 1.5;
  const noise = 1 + hashNoise(seed, now) * 0.06;
  return Math.max(0, Math.round(peakLux * shape * noise));
}

/**
 * Water temperature follows the light curve but lags it by about two hours and
 * swings far less — thermal mass.
 */
export function waterTempC(now: number, seed: number, base = 21, swing = 2): number {
  const hour = fractionOfDay(now) * 24;
  const lagged = ((hour - 2 + 24) % 24) / 24;
  const wave = Math.sin(2 * Math.PI * (lagged - 0.25));
  const noise = hashNoise(seed + 1, now) * 0.15;
  return round1(base + wave * swing + noise);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
