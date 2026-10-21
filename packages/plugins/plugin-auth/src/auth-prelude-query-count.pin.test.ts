// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24061] The reads one authenticated request pays before its handler runs —
 * counted, on a real engine.
 *
 * ## The composition
 *
 * A real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, this
 * plugin's identity objects, the grant tables `SecurityPlugin` declares and the
 * activation ledger, and a real `AuthManager`. A signed-up user holds a session
 * cookie whose session has an active organization (a `sys_member` row backs
 * it), which is the shape the card measured: every grant read the resolver can
 * issue is issued.
 *
 * ## The instrument
 *
 * The driver is wrapped, below the engine: every call is recorded with the
 * object it reads, and each yields on a macrotask before it runs, so reads a
 * caller issues together are in flight together. A call that starts while
 * nothing else is in flight OPENS a round trip; one that starts while another
 * is in flight JOINS it — the leg definition of
 * `resolve-authz-context.batch-equivalence.testkit.ts` (in `@objectstack/core`),
 * spelled here because a test may not import another package's test files.
 *
 * ## What is pinned
 *
 *  1. **The shared prelude** — `resolveAuthzContext` with the in-process
 *     session read, exactly as the REST door (`rest-server.ts`) and the runtime
 *     dispatcher call it: 8 reads in 4 round trips. Before #24061 it was 11 in
 *     7: the jwt plugin's `/get-session` header hook signed a JWT the caller
 *     discarded (two `sys_jwks` reads), and the session row's `token` was read
 *     back although the session had just been found BY that token.
 *  2. **The `/auth/me/*` faces' resolver** (`makeExecutionContextResolver`,
 *     `@objectstack/plugin-hono-server`) — the same 8 in 4. Before, 17 in 9: it
 *     resolved the grants a second time, outside any request scope.
 *  3. **The HTTP `/get-session`** still carries `set-auth-jwt`, signed by the
 *     stored key; the keyring is read once and then held.
 *  4. **An in-process read signs nothing**, even one that asks for the
 *     response headers — the half of 1 a held keyring hides from the count.
 *  5. **A keyring write is seen on the very next signing** — the key the
 *     header was signed with is retired through the engine, and the next
 *     `/get-session` signs with a new one.
 *  6. **A principal holding a direct grant pays the same prelude** — the
 *     same 8 reads in 4 round trips, whatever display formula
 *     `sys_user_permission_set` declares. The resolver's grant read projects
 *     the columns it decides on, so a formula it does not name is never
 *     computed there: the case declares a title that reads ONE hop through
 *     `user_id`, which a read that computes it pays for with a `sys_user` read
 *     and a round trip. Case 1 cannot see this — its principal holds no grant
 *     row, so no formula is ever computed for it.
 *
 * The counts are exact on purpose: a change that issues a read the prelude did
 * not issue turns 1 or 2 red. A change that REMOVES one turns them red too —
 * lower the number in the same change and say which read went.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext } from '@objectstack/core';
import { inProcessSessionReadInput } from '@objectstack/types';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-24061';
const SYS = { context: { isSystem: true } } as const;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

interface Recording {
  /** The object each driver call read or wrote, in issue order. */
  objects: string[];
  /** Round trips, by the leg definition above. */
  legs: number;
}

/** Wrap the driver's verbs; recording is off until {@link Probe.measure}. */
function probeDriver(driver: Record<string, any>) {
  let on = false;
  let inFlight = 0;
  let current: Recording = { objects: [], legs: 0 };
  for (const verb of ['find', 'findOne', 'count', 'aggregate', 'create', 'update', 'upsert', 'delete',
    'bulkCreate', 'bulkUpdate', 'bulkDelete', 'updateMany', 'deleteMany']) {
    const original = driver[verb]?.bind(driver);
    if (!original) continue;
    driver[verb] = async (object: string, ...rest: unknown[]) => {
      if (!on) return original(object, ...rest);
      if (inFlight === 0) current.legs += 1;
      inFlight += 1;
      current.objects.push(String(object));
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return await original(object, ...rest);
      } finally {
        inFlight -= 1;
      }
    };
  }
  return {
    async measure<T>(run: () => Promise<T>): Promise<{ result: T } & Recording> {
      current = { objects: [], legs: 0 };
      on = true;
      try {
        const result = await run();
        return { result, ...current };
      } finally {
        on = false;
      }
    },
  };
}

/**
 * A `sys_user_permission_set` title that reads one hop through `user_id` —
 * the person's name, or their email — which a read computing it pays for with
 * a batched `sys_user` read.
 */
const ONE_HOP_GRANT_TITLE =
  "(isBlank(trim(record.user_id.name)) ? record.user_id.email : record.user_id.name) + ' → ' + record.permission_set";

/** `sys_user_permission_set` as declared, with its `display_title` reading {@link ONE_HOP_GRANT_TITLE}. */
function withOneHopGrantTitle(object: any): unknown {
  const title = object.fields.display_title;
  expect(title?.type, 'the declared grant table carries a display_title formula').toBe('formula');
  return {
    ...object,
    fields: { ...object.fields, display_title: { ...title, expression: { dialect: 'cel', source: ONE_HOP_GRANT_TITLE } } },
  };
}

/** The grant tables, as `SecurityPlugin` declares them. */
async function grantTables(): Promise<unknown[]> {
  let manifest: { objects?: unknown[] } = {};
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: typeof manifest) => { manifest = m; } };
      throw new Error(`service not registered: ${name}`);
    },
  };
  await new SecurityPlugin({}).init(ctx);
  return (manifest.objects ?? []).filter((o: any) =>
    ['sys_user_position', 'sys_user_permission_set'].includes(o?.name));
}

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** The `kid` a compact JWS was signed with. */
const kidOf = (jwt: string | null): string | undefined =>
  jwt ? JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString('utf8')).kid : undefined;

/** Count per object, for a readable failure. */
const tally = (objects: string[]): Record<string, number> =>
  objects.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o]: (acc[o] ?? 0) + 1 }), {});

interface RigOptions {
  /** Grant the signed-in user one permission set in the active organization. */
  directGrant?: boolean;
  /** Declare `sys_user_permission_set.display_title` as {@link ONE_HOP_GRANT_TITLE}. */
  oneHopGrantTitle?: boolean;
}

/** A signed-in user whose session has an active organization, on a warmed engine. */
async function signedInRig(options: RigOptions = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  const grants = (await grantTables()).map((o: any) =>
    options.oneHopGrantTitle && o.name === 'sys_user_permission_set' ? withOneHopGrantTitle(o) : o);
  for (const object of [...authIdentityObjects, SysMetadataActivation, ...grants]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  vi.spyOn((engine as any).logger, 'info').mockImplementation(() => undefined);
  const probe = probeDriver(driver as unknown as Record<string, any>);

  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
  const signedUp = await manager.handleRequest(new Request(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'prelude@example.com', password: 'password-24061-prelude', name: 'Prelude' }),
  }));
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const cookie = cookieFrom(signedUp);
  const first = await manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
  const session: any = await first.json();
  const now = new Date().toISOString();
  await engine.insert('sys_organization', { id: 'org_prelude', name: 'Prelude', slug: 'prelude', created_at: now }, SYS);
  await engine.insert('sys_member', { id: 'mem_prelude', organization_id: 'org_prelude', user_id: session.user.id, role: 'owner', created_at: now }, SYS);
  await engine.update('sys_session', { id: session.session.id, active_organization_id: 'org_prelude' }, SYS);
  if (options.directGrant) {
    await engine.insert('sys_user_permission_set', {
      id: 'ups_prelude', user_id: session.user.id, permission_set: 'prelude_editor', organization_id: 'org_prelude', created_at: now,
    }, SYS);
  }

  const api: any = await manager.getApi();
  const headers = new Headers({ cookie });
  const prelude = () => resolveAuthzContext({
    ql: engine,
    headers,
    getSession: async (h: unknown) => api.getSession(inProcessSessionReadInput(h)),
  } as never);
  // The first resolution to name an engine registers the request memo's write
  // observer and, by that memo's own rule, stores nothing — a cold engine pays
  // once. Every request after it is the request this file measures.
  await prelude();
  return { engine, manager, probe, cookie, headers, prelude, userId: session.user.id as string };
}

/** The 8 reads of the prelude: the session row, the user row, the grant wave, the activation ledger. */
const PRELUDE_READS = {
  sys_session: 1,
  sys_user: 2,
  sys_member: 2,
  sys_user_position: 1,
  sys_user_permission_set: 1,
  sys_metadata_activation: 1,
};

describe('[#24061] one authenticated request\'s prelude, counted on a real engine', () => {
  it('the shared prelude (REST, dispatcher): 8 reads in 4 round trips, no keyring read', async () => {
    const { probe, prelude, userId } = await signedInRig();

    const run = await probe.measure(prelude);

    expect((run.result as any).userId).toBe(userId);
    expect((run.result as any).tenantId).toBe('org_prelude');
    expect(tally(run.objects)).toEqual(PRELUDE_READS);
    expect(run.objects).toHaveLength(8);
    expect(run.legs).toBe(4);
  }, 60_000);

  it('the /auth/me/* resolver: the same 8 reads in 4 round trips — the grants resolved once', async () => {
    const { engine, manager, probe, headers, userId } = await signedInRig();
    const resolveCtx = makeExecutionContextResolver({
      getService: <T,>(name: string) => ({ auth: manager, objectql: engine } as Record<string, unknown>)[name] as T,
    });

    const run = await probe.measure(() => resolveCtx({ req: { raw: { headers } } }));

    expect(run.result?.userId).toBe(userId);
    expect(run.result?.tenantId).toBe('org_prelude');
    expect(run.result?.positions).toContain('org_owner');
    expect(tally(run.objects)).toEqual(PRELUDE_READS);
    expect(run.legs).toBe(4);
  }, 60_000);

  describe.each([
    ['as declared', false],
    ['with a title that reads one hop through user_id', true],
  ])('a principal holding a direct grant, its title %s', (_title, oneHopGrantTitle) => {
    it('the shared prelude: the same 8 reads in 4 round trips', async () => {
      const { engine, probe, prelude, userId } = await signedInRig({ directGrant: true, oneHopGrantTitle });
      // The grant is real, and its title formula is computed on a read that does
      // not project it — so the hop, where declared, is live on this engine.
      const [held] = (await engine.find('sys_user_permission_set', { where: { user_id: userId }, ...SYS })) as any[];
      expect(held?.permission_set).toBe('prelude_editor');
      expect(held?.display_title).toBe('Prelude → prelude_editor');

      const run = await probe.measure(prelude);

      expect((run.result as any).userId).toBe(userId);
      expect((run.result as any).tenantId).toBe('org_prelude');
      expect(tally(run.objects)).toEqual(PRELUDE_READS);
      expect(run.legs).toBe(4);
    }, 60_000);
  });

  it('the HTTP /get-session still carries set-auth-jwt, and reads the keyring once', async () => {
    const { engine, manager, probe, cookie, userId } = await signedInRig();
    const getSession = () => manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
    const [stored] = (await engine.find('sys_jwks', { ...SYS })) as Array<{ id: string }>;

    // The rig's first signature MINTED the key — a keyring write — so the
    // keyring held before it was retired. This signature reads it once: the
    // key rows, then the `private_key` readback.
    const first = await probe.measure(getSession);
    expect(tally(first.objects)).toEqual({ ...PRELUDE_READS, sys_jwks: 2 });
    expect(first.legs).toBe(6);
    // …and holds it: the next signature reads no key at all.
    const again = await probe.measure(getSession);
    expect(tally(again.objects)).toEqual(PRELUDE_READS);
    expect(again.legs).toBe(4);

    for (const response of [first.result, again.result]) {
      const jwt = response.headers.get('set-auth-jwt');
      expect(jwt, 'the browser-facing /get-session is signed').toBeTruthy();
      expect(kidOf(jwt)).toBe(stored!.id);
      expect(JSON.parse(Buffer.from(jwt!.split('.')[1]!, 'base64url').toString('utf8')).sub).toBe(userId);
    }
  }, 60_000);

  it('an in-process session read signs nothing, even when it asks for the response headers', async () => {
    // The count above cannot see this half: once the keyring is held, a
    // signature reads no key. The header can.
    const { manager, headers, userId } = await signedInRig();
    const api: any = await manager.getApi();

    const read = await api.getSession({ ...inProcessSessionReadInput(headers), returnHeaders: true });

    expect(read.response?.user?.id).toBe(userId);
    expect(read.headers?.get('set-auth-jwt') ?? null).toBeNull();
  }, 60_000);

  it('a keyring write through the engine is seen on the very next signing', async () => {
    const { engine, manager, cookie } = await signedInRig();
    const getSession = () => manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
    const before = kidOf((await getSession()).headers.get('set-auth-jwt'));
    expect(before).toBeTruthy();

    // Retire the signing key: it expired a moment ago.
    await engine.update('sys_jwks', { id: before, expires_at: new Date(Date.now() - 1_000).toISOString() }, SYS);

    const after = kidOf((await getSession()).headers.get('set-auth-jwt'));
    expect(after, 'the next signature uses a key minted after the write').toBeTruthy();
    expect(after).not.toBe(before);
    expect(((await engine.find('sys_jwks', { ...SYS })) as unknown[]).length).toBe(2);
  }, 60_000);
});
