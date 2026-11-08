// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918] The coarse last-use stamp of an authorized AI assistant, on a real
 * engine: a real `AuthManager` over a real ObjectQL engine on a real SQL
 * driver (better-sqlite3, the `sys_oauth_consent` table created by schema
 * sync, so the `last_used_at` column is the one the platform object declares),
 * tokens minted by the real jwt plugin and verified by the real
 * `verifyMcpAccessToken` and recorded by `recordMcpAccessTokenUse` (#31211),
 * consents written by better-auth's own adapter.
 *
 * What is pinned:
 *
 *  - COARSE: however many verified calls arrive in one clock hour, the consent
 *    is written once, with the start of that hour; the next hour writes once
 *    more; a second process on the same store reads once and writes nothing;
 *  - the stamp lands on the consent the token was minted under, by its
 *    organization claim;
 *  - NOT CLIENT-CONTROLLABLE: the provider's own update-consent door strips a
 *    last-use member from its body, and a token that does not verify, or
 *    names no `azp` client, stamps nothing;
 *  - a failing store never fails the MCP call, and each distinct failure is
 *    reported once; a consent withdrawn between the stamp's read and its
 *    write is no failure, so it cannot spend the report a real outage needs.
 *
 * The access rules of the two reads are pinned on the real plugin in
 * `authorized-clients-read.real-plugin.test.ts`.
 */

import { describe, it, expect, afterEach, beforeEach, afterAll, vi } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager, OAUTH_ORGANIZATION_CLAIM } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { authorizedClientsDepsFor, runAdminAuthorizedClientsRead } from './authorized-clients-read.js';
import { inviteForAudienceGate } from './audience-gate-test-support.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit.js';

const BASE = 'http://localhost:3000';
const AUTH_BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-30918';
const SYS = { context: { isSystem: true } } as const;
const USER = 'usr_30918';
const CLIENT = 'client_30918';
const OTHER_CLIENT = 'client_30918_other';
const ORG_A = 'org_a_30918';
const ORG_B = 'org_b_30918';

const HOUR_10 = Date.parse('2026-11-06T10:00:00.000Z');
const HOUR_11 = Date.parse('2026-11-06T11:00:00.000Z');
const MINUTE = 60_000;

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};
const engines: ObjectQL[] = [];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  // Only the clock is faked: the stamp runs after the response on a real
  // `setImmediate`, and the SQL driver keeps its own timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOUR_10 + 17 * MINUTE);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

/** Let every after-response task scheduled so far run to the end. */
const drain = async () => {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** The stamp's own consent read: the one query that selects `last_used_at` by client and user. */
function isStampRead(query: unknown): boolean {
  const q = query as { fields?: unknown; where?: Record<string, unknown> } | undefined;
  return Array.isArray(q?.fields) && q.fields.includes('last_used_at') && !!q.where && 'client_id' in q.where;
}

async function rig() {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  vi.spyOn((engine as any).logger, 'info').mockImplementation(() => undefined);

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const makeManager = () =>
    new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, logger } as never);
  const manager = makeManager();
  const api: any = await manager.getApi();

  // Every write of the consent table, and every read the STAMP makes of it
  // (the one that selects `last_used_at`), counted at the engine. The
  // verifier's own per-call consent read (#30879) goes through better-auth's
  // adapter and never selects the stamp, so it is not counted here.
  let consentWrites = 0;
  let consentReads = 0;
  const realUpdate = engine.update.bind(engine);
  const realFind = engine.find.bind(engine);
  vi.spyOn(engine, 'update').mockImplementation((async (object: string, ...rest: unknown[]) => {
    if (object === 'sys_oauth_consent') consentWrites += 1;
    return (realUpdate as any)(object, ...rest);
  }) as never);
  vi.spyOn(engine, 'find').mockImplementation((async (object: string, ...rest: unknown[]) => {
    if (object === 'sys_oauth_consent' && isStampRead(rest[0])) consentReads += 1;
    return (realFind as any)(object, ...rest);
  }) as never);

  /**
   * A token for this deployment's MCP resource, signed by the jwt plugin at
   * the current (fake) time, with the `iat` the provider mints into every
   * access token (the verifier's consent read compares it, #30879).
   */
  const mint = async (claims: Record<string, unknown> = {}): Promise<string> =>
    (await api.signJWT({
      body: {
        payload: {
          iat: Math.floor(Date.now() / 1000),
          sub: USER,
          azp: CLIENT,
          scope: 'data:read',
          iss: manager.getAuthIssuer(),
          aud: manager.getMcpResourceUrl(),
          ...claims,
        },
      },
    })).token;

  /** A consent, as the provider's consent door writes it: through better-auth's own adapter. */
  const consent = async (opts: { userId?: string; clientId?: string; referenceId?: string } = {}): Promise<string> => {
    const ctx = await manager.getAuthContext();
    const row = await ctx.adapter.create({
      model: 'oauthConsent',
      data: {
        clientId: opts.clientId ?? CLIENT,
        userId: opts.userId ?? USER,
        scopes: ['openid', 'data:read'],
        ...(opts.referenceId ? { referenceId: opts.referenceId } : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return String(row.id);
  };

  /** The stored stamp, read straight from the table. */
  const stampOf = async (consentId: string): Promise<string | null> => {
    const rows = (await realFind('sys_oauth_consent', { where: { id: consentId }, fields: ['id', 'last_used_at'] }, SYS)) as any[];
    expect(rows, `consent ${consentId} is gone`).toHaveLength(1);
    const value = rows[0].last_used_at;
    return value == null || value === '' ? null : new Date(value).toISOString();
  };

  /** The person withdraws a consent: the row is deleted, as `/oauth2/revoke`, the authorized-clients withdraw and better-auth's own `/oauth2/delete-consent` delete it. */
  const withdraw = async (consentId: string): Promise<void> => {
    const ctx = await manager.getAuthContext();
    await ctx.adapter.delete({ model: 'oauthConsent', where: [{ field: 'id', value: consentId }] });
  };

  return {
    engine,
    manager,
    withdraw,
    makeManager,
    api,
    logger,
    mint,
    consent,
    stampOf,
    writes: () => consentWrites,
    reads: () => consentReads,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * [#31211] One MCP call the door ADMITTED, as `resolve-execution-context.ts`
 * makes it: verify the token, then hand the very object the verifier answered
 * back to `recordMcpAccessTokenUse`. Verifying alone records nothing.
 */
async function admittedCall(manager: AuthManager, token: string) {
  const principal = await manager.verifyMcpAccessToken(token);
  if (principal) manager.recordMcpAccessTokenUse(principal);
  return principal;
}

describe('[#30918] the last-use stamp is coarse: one write per consent per hour', () => {
  it('many verified calls in one hour write once, with the hour\'s start; the next hour writes once more; the read answers it', async () => {
    const r = await rig();
    const id = await r.consent();
    await r.engine.insert('sys_user', { id: USER, email: 'mia@last-use.example.com', name: 'Mia' }, SYS);

    const token = await r.mint();
    for (let i = 0; i < 25; i++) {
      expect(await admittedCall(r.manager, token)).toMatchObject({ userId: USER, clientId: CLIENT });
    }
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
    await drain();
    expect(r.writes(), 'twenty-five calls in one hour').toBe(1);
    expect(r.reads(), 'one read per hour per consent in this process').toBe(1);

    // Later in the same hour: still the same stamp, no I/O at all.
    vi.setSystemTime(HOUR_10 + 59 * MINUTE);
    const late = await r.mint();
    for (let i = 0; i < 5; i++) await admittedCall(r.manager, late);
    await drain();
    expect(r.writes()).toBe(1);
    expect(r.reads()).toBe(1);
    expect(await r.stampOf(id)).toBe(iso(HOUR_10));

    // The next hour: one more write, with that hour's start.
    vi.setSystemTime(HOUR_11 + 2 * MINUTE);
    const next = await r.mint();
    for (let i = 0; i < 3; i++) await admittedCall(r.manager, next);
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_11)));
    await drain();
    expect(r.writes()).toBe(2);

    // And the read answers exactly that hour start.
    const answer = await runAdminAuthorizedClientsRead(authorizedClientsDepsFor(r.manager), {} as never, {
      queries: { userId: [USER] },
    });
    expect(answer.status).toBe(200);
    expect((answer.body as any).data.clients).toEqual([
      expect.objectContaining({ id, clientId: CLIENT, lastUsedAt: iso(HOUR_11) }),
    ]);
  }, 60_000);

  it('a second process on the same store reads once and writes nothing within an hour already stamped', async () => {
    const r = await rig();
    const id = await r.consent();
    const token = await r.mint();
    await admittedCall(r.manager, token);
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
    await drain();
    const [writes, reads] = [r.writes(), r.reads()];

    const second = r.makeManager();
    await second.getApi();
    for (let i = 0; i < 10; i++) expect(await admittedCall(second, token)).toMatchObject({ userId: USER });
    await drain();
    expect(r.writes(), 'the stored hour is current, so the second process writes nothing').toBe(writes);
    expect(r.reads(), 'and it reads once for the hour, not once per call').toBe(reads + 1);
  }, 60_000);

  it('the stamp lands on the consent the token was minted under, by its organization claim', async () => {
    const r = await rig();
    const inA = await r.consent({ referenceId: ORG_A });
    const inB = await r.consent({ referenceId: ORG_B });
    const inNone = await r.consent();
    const otherClient = await r.consent({ clientId: OTHER_CLIENT, referenceId: ORG_A });

    await admittedCall(r.manager, await r.mint({ [OAUTH_ORGANIZATION_CLAIM]: ORG_A }));
    await vi.waitFor(async () => expect(await r.stampOf(inA)).toBe(iso(HOUR_10)));
    await drain();
    expect(await r.stampOf(inB)).toBeNull();
    expect(await r.stampOf(inNone)).toBeNull();
    expect(await r.stampOf(otherClient)).toBeNull();

    await admittedCall(r.manager, await r.mint());
    await vi.waitFor(async () => expect(await r.stampOf(inNone)).toBe(iso(HOUR_10)));
    await drain();
    expect(await r.stampOf(inB)).toBeNull();
    expect(await r.stampOf(otherClient)).toBeNull();
  }, 60_000);
});

describe('[#31211] verifying is not admitting: only the verifier\'s own object, handed back once, is recorded', () => {
  it('a token that verifies but is never recorded (the door refused the call) stamps nothing', async () => {
    const r = await rig();
    const id = await r.consent();
    const token = await r.mint();
    for (let i = 0; i < 3; i++) {
      expect(await r.manager.verifyMcpAccessToken(token)).toMatchObject({ userId: USER, clientId: CLIENT });
    }
    await drain();
    expect(r.reads(), 'verification alone reads no stamp').toBe(0);
    expect(r.writes(), 'and writes none').toBe(0);
    expect(await r.stampOf(id)).toBeNull();

    // Control: the same token, admitted, stamps the hour.
    await admittedCall(r.manager, token);
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
    expect(r.writes()).toBe(1);
  }, 60_000);

  it('a hand-built principal, or a copy of a verified one, records nothing', async () => {
    const r = await rig();
    const id = await r.consent();
    const verified = await r.manager.verifyMcpAccessToken(await r.mint());
    expect(verified).toMatchObject({ userId: USER, clientId: CLIENT });
    r.manager.recordMcpAccessTokenUse({ userId: USER, scopes: ['data:read'], clientId: CLIENT });
    r.manager.recordMcpAccessTokenUse({ ...verified! });
    await drain();
    expect(r.reads()).toBe(0);
    expect(r.writes()).toBe(0);
    expect(await r.stampOf(id)).toBeNull();

    // Control: the verifier's own object stamps.
    r.manager.recordMcpAccessTokenUse(verified!);
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
  }, 60_000);

  it('one verified object is recorded once: handed back again in a later hour, it stamps nothing more', async () => {
    const r = await rig();
    const id = await r.consent();
    const verified = await r.manager.verifyMcpAccessToken(await r.mint());
    r.manager.recordMcpAccessTokenUse(verified!);
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
    await drain();
    expect(r.writes()).toBe(1);

    vi.setSystemTime(HOUR_11 + 2 * MINUTE);
    r.manager.recordMcpAccessTokenUse(verified!);
    await drain();
    expect(r.writes(), 'the same object again is not a second admitted call').toBe(1);
    expect(await r.stampOf(id)).toBe(iso(HOUR_10));
  }, 60_000);

  it('a principal no verifier answered never throws: the record is bookkeeping, never the call\'s failure', () => {
    const manager = new AuthManager({ secret: SECRET, baseUrl: BASE } as never);
    expect(() => manager.recordMcpAccessTokenUse({ userId: USER, scopes: [] })).not.toThrow();
    expect(() => manager.recordMcpAccessTokenUse(null as never)).not.toThrow();
  });
});

describe('[#30918] nothing a client sends reaches the stamp', () => {
  it('a token that does not verify, or names no azp client, stamps nothing', async () => {
    const r = await rig();
    const id = await r.consent();
    const control = await r.consent({ clientId: OTHER_CLIENT });

    // Wrong audience, a key this server never published, already expired, and
    // a client named only in `client_id` (the stamp reads `azp` alone).
    const wrongAudience = await r.mint({ aud: `${BASE}/not-the-mcp-resource` });
    const { privateKey } = await generateKeyPair('EdDSA');
    const now = Math.floor(Date.now() / 1000);
    const foreignKey = await new SignJWT({ scope: 'data:read', azp: CLIENT })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'kid-never-published-30918' })
      .setIssuer(r.manager.getAuthIssuer())
      .setAudience(r.manager.getMcpResourceUrl())
      .setSubject(USER)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(privateKey);
    const expired = await r.mint({ exp: now - 60 });
    const noAzp = await r.mint({ azp: undefined, client_id: CLIENT });

    expect(await admittedCall(r.manager, wrongAudience)).toBeNull();
    expect(await admittedCall(r.manager, foreignKey)).toBeNull();
    expect(await admittedCall(r.manager, expired)).toBeNull();
    expect(await admittedCall(r.manager, 'not.a.token')).toBeNull();
    // #30879 keys the verifier's consent read by `azp`, so a token without one
    // is refused before the stamp could see it.
    expect(await admittedCall(r.manager, noAzp), 'a client_id-only token is refused').toBeNull();

    // Positive control on the same process: a verified token for another
    // client stamps, so the stamp path is live while the five above did not.
    await admittedCall(r.manager, await r.mint({ azp: OTHER_CLIENT }));
    await vi.waitFor(async () => expect(await r.stampOf(control)).toBe(iso(HOUR_10)));
    await drain();
    expect(await r.stampOf(id)).toBeNull();
  }, 60_000);

  it('the provider\'s own update-consent door strips a last-use member from its body', async () => {
    const r = await rig();
    const email = 'nora@last-use.example.com';
    const password = 'S3cure!Passw0rd-last-use';
    await inviteForAudienceGate(r.manager, email);
    const signUp = await r.manager.handleRequest(
      new Request(`${BASE}${AUTH_BASE}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'Nora' }),
      }),
    );
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const userId = String(((await signUp.clone().json()) as any).user.id);
    const cookie = (signUp.headers.getSetCookie?.() ?? [signUp.headers.get('set-cookie') ?? ''])
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');

    const ctx = await r.manager.getAuthContext();
    await ctx.adapter.create({
      model: 'oauthClient',
      data: { clientId: CLIENT, name: 'Desk Assistant', scopes: ['openid', 'data:read'], redirectUris: ['http://localhost:56789/cb'] },
    });
    const id = await r.consent({ userId });

    const res = await r.manager.handleRequest(
      new Request(`${BASE}${AUTH_BASE}/oauth2/update-consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify({
          id,
          update: { scopes: ['openid'], lastUsedAt: '2001-01-01T00:00:00.000Z', last_used_at: '2001-01-01T00:00:00.000Z' },
          lastUsedAt: '2001-01-01T00:00:00.000Z',
          last_used_at: '2001-01-01T00:00:00.000Z',
        }),
      }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    // The door ran (the scopes moved) and the stamp did not.
    const rows = (await r.engine.find(
      'sys_oauth_consent',
      { where: { id }, fields: ['id', 'scopes', 'last_used_at'] },
      SYS,
    )) as any[];
    expect(JSON.parse(String(rows[0].scopes))).toEqual(['openid']);
    expect(await r.stampOf(id)).toBeNull();

    // The one writer: a verified call, with the server's hour.
    await admittedCall(r.manager, await r.mint({ sub: userId }));
    await vi.waitFor(async () => expect(await r.stampOf(id)).toBe(iso(HOUR_10)));
  }, 60_000);
});

describe('[#30918] a failing store', () => {
  it('never fails the MCP call, is reported once at error, and is retried next hour, not next call', async () => {
    const r = await rig();
    await r.consent();
    let attempts = 0;
    const realUpdate = (r.engine.update as any).getMockImplementation();
    vi.mocked(r.engine.update).mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_oauth_consent') {
        attempts += 1;
        throw new Error('no such column: last_used_at');
      }
      return realUpdate(object, ...rest);
    }) as never);

    for (const at of [HOUR_10 + 17 * MINUTE, HOUR_10 + 40 * MINUTE, HOUR_11 + 5 * MINUTE, HOUR_11 + 50 * MINUTE]) {
      vi.setSystemTime(at);
      const token = await r.mint();
      for (let i = 0; i < 4; i++) {
        expect(await admittedCall(r.manager, token), 'the verdict never waits on, or fails with, the stamp').toMatchObject({
          userId: USER,
          clientId: CLIENT,
        });
      }
      await drain();
    }
    expect(attempts, 'one attempt per hour, however many calls').toBe(2);
    const reports = r.logger.error.mock.calls.filter(([message]) => String(message).includes('last-use time'));
    expect(reports, 'the same failure is reported once per process').toHaveLength(1);
    expect(String(reports[0][0])).toContain('sys_oauth_consent.last_used_at');
    expect(reports[0][1]).toEqual({ error: 'no such column: last_used_at' });
  }, 60_000);

  it('reports each DISTINCT failure once, so an earlier failure never silences a later, different one', async () => {
    const r = await rig();
    await r.consent();
    const failures: Record<number, string> = {
      [HOUR_10]: 'SQLITE_BUSY: database is locked',
      [HOUR_11]: 'no such column: last_used_at',
      [HOUR_11 + 60 * MINUTE]: 'SQLITE_BUSY: database is locked',
    };
    let attempts = 0;
    const realUpdate = (r.engine.update as any).getMockImplementation();
    vi.mocked(r.engine.update).mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_oauth_consent') {
        attempts += 1;
        throw new Error(failures[Math.floor(Date.now() / (60 * MINUTE)) * 60 * MINUTE]);
      }
      return realUpdate(object, ...rest);
    }) as never);

    // Every call after the consent was granted (10:17), so the verifier admits each.
    for (const at of [HOUR_10 + 20 * MINUTE, HOUR_11 + 5 * MINUTE, HOUR_11 + 65 * MINUTE]) {
      vi.setSystemTime(at);
      await admittedCall(r.manager, await r.mint());
      await drain();
    }
    expect(attempts, 'one attempt in each of the three hours').toBe(3);
    const reports = r.logger.error.mock.calls.filter(([message]) => String(message).includes('last-use time'));
    expect(
      reports.map(([, meta]) => meta),
      'the locked store, then the missing column; the locked store again is not reported twice',
    ).toEqual([{ error: 'SQLITE_BUSY: database is locked' }, { error: 'no such column: last_used_at' }]);
  }, 60_000);

  it('a consent withdrawn between the stamp\'s read and its write is no failure: nothing is reported, and a later outage still is', async () => {
    const r = await rig();
    const withdrawn = await r.consent();
    // The race on the real engine: the stamp reads the consent, then the
    // person withdraws it (the row is deleted) before the stamp's write lands.
    let withdrawAfterNextRead = true;
    const realFind = (r.engine.find as any).getMockImplementation();
    vi.mocked(r.engine.find).mockImplementation((async (object: string, ...rest: unknown[]) => {
      const rows = await realFind(object, ...rest);
      if (object === 'sys_oauth_consent' && withdrawAfterNextRead && isStampRead(rest[0])) {
        withdrawAfterNextRead = false;
        await r.engine.delete('sys_oauth_consent', { where: { id: withdrawn }, ...SYS } as never);
      }
      return rows;
    }) as never);
    const realUpdate = (r.engine.update as any).getMockImplementation();
    let updateErrors: string[] = [];
    vi.mocked(r.engine.update).mockImplementation((async (object: string, ...rest: unknown[]) => {
      try {
        return await realUpdate(object, ...rest);
      } catch (error) {
        updateErrors.push(String((error as { code?: unknown }).code));
        throw error;
      }
    }) as never);

    await admittedCall(r.manager, await r.mint());
    await drain();
    expect(updateErrors, 'the write did land on a row that was gone').toEqual(['RECORD_NOT_FOUND']);
    const reportsOf = () => r.logger.error.mock.calls.filter(([message]) => String(message).includes('last-use time'));
    expect(reportsOf(), 'a withdrawn consent has nothing to stamp, so it is not reported').toHaveLength(0);

    // A later real outage, in the same process, is still reported.
    await r.consent();
    updateErrors = [];
    vi.mocked(r.engine.update).mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_oauth_consent') throw new Error('no such column: last_used_at');
      return realUpdate(object, ...rest);
    }) as never);
    vi.setSystemTime(HOUR_11 + 5 * MINUTE);
    await admittedCall(r.manager, await r.mint());
    await drain();
    expect(reportsOf().map(([, meta]) => meta)).toEqual([{ error: 'no such column: last_used_at' }]);
  }, 60_000);
});

describe('[#30918 × #30879] the stamp lands only on the consent that admitted the call', () => {
  it('a revoked consent stamps nothing; a consent granted again is not stamped by a token of the old grant', async () => {
    const r = await rig();
    const first = await r.consent();
    const oldToken = await r.mint();
    expect(await admittedCall(r.manager, oldToken)).toMatchObject({ userId: USER, clientId: CLIENT });
    await vi.waitFor(async () => expect(await r.stampOf(first)).toBe(iso(HOUR_10)));
    await drain();
    const writes = r.writes();

    // Withdrawn: the verifier refuses the token, so nothing is stamped, in
    // this hour or the next.
    await r.withdraw(first);
    vi.setSystemTime(HOUR_11 + 3 * MINUTE);
    expect(await admittedCall(r.manager, oldToken), 'a revoked consent refuses its token').toBeNull();
    await drain();
    expect(r.writes(), 'a revoked consent stamps nothing').toBe(writes);

    // Granted again: the old token belongs to the old grant and is refused;
    // the new consent stays unstamped until a token of ITS grant is used.
    vi.setSystemTime(HOUR_11 + 4 * MINUTE);
    const again = await r.consent();
    expect(await admittedCall(r.manager, oldToken), 'a token older than the consent is refused').toBeNull();
    await drain();
    expect(await r.stampOf(again)).toBeNull();
    expect(r.writes()).toBe(writes);

    vi.setSystemTime(HOUR_11 + 5 * MINUTE);
    expect(await admittedCall(r.manager, await r.mint())).toMatchObject({ userId: USER });
    await vi.waitFor(async () => expect(await r.stampOf(again)).toBe(iso(HOUR_11)));
  }, 60_000);

  it('a re-grant that lands between the verdict and the stamp is not stamped with the old token\'s use', async () => {
    const r = await rig();
    const first = await r.consent();
    const oldToken = await r.mint();
    let regranted: string | undefined;

    // The race on the real engine: the verdict admits the old token under its
    // consent; before the stamp (which runs after the response) reads, the
    // person revokes and grants again, two minutes later.
    let regrantBeforeStampRead = true;
    const realFind = (r.engine.find as any).getMockImplementation();
    vi.mocked(r.engine.find).mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_oauth_consent' && regrantBeforeStampRead && isStampRead(rest[0])) {
        regrantBeforeStampRead = false;
        await r.withdraw(first);
        vi.setSystemTime(HOUR_10 + 19 * MINUTE);
        regranted = await r.consent();
      }
      return realFind(object, ...rest);
    }) as never);

    expect(await admittedCall(r.manager, oldToken), 'the verdict admits the token under its consent').toMatchObject({
      userId: USER,
    });
    await drain();
    expect(regranted, 'the re-grant ran inside the stamp').toBeDefined();
    expect(r.writes(), 'the new consent is newer than the token, so it is not stamped').toBe(0);
    expect(await r.stampOf(regranted!)).toBeNull();
  }, 60_000);
});
