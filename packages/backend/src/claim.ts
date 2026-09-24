import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { config } from './config';
import { db, recordEvent } from './db';

/**
 * Claim tokens. The device never holds one: it is a registry secret the backend
 * mints and prints, so esphome.yaml stays free of a secret and a token can be
 * revoked without a reflash. DESIGN.md §7 has the trade-offs.
 */

export const TOKEN_TTL_DAYS = 7;

export type ClaimOutcome = 'ready' | 'already_claimed' | 'expired' | 'unknown';

export const mintToken = (): string => randomBytes(32).toString('base64url');

export function createToken(planterId: string, now = Date.now()): string {
  const token = mintToken();
  db.prepare(
    'INSERT INTO claim_tokens (token, planter_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, NULL)',
  ).run(token, planterId, now, now + TOKEN_TTL_DAYS * 86_400_000);
  return token;
}

interface TokenRow {
  token: string;
  planter_id: string;
  expires_at: number;
  consumed_at: number | null;
}

/** Read-only: what the confirm screen shows before anyone taps Claim. */
export function inspectToken(planterId: string, token: string, now = Date.now()): ClaimOutcome {
  const row = db.prepare('SELECT * FROM claim_tokens WHERE token = ?').get(token) as
    | TokenRow
    | undefined;

  if (!row || row.planter_id !== planterId) return 'unknown';
  if (row.consumed_at !== null) return 'already_claimed';
  if (row.expires_at <= now) return 'expired';
  return 'ready';
}

/**
 * Consume a token. One statement, so two simultaneous scans cannot both win —
 * a read-then-write here would be a race worth having to explain.
 */
export function consumeToken(planterId: string, token: string, now = Date.now()): ClaimOutcome {
  const result = db
    .prepare(
      `UPDATE claim_tokens SET consumed_at = ?
        WHERE token = ? AND planter_id = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
    .run(now, token, planterId, now);

  if (result.changes === 1) {
    recordEvent(planterId, 'claimed', undefined, now);
    return 'ready';
  }
  // Nothing changed: work out why, so the UI can say something useful.
  return inspectToken(planterId, token, now);
}

/** Drop every live token for a planter. Used by --reclaim before minting a fresh one. */
export function revokeTokens(planterId: string): number {
  return db.prepare('DELETE FROM claim_tokens WHERE planter_id = ?').run(planterId).changes;
}

/**
 * The laptop's address on the current network. Looked up fresh every time
 * because a phone hotspot hands out a different one on most reconnects — which
 * is exactly why QR codes must be regenerated rather than printed once.
 */
export function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

export function claimUrl(planterId: string, token: string, host = lanAddress()): string {
  const url = new URL(`http://${host}:${config.webPort}/claim`);
  url.searchParams.set('d', planterId);
  url.searchParams.set('t', token);
  return url.toString();
}
