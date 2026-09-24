/**
 * When the pump next runs. The firmware fires at the top of the hour whenever
 * `hour % intervalHours === 0`, so this mirrors that rule rather than adding
 * `intervalHours` to the last run.
 *
 * Hours are LOCAL, matching ESPHome's configured timezone. Keep the `timezone:`
 * in esphome.yaml set to where the tower actually is, or the app and the device
 * will disagree about when "04:00" is.
 */

export interface NextRun {
  /** Epoch ms of the next scheduled run. */
  at: number;
  /** Hours until then, one decimal place. */
  inHours: number;
}

export function nextPumpRun(intervalHours: number, now: number): NextRun | null {
  if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 24) return null;

  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);

  // At most a day of hour boundaries to check, and a divisor of 24 always hits.
  for (let i = 0; i < 25; i++) {
    if (next.getHours() % intervalHours === 0) {
      const at = next.getTime();
      return { at, inHours: Math.round(((at - now) / 3_600_000) * 10) / 10 };
    }
    next.setHours(next.getHours() + 1);
  }
  return null;
}

/** "2 h", "45 min", "now". Short enough for a card readout. */
export function formatUntil(inHours: number): string {
  if (inHours <= 0) return 'now';
  if (inHours < 1) return `${Math.max(1, Math.round(inHours * 60))} min`;
  return `${Math.round(inHours)} h`;
}
