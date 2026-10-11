import type { PlanterView } from '../types';

/** Row model for the desired-versus-reported table. */
export interface ConfigRow {
  field: string;
  label: string;
  wanted: string;
  reported: string;
}

const onOff = (v: unknown) => (v === undefined ? '—' : v ? 'On' : 'Off');
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v)} %` : '—');
const hrs = (v: unknown) => (typeof v === 'number' ? `Every ${v} h` : '—');
const mins = (v: unknown) => (typeof v === 'number' ? `${v} min` : '—');

export function configRows(p: PlanterView): ConfigRow[] {
  return [
    { field: 'speedPercent', label: 'Pump speed', wanted: pct(p.desired.speedPercent), reported: pct(p.reported.speedPercent) },
    { field: 'intervalHours', label: 'Pump interval', wanted: hrs(p.desired.intervalHours), reported: hrs(p.reported.intervalHours) },
    { field: 'runtimeMinutes', label: 'Pump runtime', wanted: mins(p.desired.runtimeMinutes), reported: mins(p.reported.runtimeMinutes) },
    { field: 'pumpEnable', label: 'Pump enabled', wanted: onOff(p.desired.pumpEnable), reported: onOff(p.reported.pumpEnable) },
  ];
}

