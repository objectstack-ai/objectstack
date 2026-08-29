// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12537, ruling of 2026-08-29 — option B, part 2 (the rider)] What a
 * SWALLOWED execution-context resolution reads as INSIDE the packages door's
 * permission decision.
 *
 * ## The question this file answers, and the question it does NOT
 *
 * The thread already carried a wire-level reading: a resolver that throws
 * SYNCHRONOUSLY reaches `sendThrownError`, and one that REJECTS is swallowed
 * and the caller sees the anonymous-deny floor. That is an answer about which
 * status code comes out. The rider asks something else, and the two are not
 * the same question: what does an `undefined` execution context MEAN to the
 * gate — is it
 *
 *   (1) a SUBJECT that holds nothing (evaluated, denies),
 *   (2) an evaluation that is SKIPPED, or
 *   (3) a fall-through to a DEFAULT / SYSTEM subject?
 *
 * ⛔ Those three can produce byte-identical responses. (2) and (3) are
 * fail-open postures and (1) is not, so "the status code was the same" is not
 * evidence that the internal reading was the same. Every case below therefore
 * drives a DISCRIMINATOR — an input on which the three readings disagree —
 * and every "did not happen" reading is stated next to a same-shaped POSITIVE
 * CONTROL, because a zero from an instrument that was never shown to produce a
 * one is a false negative, not a measurement.
 *
 * ## Measured answer: (1). The fault is folded onto the ANONYMOUS subject.
 *
 * `refusePackageRequest` (`package-routes.ts`) reads the resolved context
 * through optional chaining only — `ctx?.userId`, `ctx?.isSystem`,
 * `ctx?.systemPermissions` — so `undefined` is not a branch, it is a subject
 * whose every field is absent:
 *
 *   - `shouldDenyAnonymous({ userId: undefined, isSystem: undefined, ... })`
 *     returns `true` ⇒ 401 `UNAUTHENTICATED`. The gate is REACHED and it
 *     DENIES; it is not skipped (section 3) and it does not reach a system
 *     subject (section 2).
 *   - When the anonymous floor is not the deciding clause, the capability
 *     clause evaluates the same `undefined` as a subject holding the EMPTY
 *     capability set ⇒ 403 `FORBIDDEN` (section 4). `ctx?.isSystem` is
 *     `undefined`, so the `isSystem` escape hatch is not taken either.
 *
 * ⇒ The swallow fails CLOSED at this door. It is NOT a permission-adjacent
 * fail-open. What it costs is DIAGNOSABILITY, and section 5 measures that
 * cost exactly: a faulting resolver, an absent resolver, and a genuinely
 * anonymous caller are ONE answer, indistinguishable on the wire.
 *
 * ## ⭐ The swallow at the wrapper is the SECOND net, not the first
 *
 * Section 6 measures the production supplier rather than assuming it.
 * `RestServer.computeExecCtx` wraps its whole body in `try { ... } catch {
 * return undefined; }`, so the production `resolveExecCtx` RESOLVES WITH
 * `undefined` on a fault instead of rejecting. The `.catch(() => undefined)`
 * on the packages-door wrapper `resolvePackageRouteExecutionContext` — and
 * the second one at `package-routes.ts` — therefore have nothing to catch on
 * that path. The fault-to-anonymous conversion happens INSIDE
 * `computeExecCtx`; removing either `.catch` would not by itself surface a
 * production fault. ⛔ That is measured here, not repaired: un-swallowing is
 * explicitly NOT ruled on this card.
 *
 * ## ⛔ What this file must not become
 *
 * Nothing here asserts a status code as an END in itself; every status is
 * read as the OBSERVABLE of a decision, and the decision is what is pinned.
 * A future edit that makes the gate read `undefined` as a system or default
 * subject reds section 2 and section 4 — which is the whole point of writing
 * the reading down rather than the response.
 */

import { describe, it, expect, vi } from 'vitest';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';
import { RestServer } from './rest-server.js';

const PKGS = '/api/v1/packages';

interface Captured {
  status: number;
  body: any;
}

/** A caller holding every capability these routes gate on. */
const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

function mount(options: Record<string, unknown> = {}): Map<string, RouteHandler> {
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
  registerPackageRoutes(server, () => ({ list: async () => [] }) as any, '/api/v1', {
    resolveExecutionContext: CLEARS_THE_GATE,
    ...options,
  } as any);
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

/** `GET /packages` under one resolver wiring. `undefined` ⇒ no resolver wired. */
const listUnder = (resolveExecutionContext: unknown, req: Record<string, any> = {}) =>
  drive(
    mount(resolveExecutionContext === undefined ? { resolveExecutionContext: undefined } : { resolveExecutionContext }),
    'GET',
    PKGS,
    req,
  );

/** The three ways this door can end up holding `undefined`. */
const REJECTS = async () => { throw new Error('resolver fault'); };
const RESOLVES_UNDEFINED = async () => undefined;

// ---------------------------------------------------------------------------
// 1. POSITIVE CONTROLS — this harness can observe an ALLOW, and can observe
//    each refusal clause separately. Every zero below is read against these.
// ---------------------------------------------------------------------------

describe('[#12537] controls — the instrument produces a one before any zero is read', () => {
  it('CONTROL (allow is observable): a fully capable context is served 200', async () => {
    const captured = await listUnder(CLEARS_THE_GATE);
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('CONTROL (the anonymous clause is observable): a named subject is NOT 401', async () => {
    const captured = await listUnder(async () => ({ userId: 'u_named', systemPermissions: [] }));
    expect(captured.status).not.toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('FORBIDDEN');
  });

  it('CONTROL (the resolver really runs): the door calls it exactly once per request', async () => {
    const resolver = vi.fn(REJECTS);
    await listUnder(resolver);
    expect(resolver.mock.calls.length).toBe(1);
  });

  it('CONTROL (the rejection really rejects): the injected resolver is a rejecting promise', async () => {
    await expect(REJECTS()).rejects.toThrow('resolver fault');
  });
});

// ---------------------------------------------------------------------------
// 2. READING (3) FALSIFIED — `undefined` is NOT a default / system subject.
// ---------------------------------------------------------------------------

describe('[#12537] a swallowed resolution does not fall through to a system subject', () => {
  it('a rejecting resolver is REFUSED, not served', async () => {
    const captured = await listUnder(REJECTS);
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.body?.success).toBe(false);
    expect(captured.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  });

  it('CONTROL: a real system subject IS served — so "refused" above is a decision, not an artefact', async () => {
    const captured = await listUnder(async () => ({ isSystem: true }));
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. READING (2) FALSIFIED — the gate is not SKIPPED for `undefined`.
// ---------------------------------------------------------------------------

describe('[#12537] a swallowed resolution does not bypass the gate', () => {
  it('the service is never reached when the resolver rejects', async () => {
    const list = vi.fn(async () => []);
    const routes = new Map<string, RouteHandler>();
    const server = {
      get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
      post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
      use: () => {}, listen: async () => {}, close: async () => {},
    } as any;
    registerPackageRoutes(server, () => ({ list }) as any, '/api/v1', {
      resolveExecutionContext: REJECTS,
    } as any);
    const captured = await drive(routes, 'GET', PKGS);
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    // ⚠️ ZERO. Its control is the next assertion, on the SAME `list` spy shape.
    expect(list.mock.calls.length).toBe(0);
  });

  it('CONTROL: the same spy DOES record a call when the gate is cleared', async () => {
    const list = vi.fn(async () => []);
    const routes = new Map<string, RouteHandler>();
    const server = {
      get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
      post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
      use: () => {}, listen: async () => {}, close: async () => {},
    } as any;
    registerPackageRoutes(server, () => ({ list }) as any, '/api/v1', {
      resolveExecutionContext: CLEARS_THE_GATE,
    } as any);
    const captured = await drive(routes, 'GET', PKGS);
    expect(captured.status).toBe(200);
    expect(list.mock.calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. READING (1) CONFIRMED — the CAPABILITY clause evaluates `undefined` as a
//    subject holding the EMPTY set.
//
//    ⚠️ DISCLOSURE, so no reader mistakes this for a wire path: the packages
//    registrar mounts exactly four routes (POST publish, GET list, GET by id,
//    DELETE by id) and NO `OPTIONS` route, so a real preflight never reaches
//    these handlers. `method: 'OPTIONS'` is used here as the one INPUT that
//    makes the shared `shouldDenyAnonymous` yield without authenticating —
//    i.e. as an instrument for isolating the capability clause from the
//    anonymous clause, which otherwise short-circuits ahead of it. That
//    isolation is the only way to tell "evaluated and holds nothing" apart
//    from "never evaluated": on a plain GET both readings answer 401.
// ---------------------------------------------------------------------------

describe('[#12537] the capability clause reads `undefined` as "holds nothing"', () => {
  it('past the anonymous clause, a swallowed resolution is 403 FORBIDDEN', async () => {
    const captured = await listUnder(REJECTS, { method: 'OPTIONS' });
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('FORBIDDEN');
    expect(captured.body?.error?.message).toContain('studio.access');
  });

  it('CONTROL: past the same clause, a CAPABLE context is served 200', async () => {
    const captured = await listUnder(CLEARS_THE_GATE, { method: 'OPTIONS' });
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('CONTROL: past the same clause, an explicit EMPTY capability set is the same 403', async () => {
    const captured = await listUnder(
      async () => ({ userId: 'u_named', systemPermissions: [] }),
      { method: 'OPTIONS' },
    );
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 5. THE COST — the three origins of `undefined` are ONE answer.
//    This is the defect the card actually describes: not an over-permission,
//    a refusal whose stated reason is wrong for two of the three origins.
// ---------------------------------------------------------------------------

describe('[#12537] a resolver FAULT is indistinguishable from anonymity and from no resolver', () => {
  it('rejecting resolver, resolver returning undefined, and no resolver agree byte for byte', async () => {
    const [faulted, anonymous, unwired] = await Promise.all([
      listUnder(REJECTS),
      listUnder(RESOLVES_UNDEFINED),
      listUnder(undefined),
    ]);
    expect(faulted.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(JSON.stringify(faulted)).toBe(JSON.stringify(anonymous));
    expect(JSON.stringify(faulted)).toBe(JSON.stringify(unwired));
  });

  it('CONTROL: the same comparison SEPARATES two answers that differ', async () => {
    const [faulted, capable] = await Promise.all([listUnder(REJECTS), listUnder(CLEARS_THE_GATE)]);
    expect(JSON.stringify(faulted)).not.toBe(JSON.stringify(capable));
  });

  it('every state-changing route reads the fault the same way', async () => {
    const routes = mount({ resolveExecutionContext: REJECTS });
    const del = await drive(routes, 'DELETE', `${PKGS}/:id`, { params: { id: 'com.acme.crm' } });
    const pub = await drive(routes, 'POST', `${PKGS}/publish`, {
      body: { manifest: { id: 'com.acme.crm', version: '1.0.0' } },
    });
    expect(del.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(pub.status).toBe(ANONYMOUS_DENY_STATUS);
  });
});

// ---------------------------------------------------------------------------
// 6. THE PRODUCTION SUPPLIER — the wrapper's `.catch` is the SECOND net.
// ---------------------------------------------------------------------------

describe('[#12537] the production resolver resolves with `undefined`; it does not reject', () => {
  const restWith = (authServiceProvider: (environmentId?: string) => Promise<any>) =>
    new RestServer(
      { get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {}, use: () => {} } as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      authServiceProvider,
    );

  /** Fulfilled-or-rejected, as an observable value rather than an assertion. */
  const settle = async (p: Promise<unknown>): Promise<'fulfilled' | 'rejected'> =>
    p.then(() => 'fulfilled' as const, () => 'rejected' as const);

  it('CONTROL: the witness distinguishes a rejected promise from a fulfilled one', async () => {
    expect(await settle(Promise.reject(new Error('control')))).toBe('rejected');
    expect(await settle(Promise.resolve(1))).toBe('fulfilled');
  });

  it('a faulting auth-service provider yields a FULFILLED `undefined` from the private resolver', async () => {
    const rest = restWith(() => { throw new Error('auth service exploded'); });
    const req = { params: {}, headers: {}, method: 'GET', path: PKGS };
    // ⭐ The PRIVATE resolver, read BEFORE the wrapper's `.catch` can act —
    // this is what shows the wrapper is not the thing converting the fault.
    const inner = (rest as any).resolveExecCtx(undefined, req);
    expect(await settle(inner)).toBe('fulfilled');
    expect(await inner).toBeUndefined();
  });

  it('CONTROL: when the inner resolve DOES reject, the wrapper is what swallows it', async () => {
    const rest = restWith(async () => undefined);
    (rest as any).computeExecCtx = async () => { throw new Error('injected inner rejection'); };
    const req = { params: {}, headers: {}, method: 'GET', path: PKGS };
    // Same shape as the case above, with the one difference under test — so the
    // "fulfilled" reading there is a property of `computeExecCtx`, not of the
    // instrument.
    expect(await settle((rest as any).resolveExecCtx(undefined, req))).toBe('rejected');
    expect(await settle(rest.resolvePackageRouteExecutionContext(req))).toBe('fulfilled');
    expect(await rest.resolvePackageRouteExecutionContext({ ...req })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. ⚠️ A CORRECTION to the reading this card's thread carried.
//
//    The thread records "synchronous throw ⇒ 403 PERMISSION_DENIED" beside
//    "asynchronous rejection ⇒ 401" as if both were facts ABOUT THIS DOOR.
//    Only the second one is. A synchronous throw does not produce an
//    `undefined` context at all — it escapes the wrapper (which is NOT
//    `async`, so there is no promise for either `.catch` to attach to),
//    lands in the route's own `try`, and is answered by `sendThrownError` →
//    `resolveThrownHttpError`, which reads the STATUS OFF THE THROWN ERROR.
//    So the 403 is a property of the error that was injected, not a decision
//    this gate made: the same seam, thrown a plain `Error`, answers 500.
//
//    ⇒ The two limbs are not two readings of one context. One is a refusal
//    DECIDED by the gate; the other is a status FORWARDED from a producer.
//    Nothing here re-opens the seam census: a production wrapper still cannot
//    throw synchronously (`req?.params?.environmentId` is optional-chained and
//    every downstream call resolves), so this limb remains the declared
//    test-only injection point.
// ---------------------------------------------------------------------------

describe('[#12537] a SYNC throw is forwarded from the producer, not decided by the gate', () => {
  const throwsSync = (error: unknown) => () => { throw error; };

  it('a coded producer error keeps ITS status — the thread\'s 403 is this, not a gate decision', async () => {
    const captured = await listUnder(
      throwsSync(Object.assign(new Error('nope'), { code: 'PERMISSION_DENIED', status: 403 })),
    );
    expect(captured.status).toBe(403);
    expect(captured.body?.error?.code).toBe('PERMISSION_DENIED');
  });

  it('the SAME seam, thrown a plain Error, answers 500 — so the status tracks the error', async () => {
    const captured = await listUnder(throwsSync(new Error('nope')));
    expect(captured.status).toBe(500);
    expect(captured.body?.error?.code).not.toBe('PERMISSION_DENIED');
  });

  it('and neither of those is the swallowed case: a REJECTION is still the 401 floor', async () => {
    const captured = await listUnder(
      async () => { throw Object.assign(new Error('nope'), { code: 'PERMISSION_DENIED', status: 403 }); },
    );
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  });
});
