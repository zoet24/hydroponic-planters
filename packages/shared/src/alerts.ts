import { dueState } from './nutrients';
import type { Preset } from './preset';
import type { ReportedState } from './state';

/**
 * One alert list covering everything the app watches: connection, water level,
 * water temperature, pH and nutrients. Derived, never stored — a pure function
 * of reported state, the active preset and the clock, recomputed on every push,
 * so there is nothing to go stale and nothing to reconcile.
 *
 * There is deliberately no light alert. The tower has no light sensor.
 */

export type AlertKind =
  | 'offline'
  | 'low_water'
  | 'pump_blocked'
  | 'water_temp_out_of_range'
  | 'ph_check_due'
  | 'nutrients_due';

/** critical: the plant is at risk now. warning: act soon. info: a reminder. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
}

export interface AlertInput {
  online: boolean;
  reported: ReportedState;
  preset: Preset | null;
  /** Epoch ms, from the backend. Null when there is no preset to schedule from. */
  phCheckDueAt?: number | null;
  nutrientsDueAt?: number | null;
  now?: number;
}

export function evaluateAlerts(input: AlertInput): Alert[] {
  const { online, reported, preset, phCheckDueAt = null, nutrientsDueAt = null } = input;
  const now = input.now ?? Date.now();
  const alerts: Alert[] = [];

  if (!online) {
    alerts.push({
      kind: 'offline',
      severity: 'critical',
      message: 'This planter is offline. Check power and Wi-Fi.',
    });
    // Everything below reads telemetry that is no longer arriving, so stop here.
    return alerts;
  }

  if (reported.waterOk === false) {
    alerts.push({
      kind: 'low_water',
      severity: 'critical',
      message: 'Water is low. Top up the reservoir — the pump will not run until you do.',
    });
  }

  if (reported.pumpBlocked === true && reported.waterOk !== false) {
    alerts.push({
      kind: 'pump_blocked',
      severity: 'warning',
      message: 'The pump is switched off at the device. Turn it back on to resume watering.',
    });
  }

  if (preset && reported.waterTempC !== undefined) {
    const { min, max } = preset.waterTempC;
    const temp = reported.waterTempC;
    if (temp < min || temp > max) {
      // The tower cannot change its own water temperature, so the advice has to
      // be something the person can actually do.
      const direction = temp < min ? 'warmer' : 'cooler';
      alerts.push({
        kind: 'water_temp_out_of_range',
        severity: 'warning',
        message:
          `Water is ${temp.toFixed(1)} °C, outside the ${min}–${max} °C range for ` +
          `${preset.plantType}. Move the planter somewhere ${direction} — it cannot ` +
          `change its own water temperature.`,
      });
    }
  }

  const ph = dueState(phCheckDueAt, now);
  if (ph !== 'ok') {
    alerts.push({
      kind: 'ph_check_due',
      severity: ph === 'soon' ? 'info' : 'warning',
      message:
        ph === 'soon'
          ? 'A pH check is due soon. Test the reservoir with your pH pen.'
          : `A pH check is ${ph === 'overdue' ? 'overdue' : 'due'}. Test the reservoir with your pH pen.`,
    });
  }

  const nutrients = dueState(nutrientsDueAt, now);
  if (nutrients !== 'ok' && preset) {
    const strength = `${preset.nutrients.strengthMultiplier}× the label strength`;
    alerts.push({
      kind: 'nutrients_due',
      severity: nutrients === 'soon' ? 'info' : 'warning',
      message:
        `Nutrients are ${nutrients === 'soon' ? 'due soon' : nutrients === 'overdue' ? 'overdue' : 'due'} — ` +
        `${strength}. ${preset.nutrients.guidance}`,
    });
  }

  return alerts;
}

/** Highest severity present, for a single summary chip. */
export function worstSeverity(alerts: Alert[]): AlertSeverity | null {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a.severity === 'warning')) return 'warning';
  if (alerts.some((a) => a.severity === 'info')) return 'info';
  return null;
}
