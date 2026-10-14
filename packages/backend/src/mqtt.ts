import mqtt, { type MqttClient } from 'mqtt';
import {
  AVAILABILITY,
  deviceTopics,
  numeric,
  onOff,
  parseStateTopic,
  PRESS,
  SUBSCRIPTIONS,
  type DesiredState,
} from '@planter/shared';
import { config } from './config';
import { recordEvent, recordReading } from './db';
import { ensurePlanter, persist, type PlanterRecord } from './registry';
import { markDirty } from './sse';

let client: MqttClient;

export function startMqtt(): MqttClient {
  client = mqtt.connect(config.mqttUrl, { clientId: `backend-${process.pid}`, clean: true });

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${config.mqttUrl}`);
    client.subscribe([...SUBSCRIPTIONS]);
  });

  client.on('error', (err) => console.error('[mqtt] error:', err.message));
  client.on('message', (topic, payload, packet) =>
    ingest(topic, payload.toString(), packet.retain),
  );

  return client;
}

/**
 * @param retained True when the broker is replaying stored state to a new
 *   subscriber, rather than the device having just said something. A live
 *   publish reaches existing subscribers with the flag clear even when the
 *   broker stores it, so this really does mean "history, not news".
 */
function ingest(topic: string, raw: string, retained = false): void {
  const parsed = parseStateTopic(topic);
  if (!parsed) return;

  const { deviceId, signal } = parsed;
  const record = ensurePlanter(deviceId);
  const now = Date.now();

  // Two kinds of message are not evidence the device was just seen. An offline
  // notice is the broker publishing the device's will, and a retained message
  // is the broker replaying what it stored, possibly hours ago -- on a backend
  // restart that made a planter which had been dark all morning report "last
  // seen just now". Keeping the previous value also gives the run close-out
  // below an honest timestamp.
  const offlineNotice = signal === 'status' && raw.trim() === AVAILABILITY.offline;
  const lastSeen = record.lastSeenAt;
  if (!offlineNotice && !retained) record.lastSeenAt = now;

  switch (signal) {
    case 'status': {
      const online = raw.trim() === AVAILABILITY.online;

      // Only a change is worth a timeline entry; a repeated birth is not.
      if (online !== record.online) {
        record.online = online;
        recordEvent(deviceId, online ? 'online' : 'offline', undefined, now);
      }

      // A device that has just come up has forgotten whatever the app set. The
      // fan in particular always boots at speed 0, so desired and reported can
      // never agree again on their own and the sync chip would stay amber for
      // the rest of the session. Re-asserting on the birth message makes the
      // app's stored intent survive a reboot.
      //
      // Keyed on receiving `online`, not on a transition to it. A device whose
      // offline was never observed -- an ungraceful exit, or a broker that
      // never delivered the will -- reconnects with `record.online` already
      // true. On a
      // transition check that is not a transition, nothing re-asserts, and the
      // two stay diverged with no way to self-heal. ESPHome publishes its birth
      // once per connection, so this costs no extra publishes in the normal case.
      //
      // This makes the app the source of truth: a value changed in the device's
      // own web_server UI is overwritten the next time it restarts.
      if (online) {
        record.desiredSetAt = now;
        publishDesired(record, record.desired);
      } else if (record.reported.pumpOn === true) {
        // The device vanished mid-run, so it never got to say "pump off".
        // Without closing the run here the retained ON sits until the next
        // boot, which then closes it at that moment: a power cut on the 5th
        // produced a single run 6866 minutes long. Closed at the last moment
        // we actually heard from it, and marked interrupted, because we do not
        // know when the pump truly stopped -- only when we lost sight of it.
        recordEvent(
          deviceId,
          'pump_run',
          { on: false, speedPercent: record.reported.speedPercent, interrupted: true },
          lastSeen ?? now,
        );
        record.reported.pumpOn = false;
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

