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
import { db, recordEvent } from './db';
import { nutrientStatus } from '@planter/shared';

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
  added: boolean;
  /** When the grower says it was planted. Null until they set it. */
  plantedAt: number | null;
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
  /** Epoch ms, or null when there is no preset or nothing recorded yet. */
  phCheckDueAt: number | null;
  nutrientsDueAt: number | null;
  /** What was last recorded, independent of any preset. */
  lastPhCheckAt: number | null;
  lastPhValue: number | null;
  lastNutrientsAt: number | null;
  lastNoteAt: number | null;
  lastNoteText: string | null;
  noteCount: number;
  nutrientsStatus: 'ok' | 'due' | 'overdue' | null;
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
  addedAt: number | null;
  plantedAt: number | null;
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
 * fleet until something reloads it. Without this, adding a freshly provisioned
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
    addedAt: (row.claimed_at as number | null) ?? null,
    plantedAt: (row.planted_at as number | null) ?? null,
    desiredSetAt: 0,
  };
  fleet.set(id, record);
  return record;
}
export const allPlanters = (): PlanterRecord[] => [...fleet.values()];

const upsert = db.prepare(`
  -- claimed_at is the historical column name for what the app now calls
  -- "added". Kept as-is so an existing database needs no migration.
  INSERT INTO planters (id, name, plant_type, preset_id, desired_json, reported_json, online, last_seen_at, claimed_at, planted_at, created_at)
  VALUES (@id, @name, @plantType, @presetId, @desired, @reported, @online, @lastSeenAt, @addedAt, @plantedAt, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = @name, plant_type = @plantType, preset_id = @presetId,
    desired_json = @desired, reported_json = @reported,
    online = @online, last_seen_at = @lastSeenAt, claimed_at = @addedAt,
    planted_at = @plantedAt
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
    addedAt: record.addedAt,
    plantedAt: record.plantedAt,
    createdAt: Date.now(),
  });
}

/**
 * Re-read the stored fields from SQLite, keeping live telemetry as it is.
 *
 * Needed because scripts like `pnpm demo:reset` write straight to the database
 * while the backend is running. Without this the in-memory copy wins and
 * silently overwrites them on the next MQTT message, so the reset appears to do
 * nothing. Config comes from the database; `online` and `reported` stay in
 * memory, because the broker will not resend retained state on our behalf.
 */
export function reloadFromDb(): number {
  const rows = db.prepare('SELECT * FROM planters').all() as Record<string, unknown>[];
  for (const row of rows) {
    const id = String(row.id);
    const record = fleet.get(id);
    if (!record) {
      hydrateRow(row);
      continue;
    }
    record.name = String(row.name);
    record.plantType = (row.plant_type as string | null) ?? null;
    record.presetId = (row.preset_id as string | null) ?? null;
    record.addedAt = (row.claimed_at as number | null) ?? null;
    record.plantedAt = (row.planted_at as number | null) ?? null;
    record.desired = DesiredState.catch(DEFAULT_DESIRED).parse(safeJson(row.desired_json));
    record.desiredSetAt = Date.now();
  }
  return rows.length;
}

/** Rebuild the fleet from SQLite at startup. Retained MQTT fills in the rest. */
export function hydrate(): void {
  const rows = db.prepare('SELECT * FROM planters').all() as Record<string, unknown>[];
  for (const row of rows) hydrateRow(row);
  console.log(`[registry] hydrated ${fleet.size} planter(s)`);
}

function hydrateRow(row: Record<string, unknown>): void {
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
    addedAt: (row.claimed_at as number | null) ?? null,
    plantedAt: (row.planted_at as number | null) ?? null,
    desiredSetAt: 0,
  });
}

/**
 * A device we have never seen announces itself simply by publishing. We record
 * it un-added — the Add planter flow decides whether it shows on the dashboard.
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
    addedAt: null,
    plantedAt: null,
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
  const due = dueDates(record.id, preset, now);

  return {
    id: record.id,
    name: record.name,
    plantType: record.plantType,
    presetId: record.presetId,
    preset,
    added: record.addedAt !== null,
    plantedAt: record.plantedAt,
    simulated: simulatedIds.has(record.id),
    online: record.online,
    lastSeenAt: record.lastSeenAt,
    desired: record.desired,
    reported: record.reported,
    pending,
    syncing: pending.length > 0,
    syncStale: pending.length > 0 && isSyncStale(record.desiredSetAt, now),
    flowEstimateLpm: estimateFlowLpm(record.reported.pumpOn === true, record.reported.speedPercent ?? 0),
    ...due,
    alerts: evaluateAlerts({
      online: record.online,
      reported: record.reported,
      preset,
      ...due,
      now,
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

/**
 * When the next pH check and nutrient dose fall due. Both are anchored to the
 * last recorded one, per DESIGN.md — not to a fixed time of day.
 */
function dueDates(planterId: string, preset: Preset | null, now: number) {
  // Looked up whether or not there is a preset: "last fed 3 days ago" is a
  // fact about the planter, and the Live tiles show it before one is chosen.
  const lastPh = db
    .prepare('SELECT ts, ph FROM ph_checkins WHERE planter_id = ? ORDER BY ts DESC LIMIT 1')
    .get(planterId) as { ts: number; ph: number } | undefined;

  const lastNutrients = db
    .prepare("SELECT ts FROM events WHERE planter_id = ? AND type = 'nutrients_added' ORDER BY ts DESC LIMIT 1")
    .get(planterId) as { ts: number } | undefined;

  const lastNote = db
    .prepare("SELECT ts, payload FROM events WHERE planter_id = ? AND type = 'note' ORDER BY ts DESC LIMIT 1")
    .get(planterId) as { ts: number; payload: string | null } | undefined;

  const notes = db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE planter_id = ? AND type = 'note'")
    .get(planterId) as { n: number };

  const recorded = {
    lastPhCheckAt: lastPh?.ts ?? null,
    lastPhValue: lastPh?.ph ?? null,
    lastNutrientsAt: lastNutrients?.ts ?? null,
    lastNoteAt: lastNote?.ts ?? null,
    lastNoteText: noteTextOf(lastNote?.payload),
    noteCount: notes.n,
  };

  // Due dates need a preset to schedule from; the records above do not.
  if (!preset) {
    return { phCheckDueAt: null, nutrientsDueAt: null, nutrientsStatus: null, ...recorded };
  }

  const nutrients = nutrientStatus({
    lastAddedAt: lastNutrients?.ts ?? null,
    scheduleDays: preset.nutrients.scheduleDays,
    now,
  });

  return {
    phCheckDueAt: lastPh ? lastPh.ts + preset.ph.checkIntervalDays * 86_400_000 : now,
    nutrientsDueAt: nutrients.dueAt,
    nutrientsStatus: nutrients.status,
    ...recorded,
  };
}

/** The note's text out of its stored payload, tolerating anything malformed. */
function noteTextOf(payload: string | null | undefined): string | null {
  const parsed = safeJson(payload) as { text?: unknown } | undefined;
  return typeof parsed?.text === 'string' && parsed.text.trim() !== '' ? parsed.text : null;
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
