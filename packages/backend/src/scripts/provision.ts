import { parseArgs } from 'node:util';
import { isDeviceId } from '@planter/shared';
import { db } from '../db';
import { hydrate, seedPresets } from '../registry';

/**
 * Provisioning. Creates a planter row ahead of time.
 *
 * Mostly optional: the backend discovers any device that publishes to MQTT and
 * creates the row itself. This is for seeding one before it exists, and for
 * inspecting or resetting what the dashboard is showing.
 *
 *   pnpm provision --id planter-004 --name "Shelf 4"
 *   pnpm provision --list
 *   pnpm provision --unadd planter-002   # back to the Add planter list
 */

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    unadd: { type: 'string' },
    list: { type: 'boolean' },
  },
});

function upsertPlanter(id: string, name: string): void {
  db.prepare(
    `INSERT INTO planters (id, name, desired_json, online, created_at)
     VALUES (?, ?, '{"pumpEnable":true,"speedPercent":70,"intervalHours":6,"runtimeMinutes":2}', 0, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  ).run(id, name, Date.now());
}

function main(): void {
  seedPresets();
  hydrate();

  if (values.list) {
    // `claimed_at` is the historical column name for "added to the dashboard".
    const rows = db
      .prepare('SELECT id, name, claimed_at FROM planters ORDER BY id')
      .all() as { id: string; name: string; claimed_at: number | null }[];

    if (rows.length === 0) console.log('No planters yet.');
    for (const r of rows) {
      const state = r.claimed_at ? 'on dashboard' : 'not added';
      console.log(`  ${r.id.padEnd(14)} ${state.padEnd(14)} ${r.name}`);
    }
    return;
  }

  const unadd = values.unadd;
  if (unadd) {
    const exists = db.prepare('SELECT id FROM planters WHERE id = ?').get(unadd);
    if (!exists) throw new Error(`No planter ${unadd}. Create it with --id first.`);
    db.prepare('UPDATE planters SET claimed_at = NULL WHERE id = ?').run(unadd);
    console.log(`${unadd} is off the dashboard. It will reappear under Add planter.`);
    console.log('Restart the backend, or POST /api/admin/reload, for it to notice.');
    return;
  }

  const id = values.id;
  if (!id) {
    console.log('Usage: pnpm provision --id <planter-00N> [--name "Kitchen basil"]');
    console.log('       pnpm provision --list | --unadd <id>');
    process.exitCode = 1;
    return;
  }
  if (!isDeviceId(id)) {
    throw new Error(`"${id}" is not a valid device id. It must match the ESPHome topic_prefix.`);
  }

  upsertPlanter(id, values.name ?? id);
  console.log(`Provisioned ${id}. Add it to the dashboard from inside the app.`);
}

try {
  main();
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  db.close();
}
