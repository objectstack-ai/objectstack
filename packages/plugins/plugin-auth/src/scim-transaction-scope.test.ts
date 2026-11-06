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
 *
 * ## The attribution block (#30960)
 *
 * The same scope carries the request's attribution slot: the bearer verifier
 * records the connection it verified, and the adapter reads it when it builds
 * each write's context, so the write reaches the engine as
 * `{ isSystem: true, actor: 'svc:scim:CONNECTION_ID' }` with no
 * `attributedUserId` (the audit writer turns that into `sys_audit_log.actor`,
 * `metadata.scim_connection_id` and a null `user_id` — pinned in
 * plugin-audit's `audit-writers.test.ts`). Observed at the engine, on the
 * context every write really receives:
 *
 *  (e) a SCIM create, a deactivation (its ban update) and a delete: every
 *      write names the connection, none names a human;
 *  (f) no write carries the bearer or its digest — not in its data, its
 *      query or its context;
 *  (g) a non-SCIM write in the same process, after a SCIM request, carries
 *      no service principal: sign-up and sign-in are unchanged;
 *  (h) isolation: two SCIM requests on two connections, held so that BOTH
 *      have verified before either writes, each attribute every write to
 *      their own connection;
 *  (i) a SCIM request that also carries a signed-in human's session cookie
 *      still attributes to the connection and credits no human: the bearer
 *      authenticated the request, the cookie did not.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import {
  SCIM_CREDENTIAL_OBJECT,
  digestScimBearerToken,
  inScimRequestScope,
  mintScimConnectionCredential,
} from './scim-connection-service.js';

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

  // [C8 stage 8b] It carries an organization: under `single` an organization-less

  // system insert is refused while the install holds none, and this rig holds none.

  // The verifier reads the digest alone, so the organization changes nothing it answers.

  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: 'okta-14522',
    organizationId: 'org_scim_8b',
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

// ---------------------------------------------------------------------------
// (e)–(i) — #30960: every SCIM write is attributed to the connection
// ---------------------------------------------------------------------------

/** The connection `boot()` mints its bearer for, and the label its writes must carry. */
const CONNECTION = 'okta-14522';
const CONNECTION_ACTOR = `svc:scim:${CONNECTION}`;

interface AttributedWrite {
  op: 'insert' | 'update' | 'delete';
  object: string;
  /** The row (insert / update) or the query minus its context (delete). */
  payload: unknown;
  /** The execution context the engine received for this write. */
  context: Record<string, unknown>;
}

/**
 * Record every engine write with the context it reached the engine with — the
 * raw engine, beneath the adapter's `withSystemContext`, so the context is
 * the one the audit writer's hooks are built from. Call-through.
 */
function observeAttribution(h: Harness): { writes: AttributedWrite[]; reset(): void } {
  const writes: AttributedWrite[] = [];
  const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const op of ['insert', 'update', 'delete'] as const) {
    const original = engine[op].bind(h.engine);
    vi.spyOn(engine, op).mockImplementation(async (object: unknown, ...rest: unknown[]) => {
      const options = (op === 'delete' ? rest[0] : rest[1]) as { context?: Record<string, unknown> } | undefined;
      const { context, ...query } = options ?? {};
      writes.push({
        op,
        object: String(object),
        payload: op === 'delete' ? query : rest[0],
        context: context ?? {},
      });
      return original(object, ...rest);
    });
  }
  return { writes, reset: () => void (writes.length = 0) };
}

/** A cycle-safe, function-free serialization — a write context may hold a transaction handle. */
function serialized(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'function') return undefined;
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
    }
    return v;
  });
}

const describeAttribution = (writes: AttributedWrite[]): string =>
  writes
    .map((w) => `${w.op}:${w.object}:${String(w.context.actor ?? 'NO-ACTOR')}${w.context.attributedUserId ? `:user=${String(w.context.attributedUserId)}` : ''}`)
    .join(' ');

/** Writes whose context names something other than `actor` as their attribution, or no actor at all. */
const misattributed = (writes: AttributedWrite[], actor: string): string[] =>
  writes
    .filter(
      (w) =>
        w.context.actor !== actor ||
        w.context.isSystem !== true ||
        'attributedUserId' in w.context ||
        'impersonatedBy' in w.context ||
        'performedBy' in w.context,
    )
    .map((w) => `${w.op}:${w.object}:${serialized(w.context)}`);

/** The ban write's payload — `banned` as better-auth hands it to the adapter (booleans as 0/1 here). */
const isBanWrite = (payload: unknown): boolean => {
  const banned = (payload as { banned?: unknown } | null)?.banned;
  return banned === true || banned === 1;
};

/**
 * Bring the vendor instance up with a SCIM read before observing: the first
 * request builds the better-auth instance, and that build writes the
 * platform's own `sys_oauth_resource` row before any bearer is verified — a
 * boot write, not a provisioning one. A read writes nothing else (case (d)).
 */
async function warm(h: Harness): Promise<void> {
  const res = await h.send(scimRequest(h, 'GET', '/Users'));
  expect(res.status, await res.clone().text()).toBe(200);
}

describe('[#30960] every SCIM write is attributed to the connection that performed it', () => {
  it('(e) create, deactivation (the ban update) and delete: every write names the connection and no human', async () => {
    const h = await boot();
    await warm(h);
    const o = observeAttribution(h);

    const alice = await provision(h, 'alice');
    const created = [...o.writes];
    o.reset();
    expect(created.some((w) => w.op === 'insert' && w.object === 'sys_user'), describeAttribution(created)).toBe(true);
    expect(misattributed(created, CONNECTION_ACTOR), 'create writes not attributed to the connection').toEqual([]);

    const deactivated = await setActive(h, alice.scimId, false);
    expect(deactivated.status, await deactivated.clone().text()).toBe(200);
    const deactivation = [...o.writes];
    o.reset();
    // The ban update itself — "who deactivated this account" — is among them.
    expect(
      deactivation.some((w) => w.op === 'update' && w.object === 'sys_user' && isBanWrite(w.payload)),
      describeAttribution(deactivation),
    ).toBe(true);
    expect(misattributed(deactivation, CONNECTION_ACTOR), 'deactivation writes not attributed to the connection').toEqual([]);

    const bob = await provision(h, 'bob');
    o.reset();
    const deleted = await h.send(scimRequest(h, 'DELETE', `/Users/${bob.scimId}`));
    expect(deleted.status, await deleted.clone().text()).toBe(204);
    const deletion = [...o.writes];
    expect(deletion.some((w) => w.op === 'delete' && w.object === 'sys_scim_user'), describeAttribution(deletion)).toBe(true);
    expect(
      deletion.some((w) => w.op === 'update' && w.object === 'sys_user' && isBanWrite(w.payload)),
      describeAttribution(deletion),
    ).toBe(true);
    expect(misattributed(deletion, CONNECTION_ACTOR), 'delete writes not attributed to the connection').toEqual([]);
  }, 60_000);

  it('(f) no write carries the bearer or its digest — data, query or context', async () => {
    const h = await boot();
    const o = observeAttribution(h);
    const digest = digestScimBearerToken(SECRET, h.token);

    const alice = await provision(h, 'alice');
    expect((await setActive(h, alice.scimId, false)).status).toBe(200);
    expect((await h.send(scimRequest(h, 'DELETE', `/Users/${alice.scimId}`))).status).toBe(204);

    // The control: the writes really happened and really name the connection,
    // so the absence below is about the bearer, not about an empty capture.
    expect(o.writes.length, describeAttribution(o.writes)).toBeGreaterThanOrEqual(5);
    expect(o.writes.some((w) => w.context.actor === CONNECTION_ACTOR)).toBe(true);
    const everything = serialized(o.writes);
    expect(everything.includes(CONNECTION_ACTOR)).toBe(true);
    expect(everything.includes(h.token), 'a write carried the bearer').toBe(false);
    expect(everything.includes(digest), 'a write carried the bearer digest').toBe(false);
  }, 60_000);

  it('(g) a non-SCIM write around a SCIM request carries no service principal — sign-up and sign-in unchanged', async () => {
    const h = await boot();
    const o = observeAttribution(h);

    // Sign-up first: the deployment admits self-registration only while it
    // holds no user, and the SCIM create below adds one.
    const up = await signUp(h, 'carol@example.com');
    expect(up.status, `sign-up failed: ${await up.clone().text()}`).toBeLessThan(300);
    const signUpWrites = [...o.writes];
    await provision(h, 'alice'); // a verified connection is recorded in THIS process
    o.reset();
    const down = await signIn(h, 'carol@example.com');
    expect(down.status, `sign-in failed: ${await down.clone().text()}`).toBeLessThan(300);
    o.writes.unshift(...signUpWrites);

    expect(o.writes.some((w) => w.op === 'insert' && w.object === 'sys_user'), describeAttribution(o.writes)).toBe(true);
    expect(o.writes.some((w) => w.object === 'sys_session'), describeAttribution(o.writes)).toBe(true);
    expect(
      o.writes.filter((w) => 'actor' in w.context).map((w) => `${w.op}:${w.object}:${String(w.context.actor)}`),
      'non-SCIM writes carrying a service principal',
    ).toEqual([]);
    expect(serialized(o.writes).includes('svc:scim:')).toBe(false);
  }, 60_000);

  it('(h) two concurrent SCIM requests on two connections each attribute every write to their own connection', async () => {
    const h = await boot();
    const second = await mintScimConnectionCredential(h.engine as never, SECRET, {
      connectionId: 'entra-30960',
      organizationId: 'org_scim_8b',
    });
    await warm(h);

    // Hold every bearer verification until BOTH requests have reached it, so
    // both connections are verified before either request writes — the
    // interleaving in which a slot shared across requests would let the
    // second verification re-attribute the first request's writes.
    let arrived = 0;
    let releaseBoth!: () => void;
    const bothArrived = new Promise<void>((resolve) => (releaseBoth = resolve));
    const findOne = h.engine.findOne.bind(h.engine);
    vi.spyOn(h.engine, 'findOne').mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === SCIM_CREDENTIAL_OBJECT) {
        arrived += 1;
        if (arrived === 2) releaseBoth();
        await bothArrived;
      }
      return (findOne as (...a: unknown[]) => unknown)(object, ...rest);
    }) as never);
    const o = observeAttribution(h);

    const viaEntra = { ...h, token: second.token };
    const [alice, bob] = await Promise.all([
      h.send(provisionRequest(h, 'alice')),
      viaEntra.send(provisionRequest(viaEntra, 'bob')),
    ]);
    expect(alice.status, await alice.clone().text()).toBe(201);
    expect(bob.status, await bob.clone().text()).toBe(201);
    expect(arrived, 'both verifications were held at the barrier').toBe(2);

    const userInsert = (email: string) =>
      o.writes.find((w) => w.op === 'insert' && w.object === 'sys_user' && (w.payload as { email?: unknown }).email === email);
    expect(userInsert('alice@example.com')?.context.actor, describeAttribution(o.writes)).toBe(CONNECTION_ACTOR);
    expect(userInsert('bob@example.com')?.context.actor, describeAttribution(o.writes)).toBe('svc:scim:entra-30960');
    // Every write the vendor itself stamps with a connection agrees with its actor.
    const stamped = o.writes.filter((w) => typeof (w.payload as { connection_id?: unknown })?.connection_id === 'string');
    expect(new Set(stamped.map((w) => (w.payload as { connection_id: string }).connection_id))).toEqual(
      new Set([CONNECTION, 'entra-30960']),
    );
    expect(
      stamped
        .filter((w) => w.context.actor !== `svc:scim:${(w.payload as { connection_id: string }).connection_id}`)
        .map((w) => `${w.op}:${w.object}:${(w.payload as { connection_id: string }).connection_id}→${String(w.context.actor)}`),
      'writes attributed to the OTHER request’s connection',
    ).toEqual([]);
    expect(
      o.writes.filter((w) => w.context.actor !== CONNECTION_ACTOR && w.context.actor !== 'svc:scim:entra-30960').map((w) => `${w.op}:${w.object}`),
      'writes attributed to neither connection',
    ).toEqual([]);
  }, 60_000);

  it('(i) a SCIM request that also carries a signed-in human’s session cookie credits no human', async () => {
    const h = await boot();
    const up = await signUp(h, 'carol@example.com');
    expect(up.status, `sign-up failed: ${await up.clone().text()}`).toBeLessThan(300);
    const cookie = (up.headers.get('set-cookie') ?? '').split(';')[0];
    expect(cookie, 'the sign-up set a session cookie').toMatch(/session_token=/);
    const o = observeAttribution(h);

    const request = provisionRequest(h, 'alice');
    request.headers.set('cookie', cookie);
    const res = await h.send(request);
    expect(res.status, await res.clone().text()).toBe(201);

    expect(o.writes.some((w) => w.op === 'insert' && w.object === 'sys_user'), describeAttribution(o.writes)).toBe(true);
    expect(misattributed(o.writes, CONNECTION_ACTOR), 'writes crediting someone other than the connection').toEqual([]);
  }, 60_000);
});
