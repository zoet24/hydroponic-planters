import mqtt, { type MqttClient } from 'mqtt';
import {
  AVAILABILITY,
  deviceTopics,
  numeric,
  onOff,
  parseStateTopic,
  PRESS,
  SIM_TOPICS,
  SUBSCRIPTIONS,
  type DesiredState,
  type FaultKind,
} from '@planter/shared';
import { config } from './config';
import { recordEvent, recordReading } from './db';
import { ensurePlanter, persist, setSimulatedIds, type PlanterRecord } from './registry';
import { markDirty } from './sse';

let client: MqttClient;

export function startMqtt(): MqttClient {
  client = mqtt.connect(config.mqttUrl, { clientId: `backend-${process.pid}`, clean: true });

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${config.mqttUrl}`);
    client.subscribe([...SUBSCRIPTIONS, SIM_TOPICS.roster]);
  });

  client.on('error', (err) => console.error('[mqtt] error:', err.message));
  client.on('message', (topic, payload) => ingest(topic, payload.toString()));

  return client;
}

function ingest(topic: string, raw: string): void {
  if (topic === SIM_TOPICS.roster) {
    try {
      setSimulatedIds(JSON.parse(raw) as string[]);
    } catch {
      /* ignore a malformed roster */
    }
    return;
  }

  const parsed = parseStateTopic(topic);
  if (!parsed) return;

  const { deviceId, signal } = parsed;
  const record = ensurePlanter(deviceId);
  const now = Date.now();
  record.lastSeenAt = now;

  switch (signal) {
    case 'status': {
      const online = raw.trim() === AVAILABILITY.online;
      if (online !== record.online) {
        record.online = online;
        recordEvent(deviceId, online ? 'online' : 'offline', undefined, now);
        // A device that has just come up has forgotten whatever the app set.
        // The fan in particular always boots at speed 0, so desired and
        // reported can never agree again on their own and the sync chip would
        // stay amber for the rest of the session. Re-assert on the birth
        // message so stored intent survives a reboot -- including a reboot of
        // the backend, where `online` starts false and the retained status
        // counts as a transition.
        //
        // This makes the app the source of truth: a value changed in the
        // device's own web_server UI is overwritten the next time it restarts.
        if (online) {
          record.desiredSetAt = now;
          publishDesired(record, record.desired);
        }
      }
      break;
    }

    case 'waterTemperature': {
      const v = numeric.decode(raw);
      if (v === null) return;
      record.reported.waterTempC = v;
      recordReading(deviceId, 'water_temp_c', v, now);
      break;
    }

    case 'nutrientDoses': {
      const v = numeric.decode(raw);
      if (v === null) return;
      // A rising count means a dose was logged on the device. Only act on an
      // increase: the retained message replays on every reconnect, and a reboot
      // resets the counter, so both must re-baseline rather than record.
      const previous = record.reported.nutrientDoses;
      if (previous !== undefined && v > previous) {
        recordEvent(deviceId, 'nutrients_added', { source: 'device' }, now);
      }
      record.reported.nutrientDoses = v;
      break;
    }

    case 'waterOk': {
      const v = onOff.decode(raw);
      if (v === null) return;
      if (record.reported.waterOk === true && v === false) {
        recordEvent(deviceId, 'low_water', undefined, now);
      }
      record.reported.waterOk = v;
      break;
    }

    case 'pumpBlocked': {
      const v = onOff.decode(raw);
      if (v !== null) record.reported.pumpBlocked = v;
      break;
    }

    case 'pumpState': {
      const v = onOff.decode(raw);
      if (v === null) return;
      if (v !== record.reported.pumpOn) {
        recordEvent(deviceId, 'pump_run', { on: v, speedPercent: record.reported.speedPercent }, now);
      }
      record.reported.pumpOn = v;
      break;
    }

    case 'pumpSpeed': {
      const v = numeric.decode(raw);
      if (v !== null) record.reported.speedPercent = v;
      break;
    }

    case 'pumpEnable': {
      const v = onOff.decode(raw);
      if (v !== null) record.reported.pumpEnable = v;
      break;
    }

    case 'intervalHours': {
      const v = numeric.decode(raw);
      if (v !== null) record.reported.intervalHours = v;
      break;
    }

    case 'runtimeMinutes': {
      const v = numeric.decode(raw);
      if (v !== null) record.reported.runtimeMinutes = v;
      break;
    }

    case 'lastRunHour':
      record.reported.lastRunHour = raw;
      break;

    case 'nextScheduledRuns':
      record.reported.nextScheduledRuns = raw;
      break;
  }

  persist(record);
  markDirty(deviceId);
}

/** Publish only the fields that actually changed, so chips clear one by one. */
export function publishDesired(record: PlanterRecord, next: Partial<DesiredState>): void {
  const t = deviceTopics(record.id);
  const opts = { qos: 0 as const, retain: false };

  if (next.pumpEnable !== undefined) client.publish(t.pumpEnableCommand, onOff.encode(next.pumpEnable), opts);
  if (next.speedPercent !== undefined) client.publish(t.pumpSpeedCommand, numeric.encode(next.speedPercent), opts);
  if (next.intervalHours !== undefined) client.publish(t.intervalHoursCommand, numeric.encode(next.intervalHours), opts);
  if (next.runtimeMinutes !== undefined) client.publish(t.runtimeMinutesCommand, numeric.encode(next.runtimeMinutes), opts);
}

export function publishRunNow(planterId: string): void {
  client.publish(deviceTopics(planterId).runPumpNowCommand, PRESS, { qos: 0, retain: false });
}

/**
 * Stop a run already in progress.
 *
 * Turning the fan off directly, rather than pressing a dedicated firmware
 * button, so this works on firmware that is already flashed. The `run_pump`
 * script is left holding its delay, which is harmless: its only remaining action
 * is a `fan.turn_off` on a fan that is already off.
 */
export function publishPumpStop(planterId: string): void {
  client.publish(deviceTopics(planterId).pumpCommand, onOff.encode(false), {
    qos: 0,
    retain: false,
  });
}

export function publishFault(planterId: string, kind: FaultKind, on: boolean): void {
  client.publish(SIM_TOPICS.fault(planterId), JSON.stringify({ kind, on }), { qos: 0 });
}

export function publishTimeScale(scale: number): void {
  client.publish(SIM_TOPICS.timeScale, String(scale), { qos: 0 });
}
