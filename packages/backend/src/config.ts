import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Anchored to the workspace root, not to cwd. pnpm --filter runs scripts inside
 * the package directory, so a relative path put the database and the QR codes
 * under packages/backend/ for some commands and the repo root for others.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Where the PWA is served. QR codes point at this, not at the API port. */
  webPort: Number(process.env.WEB_PORT ?? 5173),
  host: process.env.HOST ?? '0.0.0.0', // the phone reaches us over the hotspot
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data/planter.db'),
  qrDir: process.env.QR_DIR ?? resolve(repoRoot, 'qr'),
  /** Gates the simulator control endpoints. Off in anything resembling production. */
  simEnabled: process.env.SIM_ENABLED !== 'false',
  /** At most one row per planter per metric per this interval. */
  readingThrottleMs: 10_000,
  /** Readings older than this are pruned on startup. */
  readingRetentionDays: 7,
} as const;
