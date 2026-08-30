// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13279] What an UNREACHABLE PERMISSION STORE reads as at the packages door.
 *
 * ## ⚠️ DIVERGENCE PINNED, DISPOSITION OPEN
 *
 * This file records a MEASUREMENT, not a judgment. It states what the code
 * DOES today; it says nothing about what it SHOULD do.
 *
 * ⛔ Nothing here asserts that 403 is the correct answer for a store outage.
 * The single fact pinned is that, today, the two situations below are
 * INDISTINGUISHABLE to the caller and to the operator:
 *
 *   - the permission store is unreachable (every read throws), and
 *   - the permission store is reachable and the caller genuinely holds nothing.
 *
 * The DISPOSITION — whether `tryFind` in
 * `packages/core/src/security/resolve-authz-context.ts` ought to distinguish
 * "no rows" from "the read failed" — is owned by #13279 and is DELIBERATELY
 * UNRULED there, because it is a behaviour change on the SHARED authorization
 * resolver: every transport that authorizes through `resolveAuthzContext`
 * inherits it, not just REST. This pin does not pre-empt that ruling in either
 * direction, and must not be read as evidence for either answer.
 *
 * ⭐ WHEN THAT RULING LANDS, THIS ASSERTION IS EXPECTED TO BE FLIPPED — on
 * purpose. The day `tryFind` starts distinguishing the two cases, the
 * "byte-identical" assertion in section 4 SHOULD go red. That is the pin doing
 * its job, not a regression: it is what makes a deliberate change visible
 * instead of silent. Whoever flips it will find the reasoning on #13279 — flip
 * it there, with that card's ruling quoted, rather than deleting it.
 *
 * ## The seam being measured (not modified)
 *
 * `tryFind` wraps every permission-store read `resolveUserAuthzGrants` issues
 * (`sys_user`, `sys_member`, `sys_user_position`, `sys_user_permission_set`,
 * `sys_permission_set`, ...) in `try { ... } catch { return []; }`. So a read
 * FAILURE and an EMPTY RESULT arrive at the aggregation as the same value, and
 * `resolveAuthzContext` keeps the contract its own docblock states — "Always
 * resolves — never throws".
 *
 * ⇒ On a store outage the resolution does not fail. It SUCCEEDS, carrying an
 * AUTHENTICATED principal whose capability set is empty. The packages door's
 * capability clause then refuses with 403 FORBIDDEN and a message naming a
 * capability, which is the same thing it says to a real capability denial.
 *
 * ## Why this is not #13255 / #12537's seam — measured in section 3
 *
 * That reading is CONTEXT LOST: `resolveExecCtx`'s `.catch(() => undefined)`
 * and the `computeExecCtx` swallow behind it produce an `undefined` context,
 * the anonymous floor sees no `userId`, and the answer is 401. This one is
 * GRANTS LOST: identity SURVIVES (`userId` is still the real caller), only the
 * aggregation is empty, the deciding clause is a different one and the status
 * is different. Section 3 asserts the surviving `userId` precisely so the two
 * cannot be confused, and so a repair aimed at either `.catch` is not mistaken
 * for a repair of this.
 *
 * ## ⭐ The positive controls are LOAD-BEARING, not decoration
 *
 * "The two 403s are byte-identical" passes just as happily in a harness that
 * never invoked anything at all — two responses that were never produced
 * compare equal too. So every equality below is stated next to a same-shaped
 * INEQUALITY on the same comparator (section 4), and the store injection is
 * shown to actually reach the shared resolver (section 2: the healthy store's
 * rows arrive as capabilities, and the faulting store's `find` is really
 * called). A zero from an instrument never shown to produce a one is not a
 * measurement.
 *
 * ## Wiring
 *
 * The real `RestServer` (CONSTRUCTOR SEAMS ONLY — no private member replaced)
 * and the real `registerPackageRoutes`, joined exactly the way
 * `rest-api-plugin.ts` joins them:
 * `resolveExecutionContext: (req) => restServer.resolvePackageRouteExecutionContext(req)`.
 * The only injected things are the two providers the plugin also supplies —
 * `authServiceProvider` (identity) and `objectQLProvider` (the permission
 * store). No external service is needed, so this runs on the ordinary CI lane.
 */

import { describe, it, expect, vi } from 'vitest';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';
import { RestServer } from './rest-server.js';

const PKGS = '/api/v1/packages';

/** The capabilities the packages door gates on: read wants one, write the other. */
const GRANTED = ['manage_metadata', 'studio.access'];

const USER_ID = 'u_admin';
const PS_ID = 'ps_studio_operator';

/**
 * The rows a HEALTHY permission store answers for {@link USER_ID}. Shaped for
 * the reads `resolveUserAuthzGrants` actually issues: a user-scoped grant row
 * pointing at a permission set whose `system_permissions` carry the two
 * capabilities. Tables not listed answer empty, which is what a real store
 * with no memberships/positions does.
 */
const HEALTHY_ROWS: Record<string, unknown[]> = {
  sys_user: [{ id: USER_ID, email: 'admin@example.test' }],
  sys_user_permission_set: [{ user_id: USER_ID, permission_set_id: PS_ID }],
  sys_permission_set: [{ id: PS_ID, name: 'studio_operator', system_permissions: GRANTED }],
};

/** ObjectQL seam as `resolveAuthzContext` consumes it: `find(object, query)`. */
type Store = { find: (object: string, query: unknown) => Promise<unknown[]> };

/** Healthy: reachable, and it returns the grant rows. */
const healthyStore = (): Store => ({
  find: vi.fn(async (object: string) => HEALTHY_ROWS[object] ?? []),
});

/** Outage: reachable-in-code, but EVERY read throws. */
const faultingStore = (): Store => ({
  find: vi.fn(async () => { throw new Error('permission store unreachable'); }),
});

/** Genuinely empty: reachable, and the caller really holds nothing. */
const emptyStore = (): Store => ({
  find: vi.fn(async () => []),
});

/** An auth service that authenticates {@link USER_ID} — same shape the plugin's provider hands over. */
const AUTH_SERVICE = {
  api: {
    getSession: async () => ({ user: { id: USER_ID, email: 'admin@example.test' }, session: {} }),
  },
};

interface Captured {
  status: number;
  body: any;
}

interface Door {
  routes: Map<string, RouteHandler>;
  rest: RestServer;
  store: Store;
}

/**
 * The production join, over one permission store. `RestServer` is constructed
 * through its CONSTRUCTOR only; the door reads identity through the same public
 * `resolvePackageRouteExecutionContext` the plugin wires.
 */
function doorOver(store: Store): Door {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  const rest = new RestServer(
    server,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    async () => AUTH_SERVICE,
    async () => store,
  );
  registerPackageRoutes(server, () => ({ list: async () => [] }) as any, '/api/v1', {
    resolveExecutionContext: (req: any) => rest.resolvePackageRouteExecutionContext(req),
  } as any);
  return { routes, rest, store };
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, any> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 0, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

/** `GET /packages` through the real door, over one permission store. */
const listOver = (store: Store) => drive(doorOver(store).routes, 'GET', PKGS);

/** The execution context the door itself resolves, over one permission store. */
const contextOver = (store: Store) =>
  doorOver(store).rest.resolvePackageRouteExecutionContext({
    params: {}, query: {}, headers: {}, method: 'GET', path: PKGS,
  });

// ---------------------------------------------------------------------------
// 1. CONTROLS — the instrument produces a ONE before any zero is read.
// ---------------------------------------------------------------------------

describe('[#13279] controls — the harness really drives the door and the store', () => {
  it('CONTROL (allow is observable): a healthy store is served 200', async () => {
    const captured = await listOver(healthyStore());
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('CONTROL (the store is really read): the faulting store\'s `find` is called', async () => {
    const store = faultingStore();
    await drive(doorOver(store).routes, 'GET', PKGS);
    // ⚠️ If this were 0 the whole file would be measuring an unwired harness.
    expect((store.find as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('CONTROL (the fault really faults): the injected store rejects', async () => {
    await expect(faultingStore().find('sys_user', {})).rejects.toThrow('permission store unreachable');
  });
});

// ---------------------------------------------------------------------------
// 2. THE INJECTION REACHES THE SHARED RESOLVER — the healthy store's rows
//    arrive as capabilities, so an empty capability set elsewhere is a
//    property of the STORE, not of a resolver that never saw one.
// ---------------------------------------------------------------------------

describe('[#13279] the permission store injection reaches `resolveAuthzContext`', () => {
  it('a healthy store yields the two granted capabilities on the resolved context', async () => {
    const ctx: any = await contextOver(healthyStore());
    expect(ctx?.userId).toBe(USER_ID);
    for (const capability of GRANTED) expect(ctx?.systemPermissions).toContain(capability);
  });
});

// ---------------------------------------------------------------------------
// 3. THE DEGRADE IS "GRANTS LOST", NOT "CONTEXT LOST".
//
//    Asserted so this reading can never be folded into #13255 / #12537: there
//    the context becomes `undefined` and the anonymous floor answers 401. Here
//    the IDENTITY SURVIVES and only the aggregation is empty, which is why the
//    refusal comes from the capability clause instead.
// ---------------------------------------------------------------------------

describe('[#13279] a store outage resolves an AUTHENTICATED principal holding nothing', () => {
  it('the resolution SUCCEEDS: the caller is still `u_admin`, with an empty capability set', async () => {
    const ctx: any = await contextOver(faultingStore());
    // Not `undefined` — that is the other card's degrade, and its status is 401.
    expect(ctx).toBeDefined();
    expect(ctx?.userId).toBe(USER_ID);
    expect(ctx?.systemPermissions).toEqual([]);
  });

  it('a reachable, genuinely EMPTY store resolves the same shape', async () => {
    const ctx: any = await contextOver(emptyStore());
    expect(ctx?.userId).toBe(USER_ID);
    expect(ctx?.systemPermissions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. ⭐ THE PIN — the outage and the genuine denial are ONE answer on the wire.
//
//    ⛔ Read this as "indistinguishable today", never as "403 is correct".
//    Disposition: open, owned by #13279's deliberately-unruled question.
// ---------------------------------------------------------------------------

describe('[#13279] a store OUTAGE is byte-identical to a genuine capability DENIAL', () => {
  it('healthy 200, faulting 403 FORBIDDEN, empty 403 FORBIDDEN — the table as driven', async () => {
    const [healthy, faulted, empty] = await Promise.all([
      listOver(healthyStore()),
      listOver(faultingStore()),
      listOver(emptyStore()),
    ]);
    expect(healthy.status).toBe(200);

    expect(faulted.status).toBe(403);
    expect(faulted.body?.error?.code).toBe('FORBIDDEN');
    expect(empty.status).toBe(403);
    expect(empty.body?.error?.code).toBe('FORBIDDEN');

    // The divergence itself. ⚠️ EXPECTED TO BE FLIPPED, deliberately, on the
    // day `tryFind` distinguishes "no rows" from "the read failed" — the
    // reasoning for the flip belongs on #13279, which does not rule it here.
    expect(JSON.stringify(faulted)).toBe(JSON.stringify(empty));
  });

  it('⭐ CONTROL: the SAME comparator SEPARATES the healthy 200 from the refusal', async () => {
    const [healthy, faulted] = await Promise.all([listOver(healthyStore()), listOver(faultingStore())]);
    // ⚠️ LOAD-BEARING. Without this, the equality above would also pass in a
    // harness that produced nothing at all — two absent answers compare equal.
    // This shows the comparator discriminates on responses this harness really
    // produced, so the equality above is a measured sameness, not a vacuous one.
    expect(JSON.stringify(healthy)).not.toBe(JSON.stringify(faulted));
  });

  it('the refusal names a capability — the operator is told about entitlement, during an outage', async () => {
    const faulted = await listOver(faultingStore());
    expect(faulted.body?.error?.message).toContain('studio.access');
    // Same sentence for the genuine denial: the MESSAGE carries no discriminator either.
    const empty = await listOver(emptyStore());
    expect(empty.body?.error?.message).toBe(faulted.body?.error?.message);
  });

  it('the write half reads the same way — outage and denial agree there too', async () => {
    const publish = { body: { manifest: { id: 'com.acme.crm', version: '1.0.0' }, metadata: {} } };
    const [faulted, empty] = await Promise.all([
      drive(doorOver(faultingStore()).routes, 'POST', `${PKGS}/publish`, publish),
      drive(doorOver(emptyStore()).routes, 'POST', `${PKGS}/publish`, publish),
    ]);
    expect(faulted.status).toBe(403);
    expect(JSON.stringify(faulted)).toBe(JSON.stringify(empty));
  });
});
