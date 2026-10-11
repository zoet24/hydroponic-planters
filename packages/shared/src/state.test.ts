import { describe, expect, it } from 'vitest';
import { TOWER_PUMP } from './preset';
import { BUILTIN_PRESETS, findBuiltinPreset } from './presets';
import { DESIRED_FIELDS, DesiredState, isSyncing, pendingFields, presetToDesired, type ReportedState } from './state';

const basil = findBuiltinPreset('basil')!;
const desired = presetToDesired(basil);

describe('presetToDesired', () => {
  // Basil runs 6 times a day; the runtime and speed come from the tower, not
  // the plant, so every preset expands to the same two values.
  it('combines the plant frequency with the tower calibration', () => {
    expect(desired).toEqual({
      pumpEnable: true,
      speedPercent: TOWER_PUMP.speedPercent,
      intervalHours: 4,
      runtimeMinutes: TOWER_PUMP.runtimeMinutes,
    });
  });

  it('gives every built-in the same runtime and speed', () => {
    for (const preset of BUILTIN_PRESETS) {
      const d = presetToDesired(preset);
      expect(d.runtimeMinutes).toBe(TOWER_PUMP.runtimeMinutes);
      expect(d.speedPercent).toBe(TOWER_PUMP.speedPercent);
    }
  });
});

describe('DesiredState duty cycle', () => {
  // The rule moved here from Preset, which no longer carries a runtime.
  it('rejects a runtime that overworks the pump at that interval', () => {
    const bad = { ...desired, intervalHours: 1, runtimeMinutes: 20 }; // 33%
    expect(DesiredState.safeParse(bad).success).toBe(false);
  });

  it('allows a long runtime when the interval carries it', () => {
    const ok = { ...desired, intervalHours: 12, runtimeMinutes: 30 }; // 4%
    expect(DesiredState.safeParse(ok).success).toBe(true);
  });
});

describe('pendingFields', () => {
  it('lists everything when the device has said nothing', () => {
    expect(pendingFields(desired, {})).toEqual([...DESIRED_FIELDS]);
  });

  it('clears fields one at a time as they are confirmed', () => {
    const r: ReportedState = { pumpEnable: true };
    expect(pendingFields(desired, r)).toEqual(['speedPercent', 'intervalHours', 'runtimeMinutes']);
    r.speedPercent = 70;
    expect(pendingFields(desired, r)).toEqual(['intervalHours', 'runtimeMinutes']);
  });

  it('is empty once everything matches', () => {
    const r: ReportedState = { pumpEnable: true, speedPercent: 70, intervalHours: 4, runtimeMinutes: 2 };
    expect(pendingFields(desired, r)).toEqual([]);
    expect(isSyncing(desired, r)).toBe(false);
  });

  it('tolerates float noise from MQTT', () => {
    const r: ReportedState = { pumpEnable: true, speedPercent: 70.0000001, intervalHours: 4, runtimeMinutes: 2 };
    expect(pendingFields(desired, r)).toEqual([]);
  });

  it('does not treat a wrong value as confirmed', () => {
    const r: ReportedState = { pumpEnable: true, speedPercent: 65, intervalHours: 4, runtimeMinutes: 2 };
    expect(pendingFields(desired, r)).toEqual(['speedPercent']);
  });

  it('returns fields in a stable order', () => {
    expect(pendingFields(desired, {})).toEqual(pendingFields(desired, {}));
  });
});
