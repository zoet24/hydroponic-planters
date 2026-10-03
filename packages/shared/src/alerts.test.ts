import { describe, expect, it } from 'vitest';
import { evaluateAlerts, worstSeverity, type AlertKind } from './alerts';
import { findBuiltinPreset } from './presets';

const preset = findBuiltinPreset('basil')!; // 18–26 °C, pH every 3 days, feed every 7
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 3, 12, 0, 0);

const kinds = (a: { kind: AlertKind }[]) => a.map((x) => x.kind);

/** Healthy by default, so each test states only what it is changing. */
const check = (over: Partial<Parameters<typeof evaluateAlerts>[0]> = {}) =>
  evaluateAlerts({
    online: true,
    reported: { waterOk: true, waterTempC: 21, pumpBlocked: false },
    preset,
    phCheckDueAt: now + 3 * DAY,
    nutrientsDueAt: now + 7 * DAY,
    now,
    ...over,
  });

describe('healthy', () => {
  it('says nothing at all', () => {
    expect(check()).toEqual([]);
  });
});

describe('connection', () => {
  it('reports offline and nothing else, because the rest is stale', () => {
    const a = check({
      online: false,
      reported: { waterOk: false, waterTempC: 40 },
      phCheckDueAt: now - 10 * DAY,
      nutrientsDueAt: now - 10 * DAY,
    });
    expect(kinds(a)).toEqual(['offline']);
  });
});

describe('water level', () => {
  it('flags low water as critical', () => {
    const a = check({ reported: { waterOk: false } });
    expect(a[0]!.kind).toBe('low_water');
    expect(a[0]!.severity).toBe('critical');
  });

  it('does not double up with the interlock', () => {
    const a = check({ reported: { waterOk: false, pumpBlocked: true } });
    expect(kinds(a)).toEqual(['low_water']);
  });

  it('flags the interlock when the water is fine but the pump is off', () => {
    const a = check({ reported: { waterOk: true, pumpBlocked: true } });
    expect(kinds(a)).toContain('pump_blocked');
  });
});

describe('water temperature', () => {
  it('says to move it somewhere warmer when too cold', () => {
    const a = check({ reported: { waterOk: true, waterTempC: 14 } });
    expect(a[0]!.kind).toBe('water_temp_out_of_range');
    expect(a[0]!.message).toContain('warmer');
  });

  it('says cooler when too warm', () => {
    const a = check({ reported: { waterOk: true, waterTempC: 30 } });
    expect(a[0]!.message).toContain('cooler');
  });

  it('never tells you to do something the tower could do itself', () => {
    const a = check({ reported: { waterOk: true, waterTempC: 30 } });
    expect(a[0]!.message).toContain('cannot');
  });

  it('is quiet at the edges of the range', () => {
    expect(check({ reported: { waterOk: true, waterTempC: 18 } })).toEqual([]);
    expect(check({ reported: { waterOk: true, waterTempC: 26 } })).toEqual([]);
  });

  it('cannot judge without a preset', () => {
    const a = check({ preset: null, reported: { waterOk: true, waterTempC: 40 } });
    expect(kinds(a)).not.toContain('water_temp_out_of_range');
  });
});

describe('pH and nutrients share the alert list', () => {
  it('nudges gently before either falls due', () => {
    const a = check({ phCheckDueAt: now + 6 * 3_600_000 });
    expect(a[0]!.kind).toBe('ph_check_due');
    expect(a[0]!.severity).toBe('info');
  });

  it('escalates once due', () => {
    const a = check({ phCheckDueAt: now - 1000 });
    expect(a[0]!.severity).toBe('warning');
  });

  it('carries the preset guidance with the nutrient reminder', () => {
    const a = check({ nutrientsDueAt: now - 1000 });
    const alert = a.find((x) => x.kind === 'nutrients_due')!;
    expect(alert.message).toContain(preset.nutrients.guidance);
    expect(alert.message).toContain('× the label strength');
  });

  it('says nothing about nutrients without a preset to schedule from', () => {
    const a = check({ preset: null, nutrientsDueAt: null });
    expect(kinds(a)).not.toContain('nutrients_due');
  });

  it('reports everything at once rather than one at a time', () => {
    const a = check({
      reported: { waterOk: false, waterTempC: 30 },
      phCheckDueAt: now - DAY,
      nutrientsDueAt: now - DAY,
    });
    expect(kinds(a)).toEqual([
      'low_water',
      'water_temp_out_of_range',
      'ph_check_due',
      'nutrients_due',
    ]);
  });
});

describe('no light alert exists', () => {
  it('has no light kind, because the tower has no light sensor', () => {
    const everything = check({
      online: false,
      reported: { waterOk: false, waterTempC: 40 },
      phCheckDueAt: now - 99 * DAY,
      nutrientsDueAt: now - 99 * DAY,
    });
    expect(JSON.stringify(everything)).not.toMatch(/light|lux/i);
  });
});

describe('worstSeverity', () => {
  it('picks the most serious present', () => {
    expect(worstSeverity(check({ reported: { waterOk: false } }))).toBe('critical');
    expect(worstSeverity(check({ reported: { waterOk: true, waterTempC: 30 } }))).toBe('warning');
    expect(worstSeverity(check({ phCheckDueAt: now + 3_600_000 }))).toBe('info');
    expect(worstSeverity([])).toBeNull();
  });
});
