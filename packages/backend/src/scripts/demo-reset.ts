import { parseArgs } from 'node:util';
import { BUILTIN_PRESETS, presetToDesired } from '@planter/shared';
import { config } from '../config';
import { db } from '../db';
import { hydrate, resolvePreset, seedPresets } from '../registry';
import { seedEstablished } from './seed-established';

/**
 * Put the demo back to its starting position. Run it about ten minutes before
 * you go on, so "last seen" timestamps look fresh.
 *
 *   pnpm demo:reset               # the presentation cast
 *   pnpm demo:reset --days 42     # a longer history on the established planter
 *   pnpm demo:reset --blank       # nothing added anywhere, no history at all
 *
 * The cast is built around the three acts of the talk:
 *
 *   planter-003  added, three weeks of history  -- what a tended tower looks like
 *   planter-002  discovered, nothing recorded   -- onboarded live from scratch
 *   planter-001  the real board, left un-added  -- onboarded live once plugged in
 *
 * Everything else is cleared, so the dashboard opens with exactly one planter
 * on it and the rest waiting under Add planter.
 */

const { values } = parseArgs({
  options: {
    days: { type: 'string' },
    blank: { type: 'boolean' },
    /** Which planter gets the history. Must be one the simulator is running. */
    established: { type: 'string' },
  },
});

const days = Number(values.days ?? 21);
const ESTABLISHED = values.established ?? 'planter-003';
const ESTABLISHED_NAME = 'Kitchen windowsill';
const ESTABLISHED_PRESET = 'mint';

async function main(): Promise<void> {
  seedPresets();
  hydrate();

  const planters = db.prepare('SELECT id FROM planters ORDER BY id').all() as { id: string }[];
  if (planters.length === 0) {
    console.log('No planters yet. Start the simulator, or run pnpm provision first.');
    return;
  }

  console.log('Clearing history and taking every planter off the dashboard…');
  db.exec('DELETE FROM readings; DELETE FROM events; DELETE FROM ph_checkins;');
  for (const { id } of planters) {
    db.prepare(
      `UPDATE planters SET claimed_at = NULL, name = ?, plant_type = NULL, preset_id = NULL,
                           planted_at = NULL WHERE id = ?`,
    ).run(id, id);
  }

  // The backend keeps planters in memory and would overwrite everything above
  // on the next MQTT message. Tell it to re-read.
  const notified = await notifyBackend();

  if (values.blank) {
    console.log('\nReady. Dashboard is empty and nothing has any history (--blank).');
    return;
  }

  const preset = resolvePreset(ESTABLISHED_PRESET);
  if (!preset) throw new Error(`No ${ESTABLISHED_PRESET} preset`);

  if (!planters.some((p) => p.id === ESTABLISHED)) {
    console.log(`\n${ESTABLISHED} does not exist yet, so there is nothing to age.`);
    console.log('Start the simulator first: SIM_START=2 SIM_COUNT=2 pnpm dev:sim');
    return;
  }

  console.log(`Adding ${ESTABLISHED} as "${ESTABLISHED_NAME}" (${preset.name})…`);
  if (notified) {
    // Through the API, not the database: adding has to publish the pump
    // settings to the device as well as storing them.
    await call(`/api/planters/${ESTABLISHED}/add`, 'POST', {
      name: ESTABLISHED_NAME,
      presetId: preset.id,
    });
  } else {
    db.prepare(
      `UPDATE planters SET name = ?, plant_type = ?, preset_id = ?, desired_json = ?,
                           claimed_at = ? WHERE id = ?`,
    ).run(
      ESTABLISHED_NAME,
      preset.plantType,
      preset.id,
      JSON.stringify(presetToDesired(preset)),
      Date.now(),
      ESTABLISHED,
    );
  }

  console.log(`Seeding ${days} days of history…`);
  const r = seedEstablished(ESTABLISHED, preset, days);
  console.log(
    `  ${r.readings} readings, ${r.runs} pump runs, ${r.phChecks} pH checks, ` +
      `${r.feeds} feeds, ${r.notes} notes`,
  );

  // Seeding wrote straight to SQLite, so the in-memory copy is stale.
  await notifyBackend();

  // The planted date goes through the API, not SQL: the backend rewrites the
  // planter row on every MQTT message, and the simulator publishes constantly,
  // so a direct UPDATE is overwritten before anyone sees it.
  const dated = notified
    ? await call(`/api/planters/${ESTABLISHED}`, 'PATCH', { plantedAt: r.plantedAt })
    : (db.prepare('UPDATE planters SET planted_at = ? WHERE id = ?').run(r.plantedAt, ESTABLISHED),
      true);
  if (!dated) console.log('  (could not set the planted date)');

  console.log(
    notified
      ? '\nReady. The app has already picked this up over SSE.'
      : '\nReady, but the backend is not running — start it before the demo.',
  );
  console.log(`  on the dashboard : ${ESTABLISHED} — ${ESTABLISHED_NAME}, ${days} days of history`);
  console.log('  under Add planter: everything else, including the real board when it connects');
  console.log(`Built-in presets available: ${BUILTIN_PRESETS.length}`);
}

const base = `http://127.0.0.1:${config.port}`;

async function call(path: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      // Only declare JSON when there is a body: Fastify rejects a POST that
      // claims application/json and sends nothing (FST_ERR_CTP_EMPTY_JSON_BODY).
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const notifyBackend = (): Promise<boolean> => call('/api/admin/reload', 'POST');

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => db.close());
