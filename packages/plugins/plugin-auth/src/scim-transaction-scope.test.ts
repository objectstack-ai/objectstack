// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14522] SCIM provisioning writes run inside ONE engine transaction — the
 * RUNTIME pin behind the `#3653` scoping note in `objectql-adapter.ts`.
 *
 * ## The defect
 *
 * The adapter's `transaction` config opens a real `engine.transaction()` only
 * while `inScimRequestScope()` reads true. That scope used to be stamped with
 * `scimRequestScope.enterWith(...)` inside the `verifyBearerToken` callback
 * handed to `@better-auth/scim` — and `enterWith` has no callback boundary:
 * it marks the async resource it runs in and that resource's descendants.
 * The vendor awaits the verifier (an endpoint `use` middleware) from the
 * endpoint's own async frame and resumes the handler under its own
 * `runWithEndpointContext` (an `als.run`), so by the time the handler asked
 * the adapter for a transaction the store was gone. Measured on 1.7.2 before
 * this card: zero `engine.transaction` and zero `driver.beginTransaction`
 * calls across `POST /Users` + `PATCH /Users/{id}`, `inScimRequestScope()`
 * false inside every `sys_user` / `sys_scim_user` write — while the vendor's
 * mount-time `assertNativeSCIMTransactions` stayed satisfied, because it only
 * asks whether `transaction` is a function.
 *
 * The scope is now opened with `scimRequestScope.run(...)` around the WHOLE
 * request at `AuthManager.handleRequest`, keyed on the better-auth endpoint
 * path prefix `/scim/v2` — a callback boundary that every `als.run` the
 * vendor performs underneath nests inside, the same seam the actor-attribution
 * scope and the subject-erasure transaction already use.
 *
 * ## Why these are RUNTIME pins
 *
 * `credential-at-rest-posture.test.ts` records that the vendor refuses to
 * mount on a sequential-fallback `transaction`. That is a mount-time
 * assertion, and it passed throughout the defect. Every case here observes a
 * SCIM mutation at run time — through `AuthManager.handleRequest()` with a
 * real bearer, on a real `ObjectQL` over better-sqlite3, the harness shape of
 * the #14360 suite (`scim-deactivation-reconcile-user.test.ts`). That suite
 * pins the CONSEQUENCE (face (c): a refused last-administrator deactivation
 * no longer leaves the SCIM resource reporting inactive); this file pins the
 * MECHANISM.
 *
 *  (a) `POST /Users` and `PATCH /Users/{id}` each open the engine
 *      transaction (`engine.transaction` ≥ 1, `driver.beginTransaction` ≥ 1)
 *      and every identity write made inside them sees the SCIM scope.
 *  (b) atomicity: a failure on a LATER provisioning write leaves NO partial
 *      identity — `sys_user`, `sys_scim_subject`, `sys_scim_user` all absent.
 *  (c) negative control — the triage's first scope guard: non-SCIM flows keep
 *      their historical sequential posture. Sign-up and sign-in open ZERO
 *      engine transactions, exactly as before this card.
 *  (d) a SCIM read opens none either: the scope adds no transaction where the
 *      vendor asks for none.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { inScimRequestScope, mintScimConnectionCredential } from './scim-connection-service.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-14522';
const PASSWORD = 'correct-horse-battery-staple-14522';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** Every read below is a safety-proof read, never RLS-scoped to a caller. */
const SYSTEM = { context: { isSystem: true } } as const;

/** The identity objects a SCIM provisioning request touches. */
const IDENTITY_OBJECTS = ['sys_user', 'sys_scim_subject', 'sys_scim_user'] as const;

/**
 * The objects a deployment that mounts plugin-auth registers, imported from the
 * plugin's own manifest rather than re-spelled here, so this harness cannot
 * drift from what `auth-plugin.ts` registers at runtime (#14615).
 */
const AUTH_OBJECTS = authIdentityObjects;

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

interface Harness {
  engine: ObjectQL;
  driver: SqlDriver;
  manager: AuthManager;
  token: string;
  send: (request: Request) => Promise<Response>;
}

/**
 * The manager under test, built the way a deployment with SCIM turned on
 * builds it. The scope stamp and the adapter's `transaction` config are both
 * inside the system under test; nothing here names either.
 */
async function boot(): Promise<Harness> {
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);

  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: 'okta-14522',
  });

  return { engine, driver, manager, token, send: (request) => manager.handleRequest(request) };
}

// ---------------------------------------------------------------------------
// Observation — the two spies the card names, plus the scope sampled INSIDE
// every engine write (the only place the answer matters).
// ---------------------------------------------------------------------------

interface WriteSample {
  op: 'insert' | 'update';
  object: string;
  scim: boolean;
}

interface Observation {
  transaction: ReturnType<typeof vi.spyOn>;
  beginTransaction: ReturnType<typeof vi.spyOn>;
  writes: WriteSample[];
  reset(): void;
}

/**
 * Spy `engine.transaction` and `driver.beginTransaction` (call-through), and
 * wrap `engine.insert` / `engine.update` to record whether the SCIM scope is
 * visible at the moment each write happens. Optionally fail one object's
 * insert, for the atomicity case.
 */
function observe(h: Harness, failInsertOn?: string): Observation {
  const transaction = vi.spyOn(h.engine, 'transaction');
  const beginTransaction = vi.spyOn(h.driver, 'beginTransaction');
  const writes: WriteSample[] = [];
  for (const op of ['insert', 'update'] as const) {
    const original = (h.engine as unknown as Record<string, (...a: unknown[]) => unknown>)[op].bind(
      h.engine,
    );
    vi.spyOn(h.engine as unknown as Record<string, (...a: unknown[]) => unknown>, op).mockImplementation(
      async (object: unknown, ...rest: unknown[]) => {
        writes.push({ op, object: String(object), scim: inScimRequestScope() });
        if (op === 'insert' && failInsertOn !== undefined && object === failInsertOn) {
          throw new Error(`[#14522 test] injected failure on insert ${failInsertOn}`);
        }
        return original(object, ...rest);
      },
    );
  }
  return {
    transaction,
    beginTransaction,
    writes,
    reset() {
      transaction.mockClear();
      beginTransaction.mockClear();
      writes.length = 0;
    },
  };
}

const identityWrites = (o: Observation): WriteSample[] =>
  o.writes.filter((w) => (IDENTITY_OBJECTS as readonly string[]).includes(w.object));

const describeWrites = (o: Observation): string =>
  o.writes.map((w) => `${w.op}:${w.object}:${w.scim ? 'scim' : 'NO-SCOPE'}`).join(' ');

// ---------------------------------------------------------------------------
// SCIM 2.0 requests — the shapes an identity provider actually sends
// ---------------------------------------------------------------------------

function scimRequest(h: Harness, method: string, path: string, body?: unknown): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      authorization: `Bearer ${h.token}`,
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function provisionRequest(h: Harness, localPart: string): Request {
  const email = `${localPart}@example.com`;
  return scimRequest(h, 'POST', '/Users', {
    schemas: [USER_SCHEMA],
    userName: email,
    name: { givenName: localPart, familyName: 'Example' },
    displayName: `${localPart} Example`,
    emails: [{ value: email, primary: true, type: 'work' }],
    active: true,
  });
}

async function provision(h: Harness, localPart: string): Promise<{ scimId: string; email: string }> {
  const res = await h.send(provisionRequest(h, localPart));
  expect(res.status, `SCIM POST /Users failed: ${await res.clone().text()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return { scimId: body.id, email: `${localPart}@example.com` };
}

const setActive = (h: Harness, scimId: string, active: boolean) =>
  h.send(
    scimRequest(h, 'PATCH', `/Users/${scimId}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'replace', path: 'active', value: active }],
    }),
  );

async function rowsOf(h: Harness, object: string): Promise<number> {
  const rows = await h.engine.find(object, { where: {} }, SYSTEM);
  return Array.isArray(rows) ? rows.length : 0;
}

async function userRow(h: Harness, email: string): Promise<Record<string, unknown> | null> {
  return h.engine.findOne(
    'sys_user',
    { where: { email }, fields: ['id', 'email'] },
    SYSTEM,
  ) as Promise<Record<string, unknown> | null>;
}

// ---------------------------------------------------------------------------
// (a) — each SCIM mutation opens the engine transaction and its writes see the scope
// ---------------------------------------------------------------------------

describe('[#14522] a SCIM mutation runs inside one engine transaction', () => {
  it('(a) POST /Users: engine.transaction and driver.beginTransaction each called, every identity write in scope', async () => {
    const h = await boot();
    const o = observe(h);

    await provision(h, 'alice');

    expect(o.transaction, `engine.transaction calls; writes: ${describeWrites(o)}`).toHaveBeenCalled();
    expect(o.beginTransaction, 'driver.beginTransaction calls').toHaveBeenCalled();
    const writes = identityWrites(o);
    // The provisioning sequence really is several writes — the reason the
    // transaction exists at all.
    expect(writes.length, describeWrites(o)).toBeGreaterThanOrEqual(2);
    for (const object of IDENTITY_OBJECTS) {
      expect(
        writes.some((w) => w.object === object),
        `expected a write on ${object}; saw: ${describeWrites(o)}`,
      ).toBe(true);
    }
    expect(
      writes.filter((w) => !w.scim).map((w) => `${w.op}:${w.object}`),
      'identity writes made OUTSIDE the SCIM scope',
    ).toEqual([]);
  }, 60_000);

  it('(a) PATCH /Users/{id} active:false: the transaction opens again and the sys_user / sys_scim_user writes see the scope', async () => {
    const h = await boot();
    const alice = await provision(h, 'alice');
    const o = observe(h);

    const res = await setActive(h, alice.scimId, false);
    expect(res.status, `SCIM PATCH active:false failed: ${await res.clone().text()}`).toBe(200);

    expect(o.transaction, `engine.transaction calls; writes: ${describeWrites(o)}`).toHaveBeenCalled();
    expect(o.beginTransaction, 'driver.beginTransaction calls').toHaveBeenCalled();
    const writes = identityWrites(o);
    expect(writes.some((w) => w.object === 'sys_scim_user'), describeWrites(o)).toBe(true);
    expect(writes.some((w) => w.object === 'sys_user'), describeWrites(o)).toBe(true);
    expect(
      writes.filter((w) => !w.scim).map((w) => `${w.op}:${w.object}`),
      'identity writes made OUTSIDE the SCIM scope',
    ).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (b) — atomicity: a failed provisioning leaves no partial identity
// ---------------------------------------------------------------------------

describe('[#14522] a provisioning that fails part-way leaves NO partial identity', () => {
  it('(b) a failure on the sys_scim_user write rolls the sys_user and sys_scim_subject writes back', async () => {
    const h = await boot();
    // Control: nothing is there before the request.
    for (const object of IDENTITY_OBJECTS) expect(await rowsOf(h, object)).toBe(0);

    const o = observe(h, 'sys_scim_user');
    const res = await h.send(provisionRequest(h, 'bob'));
    // The vendor reports the failure — it must not be a 201 over a torn write.
    expect(res.status, await res.clone().text()).toBeGreaterThanOrEqual(400);
    // The failing write was reached, i.e. the earlier ones had already run.
    expect(o.writes.some((w) => w.object === 'sys_scim_user'), describeWrites(o)).toBe(true);
    expect(o.writes.some((w) => w.object === 'sys_user'), describeWrites(o)).toBe(true);

    // Then the rollback: none of the three survives.
    expect(await userRow(h, 'bob@example.com'), 'sys_user survived the failed provisioning').toBeNull();
    for (const object of IDENTITY_OBJECTS) {
      expect(await rowsOf(h, object), `${object} rows after the failed provisioning`).toBe(0);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (c) + (d) — negative controls
// ---------------------------------------------------------------------------

async function signUp(h: Harness, email: string): Promise<Response> {
  return h.send(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Carol Example' }),
    }),
  );
}

async function signIn(h: Harness, email: string): Promise<Response> {
  return h.send(
    new Request(`${AUTH}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

describe('[#14522] the scope is SCIM-only — non-SCIM flows keep their sequential posture', () => {
  it('(c) sign-up and sign-in write identity rows with ZERO engine transactions and no SCIM scope', async () => {
    const h = await boot();
    const o = observe(h);

    const up = await signUp(h, 'carol@example.com');
    expect(up.status, `sign-up failed: ${await up.clone().text()}`).toBeLessThan(300);
    const down = await signIn(h, 'carol@example.com');
    expect(down.status, `sign-in failed: ${await down.clone().text()}`).toBeLessThan(300);

    // The flows really wrote (user, account, session) — a control with no
    // writes would prove nothing.
    expect(o.writes.length, describeWrites(o)).toBeGreaterThanOrEqual(3);
    expect(o.writes.some((w) => w.object === 'sys_user'), describeWrites(o)).toBe(true);
    expect(o.writes.some((w) => w.object === 'sys_session'), describeWrites(o)).toBe(true);
    // ...and none of it inside a transaction or the SCIM scope.
    expect(o.transaction, `engine.transaction calls during sign-up/sign-in: ${describeWrites(o)}`).not.toHaveBeenCalled();
    expect(o.beginTransaction).not.toHaveBeenCalled();
    expect(o.writes.filter((w) => w.scim).map((w) => `${w.op}:${w.object}`)).toEqual([]);
  }, 60_000);

  it('(d) a SCIM read opens no transaction', async () => {
    const h = await boot();
    const alice = await provision(h, 'alice');
    const o = observe(h);

    const res = await h.send(scimRequest(h, 'GET', `/Users/${alice.scimId}`));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(o.transaction).not.toHaveBeenCalled();
    expect(o.beginTransaction).not.toHaveBeenCalled();
    expect(o.writes).toEqual([]);
  }, 60_000);
});
