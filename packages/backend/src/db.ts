import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

/**
 * SQLite. Config lives as JSON blobs rather than
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
  planted_at    INTEGER,
  created_at    INTEGER NOT NULL
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

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a new column
 * never reaches a database that already exists. Adding them here keeps that
 * working without a migration framework: SQLite's ADD COLUMN is cheap, and
 * checking table_info first makes it safe to run on every start.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] added ${table}.${column}`);
}

addColumnIfMissing('planters', 'planted_at', 'INTEGER');
// The note belongs with the reading, not only in the event payload: the chart
// reads this table, and matching the two on an identical timestamp would be a
// coupling nobody could see.
addColumnIfMissing('ph_checkins', 'note', 'TEXT');

export type EventType =
  | 'pump_run'
  | 'preset_applied'
  | 'low_water'
  | 'offline'
  | 'online'
  | 'ph_checkin'
  | 'nutrients_added'
  | 'added'
  | 'note';

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
 * Throttled at the boundary, not in the caller, so a chatty device cannot
 * write a million rows overnight.
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

export function readingsBetween(planterId: string, metric: string, from: number, to: number) {
  return db
    .prepare('SELECT ts, value FROM readings WHERE planter_id = ? AND metric = ? AND ts BETWEEN ? AND ? ORDER BY ts')
    .all(planterId, metric, from, to) as { ts: number; value: number }[];
}

export function recentEvents(planterId: string, limit = 50, from?: number) {
  return db
    .prepare(
      `SELECT id, ts, type, payload FROM events
        WHERE planter_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?`,
    )
    .all(planterId, from ?? 0, limit) as {
    id: number;
    ts: number;
    type: string;
    payload: string | null;
  }[];
}
