import { describe, expect, it } from 'vitest';
import { evaluateAlerts, type AlertKind } from './alerts';
import { findBuiltinPreset } from './presets';

const preset = findBuiltinPreset('basil')!; // 18–26°C, 4000 lux
const kinds = (a: { kind: AlertKind }[]) => a.map((x) => x.kind);

describe('evaluateAlerts', () => {
  it('is quiet when everything is healthy', () => {
    const a = evaluateAlerts({
      online: true,
      reported: { waterOk: true, waterTempC: 21, pumpBlocked: false },
      preset,
      lightPeak24hLux: 6000,
    });
    expect(a).toEqual([]);
  });

  it('reports offline and nothing else, because the rest is stale', () => {
    const a = evaluateAlerts({
      online: false,
      reported: { waterOk: false, waterTempC: 40 },
      preset,
      lightPeak24hLux: 0,
    });
    expect(kinds(a)).toEqual(['offline']);
  });

  it('flags low water', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: false }, preset });
    expect(kinds(a)).toContain('low_water');
  });

  it('does not double up interlock and low water', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: false, pumpBlocked: true }, preset });
    expect(kinds(a)).toEqual(['low_water']);
  });

  it('flags the interlock when the water is fine but the pump is disabled', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: true, pumpBlocked: true }, preset });
    expect(kinds(a)).toContain('pump_blocked');
  });

  it.each([[14, 'cold'], [30, 'hot']])('flags water at %d°C (%s)', (temp) => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: true, waterTempC: temp }, preset });
    expect(kinds(a)).toContain('water_temp_out_of_range');
  });

  it('judges light over a day, not a moment', () => {
    // Midnight: instantaneous lux is 0, but the day peaked well above the minimum.
    const a = evaluateAlerts({
      online: true,
      reported: { waterOk: true, lightLux: 0 },
      preset,
      lightPeak24hLux: 8000,
    });
    expect(kinds(a)).not.toContain('light_low');
  });

  it('flags light only when the daily peak falls short', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: true }, preset, lightPeak24hLux: 900 });
    expect(kinds(a)).toContain('light_low');
  });

  it('skips the light alert rather than guessing when there is no history', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: true }, preset });
    expect(kinds(a)).not.toContain('light_low');
  });

  it('skips preset-dependent alerts when no preset is assigned', () => {
    const a = evaluateAlerts({ online: true, reported: { waterOk: true, waterTempC: 40 }, preset: null });
    expect(a).toEqual([]);
  });
});
