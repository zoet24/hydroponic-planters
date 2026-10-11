import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, findBuiltinPreset } from './presets';
import { clampToSafety, dutyCycle, Preset, PresetShape, runsPerDayToIntervalHours, SAFETY, TOWER_PUMP, type Preset as P } from './preset';

const basil = (): P => structuredClone(findBuiltinPreset('basil')!);

describe('built-in presets', () => {
  it('ships ten of them', () => expect(BUILTIN_PRESETS).toHaveLength(10));

  it('all pass the full safety schema untouched', () => {
    for (const p of BUILTIN_PRESETS) expect(Preset.safeParse(p).success, p.id).toBe(true);
  });

  it('need no clamping — a built-in that warns is a bug in the JSON', () => {
    for (const p of BUILTIN_PRESETS) expect(clampToSafety(p).warnings, p.id).toEqual([]);
  });

  it('all carry a one-line description for the preset card', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.description, p.id).toBeTruthy();
      expect(p.description!.length, p.id).toBeLessThanOrEqual(80);
    }
  });

  it('have unique ids', () => {
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
  });
});

describe('schema rules', () => {
  it('rejects a run frequency that does not divide 24', () => {
    const p = basil();
    p.pump.runsPerDay = 5; // 24/5 is not a whole number of hours
    expect(Preset.safeParse(p).success).toBe(false);
    expect(PresetShape.safeParse(p).success).toBe(true); // shape is fine, the rule is not
  });

  it('accepts every allowed frequency', () => {
    for (const runs of SAFETY.pump.runsPerDayAllowed) {
      const p = basil();
      p.pump.runsPerDay = runs;
      expect(Preset.safeParse(p).success).toBe(true);
    }
  });

  it('rejects a pH range narrower than the minimum span', () => {
    const p = basil();
    p.ph.targetMin = 6;
    p.ph.targetMax = 6.05;
    expect(Preset.safeParse(p).success).toBe(false);
  });

  it('requires a feed type, so the reminder can say what to add', () => {
    const p = basil();
    (p.nutrients as { type: string }).type = '';
    expect(PresetShape.safeParse(p).success).toBe(false);
  });
});

describe('TOWER_PUMP', () => {
  // Runtime and speed are tower properties, so they are not per-plant any more.
  it('keeps every preset well inside the duty-cycle cap', () => {
    for (const preset of BUILTIN_PRESETS) {
      const hours = runsPerDayToIntervalHours(preset.pump.runsPerDay);
      expect(dutyCycle(hours, TOWER_PUMP.runtimeMinutes)).toBeLessThanOrEqual(SAFETY.pump.maxDutyCycle);
    }
  });

  it('uses a speed above the stall threshold', () => {
    expect(TOWER_PUMP.speedPercent).toBeGreaterThanOrEqual(SAFETY.pump.speedPercent.min);
    expect(TOWER_PUMP.speedPercent).toBeLessThanOrEqual(SAFETY.pump.speedPercent.max);
  });

  it('converts runs per day into whole hours for every allowed value', () => {
    for (const runs of SAFETY.pump.runsPerDayAllowed) {
      const hours = runsPerDayToIntervalHours(runs);
      expect(Number.isInteger(hours)).toBe(true);
      expect(SAFETY.pump.intervalHoursAllowed).toContain(hours);
    }
  });
});

describe('clampToSafety', () => {
  it('snaps a frequency that does not divide 24 to the nearest allowed value', () => {
    const p = basil();
    p.pump.runsPerDay = 5;
    const { preset, warnings } = clampToSafety(p);
    expect(preset.pump.runsPerDay).toBe(4);
    expect(warnings.join(' ')).toContain('divide 24');
  });

  it('widens a pH range that is too narrow', () => {
    const p = basil();
    p.ph.targetMin = 6;
    p.ph.targetMax = 6.0;
    const { preset } = clampToSafety(p);
    expect(preset.ph.targetMax - preset.ph.targetMin).toBeGreaterThanOrEqual(SAFETY.ph.minSpan);
  });

  it('always produces something that passes the full schema', () => {
    const hostile: P = {
      ...basil(),
      pump: { runsPerDay: 5 },
      waterTempC: { min: 34, max: 35 },
      ph: { targetMin: 8, targetMax: 8, checkIntervalDays: 14 },
      nutrients: {
        type: 'Balanced herb feed',
        strengthMultiplier: 1.5,
        scheduleDays: 28,
        guidance: 'Feed sparingly.',
      },
    };
    const { preset, warnings } = clampToSafety(hostile);
    expect(Preset.safeParse(preset).success).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns for every change it makes, and stays silent when it makes none', () => {
    expect(clampToSafety(basil()).warnings).toEqual([]);
  });

  it('does not mutate its input', () => {
    const p = basil();
    p.pump.runsPerDay = 5;
    const snapshot = structuredClone(p);
    clampToSafety(p);
    expect(p).toEqual(snapshot);
  });
});
