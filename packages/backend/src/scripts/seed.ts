import { parseArgs } from 'node:util';
import { db } from '../db';
import { hydrate, seedPresets } from '../registry';
import { seedHistory } from './seed-history';

/**
 * Seed plausible history so the charts are not empty.
 *
 *   pnpm seed
 *   pnpm seed --id planter-001 --hours 48
 *   pnpm seed --keep     # add to existing history rather than replacing it
 */

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    hours: { type: 'string' },
    keep: { type: 'boolean' },
  },
});

function main(): void {
  seedPresets();
  hydrate();

  const ids = values.id
    ? [values.id]
    : (db.prepare('SELECT id FROM planters ORDER BY id').all() as { id: string }[]).map((r) => r.id);

  if (ids.length === 0) {
    console.log('No planters to seed. Start the simulator or run pnpm provision first.');
    return;
  }

  const hours = Number(values.hours ?? 24);
  console.log(`Seeding ${hours}h of history:`);
  for (const id of ids) {
    const { readings, runs } = seedHistory(id, hours, !values.keep);
    console.log(`  ${id}: ${readings} readings, ${runs} pump runs`);
  }
  console.log('Done. The charts read straight from the database.');
}

try {
  main();
} finally {
  db.close();
}
