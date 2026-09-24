import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';
import { BUILTIN_PRESETS, presetToDesired } from '@planter/shared';
import { claimUrl, createToken, lanAddress, revokeTokens } from '../claim';
import { config } from '../config';
import { db } from '../db';
import { hydrate, resolvePreset, seedPresets } from '../registry';
import { seedHistory } from './seed-history';

/**
 * Put the demo back to its starting position. Run it about ten minutes before
 * you go on, so "last seen" timestamps look fresh.
 *
 *   pnpm demo:reset
 *   pnpm demo:reset --host 192.168.1.42    # override the detected address
 *
 * Wipes history and claim state, re-mints a single-use token per planter,
 * regenerates the QR codes against today's address, and seeds 24 hours of
 * plausible readings so the charts are not empty.
 */

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    hours: { type: 'string' },
    /** Leave planters claimed, for a rehearsal that skips the scan. */
    keepClaims: { type: 'boolean' },
  },
});

const host = values.host ?? lanAddress();
const hours = Number(values.hours ?? 24);

/** Names and plants the demo opens with. A planter not listed is left alone. */
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


  if (values.keepClaims) {
    console.log('Leaving claim state alone (--keepClaims).');
  } else {
    console.log(`Re-minting claim codes for ${host}…`);
    mkdirSync(config.qrDir, { recursive: true });
    for (const { id } of planters) {
      db.prepare('UPDATE planters SET claimed_at = NULL WHERE id = ?').run(id);
      revokeTokens(id);
      const token = createToken(id);
      const url = claimUrl(id, token, host);
      await QRCode.toFile(`${config.qrDir}/${id}.png`, url, { width: 512, margin: 2 });
      console.log(`  ${config.qrDir}/${id}.png`);
    }
  }


  // The backend keeps planters in memory and would overwrite everything above
  // on the next MQTT message. Tell it to re-read.
  const notified = await notifyBackend();

  console.log('Setting the cast…');
  for (const role of CAST) {
    if (!planters.some((p) => p.id === role.id)) continue;
    const preset = resolvePreset(role.presetId);
    if (!preset) continue;

    if (notified) {
      // Through the API, not the database: applying a preset has to publish the
      // MQTT commands too. Writing desired state straight to SQLite left every
      // planter showing "Not confirmed", because nothing was ever sent.
      await call(`/api/planters/${role.id}`, 'PATCH', { name: role.name });
      await call(`/api/planters/${role.id}/preset`, 'POST', { presetId: preset.id });
    } else {
      db.prepare(
        'UPDATE planters SET name = ?, plant_type = ?, preset_id = ?, desired_json = ? WHERE id = ?',
      ).run(role.name, preset.plantType, preset.id, JSON.stringify(presetToDesired(preset)), role.id);
    }
    console.log(`  ${role.id}  ${role.name} (${preset.name})`);
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
  if (!values.keepClaims) {
    console.log(`Print qr/ and check the address is right: http://${host}:${config.webPort}`);
  }
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
