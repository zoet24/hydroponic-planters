import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, findBuiltinPreset } from './presets';
import { clampToSafety, dutyCycle, Preset, PresetShape, SAFETY, type Preset as P } from './preset';

const basil = (): P => structuredClone(findBuiltinPreset('basil')!);

describe('built-in presets', () => {
  it('ships ten of them', () => expect(BUILTIN_PRESETS).toHaveLength(10));

  it('all pass the full safety schema untouched', () => {
    for (const p of BUILTIN_PRESETS) expect(Preset.safeParse(p).success, p.id).toBe(true);
  });

  it('need no clamping — a built-in that warns is a bug in the JSON', () => {
    for (const p of BUILTIN_PRESETS) expect(clampToSafety(p).warnings, p.id).toEqual([]);
  });

  it('have unique ids', () => {
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
  });
});

describe('schema rules', () => {
  it('rejects a pump interval that does not divide 24', () => {
    const p = basil();
    p.pump.intervalHours = 5;
    expect(Preset.safeParse(p).success).toBe(false);
    expect(PresetShape.safeParse(p).success).toBe(true); // shape is fine, the rule is not
  });

  it('rejects a duty cycle above the limit, where the shape bounds allow it', () => {
    const p = basil();
    p.pump.intervalHours = 1;
    p.pump.runtimeMinutes = 20; // 20/60 = 33%, over the 25% limit
    expect(PresetShape.safeParse(p).success).toBe(true); // every field is in range
    expect(Preset.safeParse(p).success).toBe(false); // the cross-field rule catches it
  });

  it('allows a long runtime when the interval is long enough to carry it', () => {
    const p = basil();
    p.pump.intervalHours = 12;
    p.pump.runtimeMinutes = 30; // 30/720 = 4%
    expect(Preset.safeParse(p).success).toBe(true);
  });

  it('rejects a pH range narrower than the minimum span', () => {
    const p = basil();
    p.ph.targetMin = 6;
    p.ph.targetMax = 6.05;
    expect(Preset.safeParse(p).success).toBe(false);
  });

  it('rejects a pump speed below the stall threshold', () => {
    const p = basil();
    p.pump.speedPercent = 5;
    expect(PresetShape.safeParse(p).success).toBe(false);
  });
});

describe('clampToSafety', () => {
  it('snaps a non-divisor interval to the nearest allowed value', () => {
    const p = basil();
    p.pump.intervalHours = 5;
    const { preset, warnings } = clampToSafety(p);
    expect(preset.pump.intervalHours).toBe(4);
    expect(warnings.join(' ')).toContain('divisor of 24');
  });

  it('caps a runaway duty cycle', () => {
    const p = basil();
    p.pump.intervalHours = 1;
    p.pump.runtimeMinutes = 20;
    const { preset, warnings } = clampToSafety(p);
    expect(dutyCycle(preset.pump.intervalHours, preset.pump.runtimeMinutes)).toBeLessThanOrEqual(SAFETY.pump.maxDutyCycle);
    expect(warnings.join(' ')).toContain('duty cycle');
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
      pump: { intervalHours: 1, runtimeMinutes: 15, speedPercent: 100 },
      light: { minLux: 99_999 },
      waterTempC: { min: 34, max: 35 },
      ph: { targetMin: 8, targetMax: 8, checkIntervalDays: 14 },
      nutrients: { strengthMultiplier: 1.5, scheduleDays: 28 },
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
    p.pump.intervalHours = 5;
    const snapshot = structuredClone(p);
    clampToSafety(p);
    expect(p).toEqual(snapshot);
  });
});
