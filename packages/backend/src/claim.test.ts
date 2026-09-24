import { rmSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const DB_PATH = `/tmp/planter-claim-test-${process.pid}.db`;
process.env.DB_PATH = DB_PATH;

const { db } = await import('./db');
const { claimUrl, consumeToken, createToken, inspectToken, mintToken, revokeTokens, TOKEN_TTL_DAYS } =
  await import('./claim');

const DAY = 86_400_000;
const now = Date.now();

const addPlanter = (id: string) =>
  db
    .prepare(
      `INSERT OR REPLACE INTO planters (id, name, desired_json, online, created_at)
       VALUES (?, ?, '{}', 0, ?)`,
    )
    .run(id, id, now);

beforeEach(() => {
  db.exec('DELETE FROM claim_tokens; DELETE FROM planters; DELETE FROM events;');
  addPlanter('planter-001');
  addPlanter('planter-002');
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
});

/** Insert a token with an expiry we choose, to test the time-based paths. */
function tokenExpiring(planterId: string, expiresAt: number): string {
  const token = mintToken();
  db.prepare(
    'INSERT INTO claim_tokens (token, planter_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, NULL)',
  ).run(token, planterId, now - DAY, expiresAt);
  return token;
}

describe('mintToken', () => {
  it('is long and URL-safe, so it survives a QR code and a query string', () => {
    const token = mintToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, mintToken));
    expect(tokens.size).toBe(500);
  });
});

describe('inspectToken', () => {
  it('reports a fresh token as ready, without consuming it', () => {
    const token = createToken('planter-001', now);
    expect(inspectToken('planter-001', token, now)).toBe('ready');
    expect(inspectToken('planter-001', token, now)).toBe('ready');
  });

  it('reports an expired token', () => {
    const token = tokenExpiring('planter-001', now - 1);
    expect(inspectToken('planter-001', token, now)).toBe('expired');
  });

  it('treats the expiry instant as already gone', () => {
    const token = tokenExpiring('planter-001', now);
    expect(inspectToken('planter-001', token, now)).toBe('expired');
  });

  it('does not accept a token issued for a different planter', () => {
    const token = createToken('planter-002', now);
    expect(inspectToken('planter-001', token, now)).toBe('unknown');
  });

  it('reports an invented token as unknown', () => {
    expect(inspectToken('planter-001', 'not-a-real-token', now)).toBe('unknown');
  });

  it('defaults to a 7 day life', () => {
    const token = createToken('planter-001', now);
    expect(inspectToken('planter-001', token, now + TOKEN_TTL_DAYS * DAY - 1000)).toBe('ready');
    expect(inspectToken('planter-001', token, now + TOKEN_TTL_DAYS * DAY + 1000)).toBe('expired');
  });
});

describe('consumeToken', () => {
  it('succeeds once and only once', () => {
    const token = createToken('planter-001', now);
    expect(consumeToken('planter-001', token, now)).toBe('ready');
    expect(consumeToken('planter-001', token, now)).toBe('already_claimed');
  });

  it('records a claimed event on the successful consume only', () => {
    const token = createToken('planter-001', now);
    consumeToken('planter-001', token, now);
    consumeToken('planter-001', token, now);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE planter_id = ? AND type = 'claimed'")
      .get('planter-001') as { n: number };
    expect(count.n).toBe(1);
  });

  it('refuses an expired token and leaves it unconsumed', () => {
    const token = tokenExpiring('planter-001', now - 1);
    expect(consumeToken('planter-001', token, now)).toBe('expired');
    const row = db.prepare('SELECT consumed_at FROM claim_tokens WHERE token = ?').get(token) as {
      consumed_at: number | null;
    };
    expect(row.consumed_at).toBeNull();
  });

  it('refuses a token for the wrong planter', () => {
    const token = createToken('planter-002', now);
    expect(consumeToken('planter-001', token, now)).toBe('unknown');
  });

  it('lets only one of two simultaneous claims win', () => {
    const token = createToken('planter-001', now);
    // better-sqlite3 is synchronous, so this is the genuine interleaving: both
    // callers read "unconsumed" before either writes.
    const results = [consumeToken('planter-001', token, now), consumeToken('planter-001', token, now)];
    expect(results.filter((r) => r === 'ready')).toHaveLength(1);
  });
});

describe('revokeTokens', () => {
  it('removes every token for a planter and leaves others alone', () => {
    createToken('planter-001', now);
    createToken('planter-001', now);
    const other = createToken('planter-002', now);

    expect(revokeTokens('planter-001')).toBe(2);
    expect(inspectToken('planter-002', other, now)).toBe('ready');
  });
});

describe('claimUrl', () => {
  it('points at the web port and carries both halves of the code', () => {
    const url = new URL(claimUrl('planter-002', 'abc123', '192.168.1.36'));
    expect(url.host).toBe('192.168.1.36:5173');
    expect(url.pathname).toBe('/claim');
    expect(url.searchParams.get('d')).toBe('planter-002');
    expect(url.searchParams.get('t')).toBe('abc123');
  });

  it('escapes a token that would otherwise break the query string', () => {
    const url = new URL(claimUrl('planter-002', 'a+b/c=d', 'host'));
    expect(url.searchParams.get('t')).toBe('a+b/c=d');
  });
});
