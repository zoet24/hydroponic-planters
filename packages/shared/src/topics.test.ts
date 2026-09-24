import { describe, expect, it } from 'vitest';
import { deviceTopics, numeric, onOff, parseStateTopic, PRESS } from './topics';

describe('topic construction', () => {
  const t = deviceTopics('planter-001');

  it('matches the ESPHome layout from DESIGN.md', () => {
    expect(t.status).toBe('planter-001/status');
    expect(t.waterTemperature).toBe('planter-001/sensor/water_temperature/state');
    expect(t.waterOk).toBe('planter-001/binary_sensor/water_ok/state');
    expect(t.pumpSpeedCommand).toBe('planter-001/fan/pump/speed_level/command');
    expect(t.runtimeMinutesState).toBe('planter-001/number/pump_runtime/state');
    expect(t.runPumpNowCommand).toBe('planter-001/button/run_pump_now/command');
  });

  it('treats the pump as a fan, not a switch', () => {
    expect(t.pumpState).toContain('/fan/');
    expect(t.pumpState).not.toContain('/switch/');
  });

  it('exposes no direction topic, so nothing can run the pump backwards', () => {
    expect(Object.values(t).some((v) => v.includes('direction'))).toBe(false);
  });
});

describe('topic parsing', () => {
  it('round-trips every inbound topic it builds', () => {
    const t = deviceTopics('planter-002');
    const inbound = [t.status, t.waterTemperature, t.lightLevel, t.waterOk, t.pumpBlocked, t.pumpState, t.pumpSpeedState, t.pumpEnableState, t.intervalHoursState, t.runtimeMinutesState, t.lastRunHour, t.nextScheduledRuns];
    for (const topic of inbound) {
      expect(parseStateTopic(topic), topic).not.toBeNull();
      expect(parseStateTopic(topic)!.deviceId).toBe('planter-002');
    }
  });

  it('ignores our own command topics', () => {
    const t = deviceTopics('planter-001');
    expect(parseStateTopic(t.pumpSpeedCommand)).toBeNull();
    expect(parseStateTopic(t.runPumpNowCommand)).toBeNull();
  });

  it.each(['', 'nodevice', '/leading', 'PLANTER-001/status', 'planter-001/unknown/thing/state'])(
    'returns null for %p',
    (topic) => expect(parseStateTopic(topic)).toBeNull(),
  );
});

describe('payload codecs', () => {
  it('encodes booleans the way ESPHome expects', () => {
    expect(onOff.encode(true)).toBe('ON');
    expect(onOff.encode(false)).toBe('OFF');
  });

  it.each([['ON', true], ['on', true], ['1', true], ['OFF', false], ['false', false], [' ON ', true]])(
    'decodes %p',
    (raw, expected) => expect(onOff.decode(raw as string)).toBe(expected),
  );

  it.each(['', 'maybe', 'ONN'])('rejects %p rather than guessing', (raw) => {
    expect(onOff.decode(raw)).toBeNull();
  });

  it('decodes numbers and rejects junk', () => {
    expect(numeric.decode('21.4')).toBe(21.4);
    expect(numeric.decode('  70 ')).toBe(70);
    expect(numeric.decode('')).toBeNull();
    expect(numeric.decode('nan')).toBeNull();
    expect(numeric.decode('warm')).toBeNull();
  });

  it('uses PRESS for the button', () => expect(PRESS).toBe('PRESS'));
});
