import type { Alert } from '@planter/shared';

/** Mirrors the backend PlanterView in packages/backend/src/registry.ts. */

export interface PlanterView {
  id: string;
  name: string;
  plantType: string | null;
  presetId: string | null;
  preset: Preset | null;
  added: boolean;
  /** When the grower says it went in. Null until they set it. */
  plantedAt: number | null;
  simulated: boolean;
  online: boolean;
  lastSeenAt: number | null;
  desired: {
    pumpEnable: boolean;
    speedPercent: number;
    intervalHours: number;
    runtimeMinutes: number;
  };
  reported: {
    waterTempC?: number;
    waterOk?: boolean;
    nutrientDoses?: number;
    pumpBlocked?: boolean;
    pumpOn?: boolean;
    speedPercent?: number;
    pumpEnable?: boolean;
    intervalHours?: number;
    runtimeMinutes?: number;
    lastRunHour?: string;
    nextScheduledRuns?: string;
  };
  pending: string[];
  syncing: boolean;
  syncStale: boolean;
  flowEstimateLpm: number;
  alerts: Alert[];
  phCheckDueAt: number | null;
  nutrientsDueAt: number | null;
  lastPhCheckAt: number | null;
  lastPhValue: number | null;
  lastNutrientsAt: number | null;
  lastNoteAt: number | null;
  lastNoteText: string | null;
  noteCount: number;
  nutrientsStatus: 'ok' | 'due' | 'overdue' | null;
}

/** Mirrors the Preset schema in packages/shared/src/preset.ts. */
export interface Preset {
  id: string;
  name: string;
  plantType: string;
  description?: string;
  /** How often, only. Runtime and speed belong to the tower, not the plant. */
  pump: { runsPerDay: number };
  waterTempC: { min: number; max: number };
  ph: { targetMin: number; targetMax: number; checkIntervalDays: number };
  nutrients: { type: string; strengthMultiplier: number; scheduleDays: number; guidance: string };
}

