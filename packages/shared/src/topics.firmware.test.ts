import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deviceTopics, esphomeObjectId } from './topics';

/**
 * Cross-checks the firmware against the topic contract.
 *
 * The single biggest integration risk here is a mismatch between the entity
 * names in esphome.yaml and the topics the backend subscribes to — a rename in
 * the firmware would silently stop telemetry, with nothing failing loudly. This
 * reads the actual YAML rather than a copy of it, so the two cannot drift.
 */

const firmware = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../firmware/esphome.yaml'),
  'utf8',
);

/** Every `name: "..."` in the config, which is what ESPHome derives ids from. */
const entityNames = [...firmware.matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]!);

const t = deviceTopics('planter-001');

describe('firmware entity names match the topic contract', () => {
  it.each([
    ['Water Temperature', t.waterTemperature],
    ['Light Level', t.lightLevel],
    ['Water OK', t.waterOk],
    ['Pump Blocked', t.pumpBlocked],
    ['Pump Enable', t.pumpEnableState],
    ['Pump Interval Hours', t.intervalHoursState],
    ['Pump Runtime', t.runtimeMinutesState],
    ['Run Pump Now', t.runPumpNowCommand],
    ['Last Run Hour', t.lastRunHour],
    ['Next Scheduled Runs', t.nextScheduledRuns],
    ['Pump', t.pumpState],
  ])('"%s" is declared and lands on %s', (name, topic) => {
    expect(entityNames, `missing from esphome.yaml: ${name}`).toContain(name);
    expect(topic).toContain(`/${esphomeObjectId(name)}/`);
  });

  it('declares no entity whose name would produce an awkward object id', () => {
    for (const name of entityNames) {
      // The original "Pump Runtime (min)" became pump_runtime__min_.
      expect(esphomeObjectId(name), name).not.toMatch(/__|_$/);
    }
  });

  it('sets the topic prefix from a substitution rather than the node name', () => {
    expect(firmware).toMatch(/topic_prefix:\s*\$\{planter_id\}/);
    expect(firmware).toMatch(/planter_id:\s*planter-\d+/);
  });

  it('leaves the native API out, so the board cannot reboot every 15 minutes', () => {
    expect(firmware).not.toMatch(/^api:/m);
  });

  it('keeps the low-water interlock on both paths', () => {
    // Refuses to start...
    expect(firmware).toMatch(/binary_sensor\.is_on:\s*water_ok/);
    // ...and cuts a run already going.
    expect(firmware).toMatch(/on_release:/);
    expect(firmware).toMatch(/script\.stop:\s*run_pump/);
  });

  it('publishes the snapped interval back, so reported state cannot lie', () => {
    expect(firmware).toMatch(/id\(interval_input\)\.publish_state\(snapped\)/);
  });
});

describe('esphomeObjectId', () => {
  it.each([
    ['Water Temperature', 'water_temperature'],
    ['Pump Runtime (min)', 'pump_runtime__min_'],
    ['Water OK', 'water_ok'],
    ['Run Pump Now', 'run_pump_now'],
  ])('derives %p as %p', (name, expected) => expect(esphomeObjectId(name)).toBe(expected));
});
