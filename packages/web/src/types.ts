/** Mirrors the backend PlanterView in packages/backend/src/registry.ts. */

export interface PlanterView {
  id: string;
  name: string;
  plantType: string | null;
  presetId: string | null;
  preset: { id: string; name: string; plantType: string } | null;
  claimed: boolean;
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
    lightLux?: number;
    waterOk?: boolean;
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
  alerts: { kind: string; severity: 'warning' | 'critical'; message: string }[];
}

