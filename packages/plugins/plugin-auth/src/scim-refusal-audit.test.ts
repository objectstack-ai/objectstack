// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31829] A SCIM request the door refuses hands ONE event to the `audit`
 * slot's `recordScimRefusal`, naming the connection — observed through
 * `AuthManager.handleRequest()` with a real bearer, on a real `ObjectQL` over
 * better-sqlite3 (the harness of `scim-transaction-scope.test.ts`).
 *
 * The slot is a recording double: the row itself is plugin-audit's
 * (`scim-refusal-audit.ts` there, pinned in its own suite), and plugin-auth
 * takes no dependency on that package. What this suite pins is the door's
 * half: which refusals reach the slot, what the event names, what it never
 * carries, and the bound.
 *
 * Measured on `main` before the fix (cfe35630): each refusal below answered
 * its SCIM error and handed the slot NOTHING, and wrote nothing to the engine.
 * Whether the bearer verified BEFORE the refusal is the vendor's order, also
 * measured: a duplicate create (409), an unknown user (404) and a refused
 * PATCH path or value (400) are answered after the bearer verified; a PATCH
 * whose body fails the vendor's schema (400) is refused BEFORE the bearer is
 * verified. [#32116] That row used to name no connection, exactly as a 401
 * does; it now names the connection a LIVE credential resolves to, read once
 * after the response by the verifier's own read-only lookup (block (6)).
 *
 *  (1) the four refusals of the card — 401 bad bearer, 409 duplicate create,
 *      400 malformed PATCH, 404 unknown user — and a 400 refused after the
 *      bearer verified: exactly one event each, with status, error type,
 *      resource, method and client address;
 *  (2) nothing secret: no bearer (or any part after its prefix), no digest,
 *      no attribute value, no resource id and no `detail` text in any event;
 *  (3) a burst over the per-connection cap is bounded, and the next row after
 *      the window carries the dropped count;
 *  (4) the answer is unchanged when the slot is absent, lacks the member, or
 *      throws;
 *  (5) CONTROL: an accepted SCIM write hands the slot no refusal and its
 *      writes still name the connection; a refused non-SCIM sign-in is
 *      unchanged (its `login_failed` event, and no SCIM refusal);
 *  (6) [#32116] a schema-refused request (400 `invalidValue`) with a valid
 *      bearer names its connection; CONTROLS: a forged, a revoked and an
 *      expired SCIM bearer still name none, a non-SCIM credential is
 *      unchanged, and the lookup writes nothing to the credential row.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import {
  SCIM_BEARER_PREFIX,
  SCIM_CREDENTIAL_OBJECT,
  digestScimBearerToken,
  mintScimConnectionCredential,
  revokeScimConnectionCredential,
} from './scim-connection-service.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-31829';
const PASSWORD = 'correct-horse-battery-staple-31829';
const CONNECTION = 'okta-31829';
const ORG = 'org_31829';
const CLIENT = '203.0.113.7';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** The per-connection cap and window the door ships (`scim-refusal-audit.ts`), spelled as literals. */
const ROWS_PER_CONNECTION = 20;
const WINDOW_MS = 10 * 60_000;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

type Event = Record<string, unknown>;

interface Harness {
  engine: ObjectQL;
  manager: AuthManager;
  token: string;
  credentialId: string;
  refusals: Event[];
  authEvents: Event[];
  send: (request: Request) => Promise<Response>;
}

type SinkShape = 'full' | 'no-member' | 'none' | 'throws';

async function boot(sinkShape: SinkShape = 'full'): Promise<Harness> {
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  const refusals: Event[] = [];
  const authEvents: Event[] = [];
  const recordAuthEvent = async (event: Event) => void authEvents.push(event);
  const sink =
    sinkShape === 'none'
      ? undefined
      : sinkShape === 'no-member'
        ? { recordAuthEvent }
        : {
            recordAuthEvent,
            recordScimRefusal: async (event: Event) => {
              refusals.push(event);
              if (sinkShape === 'throws') throw new Error('[#31829 test] the ledger is down');
            },
          };

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    getAuditSink: () => sink as never,
    plugins: { scim: true, organization: true },
  } as never);

  const { token, credentialId } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: CONNECTION,
    organizationId: ORG,
  });
  return {
    engine,
    manager,
    token,
    credentialId,
    refusals,
    authEvents,
    send: (request) => manager.handleRequest(request, { remoteAddress: CLIENT }),
  };
}

function scimRequest(h: Harness, method: string, path: string, body?: unknown, bearer: string | null = h.token): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      ...(bearer !== null ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ALICE = {
  schemas: [USER_SCHEMA],
  userName: 'alice@example.com',
  name: { givenName: 'Alice', familyName: 'Example' },
  emails: [{ value: 'alice@example.com', primary: true, type: 'work' }],
  active: true,
};

async function provisionAlice(h: Harness): Promise<string> {
  const res = await h.send(scimRequest(h, 'POST', '/Users', ALICE));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A bearer of the minted shape that no credential row holds. */
const FOREIGN_BEARER = `${SCIM_BEARER_PREFIX}${'Q'.repeat(43)}`;

/** Let the after-response hand-offs run, then wait for `count` events and a little longer for strays. */
async function settle(events: Event[], count: number): Promise<void> {
  await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(count), { timeout: 5_000, interval: 5 });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

/** Let any after-response hand-off that WOULD run, run. */
async function quiesce(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 20));
}

describe('[#31829] each refused SCIM request hands the audit slot one event naming its connection', () => {
  it('(1) 401 bad bearer: one event, no connection, the credential kind, status, resource, method and address', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h, 'GET', '/Users', undefined, FOREIGN_BEARER));
    expect(res.status).toBe(401);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { presentedCredential: 'scim_bearer', resource: 'Users', method: 'GET', status: 401, ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(1) 401 with no bearer at all names the credential kind `none`', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h, 'GET', '/Users', undefined, null));
    expect(res.status).toBe(401);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { presentedCredential: 'none', resource: 'Users', method: 'GET', status: 401, ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(1) 409 duplicate create: one event naming the connection and the SCIM `uniqueness` type', async () => {
    const h = await boot();
    await provisionAlice(h);
    expect(h.refusals).toEqual([]);
    const res = await h.send(scimRequest(h, 'POST', '/Users', ALICE));
    expect(res.status).toBe(409);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, resource: 'Users', method: 'POST', status: 409, scimType: 'uniqueness', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(1) 400 malformed PATCH (refused by the schema BEFORE the bearer verifies): one event naming the connection', async () => {
    const h = await boot();
    const id = await provisionAlice(h);
    const res = await h.send(
      scimRequest(h, 'PATCH', `/Users/${id}`, {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: 'frobnicate', path: 'active', value: false }],
      }),
    );
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, resource: 'Users', method: 'PATCH', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(1) 400 refused AFTER the bearer verified (an unsupported PATCH path): one event naming the connection', async () => {
    const h = await boot();
    const id = await provisionAlice(h);
    const res = await h.send(
      scimRequest(h, 'PATCH', `/Users/${id}`, {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: 'replace', path: 'nosuchattr', value: 'x' }],
      }),
    );
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, resource: 'Users', method: 'PATCH', status: 400, scimType: 'invalidPath', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(1) 404 unknown user: one event naming the connection', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h, 'GET', '/Users/does-not-exist-31829'));
    expect(res.status).toBe(404);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, resource: 'Users', method: 'GET', status: 404, ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(2) no event carries the bearer, any part of it, its digest, an attribute value, the resource id or the detail text', async () => {
    const h = await boot();
    const id = await provisionAlice(h);
    const answers: string[] = [];
    for (const request of [
      scimRequest(h, 'GET', '/Users', undefined, FOREIGN_BEARER),
      scimRequest(h, 'POST', '/Users', ALICE),
      scimRequest(h, 'PATCH', `/Users/${id}`, { schemas: [PATCH_SCHEMA], Operations: [{ op: 'frobnicate', path: 'active', value: false }] }),
      scimRequest(h, 'PATCH', `/Users/${id}`, { schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', path: 'nosuchattr', value: 'secret-value-31829' }] }),
      scimRequest(h, 'GET', '/Users/does-not-exist-31829'),
    ]) {
      const res = await h.send(request);
      answers.push(await res.text());
    }
    await settle(h.refusals, 5);
    expect(h.refusals).toHaveLength(5);
    const recorded = JSON.stringify(h.refusals);
    const forbidden = [
      h.token,
      h.token.slice(SCIM_BEARER_PREFIX.length, SCIM_BEARER_PREFIX.length + 8),
      FOREIGN_BEARER,
      FOREIGN_BEARER.slice(SCIM_BEARER_PREFIX.length, SCIM_BEARER_PREFIX.length + 8),
      digestScimBearerToken(SECRET, h.token),
      digestScimBearerToken(SECRET, FOREIGN_BEARER),
      'alice@example.com',
      'secret-value-31829',
      'nosuchattr',
      'frobnicate',
      id,
      'does-not-exist-31829',
      'already exists',
      'not found',
      'Invalid SCIM bearer token',
    ];
    for (const value of forbidden) {
      expect(recorded.includes(value), `an event carries ${JSON.stringify(value)}: ${recorded}`).toBe(false);
    }
    // The answers themselves are the vendor's, untouched — the detail text is still there for the caller.
    expect(answers[1]).toContain('already exists');
    // Every event's keys are from the closed set.
    const allowed = new Set(['connectionId', 'organizationId', 'presentedCredential', 'resource', 'method', 'status', 'scimType', 'errorCode', 'ipAddress', 'suppressed']);
    for (const event of h.refusals) {
      expect(Object.keys(event).filter((k) => !allowed.has(k))).toEqual([]);
    }
  }, 60_000);
});

describe('[#31829] the refusals of one connection are bounded and counted', () => {
  it('(3) a burst over the cap writes the cap, and the first row after the window carries what was dropped', async () => {
    const h = await boot();
    const burst = ROWS_PER_CONNECTION + 7;
    for (let i = 0; i < burst; i++) {
      const res = await h.send(scimRequest(h, 'GET', `/Users/missing-${i}`));
      expect(res.status).toBe(404);
    }
    await settle(h.refusals, ROWS_PER_CONNECTION);
    await quiesce();
    expect(h.refusals).toHaveLength(ROWS_PER_CONNECTION);
    expect(h.refusals.every((e) => e.connectionId === CONNECTION && e.suppressed === undefined)).toBe(true);

    // The next window: one more refusal writes again, and says how many were dropped.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + WINDOW_MS + 1_000);
    const res = await h.send(scimRequest(h, 'GET', '/Users/missing-after'));
    expect(res.status).toBe(404);
    await settle(h.refusals, ROWS_PER_CONNECTION + 1);
    expect(h.refusals).toHaveLength(ROWS_PER_CONNECTION + 1);
    expect(h.refusals.at(-1)).toMatchObject({ connectionId: CONNECTION, status: 404, suppressed: burst - ROWS_PER_CONNECTION });
  }, 120_000);

  it('(3) an unverified bearer is bounded by its client address, apart from the connection', async () => {
    const h = await boot();
    for (let i = 0; i < ROWS_PER_CONNECTION + 3; i++) {
      await h.send(scimRequest(h, 'GET', '/Users', undefined, FOREIGN_BEARER));
    }
    await settle(h.refusals, ROWS_PER_CONNECTION);
    await quiesce();
    expect(h.refusals).toHaveLength(ROWS_PER_CONNECTION);
    // The connection's own budget is untouched by the address's flood.
    await h.send(scimRequest(h, 'GET', '/Users/does-not-exist-31829'));
    await settle(h.refusals, ROWS_PER_CONNECTION + 1);
    expect(h.refusals.at(-1)).toMatchObject({ connectionId: CONNECTION, status: 404 });
  }, 120_000);
});

describe('[#31829] the SCIM answer never depends on the ledger', () => {
  for (const shape of ['none', 'no-member', 'throws'] as const) {
    it(`(4) slot ${shape}: the 409 is answered exactly as with a working slot`, async () => {
      const reference = await boot('full');
      await provisionAlice(reference);
      const expected = await reference.send(scimRequest(reference, 'POST', '/Users', ALICE));

      const h = await boot(shape);
      await provisionAlice(h);
      const res = await h.send(scimRequest(h, 'POST', '/Users', ALICE));
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe(await expected.text());
      await quiesce();
    }, 60_000);
  }
});

describe('[#31829] CONTROL — accepted SCIM writes and non-SCIM refusals are unchanged', () => {
  it('(5) an accepted SCIM create hands the slot no refusal, and its writes still name the connection', async () => {
    const h = await boot();
    const contexts: Array<Record<string, unknown>> = [];
    const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    const insert = engine.insert.bind(h.engine);
    vi.spyOn(engine, 'insert').mockImplementation(async (object: unknown, data: unknown, options?: unknown) => {
      const context = (options as { context?: Record<string, unknown> } | undefined)?.context;
      if (object === 'sys_user') contexts.push(context ?? {});
      return insert(object, data, options);
    });
    await provisionAlice(h);
    await quiesce();
    expect(h.refusals).toEqual([]);
    expect(contexts.map((c) => c.actor)).toEqual([`svc:scim:${CONNECTION}`]);
  }, 60_000);

  it('(5) a refused password sign-in keeps its login_failed event and hands the slot no SCIM refusal', async () => {
    const h = await boot();
    const up = await h.send(
      new Request(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'carol@example.com', password: PASSWORD, name: 'Carol Example' }),
      }),
    );
    expect(up.status, await up.clone().text()).toBeLessThan(300);
    const res = await h.send(
      new Request(`${AUTH}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'carol@example.com', password: 'wrong-password-31829' }),
      }),
    );
    expect(res.status).toBe(401);
    await vi.waitFor(() => expect(h.authEvents.some((e) => e.action === 'login_failed')).toBe(true), { timeout: 5_000 });
    await quiesce();
    expect(h.authEvents.filter((e) => e.action === 'login_failed')).toHaveLength(1);
    expect(h.refusals).toEqual([]);
  }, 60_000);
});

/** A create the vendor's schema refuses before its bearer verifier runs: no `userName`. */
const NO_USERNAME = { schemas: [USER_SCHEMA], name: { givenName: 'Nobody' } };

/** Record every write the engine is handed for the credential object. */
function credentialWrites(h: Harness): unknown[][] {
  const writes: unknown[][] = [];
  const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const method of ['insert', 'update', 'delete'] as const) {
    const original = engine[method]!.bind(h.engine);
    vi.spyOn(engine, method).mockImplementation(async (...args: unknown[]) => {
      if (args[0] === SCIM_CREDENTIAL_OBJECT) writes.push([method, ...args]);
      return original(...args);
    });
  }
  return writes;
}

describe('[#32116] a schema-refused SCIM request names the connection its live bearer resolves to', () => {
  it('(6) 400 create with no userName and a valid bearer: one event naming the connection, and no credential write', async () => {
    const h = await boot();
    const before = await h.engine.findOne(SCIM_CREDENTIAL_OBJECT, { where: { id: h.credentialId } }, { context: { isSystem: true } } as never);
    const writes = credentialWrites(h);
    const res = await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME));
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    await quiesce();
    expect(h.refusals).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, resource: 'Users', method: 'POST', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
    // Read-only: the lookup wrote nothing to the credential, its last use included.
    expect(writes).toEqual([]);
    const after = await h.engine.findOne(SCIM_CREDENTIAL_OBJECT, { where: { id: h.credentialId } }, { context: { isSystem: true } } as never);
    expect(after).toEqual(before);
  }, 60_000);

  it('(6) CONTROL: a forged SCIM-prefixed bearer on a schema 400 still names no connection', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME, FOREIGN_BEARER));
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { presentedCredential: 'scim_bearer', resource: 'Users', method: 'POST', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(6) CONTROL: a revoked bearer on a schema 400 still names no connection', async () => {
    const h = await boot();
    expect((await revokeScimConnectionCredential(h.engine as never, h.credentialId)).outcome).toBe('revoked');
    const res = await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME));
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { presentedCredential: 'scim_bearer', resource: 'Users', method: 'POST', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(6) CONTROL: an expired bearer on a schema 400 still names no connection', async () => {
    const h = await boot();
    const { token: expired } = await mintScimConnectionCredential(h.engine as never, SECRET, {
      connectionId: 'okta-expired-32116',
      organizationId: ORG,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME, expired));
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    expect(h.refusals).toEqual([
      { presentedCredential: 'scim_bearer', resource: 'Users', method: 'POST', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
  }, 60_000);

  it('(6) CONTROL: a non-SCIM credential on a schema 400 is unchanged, and is never looked up', async () => {
    const h = await boot();
    const reads: unknown[] = [];
    const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    const findOne = engine.findOne!.bind(h.engine);
    vi.spyOn(engine, 'findOne').mockImplementation(async (...args: unknown[]) => {
      if (args[0] === SCIM_CREDENTIAL_OBJECT) reads.push(args[1]);
      return findOne(...args);
    });
    const res = await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME, 'not-a-scim-bearer-32116'));
    expect(res.status).toBe(400);
    await settle(h.refusals, 1);
    await quiesce();
    expect(h.refusals).toEqual([
      { presentedCredential: 'other', resource: 'Users', method: 'POST', status: 400, scimType: 'invalidValue', ipAddress: CLIENT },
    ]);
    expect(reads).toEqual([]);
  }, 60_000);

  it('(6) the event never carries the resolved bearer, any part of it or its digest', async () => {
    const h = await boot();
    await h.send(scimRequest(h, 'POST', '/Users', NO_USERNAME));
    await settle(h.refusals, 1);
    const recorded = JSON.stringify(h.refusals);
    for (const value of [h.token, h.token.slice(SCIM_BEARER_PREFIX.length, SCIM_BEARER_PREFIX.length + 8), digestScimBearerToken(SECRET, h.token)]) {
      expect(recorded.includes(value), `an event carries ${JSON.stringify(value)}`).toBe(false);
    }
  }, 60_000);
});
