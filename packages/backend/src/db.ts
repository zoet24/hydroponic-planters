import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

/**
 * SQLite, schema exactly as DESIGN.md §3. Config lives as JSON blobs rather than
 * columns because presets will change shape several times; zod validates on the
 * way in and out, so there are no migrations to write.
 */

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  plant_type TEXT NOT NULL,
  source     TEXT NOT NULL,
  json       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS planters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plant_type    TEXT,
  preset_id     TEXT REFERENCES presets(id),
  desired_json  TEXT NOT NULL,
  reported_json TEXT,
  online        INTEGER NOT NULL DEFAULT 0,
  last_seen_at  INTEGER,
  claimed_at    INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_tokens (
  token       TEXT PRIMARY KEY,
  planter_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS readings (
  planter_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  metric     TEXT NOT NULL,
  value      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS readings_lookup ON readings (planter_id, metric, ts);

CREATE TABLE IF NOT EXISTS ph_checkins (
  id         INTEGER PRIMARY KEY,
  planter_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  ph         REAL NOT NULL,
  status     TEXT NOT NULL,
  action     TEXT NOT NULL,
  advice     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  planter_id TEXT,
  ts         INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT
);
CREATE INDEX IF NOT EXISTS events_lookup ON events (planter_id, ts);
`);

export type EventType =
  | 'pump_run'
  | 'preset_applied'
  | 'low_water'
  | 'offline'
  | 'online'
  | 'ph_checkin'
  | 'nutrients_added'
  | 'claimed';

const insertEvent = db.prepare(
  'INSERT INTO events (planter_id, ts, type, payload) VALUES (?, ?, ?, ?)',
);

export function recordEvent(
  planterId: string | null,
  type: EventType,
  payload?: unknown,
  ts = Date.now(),
): void {
  insertEvent.run(planterId, ts, type, payload === undefined ? null : JSON.stringify(payload));
}

const insertReading = db.prepare(
  'INSERT INTO readings (planter_id, ts, metric, value) VALUES (?, ?, ?, ?)',
);

/**
 * Throttled at the boundary, not in the caller. The simulator at 60x would
 * otherwise write a million rows overnight.
 */
const lastWrite = new Map<string, number>();

export function recordReading(planterId: string, metric: string, value: number, ts = Date.now()): void {
  const key = `${planterId}:${metric}`;
  const previous = lastWrite.get(key) ?? 0;
  if (ts - previous < config.readingThrottleMs) return;
  lastWrite.set(key, ts);
  insertReading.run(planterId, ts, metric, value);
}

export function pruneOldReadings(): number {
  const cutoff = Date.now() - config.readingRetentionDays * 86_400_000;
  return db.prepare('DELETE FROM readings WHERE ts < ?').run(cutoff).changes;
}

/** Below this much history, we cannot tell a dark corner from a fresh database. */
const LIGHT_JUDGEMENT_MIN_SPAN_MS = 6 * 3_600_000;

/**
 * Peak lux over the last day, or undefined when there is not enough history to
 * judge. Returning a low peak from twenty minutes of dawn readings would fire a
 * "not enough light" alert on every fresh start, which is a lie about the plant.
 */
export function peakLuxLast24h(planterId: string, now = Date.now()): number | undefined {
  const row = db
    .prepare(
      `SELECT MAX(value) AS peak, MIN(ts) AS first, MAX(ts) AS last
         FROM readings WHERE planter_id = ? AND metric = 'light_lux' AND ts >= ?`,
    )
    .get(planterId, now - 86_400_000) as
    | { peak: number | null; first: number | null; last: number | null }
    | undefined;

  if (!row || row.peak === null || row.first === null || row.last === null) return undefined;
  if (row.last - row.first < LIGHT_JUDGEMENT_MIN_SPAN_MS) return undefined;
  return row.peak;
}

export function readingsBetween(planterId: string, metric: string, from: number, to: number) {
  return db
    .prepare('SELECT ts, value FROM readings WHERE planter_id = ? AND metric = ? AND ts BETWEEN ? AND ? ORDER BY ts')
    .all(planterId, metric, from, to) as { ts: number; value: number }[];
}

export function recentEvents(planterId: string, limit = 50) {
  return db
    .prepare('SELECT id, ts, type, payload FROM events WHERE planter_id = ? ORDER BY ts DESC LIMIT ?')
    .all(planterId, limit) as { id: number; ts: number; type: string; payload: string | null }[];
}
