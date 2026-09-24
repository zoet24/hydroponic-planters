/**
 * The MQTT topic contract. Every topic string the backend and simulator use is
 * built here from the device id, so reconciling with the real firmware is a
 * one-file change.
 *
 * Layout is ESPHome's default:
 *   <topic_prefix>/<component>/<object_id>/state | /command
 *   <topic_prefix>/status                          availability, retained LWT
 *
 * Verify against a real board before trusting it — the spelling of the fan's
 * speed sub-topic varies by ESPHome version:
 *   mosquitto_sub -h localhost -v -t 'planter-001/#'
 */

/** Matches the ESPHome `topic_prefix`, e.g. planter-001. */
export const DEVICE_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const isDeviceId = (id: string): boolean => DEVICE_ID_RE.test(id);

export function deviceTopics(id: string) {
  return {
    status: `${id}/status`,

    // device -> app
    waterTemperature: `${id}/sensor/water_temperature/state`,
    lightLevel: `${id}/sensor/light_level/state`,
    waterOk: `${id}/binary_sensor/water_ok/state`,
    pumpBlocked: `${id}/binary_sensor/pump_blocked/state`,
    lastRunHour: `${id}/text_sensor/last_run_hour/state`,
    nextScheduledRuns: `${id}/text_sensor/next_scheduled_runs/state`,

    // both directions
    pumpState: `${id}/fan/pump/state`,
    pumpCommand: `${id}/fan/pump/command`,
    pumpSpeedState: `${id}/fan/pump/speed_level/state`,
    pumpSpeedCommand: `${id}/fan/pump/speed_level/command`,
    pumpEnableState: `${id}/switch/pump_enable/state`,
    pumpEnableCommand: `${id}/switch/pump_enable/command`,
    intervalHoursState: `${id}/number/pump_interval_hours/state`,
    intervalHoursCommand: `${id}/number/pump_interval_hours/command`,
    runtimeMinutesState: `${id}/number/pump_runtime/state`,
    runtimeMinutesCommand: `${id}/number/pump_runtime/command`,

    // app -> device, fire and forget
    runPumpNowCommand: `${id}/button/run_pump_now/command`,
  } as const;
}

export type DeviceTopics = ReturnType<typeof deviceTopics>;

/**
 * The hbridge fan also exposes `<id>/fan/pump/direction/command`. Running a
 * submersible pump backwards is never what we want, so nothing in this codebase
 * publishes it and it is deliberately absent from the map above.
 */

/** Everything the backend subscribes to. One handler, no per-device wiring. */
export const SUBSCRIPTIONS = [
  '+/status',
  '+/+/+/state',
  '+/+/+/+/state', // the fan's speed_level sits one level deeper
] as const;

/** Signals the app can receive. Command-only topics are not listed. */
export type InboundSignal =
  | 'status'
  | 'waterTemperature'
  | 'lightLevel'
  | 'waterOk'
  | 'pumpBlocked'
  | 'pumpState'
  | 'pumpSpeed'
  | 'pumpEnable'
  | 'intervalHours'
  | 'runtimeMinutes'
  | 'lastRunHour'
  | 'nextScheduledRuns';

const INBOUND_BY_SUFFIX = new Map<string, InboundSignal>([
  ['status', 'status'],
  ['sensor/water_temperature/state', 'waterTemperature'],
  ['sensor/light_level/state', 'lightLevel'],
  ['binary_sensor/water_ok/state', 'waterOk'],
  ['binary_sensor/pump_blocked/state', 'pumpBlocked'],
  ['fan/pump/state', 'pumpState'],
  ['fan/pump/speed_level/state', 'pumpSpeed'],
  ['switch/pump_enable/state', 'pumpEnable'],
  ['number/pump_interval_hours/state', 'intervalHours'],
  ['number/pump_runtime/state', 'runtimeMinutes'],
  ['text_sensor/last_run_hour/state', 'lastRunHour'],
  ['text_sensor/next_scheduled_runs/state', 'nextScheduledRuns'],
]);

export interface ParsedTopic {
  deviceId: string;
  signal: InboundSignal;
}

/** Returns null for anything we do not consume, including our own commands. */
export function parseStateTopic(topic: string): ParsedTopic | null {
  const slash = topic.indexOf('/');
  if (slash <= 0) return null;

  const deviceId = topic.slice(0, slash);
  if (!isDeviceId(deviceId)) return null;

  const signal = INBOUND_BY_SUFFIX.get(topic.slice(slash + 1));
  return signal ? { deviceId, signal } : null;
}

/**
 * How ESPHome turns an entity's `name:` into the object id that appears in its
 * MQTT topic: lower case, spaces to underscores, anything else that is not
 * alphanumeric, `-` or `_` replaced with `_`.
 *
 * This is why the firmware renames "Pump Runtime (min)" — the parentheses would
 * have produced `pump_runtime__min_`.
 */
export const esphomeObjectId = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '_');

/** ESPHome speaks ON/OFF. Decoding is tolerant; encoding is not. */
export const onOff = {
  encode: (value: boolean): string => (value ? 'ON' : 'OFF'),
  decode: (raw: string): boolean | null => {
    const v = raw.trim().toUpperCase();
    if (v === 'ON' || v === 'TRUE' || v === '1') return true;
    if (v === 'OFF' || v === 'FALSE' || v === '0') return false;
    return null;
  },
};

/** Numeric payloads arrive as strings. Reject anything that is not finite. */
export const numeric = {
  encode: (value: number): string => String(value),
  decode: (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  },
};

/** Availability payloads, matching ESPHome's birth and will messages. */
export const AVAILABILITY = { online: 'online', offline: 'offline' } as const;

/** The payload an ESPHome button expects. */
export const PRESS = 'PRESS';
