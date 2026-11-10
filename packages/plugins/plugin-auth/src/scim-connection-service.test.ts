// Unit cases for the SCIM credential liveness check that both the bearer
// verifier and the group-mapping door read (#30959 review nit N3): no stored
// row reaches an expired or falsy-active credential through the suites today.
// [#32120] Also the token hint the mint stores and the verifier's throttled
// last-use stamp, over an in-memory store whose every write is recorded.
import { describe, it, expect, vi } from 'vitest';
import {
  SCIM_BEARER_PREFIX,
  SCIM_CREDENTIAL_LAST_USED_STAMP_INTERVAL_MS,
  SCIM_CREDENTIAL_OBJECT,
  ScimCredentialLastUseStamper,
  digestScimBearerToken,
  mintScimConnectionCredential,
  scimBearerTokenHint,
  scimCredentialIsLive,
  verifyScimBearerToken,
} from './scim-connection-service.js';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');

describe('scimCredentialIsLive', () => {
  it.each([false, 0, null, undefined])('refuses a credential whose active is %s', (active) => {
    expect(scimCredentialIsLive({ active, expires_at: null }, NOW)).toBe(false);
  });
  it('accepts an active credential with no expiry', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: null }, NOW)).toBe(true);
    expect(scimCredentialIsLive({ active: 1 }, NOW)).toBe(true);
  });
  it('refuses a credential that expired in the past', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: '2026-11-08T11:59:59.999Z' }, NOW)).toBe(false);
  });
  it('refuses a credential that expires exactly now', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });
  it('accepts a credential that expires in the future, and refuses an unreadable expiry', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: '2026-11-08T12:00:00.001Z' }, NOW)).toBe(true);
    expect(scimCredentialIsLive({ active: true, expires_at: 'not a date' }, NOW)).toBe(false);
  });
});

// ── [#32120] token hint and the throttled last-use stamp ────────────────────

const SECRET_32120 = 'test-secret-at-least-32-chars-long-32120';

/** An in-memory credential store: one table, every write recorded. */
function memoryEngine() {
  const rows = new Map<string, Record<string, unknown>>();
  const updates: Array<Record<string, unknown>> = [];
  let next = 1;
  const engine = {
    rows,
    updates,
    failUpdatesWith: undefined as Error | undefined,
    async insert(_object: string, row: Record<string, unknown>) {
      const stored = { id: `cred_${next++}`, ...row };
      rows.set(String(stored.id), stored);
      return stored;
    },
    async findOne(_object: string, query: { where: Record<string, unknown> }) {
      for (const row of rows.values()) {
        if (Object.entries(query.where).every(([k, v]) => row[k] === v)) return { ...row };
      }
      return null;
    },
    update: vi.fn(async (object: string, data: Record<string, unknown>, options?: { context?: { isSystem?: boolean; actor?: string } }) => {
      if (engine.failUpdatesWith) throw engine.failUpdatesWith;
      updates.push({ object, data, options });
      const row = rows.get(String(data.id));
      if (row) Object.assign(row, data);
      return row;
    }),
  };
  return engine;
}

/** A stamper on a clock the test moves. */
function clockedStamper(startMs: number, onNewFailure?: (error: unknown, id: string) => void) {
  const clock = { now: startMs };
  return { clock, stamper: new ScimCredentialLastUseStamper({ now: () => clock.now, onNewFailure }) };
}

describe('[#32120] scimBearerTokenHint', () => {
  it('is the last four characters of the bearer, never its constant prefix', async () => {
    const engine = memoryEngine();
    const minted = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-hint' });
    expect(minted.token.startsWith(SCIM_BEARER_PREFIX)).toBe(true);
    expect(minted.tokenHint).toBe(minted.token.slice(-4));
    expect(minted.tokenHint).toHaveLength(4);
    expect(scimBearerTokenHint(minted.token)).toBe(minted.tokenHint);
    // Stored on the row beside the digest, and the row holds no bearer.
    const row = engine.rows.get(minted.credentialId)!;
    expect(row.token_hint).toBe(minted.tokenHint);
    expect(row.token_digest).toBe(digestScimBearerToken(SECRET_32120, minted.token));
    expect(JSON.stringify(row)).not.toContain(minted.token);
  });

  it('two mints for one connection carry different hints (with overwhelming probability)', async () => {
    const engine = memoryEngine();
    const hints = new Set<string>();
    for (let i = 0; i < 8; i++) {
      hints.add((await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-two' })).tokenHint);
    }
    expect(hints.size).toBeGreaterThan(1);
  });
});

describe('[#32120] verifyScimBearerToken stamps last_used_at on a successful verify only, at most once a minute', () => {
  const T0 = Date.parse('2026-11-10T10:00:00.000Z');

  it('a successful verify writes last_used_at as the system, attributed to the connection, with the server clock', async () => {
    const engine = memoryEngine();
    const { token, credentialId } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-use' });
    const { stamper } = clockedStamper(T0);
    const verified = await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper);
    expect(verified?.credentialId).toBe(credentialId);
    expect(engine.updates).toEqual([
      {
        object: SCIM_CREDENTIAL_OBJECT,
        data: { id: credentialId, last_used_at: new Date(T0).toISOString() },
        options: { context: { isSystem: true, actor: 'svc:scim:okta-use' } },
      },
    ]);
  });

  it('two verifies inside a minute write once; the first one past the minute writes again', async () => {
    const engine = memoryEngine();
    const { token } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-throttle' });
    const { clock, stamper } = clockedStamper(T0);
    await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper);
    clock.now = T0 + SCIM_CREDENTIAL_LAST_USED_STAMP_INTERVAL_MS - 1;
    await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper);
    expect(engine.update).toHaveBeenCalledTimes(1);
    clock.now = T0 + SCIM_CREDENTIAL_LAST_USED_STAMP_INTERVAL_MS;
    await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper);
    expect(engine.update).toHaveBeenCalledTimes(2);
    expect(engine.updates[1].data).toMatchObject({ last_used_at: new Date(clock.now).toISOString() });
  });

  it('the stored stamp throttles a second process too: a fresh stamper reading a stamp under a minute old writes nothing', async () => {
    const engine = memoryEngine();
    const { token } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-two-procs' });
    await verifyScimBearerToken(engine as never, SECRET_32120, token, clockedStamper(T0).stamper);
    await verifyScimBearerToken(engine as never, SECRET_32120, token, clockedStamper(T0 + 30_000).stamper);
    expect(engine.update).toHaveBeenCalledTimes(1);
  });

  it('a burst of concurrent verifies that all read the same unstamped row writes once', async () => {
    const engine = memoryEngine();
    const { token } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-burst' });
    const { stamper } = clockedStamper(T0);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verifyScimBearerToken(engine as never, SECRET_32120, token, stamper)),
    );
    expect(results.every((r) => r !== null)).toBe(true);
    expect(engine.update).toHaveBeenCalledTimes(1);
  });

  it('a failed verify writes nothing: an unknown bearer, a revoked credential, an expired one', async () => {
    const engine = memoryEngine();
    const live = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-refused' });
    const revoked = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-refused' });
    engine.rows.get(revoked.credentialId)!.active = false;
    const expired = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-refused' });
    engine.rows.get(expired.credentialId)!.expires_at = new Date(Date.now() - 1000).toISOString();
    const { stamper } = clockedStamper(T0);
    for (const token of [`${SCIM_BEARER_PREFIX}not-a-minted-bearer`, revoked.token, expired.token, '']) {
      expect(await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper)).toBeNull();
    }
    expect(engine.update).not.toHaveBeenCalled();
    // And the live one still stamps, so the stamper was armed all along.
    expect(await verifyScimBearerToken(engine as never, SECRET_32120, live.token, stamper)).not.toBeNull();
    expect(engine.update).toHaveBeenCalledTimes(1);
  });

  it('a failed stamp never fails the verification, is reported once per distinct failure, and is retried next minute', async () => {
    const engine = memoryEngine();
    const { token, credentialId } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-fail' });
    const reports: Array<[string, string]> = [];
    const { clock, stamper } = clockedStamper(T0, (error, id) => reports.push([(error as Error).message, id]));
    engine.failUpdatesWith = new Error('store unavailable');
    const first = await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper);
    expect(first?.credentialId).toBe(credentialId);
    // Same minute: the claim holds, so no second attempt and no second report.
    clock.now = T0 + 10_000;
    expect(await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper)).not.toBeNull();
    expect(engine.update).toHaveBeenCalledTimes(1);
    // Next minute: retried; the same failure is not reported again.
    clock.now = T0 + SCIM_CREDENTIAL_LAST_USED_STAMP_INTERVAL_MS;
    expect(await verifyScimBearerToken(engine as never, SECRET_32120, token, stamper)).not.toBeNull();
    expect(engine.update).toHaveBeenCalledTimes(2);
    expect(reports).toEqual([['store unavailable', credentialId]]);
    // The report names the row, never the bearer or its digest.
    expect(JSON.stringify(reports)).not.toContain(token);
    expect(JSON.stringify(reports)).not.toContain(digestScimBearerToken(SECRET_32120, token));
  });

  it('with no stamper the verifier writes nothing (the stamp is the wiring\'s, not a side effect of every caller)', async () => {
    const engine = memoryEngine();
    const { token } = await mintScimConnectionCredential(engine as never, SECRET_32120, { connectionId: 'okta-no-stamper' });
    expect(await verifyScimBearerToken(engine as never, SECRET_32120, token)).not.toBeNull();
    expect(engine.update).not.toHaveBeenCalled();
  });
});
