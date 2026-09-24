import type { Preset } from './preset';
import type { ReportedState } from './state';

/**
 * Alerts are derived, never stored: a pure function of reported state, the active
 * preset and the clock. Recomputed on every push, so there is nothing to go stale
 * and nothing to reconcile.
 */

export type AlertKind =
  | 'offline'
  | 'low_water'
  | 'pump_blocked'
  | 'water_temp_out_of_range'
  | 'light_low';

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
}

export interface AlertInput {
  online: boolean;
  reported: ReportedState;
  preset: Preset | null;
  /**
   * Peak lux over the last 24 hours, from the readings table.
   *
   * Light is judged over a day, not a moment — comparing the instantaneous
   * reading against the preset minimum would fire every single night. Leave it
   * undefined and the light alert is skipped rather than guessed at.
   */
  lightPeak24hLux?: number;
}

export function evaluateAlerts(input: AlertInput): Alert[] {
  const { online, reported, preset, lightPeak24hLux } = input;
  const alerts: Alert[] = [];

  if (!online) {
    alerts.push({
      kind: 'offline',
      severity: 'critical',
      message: 'This planter is offline. Check power and Wi-Fi.',
    });
    // Everything below reads stale telemetry, so stop here.
    return alerts;
  }

  if (reported.waterOk === false) {
    alerts.push({
      kind: 'low_water',
      severity: 'critical',
      message: 'Water is low. The pump will not run until the reservoir is topped up.',
    });
  }

  if (reported.pumpBlocked === true && reported.waterOk !== false) {
    alerts.push({
      kind: 'pump_blocked',
      severity: 'warning',
      message: 'The pump is blocked by the device interlock. Check that the pump is enabled.',
    });
  }

  if (preset && reported.waterTempC !== undefined) {
    const { min, max } = preset.waterTempC;
    if (reported.waterTempC < min || reported.waterTempC > max) {
      alerts.push({
        kind: 'water_temp_out_of_range',
        severity: 'warning',
        message: `Water is ${reported.waterTempC.toFixed(1)}°C, outside the ${min}–${max}°C range for ${preset.plantType}.`,
      });
    }
  }

  if (preset && lightPeak24hLux !== undefined && lightPeak24hLux < preset.light.minLux) {
    alerts.push({
      kind: 'light_low',
      severity: 'warning',
      message: `Light peaked at ${Math.round(lightPeak24hLux)} lux in the last day, below the ${preset.light.minLux} lux ${preset.plantType} wants. Move it somewhere brighter.`,
    });
  }

  return alerts;
}
