import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';
import { isDeviceId } from '@planter/shared';
import { claimUrl, createToken, lanAddress, revokeTokens } from '../claim';
import { config } from '../config';
import { db } from '../db';
import { hydrate, seedPresets } from '../registry';

/**
 * Provisioning. Creates a planter, mints a single-use claim token, and writes a
 * QR code you print and stick on the tower.
 *
 *   pnpm provision --id planter-004 --name "Shelf 4"
 *   pnpm provision --reclaim planter-002     # fresh token for a rehearsal
 *   pnpm provision --qr                      # rewrite every QR for today's IP
 *   pnpm provision --list
 */

const QR_DIR = config.qrDir;

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    reclaim: { type: 'string' },
    qr: { type: 'boolean' },
    list: { type: 'boolean' },
    host: { type: 'string' },
  },
});

const host = values.host ?? lanAddress();

async function writeQr(planterId: string, token: string): Promise<string> {
  mkdirSync(QR_DIR, { recursive: true });
  const url = claimUrl(planterId, token, host);
  const path = `${QR_DIR}/${planterId}.png`;
  await QRCode.toFile(path, url, { width: 512, margin: 2 });
  console.log(`  ${path}\n    ${url}`);
  return url;
}

function upsertPlanter(id: string, name: string): void {
  db.prepare(
    `INSERT INTO planters (id, name, desired_json, online, created_at)
     VALUES (?, ?, '{"pumpEnable":true,"speedPercent":70,"intervalHours":6,"runtimeMinutes":2}', 0, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  ).run(id, name, Date.now());
}

async function main(): Promise<void> {
  seedPresets();
  hydrate();

  if (values.list) {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.claimed_at,
                (SELECT COUNT(*) FROM claim_tokens t
                  WHERE t.planter_id = p.id AND t.consumed_at IS NULL AND t.expires_at > ?) AS live
           FROM planters p ORDER BY p.id`,
      )
      .all(Date.now()) as { id: string; name: string; claimed_at: number | null; live: number }[];

    if (rows.length === 0) console.log('No planters yet.');
    for (const r of rows) {
      const state = r.claimed_at ? 'claimed' : 'unclaimed';
      console.log(`  ${r.id.padEnd(14)} ${state.padEnd(10)} ${r.live} live token(s)  ${r.name}`);
    }
    return;
  }

  if (values.qr) {
    const rows = db
      .prepare(
        `SELECT planter_id, token FROM claim_tokens
          WHERE consumed_at IS NULL AND expires_at > ? ORDER BY planter_id`,
      )
      .all(Date.now()) as { planter_id: string; token: string }[];

    if (rows.length === 0) {
      console.log('No live tokens. Run --id or --reclaim first.');
      return;
    }
    console.log(`Rewriting ${rows.length} QR code(s) for ${host}:`);
    for (const r of rows) await writeQr(r.planter_id, r.token);
    return;
  }

  const reclaim = values.reclaim;
  if (reclaim) {
    const exists = db.prepare('SELECT id FROM planters WHERE id = ?').get(reclaim);
    if (!exists) throw new Error(`No planter ${reclaim}. Create it with --id first.`);

    db.prepare('UPDATE planters SET claimed_at = NULL WHERE id = ?').run(reclaim);
    const revoked = revokeTokens(reclaim);
    const token = createToken(reclaim);
    console.log(`Reclaimed ${reclaim} (${revoked} old token(s) revoked):`);
    await writeQr(reclaim, token);
    return;
  }

  const id = values.id;
  if (!id) {
    console.log('Usage: pnpm provision --id <planter-00N> [--name "Kitchen basil"]');
    console.log('       pnpm provision --reclaim <id> | --qr | --list');
    process.exitCode = 1;
    return;
  }
  if (!isDeviceId(id)) {
    throw new Error(`"${id}" is not a valid device id. It must match the ESPHome topic_prefix.`);
  }

  upsertPlanter(id, values.name ?? id);
  const token = createToken(id);
  console.log(`Provisioned ${id}:`);
  await writeQr(id, token);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => db.close());
