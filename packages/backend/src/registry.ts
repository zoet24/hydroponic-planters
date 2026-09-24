import {
  BUILTIN_PRESETS,
  DesiredState,
  estimateFlowLpm,
  evaluateAlerts,
  findBuiltinPreset,
  isSyncStale,
  pendingFields,
  ReportedState,
  type Alert,
  type DesiredField,
  type Preset,
} from '@planter/shared';
import { db, peakLuxLast24h, recordEvent } from './db';

/**
 * The in-memory fleet. Reported state lives here and is rebuilt from retained
 * MQTT on every restart, so the database never has to be the source of truth for
 * something the broker already remembers.
 */

export interface PlanterView {
  id: string;
  name: string;
  plantType: string | null;
  presetId: string | null;
  preset: Preset | null;
  claimed: boolean;
  simulated: boolean;
  online: boolean;
  lastSeenAt: number | null;
  desired: DesiredState;
  reported: ReportedState;
  pending: DesiredField[];
  syncing: boolean;
  syncStale: boolean;
  flowEstimateLpm: number;
  alerts: Alert[];
}

interface PlanterRecord {
  id: string;
  name: string;
  plantType: string | null;
  presetId: string | null;
  desired: DesiredState;
  reported: ReportedState;
  online: boolean;
  lastSeenAt: number | null;
  claimedAt: number | null;
  desiredSetAt: number;
}

const DEFAULT_DESIRED: DesiredState = {
  pumpEnable: true,
  speedPercent: 70,
  intervalHours: 6,
  runtimeMinutes: 2,
};

const fleet = new Map<string, PlanterRecord>();
let simulatedIds = new Set<string>();

export const setSimulatedIds = (ids: string[]): void => {
  simulatedIds = new Set(ids);
};

/**
 * Look up a planter, falling back to SQLite for one we have not seen.
 *
 * `pnpm provision` runs in its own process and writes straight to the database,
 * so a planter created while the backend is running is absent from the in-memory
 * fleet until something reloads it. Without this, claiming a freshly provisioned
 * planter 404s even though its token is perfectly valid.
 */
export function getPlanter(id: string): PlanterRecord | undefined {
  const cached = fleet.get(id);
  if (cached) return cached;

  const row = db.prepare('SELECT * FROM planters WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;

  const record: PlanterRecord = {
    id,
    name: String(row.name),
    plantType: (row.plant_type as string | null) ?? null,
    presetId: (row.preset_id as string | null) ?? null,
    desired: DesiredState.catch(DEFAULT_DESIRED).parse(safeJson(row.desired_json)),
    reported: ReportedState.catch({}).parse(safeJson(row.reported_json)),
    online: false,
    lastSeenAt: (row.last_seen_at as number | null) ?? null,
    claimedAt: (row.claimed_at as number | null) ?? null,
    desiredSetAt: 0,
  };
  fleet.set(id, record);
  return record;
}
export const allPlanters = (): PlanterRecord[] => [...fleet.values()];

const upsert = db.prepare(`
  INSERT INTO planters (id, name, plant_type, preset_id, desired_json, reported_json, online, last_seen_at, claimed_at, created_at)
  VALUES (@id, @name, @plantType, @presetId, @desired, @reported, @online, @lastSeenAt, @claimedAt, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = @name, plant_type = @plantType, preset_id = @presetId,
    desired_json = @desired, reported_json = @reported,
    online = @online, last_seen_at = @lastSeenAt, claimed_at = @claimedAt
`);

export function persist(record: PlanterRecord): void {
  upsert.run({
    id: record.id,
    name: record.name,
    plantType: record.plantType,
    presetId: record.presetId,
    desired: JSON.stringify(record.desired),
    reported: JSON.stringify(record.reported),
    online: record.online ? 1 : 0,
    lastSeenAt: record.lastSeenAt,
    claimedAt: record.claimedAt,
    createdAt: Date.now(),
  });
}

/** Rebuild the fleet from SQLite at startup. Retained MQTT fills in the rest. */
export function hydrate(): void {
  const rows = db.prepare('SELECT * FROM planters').all() as Record<string, unknown>[];
  for (const row of rows) {
    const id = String(row.id);
    fleet.set(id, {
      id,
      name: String(row.name),
      plantType: (row.plant_type as string | null) ?? null,
      presetId: (row.preset_id as string | null) ?? null,
      desired: DesiredState.catch(DEFAULT_DESIRED).parse(safeJson(row.desired_json)),
      reported: ReportedState.catch({}).parse(safeJson(row.reported_json)),
      online: false, // proven by a retained status message, never assumed
      lastSeenAt: (row.last_seen_at as number | null) ?? null,
      claimedAt: (row.claimed_at as number | null) ?? null,
      desiredSetAt: 0,
    });
  }
  console.log(`[registry] hydrated ${fleet.size} planter(s)`);
}

/**
 * A device we have never seen announces itself simply by publishing. We record
 * it unclaimed — the claim flow decides whether it shows up as yours.
 */
export function ensurePlanter(id: string): PlanterRecord {
  const existing = fleet.get(id);
  if (existing) return existing;

  const record: PlanterRecord = {
    id,
    name: id,
    plantType: null,
    presetId: null,
    desired: { ...DEFAULT_DESIRED },
    reported: {},
    online: false,
    lastSeenAt: null,
    claimedAt: null,
    desiredSetAt: 0,
  };
  fleet.set(id, record);
  persist(record);
  console.log(`[registry] discovered ${id}`);
  return record;
}

export function resolvePreset(presetId: string | null): Preset | null {
  if (!presetId) return null;
  const builtin = findBuiltinPreset(presetId);
  if (builtin) return builtin;
  const row = db.prepare('SELECT json FROM presets WHERE id = ?').get(presetId) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as Preset) : null;
}

export function toView(record: PlanterRecord, now = Date.now()): PlanterView {
  const preset = resolvePreset(record.presetId);
  const pending = pendingFields(record.desired, record.reported);

  return {
    id: record.id,
    name: record.name,
    plantType: record.plantType,
    presetId: record.presetId,
    preset,
    claimed: record.claimedAt !== null,
    simulated: simulatedIds.has(record.id),
    online: record.online,
    lastSeenAt: record.lastSeenAt,
    desired: record.desired,
    reported: record.reported,
    pending,
    syncing: pending.length > 0,
    syncStale: pending.length > 0 && isSyncStale(record.desiredSetAt, now),
    flowEstimateLpm: estimateFlowLpm(record.reported.pumpOn === true, record.reported.speedPercent ?? 0),
    alerts: evaluateAlerts({
      online: record.online,
      reported: record.reported,
      preset,
      lightPeak24hLux: peakLuxLast24h(record.id, now),
    }),
  };
}

/** Seed the preset table from the built-ins so foreign keys resolve. */
export function seedPresets(): void {
  const insert = db.prepare(`
    INSERT INTO presets (id, name, plant_type, source, json, created_at)
    VALUES (?, ?, ?, 'builtin', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json
  `);
  const now = Date.now();
  for (const p of BUILTIN_PRESETS) insert.run(p.id, p.name, p.plantType, JSON.stringify(p), now);
}

export function applyPreset(record: PlanterRecord, preset: Preset): void {
  record.presetId = preset.id;
  record.plantType = preset.plantType;
  recordEvent(record.id, 'preset_applied', { presetId: preset.id, name: preset.name });
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export type { PlanterRecord };
