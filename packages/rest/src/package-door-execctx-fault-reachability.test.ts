// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13255] REACHABILITY and CONSEQUENCE of a swallowed execution-context
 * resolution, measured at the PACKAGE-MANAGEMENT door.
 *
 * ## What this file is, and what its sibling already answered
 *
 * `package-door-execctx-fault-reading.test.ts` (#12537) answered what an
 * `undefined` execution context MEANS to this gate: a subject that holds
 * nothing, evaluated, denying — not a skipped evaluation and not a fall-through
 * to a system subject. It drove ONE fault class (a synchronously-throwing
 * `authServiceProvider`) and it left the card's own two questions open.
 *
 * This file answers those two:
 *
 *  1. **Reachability.** Which PRODUCTION inputs degrade the resolution, driven
 *     one class at a time through the REAL supplier (`RestServer`, wired at its
 *     constructor seams — no monkeypatched private) and the REAL registrar
 *     (`registerPackageRoutes`, wired the way `rest-api-plugin.ts` wires it).
 *  2. **Consequence.** What the door answers for each class, and specifically
 *     whether a SERVER-SIDE FAULT is ever disguised as a permission denial or
 *     as anonymous access.
 *
 * ## Measured answers — the four the card asked for
 *
 *  - **Is a fault disguised as a permission denial? YES, in TWO shapes.**
 *    - `CONTEXT LOST` (six classes) — the whole context is gone, so the
 *      anonymous floor decides: **401 `UNAUTHENTICATED`**, "Authentication is
 *      required to access this endpoint." The caller may hold a valid session;
 *      the fault is elsewhere.
 *    - `GRANTS LOST` (two classes) — identity survives and the CAPABILITY
 *      aggregation is what faulted, so the door answered **403 `FORBIDDEN`**,
 *      "Reading packages requires the `studio.access` or `setup.access`
 *      capability." An authenticated administrator was told they lack a
 *      capability while the permission store was down. ⭐ This shape does NOT
 *      travel through the `.catch(() => undefined)` the card names, nor through
 *      `computeExecCtx`'s own `catch`: it is `tryFind`'s per-read swallow
 *      inside `resolveAuthzContext` (`@objectstack/core`), one layer further
 *      out.
 *
 *      ⭐ **[#13279] REPAIRED, and this file now pins the repair.** Maintainer
 *      ruling 2026-08-30, verbatim 「第一批其余同意」: `tryFind` distinguishes
 *      "no rows" from "the read failed", and a read failure fails LOUD. The
 *      `PERMISSION_STORE_DOWN` class therefore answers **503
 *      `SERVICE_UNAVAILABLE`** and is no longer byte-identical to its innocent
 *      twin — section 5's assertion is INVERTED IN PLACE, with the superseded
 *      text quoted beside it. ⚠️ The SECOND grants-lost class,
 *      `DATA_ENGINE_UNRESOLVABLE`, is UNCHANGED and still answers 403: it
 *      reaches an empty grant set through `tryFind`'s `!ql` guard (there is no
 *      engine to read) rather than through its `catch` (a read that failed), so
 *      the ruling's landing point does not see it. That residue is asserted
 *      explicitly in section 3 rather than left to be rediscovered.
 *  - **Is a fault ever served as ANONYMOUS ACCESS, or as a silent success? NO.**
 *    Every degraded class is REFUSED on every wire-reachable method of all
 *    four routes. The swallow fails CLOSED. (Section 6.)
 *  - **Does a fault ever reach the caller as the 5xx it is?** It did not, in
 *    any class — that zero was read against a WORKING instrument: section 1
 *    shows this same door answering **500 `INTERNAL_ERROR`** when the fault is
 *    raised one layer later, by the package service. So "no 5xx" was a property
 *    of the degradation, not of the harness. ⭐ **[#13279] Now partitioned
 *    rather than zero**: the ruled permission-store class answers 503 on every
 *    route, and every class the ruling did not reach still answers a refusal.
 *    Section 3 asserts both halves, so the test still fails if a door goes
 *    quiet again OR if an unruled class starts throwing.
 *  - **Does the `.catch(() => undefined)` at
 *    `resolvePackageRouteExecutionContext` ever fire on production input? NO.**
 *    In every class below the private resolver FULFILS. `computeExecCtx` wraps
 *    its whole body in `try { … } catch { return undefined; }`, and every
 *    remaining seam (`resolveRequestEnvironmentId`, `getSession`, `tryFind`)
 *    carries its own swallow — so nothing reaches the wrapper as a rejection.
 *    ⇒ the card's PREMISE holds in its consequence ("a failed resolve is
 *    indistinguishable from no context") and is off by one level in its
 *    MECHANISM: the named `.catch` is a second net over a first that never
 *    lets anything through. Section 4 measures this per class, against a
 *    control that shows the witness CAN report a rejection.
 *
 * ## What this file does, and no longer does not (#13279)
 *
 * As written for #13255 this file repaired nothing and asserted no verdict —
 * distinguishing "no context" from "resolution failed" was a behaviour change
 * on a public door and out of that card's scope. #13279 RULED that change for
 * the permission-store half, so the assertions covering it are now regression
 * pins on the repaired behaviour rather than measurements of a defect.
 *
 * ⛔ The other half is still not repaired and still not asserted as a verdict:
 * `CONTEXT LOST` remains byte-identical to a genuine anonymous caller (section
 * 5's first case is unchanged), and `DATA_ENGINE_UNRESOLVABLE` remains a 403.
 * Both are recorded here as measurements, exactly as before.
 *
 * ## ⭐ [#13280] The SEAM ASYMMETRY is repaired; section 7 pins the repair
 *
 * Section 7 was filed as a finding of its own: at one and the same provider
 * seam, a REJECTION was absorbed and a SYNCHRONOUS throw lost the whole
 * execution context — `settingsServiceProvider` answered **200** when it
 * returned a rejecting promise and **401** when it threw synchronously, both
 * callers holding a valid session and identical grants. The wire answer was
 * decided by whether the host happened to declare its provider `async`.
 *
 * `computeExecCtx` now reaches its seams through `seamOrUndefined`
 * (`rest-server.ts`), so a sync throw and a rejection reach the same answer.
 * Section 7 is INVERTED IN PLACE — it asserts agreement, and the superseded
 * text is quoted beside it. Verifying the card's table also turned up a
 * SECOND divergent seam it had not measured: `objectQLProvider`, 403 when
 * rejecting and 401 when throwing synchronously; it now agrees at 403.
 *
 * ⚠️ What this did NOT change, deliberately: `computeExecCtx`'s outer `catch`.
 * Whether a post-identity fault SHOULD discard identity is a behaviour change
 * on a public door — the second of the two directions the finding recorded,
 * and still unruled. Normalising the seams is decision-independent: under
 * ANY answer to that question, one fault yielding 200 or 401 depending on how
 * the host spelled its provider is a defect.
 *
 * ⚠️ `SETTINGS_PROVIDER_SYNC_THROW` is consequently GONE from the section-2
 * class table — it is no longer a context-lost class. See the block that
 * replaces it there before concluding that coverage was dropped.
 *
 * ## Reading discipline
 *
 * Every class is driven beside a POSITIVE CONTROL that is the same wiring with
 * the one fault removed — so a refusal is read as caused by the fault rather
 * than by an under-wired harness. Statuses are never asserted as ends in
 * themselves: each is read as the observable of a decision, and section 5 pins
 * the decision by showing the fault and its innocent twin are one answer.
 */

import { describe, it, expect } from 'vitest';
import {
  ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS,
  // [#13279] The loud permission-store outage, and its brand predicate.
  AUTHZ_STORE_UNAVAILABLE_CODE, AUTHZ_STORE_UNAVAILABLE_STATUS, isAuthzStoreUnavailableError,
} from '@objectstack/core';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';
import { RestServer } from './rest-server.js';

const PKGS = '/api/v1/packages';

// ---------------------------------------------------------------------------
// Harness — the REAL supplier and the REAL registrar, wired the production way.
// ---------------------------------------------------------------------------

/** The constructor seams a host actually wires. Nothing private is replaced. */
interface Wiring {
  kernelManager?: any;
  defaultEnvironmentIdProvider?: any;
  authServiceProvider?: any;
  objectQLProvider?: any;
  settingsServiceProvider?: any;
  requestEnvResolver?: any;
}

function serverWith(w: Wiring): RestServer {
  return new RestServer(
    { get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {}, use: () => {} } as any,
    {} as any,
    {} as any,
    w.kernelManager,
    undefined,
    w.defaultEnvironmentIdProvider,
    w.authServiceProvider,
    w.objectQLProvider,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    w.settingsServiceProvider,
    undefined,
    undefined,
    w.requestEnvResolver,
  );
}

interface Captured { status: number; body: any }

/**
 * Mount the four package routes against a real `RestServer`, with the resolver
 * wired EXACTLY as `rest-api-plugin.ts` wires it:
 * `resolveExecutionContext: (req) => restServer.resolvePackageRouteExecutionContext(req)`.
 */
function mount(rest: RestServer, list: () => Promise<unknown> = async () => []): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
  } as any;
  registerPackageRoutes(
    server,
    () => ({ list, publish: async () => ({}), delete: async () => ({}) }) as any,
    '/api/v1',
    { resolveExecutionContext: (req: any) => rest.resolvePackageRouteExecutionContext(req) } as any,
  );
  return routes;
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

/** Fulfilled-or-rejected as an observable value, never as an assertion. */
const settle = async (p: Promise<unknown>): Promise<'fulfilled' | 'rejected'> =>
  p.then(() => 'fulfilled' as const, () => 'rejected' as const);

// ---------------------------------------------------------------------------
// Healthy production wiring — the baseline every fault is injected into.
// ---------------------------------------------------------------------------

/** A better-auth-shaped service that resolves a real session. */
const AUTH_OK = async () => ({ api: { getSession: async () => ({ user: { id: 'u_admin' } }) } });

/**
 * A permission store that actually grants the package capabilities, through
 * the SHIPPED aggregation (`sys_user_permission_set` → `sys_permission_set`
 * → `system_permissions`) rather than by handing the door a ready-made context.
 */
const qlHealthy = () => ({
  find: async (object: string) => {
    if (object === 'sys_user_permission_set') return [{ permission_set_id: 'ps_pkg' }];
    if (object === 'sys_permission_set') {
      return [{ id: 'ps_pkg', name: 'pkg_admin', system_permissions: ['manage_metadata', 'studio.access'] }];
    }
    return [];
  },
});

/** The same store, unreachable — every read throws, as a driver outage does. */
const qlDown = () => ({ find: async () => { throw new Error('permission store unreachable'); } });

/** The same store, reachable and genuinely EMPTY — the innocent twin of `qlDown`. */
const qlEmpty = () => ({ find: async () => [] });

const healthy = (): Wiring => ({ authServiceProvider: AUTH_OK, objectQLProvider: async () => qlHealthy() });

// ---------------------------------------------------------------------------
// 1. CONTROL BOARD — every answer this file later reports ABSENT is shown to be
//    producible by this instrument first. Without the 500 control, "a fault is
//    never surfaced as a 5xx" would be indistinguishable from "this harness
//    cannot produce a 5xx".
// ---------------------------------------------------------------------------

describe('[#13255] controls — the instrument can produce 200, 401, 403 and 500', () => {
  it('CONTROL 200: the full production stack, healthy end to end, serves the read', async () => {
    const captured = await drive(mount(serverWith(healthy())), 'GET', PKGS);
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('CONTROL 200: and the capabilities came from the SHIPPED aggregation, not a stub', async () => {
    const rest = serverWith(healthy());
    const ctx = await rest.resolvePackageRouteExecutionContext({ params: {}, headers: {}, method: 'GET', path: PKGS });
    expect(ctx?.userId).toBe('u_admin');
    expect(ctx?.systemPermissions).toContain('manage_metadata');
    expect(ctx?.systemPermissions).toContain('studio.access');
  });

  it('CONTROL 401: a genuinely anonymous caller (no auth wired at all) is refused', async () => {
    const captured = await drive(mount(serverWith({})), 'GET', PKGS);
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  });

  it('CONTROL 403: an authenticated caller who genuinely holds nothing is refused on capability', async () => {
    const captured = await drive(
      mount(serverWith({ authServiceProvider: AUTH_OK, objectQLProvider: async () => qlEmpty() })),
      'GET',
      PKGS,
    );
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('FORBIDDEN');
  });

  it('⭐ CONTROL 500: THIS door does answer a 5xx — when the fault is raised by the package service', async () => {
    const routes = mount(serverWith(healthy()), async () => { throw new Error('driver exploded'); });
    const captured = await drive(routes, 'GET', PKGS);
    expect(captured.status).toBe(500);
    expect(captured.body?.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 2. REACHABILITY — the fault classes, one per production seam.
//
//    `ctx: 'lost'`   — the whole execution context is gone.
//    `ctx: 'grants'` — identity survives, the capability aggregation is empty.
// ---------------------------------------------------------------------------

interface FaultClass {
  id: string;
  /** The production condition this stands for. */
  what: string;
  /** Healthy wiring with exactly ONE seam faulted. */
  faulted: () => Wiring;
  /** The request that reaches the door (scoped mount supplies `params`). */
  req?: Record<string, any>;
  /**
   * `lost`   — the whole execution context is gone.
   * `grants` — identity survives, the capability aggregation is empty.
   * `loud`   — [#13279] the resolution REFUSES rather than resolving at all.
   */
  ctx: 'lost' | 'grants' | 'loud';
  read: { status: number; code: string };
  write: { status: number; code: string };
}

const DENY = { status: ANONYMOUS_DENY_STATUS, code: ANONYMOUS_DENY_CODE };
const FORBID = { status: 403, code: 'FORBIDDEN' };
/**
 * [#13279] The LOUD cohort — a permission-store outage, answered as the outage
 * it is. Ruled 2026-08-30 (maintainer, verbatim 「第一批其余同意」):
 * `tryFind` distinguishes "no rows" from "the read failed", and a read failure
 * fails LOUD, so an outage can no longer be answered as a capability denial.
 */
const UNAVAILABLE = { status: AUTHZ_STORE_UNAVAILABLE_STATUS, code: AUTHZ_STORE_UNAVAILABLE_CODE };

const CLASSES: FaultClass[] = [
  {
    id: 'KERNEL_BOOT',
    what: 'a scoped `/environments/:environmentId/packages` request whose tenant kernel fails to boot',
    faulted: () => ({ ...healthy(), kernelManager: { getOrCreate: async () => { throw new Error('kernel boot failed'); } } }),
    req: { params: { environmentId: 'env_broken' } },
    ctx: 'lost', read: DENY, write: DENY,
  },
  {
    id: 'AUTH_SERVICE_DOWN',
    what: 'the auth service is unavailable (provider rejects)',
    faulted: () => ({ ...healthy(), authServiceProvider: async () => { throw new Error('auth service unavailable'); } }),
    ctx: 'lost', read: DENY, write: DENY,
  },
  {
    id: 'AUTH_SERVICE_SYNC_THROW',
    what: 'the auth-service provider throws SYNCHRONOUSLY (escapes the seam\'s own `.catch`)',
    faulted: () => ({ ...healthy(), authServiceProvider: (() => { throw new Error('auth provider blew up'); }) as any }),
    ctx: 'lost', read: DENY, write: DENY,
  },
  {
    id: 'AUTH_API_BUILD',
    what: 'the auth service is present but `getApi()` fails',
    faulted: () => ({ ...healthy(), authServiceProvider: async () => ({ getApi: async () => { throw new Error('api build failed'); } }) }),
    ctx: 'lost', read: DENY, write: DENY,
  },
  {
    id: 'SESSION_STORE_DOWN',
    what: 'the session store is unreachable (`getSession` rejects)',
    faulted: () => ({ ...healthy(), authServiceProvider: async () => ({ api: { getSession: async () => { throw new Error('session store down'); } } }) }),
    ctx: 'lost', read: DENY, write: DENY,
  },
  // ⭐ [#13280] `SETTINGS_PROVIDER_SYNC_THROW` USED TO LIVE HERE, and its
  // removal from this table is the repair, not a gap in it. The row read:
  //
  //     id: 'SETTINGS_PROVIDER_SYNC_THROW',
  //     what: 'a post-identity provider seam throws SYNCHRONOUSLY — the caller IS authenticated',
  //     faulted: () => ({ ...healthy(), settingsServiceProvider: (() => { throw … }) as any }),
  //     ctx: 'lost', read: DENY, write: DENY,
  //
  // i.e. a SYNCHRONOUS throw at a post-identity settings seam discarded the
  // whole execution context and the authenticated caller was answered 401 —
  // while the SAME seam rejecting asynchronously was absorbed and served 200.
  // The seams are normalised now (`seamOrUndefined`, `rest-server.ts`), so the
  // sync throw is absorbed exactly as the rejection always was: this is no
  // longer a CONTEXT-LOST class at all, and a table of degraded classes is the
  // wrong home for it. Its measurement did not disappear — it MOVED to
  // section 7, which now pins the two shapes as EQUAL rather than recording
  // them as divergent. ⛔ Do not re-add it here to "restore coverage": section
  // 6's "no degraded class is ever served" would then be asserting that a
  // repaired seam is still broken.
  {
    id: 'PERMISSION_STORE_DOWN',
    what: 'identity resolves, then every permission-store read throws',
    faulted: () => ({ ...healthy(), objectQLProvider: async () => qlDown() }),
    // ⭐ [#13279] INVERTED IN PLACE, not re-baselined. Until the 2026-08-30
    // ruling this row read `ctx: 'grants', read: FORBID, write: FORBID` — an
    // authenticated principal with an empty capability set, refused 403. That
    // was the DISGUISE the ruling reverses: the store that holds the
    // capabilities was down, so no capability judgement was ever reached.
    ctx: 'loud', read: UNAVAILABLE, write: UNAVAILABLE,
  },
  {
    id: 'DATA_ENGINE_UNRESOLVABLE',
    what: 'identity resolves, then the data engine cannot be resolved at all',
    faulted: () => ({ ...healthy(), objectQLProvider: async () => { throw new Error('datasource unavailable'); } }),
    ctx: 'grants', read: FORBID, write: FORBID,
  },
];

describe('[#13255] reachability — each production fault class, driven, with its own control', () => {
  it.each(CLASSES)('$id — $what', async (klass) => {
    // ---- the fault -------------------------------------------------------
    const rest = serverWith(klass.faulted());
    const req = { params: {}, headers: {}, method: 'GET', path: PKGS, ...(klass.req ?? {}) };
    // [#13279] The loud cohort never produces a context to inspect — that IS
    // the repair. The resolution REJECTS with the branded outage error instead
    // of fabricating an envelope that reports a capability set nobody read.
    if (klass.ctx === 'loud') {
      const settled = await rest.resolvePackageRouteExecutionContext(req).then(
        (v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }),
      );
      expect(settled.ok).toBe(false);
      // The BRAND, not merely "something threw": an incidental throw would
      // satisfy a bare `.rejects` and prove nothing about which fault fired.
      expect(isAuthzStoreUnavailableError((settled as any).e)).toBe(true);
      expect((settled as any).e.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
      // POSITIVE CONTROL, unchanged: the same wiring minus the fault is served.
      const served = await drive(mount(serverWith(healthy())), 'GET', PKGS, klass.req ?? {});
      expect(served.status).toBe(200);
      return;
    }
    const ctx = await rest.resolvePackageRouteExecutionContext(req);
    if (klass.ctx === 'lost') {
      expect(ctx).toBeUndefined();
    } else {
      // Identity SURVIVES; only the capability aggregation is empty. The
      // difference matters: this shape is refused by a different clause.
      expect(ctx?.userId).toBe('u_admin');
      expect(ctx?.systemPermissions).toEqual([]);
    }
    // `isSystem` is never synthesised by a degrade, in either shape.
    expect(ctx?.isSystem).not.toBe(true);

    // ---- POSITIVE CONTROL: the same wiring, fault removed ----------------
    // A refusal above is caused by the injected fault, not by a harness that
    // could never have been served in the first place.
    const control = await drive(mount(serverWith(healthy())), 'GET', PKGS, klass.req ?? {});
    expect(control.status).toBe(200);
    expect(control.body?.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. CONSEQUENCE — what the package-management door answers, per class, on the
//    read cohort and the write cohort.
// ---------------------------------------------------------------------------

describe('[#13255] consequence — the door\'s answer for each fault class', () => {
  it.each(CLASSES)('$id — read and write cohorts', async (klass) => {
    const routes = mount(serverWith(klass.faulted()));
    const extra = klass.req ?? {};

    const read = await drive(routes, 'GET', PKGS, extra);
    expect(read.status).toBe(klass.read.status);
    expect(read.body?.error?.code).toBe(klass.read.code);

    const del = await drive(routes, 'DELETE', `${PKGS}/:id`, { ...extra, params: { ...(extra.params ?? {}), id: 'com.acme.crm' } });
    expect(del.status).toBe(klass.write.status);
    expect(del.body?.error?.code).toBe(klass.write.code);

    const publish = await drive(routes, 'POST', `${PKGS}/publish`, {
      ...extra,
      body: { manifest: { id: 'com.acme.crm', version: '1.0.0' } },
    });
    expect(publish.status).toBe(klass.write.status);
    expect(publish.body?.error?.code).toBe(klass.write.code);
  });

  it('⭐ [#13279] a permission-store OUTAGE surfaces as a 5xx on every route; every other class still does not', async () => {
    // ⭐ INVERTED IN PLACE, not re-baselined. This test used to assert
    // `seen.filter((s) => s >= 500)` was EMPTY across every class and route —
    // "a fault never reaches the caller as the 5xx it is", which was the
    // card's headline finding. The 2026-08-30 ruling reverses exactly that for
    // the permission-store class, so the assertion is inverted rather than
    // deleted: the zero becomes a partition, and the classes NOT covered by the
    // ruling keep the original reading, which is what makes this still a
    // regression test rather than a rubber stamp.
    const loud: number[] = [];
    const quiet: number[] = [];
    for (const klass of CLASSES) {
      const routes = mount(serverWith(klass.faulted()));
      const extra = klass.req ?? {};
      const bucket = klass.ctx === 'loud' ? loud : quiet;
      bucket.push((await drive(routes, 'GET', PKGS, extra)).status);
      bucket.push((await drive(routes, 'DELETE', `${PKGS}/:id`, { ...extra, params: { ...(extra.params ?? {}), id: 'x' } })).status);
      bucket.push((await drive(routes, 'POST', `${PKGS}/publish`, { ...extra, body: { manifest: { id: 'x', version: '1.0.0' } } })).status);
    }
    // The ruled class: the outage is the answer, on EVERY route — not one door
    // taught to be loud while its siblings kept the disguise.
    expect(loud.length).toBeGreaterThan(0);
    expect(loud.every((s) => s === AUTHZ_STORE_UNAVAILABLE_STATUS)).toBe(true);
    // ⚠️ The classes the ruling did NOT reach still answer a refusal, and that
    // residue is deliberately left visible rather than asserted away:
    // `DATA_ENGINE_UNRESOLVABLE` reaches an empty grant set through `tryFind`'s
    // `!ql` guard (no engine to read) rather than through its `catch` (a read
    // that failed), so the ruling's landing point does not see it.
    expect(quiet.filter((s) => s >= 500)).toEqual([]);
    expect(quiet.every((s) => s === ANONYMOUS_DENY_STATUS || s === 403)).toBe(true);
  });

  it('the capability clause, isolated from the anonymous floor, refuses the lost context too', async () => {
    // `method: 'OPTIONS'` is the one input that makes `shouldDenyAnonymous`
    // yield without authenticating — used here ONLY to separate the two
    // clauses. ⚠️ The registrar mounts no OPTIONS route, so this is not a wire
    // path; it is the instrument that tells "evaluated and holds nothing"
    // apart from "never evaluated".
    const lost = CLASSES.find((c) => c.id === 'AUTH_SERVICE_DOWN')!;
    const captured = await drive(mount(serverWith(lost.faulted())), 'GET', PKGS, { method: 'OPTIONS' });
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('FORBIDDEN');

    // CONTROL: past the SAME clause, a healthy stack is served.
    const control = await drive(mount(serverWith(healthy())), 'GET', PKGS, { method: 'OPTIONS' });
    expect(control.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. THE `.catch(() => undefined)` THE CARD NAMES IS NEVER THE THING THAT
//    FIRES. Measured per class, not inferred.
// ---------------------------------------------------------------------------

describe('[#13255] the private resolver FULFILS on every production fault class', () => {
  it('CONTROL: the witness can report a rejection at all', async () => {
    expect(await settle(Promise.reject(new Error('control')))).toBe('rejected');
    expect(await settle(Promise.resolve(1))).toBe('fulfilled');
  });

  it.each(CLASSES)('$id — `resolveExecCtx` settles the way its cohort declares', async (klass) => {
    const rest = serverWith(klass.faulted());
    const req: Record<string, any> = { params: {}, headers: {}, method: 'GET', path: PKGS, ...(klass.req ?? {}) };
    // The PRIVATE resolver, read BEFORE the wrapper's `.catch` can act — so
    // this reads the supplier, not the net over it.
    const inner = (rest as any).resolveExecCtx(req.params?.environmentId, req);
    // ⭐ [#13279] INVERTED IN PLACE for the loud cohort. This assertion used to
    // read `'fulfilled'` for EVERY class, and that uniformity was the finding:
    // every fault reached the door as a value, so no fault could be told from a
    // verdict. A permission-store outage now REJECTS all the way out here —
    // which is why `computeExecCtx`'s blanket `catch` had to learn to re-raise
    // it. Every other class still fulfils, exactly as measured before.
    expect(await settle(inner)).toBe(klass.ctx === 'loud' ? 'rejected' : 'fulfilled');
  });

  it('CONTROL: when the inner resolve IS made to reject, the wrapper is what absorbs it', async () => {
    // The one case in this file that replaces a private — deliberately, as the
    // control that proves the readings above are a property of the production
    // supplier rather than of the wrapper.
    const rest = serverWith(healthy());
    (rest as any).computeExecCtx = async () => { throw new Error('injected inner rejection'); };
    const req = { params: {}, headers: {}, method: 'GET', path: PKGS };
    expect(await settle((rest as any).resolveExecCtx(undefined, req))).toBe('rejected');
    expect(await settle(rest.resolvePackageRouteExecutionContext({ ...req }))).toBe('fulfilled');
    expect(await rest.resolvePackageRouteExecutionContext({ ...req })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. THE DISGUISE — each fault shape is byte-identical to its INNOCENT twin.
//    This is the card's question 2, stated as a decision rather than a status.
// ---------------------------------------------------------------------------

describe('[#13255] a server-side fault is indistinguishable from the denial it imitates', () => {
  it('CONTEXT LOST: an auth-service outage answers exactly what a genuine anonymous caller answers', async () => {
    const faulted = await drive(
      mount(serverWith({ ...healthy(), authServiceProvider: async () => { throw new Error('auth service unavailable'); } })),
      'GET', PKGS,
    );
    const anonymous = await drive(mount(serverWith({})), 'GET', PKGS);
    expect(faulted.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(JSON.stringify(faulted)).toBe(JSON.stringify(anonymous));
  });

  it('⭐ [#13279] GRANTS LOST: a permission-store outage NO LONGER answers what "you hold nothing" answers', async () => {
    // ⭐ THE INVERSION. This is the #13282 assertion the 2026-08-30 ruling
    // reverses, inverted IN PLACE with its reason recorded — ⛔ not deleted and
    // ⛔ not re-baselined. It used to read:
    //
    //     expect(faulted.status).toBe(403);
    //     expect(faulted.body?.error?.message).toContain('studio.access');
    //     expect(JSON.stringify(faulted)).toBe(JSON.stringify(genuinelyEmpty));
    //
    // i.e. an outage of the permission store and a caller who genuinely holds
    // nothing were ONE answer, byte for byte. Maintainer ruling 2026-08-30,
    // verbatim 「第一批其余同意」: 权限库不可达时不再解析为「已认证零能力」,
    // 而是响亮拒绝(与真实能力拒绝的 403 可区分).
    const faulted = await drive(
      mount(serverWith({ ...healthy(), objectQLProvider: async () => qlDown() })), 'GET', PKGS,
    );
    const genuinelyEmpty = await drive(
      mount(serverWith({ authServiceProvider: AUTH_OK, objectQLProvider: async () => qlEmpty() })), 'GET', PKGS,
    );

    // The outage is answered as an outage — and says so, in words that cannot
    // be read as a permission verdict.
    expect(faulted.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect(faulted.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect(faulted.body?.error?.message).not.toContain('studio.access');

    // ⚠️ The other half of the ruling, and the half a one-sided fix would
    // break: a GENUINE capability denial is untouched. Making outages loud is
    // only correct if real denials still read as denials.
    expect(genuinelyEmpty.status).toBe(403);
    expect(genuinelyEmpty.body?.error?.message).toContain('studio.access');

    // The disguise is gone, stated on the same comparison that pinned it.
    expect(JSON.stringify(faulted)).not.toBe(JSON.stringify(genuinelyEmpty));
  });

  it('CONTROL: the same comparison SEPARATES two answers that differ', async () => {
    const [refused, served] = await Promise.all([
      drive(mount(serverWith({})), 'GET', PKGS),
      drive(mount(serverWith(healthy())), 'GET', PKGS),
    ]);
    expect(JSON.stringify(refused)).not.toBe(JSON.stringify(served));
  });

  it('and the two DISGUISES are not each other — the door distinguishes lost-context from lost-grants', async () => {
    const lost = await drive(
      mount(serverWith({ ...healthy(), authServiceProvider: async () => { throw new Error('down'); } })), 'GET', PKGS,
    );
    const grants = await drive(
      mount(serverWith({ ...healthy(), objectQLProvider: async () => qlDown() })), 'GET', PKGS,
    );
    expect(lost.status).not.toBe(grants.status);
  });
});

// ---------------------------------------------------------------------------
// 6. FAIL-CLOSED — no fault class is ever SERVED. The security-relevant zero.
// ---------------------------------------------------------------------------

describe('[#13255] no degraded class is ever served as anonymous ACCESS or as a silent success', () => {
  it('every class is refused on every wire-reachable route, and never answers 200', async () => {
    const statuses: number[] = [];
    const bodies: any[] = [];
    for (const klass of CLASSES) {
      const routes = mount(serverWith(klass.faulted()));
      const extra = klass.req ?? {};
      for (const call of [
        () => drive(routes, 'GET', PKGS, extra),
        () => drive(routes, 'GET', `${PKGS}/:id`, { ...extra, params: { ...(extra.params ?? {}), id: 'com.acme.crm' } }),
        () => drive(routes, 'DELETE', `${PKGS}/:id`, { ...extra, params: { ...(extra.params ?? {}), id: 'com.acme.crm' } }),
        () => drive(routes, 'POST', `${PKGS}/publish`, { ...extra, body: { manifest: { id: 'com.acme.crm', version: '1.0.0' } } }),
      ]) {
        const captured = await call();
        statuses.push(captured.status);
        bodies.push(captured.body);
      }
    }
    // ⚠️ ZERO, twice. Both are read against section 1's 200 controls, which
    // show this harness serving this same door on healthy wiring.
    expect(statuses.filter((s) => s === 200)).toEqual([]);
    expect(bodies.filter((b) => b?.success === true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. ⭐ [#13280] SEAM AGREEMENT — the same provider seam, the same fault, and
//    now the SAME answer whichever way the provider fails.
//
//    ⭐ INVERTED IN PLACE, not re-baselined. As written for #13255 this section
//    RECORDED a divergence and asserted it, under the heading "sync-throw and
//    rejection do not agree":
//
//      it('a REJECTING settings provider is absorbed … the caller is still served')
//          -> expect(captured.status).toBe(200)
//      it('the SAME seam, throwing synchronously, escapes that `.catch` … refused 401')
//          -> expect(captured.status).toBe(ANONYMOUS_DENY_STATUS)
//
//    Both callers held a valid session and identical grants; the wire answer
//    was decided by whether the host happened to declare its provider `async`.
//    `computeExecCtx` now reaches every one of these seams through
//    `seamOrUndefined`, so the two shapes agree — the assertions are inverted
//    rather than deleted, which is what keeps this a regression pin on the
//    repair instead of a rubber stamp.
//
//    ⚠️ The pins below assert AGREEMENT and the AGREED VALUE, never merely
//    "both are 200". Two of these seams do not agree at 200, and asserting a
//    bare equality would let a future blanket-swallow regression — every seam
//    degrading to a served 200 — pass this section unchanged.
// ---------------------------------------------------------------------------

describe('[#13280] at a post-identity provider seam, sync-throw and rejection AGREE', () => {
  /** The same seam, failed both ways; the door's answer to each. */
  const bothShapes = async (seam: 'settingsServiceProvider' | 'objectQLProvider' | 'authServiceProvider') => {
    const rejecting = await drive(
      mount(serverWith({ ...healthy(), [seam]: async () => { throw new Error('seam unavailable'); } })), 'GET', PKGS);
    const syncThrowing = await drive(
      mount(serverWith({ ...healthy(), [seam]: (() => { throw new Error('seam unavailable'); }) as any })), 'GET', PKGS);
    return { rejecting, syncThrowing };
  };

  it('⭐ settings — a POST-IDENTITY seam: both shapes are absorbed and the caller is SERVED', async () => {
    const { rejecting, syncThrowing } = await bothShapes('settingsServiceProvider');
    // The agreed value, named: identity survives a settings fault, because
    // localization has nothing to do with authorization.
    expect(rejecting.status).toBe(200);
    expect(syncThrowing.status).toBe(200);
    expect(syncThrowing.body?.success).toBe(true);
    // ⭐ The card's headline, as an equality rather than a table: 401 vs 200
    // was the defect, and this is the assertion that fails if it returns.
    expect(syncThrowing.status).toBe(rejecting.status);
  });

  it('⭐ objectQL — the SECOND divergent seam the card did not measure: both shapes answer 403', async () => {
    // [#13280] Not in the card's table, found while verifying it: this seam
    // diverged too, 403 (reject) vs 401 (sync throw). It agrees at 403 — the
    // engine is unresolvable either way, so the caller reaches an EMPTY grant
    // set and is refused on capability, NOT on identity.
    const { rejecting, syncThrowing } = await bothShapes('objectQLProvider');
    expect(rejecting.status).toBe(403);
    expect(syncThrowing.status).toBe(403);
    expect(syncThrowing.body?.error?.code).toBe('FORBIDDEN');
    expect(syncThrowing.status).toBe(rejecting.status);
  });

  it('auth — a PRE-IDENTITY seam: both shapes were ALREADY 401, and still are', async () => {
    // ⚠️ This seam was mechanically asymmetric too (the sync throw escaped its
    // `.catch` to the outer one) but never OBSERVABLY so: an absorbed auth
    // provider yields `undefined`, and the next line is `if (!authService)
    // return undefined`. Pinned precisely because it must NOT move — it is the
    // control showing the normalisation did not turn every seam into a 200.
    const { rejecting, syncThrowing } = await bothShapes('authServiceProvider');
    expect(rejecting.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(syncThrowing.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(syncThrowing.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
    expect(syncThrowing.status).toBe(rejecting.status);
  });

  it('⭐ the three seams do NOT agree with EACH OTHER — 200 / 403 / 401, so agreement is not a blanket swallow', async () => {
    // The guard against the rival repair. "Every seam absorbs everything"
    // would satisfy each per-seam pin above; it would NOT satisfy this. Each
    // seam still degrades according to what it supplies.
    const answers = await Promise.all(
      (['settingsServiceProvider', 'objectQLProvider', 'authServiceProvider'] as const)
        .map(async (seam) => (await bothShapes(seam)).syncThrowing.status),
    );
    expect(answers).toEqual([200, 403, ANONYMOUS_DENY_STATUS]);
    expect(new Set(answers).size).toBe(3);
  });

  it('⭐ [#13279] the loud permission-store outage is NOT absorbed by the normalised seams', async () => {
    // The regression that would matter most: `seamOrUndefined` swallows at the
    // seam, so a reader must be able to see that the branded outage still
    // travels. It does — `AuthzStoreUnavailableError` is raised by `tryFind`
    // inside `resolveAuthzContext`, downstream of every seam here, so no
    // normalised seam is on its path.
    const captured = await drive(mount(serverWith({ ...healthy(), objectQLProvider: async () => qlDown() })), 'GET', PKGS);
    expect(captured.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect(captured.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
  });
});
