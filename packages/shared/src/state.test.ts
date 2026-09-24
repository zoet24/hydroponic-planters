import { describe, expect, it } from 'vitest';
import { findBuiltinPreset } from './presets';
import { DESIRED_FIELDS, isSyncing, pendingFields, presetToDesired, type ReportedState } from './state';

const basil = findBuiltinPreset('basil')!;
const desired = presetToDesired(basil);

describe('presetToDesired', () => {
  it('carries the pump settings across', () => {
    expect(desired).toEqual({ pumpEnable: true, speedPercent: 70, intervalHours: 4, runtimeMinutes: 3 });
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
    const r: ReportedState = { pumpEnable: true, speedPercent: 70, intervalHours: 4, runtimeMinutes: 3 };
    expect(pendingFields(desired, r)).toEqual([]);
    expect(isSyncing(desired, r)).toBe(false);
  });

  it('tolerates float noise from MQTT', () => {
    const r: ReportedState = { pumpEnable: true, speedPercent: 70.0000001, intervalHours: 4, runtimeMinutes: 3 };
    expect(pendingFields(desired, r)).toEqual([]);
  });

  it('does not treat a wrong value as confirmed', () => {
    const r: ReportedState = { pumpEnable: true, speedPercent: 65, intervalHours: 4, runtimeMinutes: 3 };
    expect(pendingFields(desired, r)).toEqual(['speedPercent']);
  });

  it('returns fields in a stable order', () => {
    expect(pendingFields(desired, {})).toEqual(pendingFields(desired, {}));
  });
});
