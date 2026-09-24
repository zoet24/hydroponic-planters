/**
 * Simulator control channel. NOT part of the device contract — a real planter
 * neither publishes nor subscribes to any of this. It rides on MQTT only so the
 * backend can drive the simulator without a second transport.
 */

export const SIM_CONTROL_PREFIX = '$sim';

export const SIM_TOPICS = {
  /** Backend -> simulator: toggle a fault on one virtual planter. */
  fault: (deviceId: string) => `${SIM_CONTROL_PREFIX}/${deviceId}/fault`,
  faultWildcard: `${SIM_CONTROL_PREFIX}/+/fault`,
  /** Backend -> simulator: change how fast virtual time runs. */
  timeScale: `${SIM_CONTROL_PREFIX}/time-scale`,
  /** Simulator -> backend: which ids are simulated, retained. */
  roster: `${SIM_CONTROL_PREFIX}/roster`,
} as const;

export const FAULT_KINDS = ['lowWater', 'sensorDropout', 'offline'] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface FaultCommand {
  kind: FaultKind;
  on: boolean;
}

export const isFaultKind = (v: string): v is FaultKind =>
  (FAULT_KINDS as readonly string[]).includes(v);

/** Bounds on time acceleration. 1 is real time. */
export const TIME_SCALE = { min: 1, max: 3600, default: 1 } as const;
