import { parseArgs } from 'node:util';
import { BUILTIN_PRESETS, presetToDesired } from '@planter/shared';
import { config } from '../config';
import { db } from '../db';
import { hydrate, resolvePreset, seedPresets } from '../registry';
import { seedHistory } from './seed-history';

/**
 * Put the demo back to its starting position. Run it about ten minutes before
 * you go on, so "last seen" timestamps look fresh.
 *
 *   pnpm demo:reset              # empty dashboard, ready to onboard live
 *   pnpm demo:reset --staged     # cast already added, to skip onboarding
 *   pnpm demo:reset --hours 48
 *
 * Wipes history, takes every planter back off the dashboard, and seeds plausible
 * readings so the charts are not empty the moment a planter is added.
 *
 * The default leaves the fleet un-added on purpose: the talk opens on an empty
 * dashboard and onboarding a planter is the first thing demonstrated. Use
 * --staged for a rehearsal that starts after that point.
 */

const { values } = parseArgs({
  options: {
    hours: { type: 'string' },
    /** Add the cast up front, for a rehearsal that skips onboarding. */
    staged: { type: 'boolean' },
  },
});

const hours = Number(values.hours ?? 24);

/** Names and plants the demo opens with, when --staged is passed. */
const CAST = [
  { id: 'planter-001', name: 'Kitchen basil', presetId: 'basil' },
  { id: 'planter-002', name: 'Windowsill mint', presetId: 'mint' },
  { id: 'planter-003', name: 'Lettuce rack', presetId: 'lettuce' },
] as const;

async function main(): Promise<void> {
  seedPresets();
  hydrate();

  const planters = db.prepare('SELECT id FROM planters ORDER BY id').all() as { id: string }[];
  if (planters.length === 0) {
    console.log('No planters yet. Start the simulator, or run pnpm provision first.');
    return;
  }

  console.log('Wiping history…');
  db.exec('DELETE FROM readings; DELETE FROM events; DELETE FROM ph_checkins;');

  // Everything comes off the dashboard. Name and preset are cleared too, so a
  // planter added live starts blank rather than wearing last rehearsal's name.
  console.log('Taking every planter off the dashboard…');
  for (const { id } of planters) {
    db.prepare(
      'UPDATE planters SET claimed_at = NULL, name = ?, plant_type = NULL, preset_id = NULL WHERE id = ?',
    ).run(id, id);
  }

  // The backend keeps planters in memory and would overwrite everything above
  // on the next MQTT message. Tell it to re-read.
  const notified = await notifyBackend();

  if (values.staged) {
    console.log('Adding the cast (--staged)…');
    for (const role of CAST) {
      if (!planters.some((p) => p.id === role.id)) continue;
      const preset = resolvePreset(role.presetId);
      if (!preset) continue;

      if (notified) {
        // Through the API, not the database: adding has to publish the MQTT
        // commands too. Writing desired state straight to SQLite left every
        // planter showing "Not confirmed", because nothing was ever sent.
        await call(`/api/planters/${role.id}/add`, 'POST', {
          name: role.name,
          presetId: preset.id,
        });
      } else {
        db.prepare(
          `UPDATE planters SET name = ?, plant_type = ?, preset_id = ?, desired_json = ?,
                               claimed_at = ? WHERE id = ?`,
        ).run(
          role.name,
          preset.plantType,
          preset.id,
          JSON.stringify(presetToDesired(preset)),
          Date.now(),
          role.id,
        );
      }
      console.log(`  ${role.id}  ${role.name} (${preset.name})`);
    }
  }

  console.log(`Seeding ${hours}h of history…`);
  for (const { id } of planters) {
    const { readings, runs } = seedHistory(id, hours);
    console.log(`  ${id}: ${readings} readings, ${runs} pump runs`);
  }

  console.log(
    notified
      ? '\nReady. The app has already picked this up over SSE.'
      : '\nReady, but the backend is not running — start it before the demo.',
  );
  console.log(
    values.staged
      ? 'The dashboard opens with the cast already on it.'
      : 'The dashboard opens empty. Add a planter from inside the app to begin.',
  );
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
