// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dispatcher's environment-membership gate reads `sys_environment_member`
 * with the explicit system opt-in (`isSystem: true`).
 *
 * The gate is the one asking the question — the caller's user id is the
 * `where`, not the reader — so the read runs as the platform. Before, it
 * reached the engine with no principal and no opt-in: the security
 * middleware's principal-less hand-off (ADR-0096), which is not an
 * authorization, and which a deny of principal-less contexts would refuse.
 *
 * Three facts are pinned here:
 *
 *  1. the read carries the opt-in, for a member and for a non-member, and the
 *     gate's two answers (pass; `403 PROJECT_MEMBERSHIP_REQUIRED`) are
 *     unchanged;
 *  2. the gate KEEPS its answers on an engine that refuses a principal-less,
 *     non-system context — the read is not one, so the non-member is still
 *     refused rather than waved through by the catch below;
 *  3. the gate FAILS CLOSED when its read cannot answer (#21941): a read that
 *     throws, or no engine at all, raises `AuthzStoreUnavailableError` —
 *     `503 SERVICE_UNAVAILABLE`, naming `sys_environment_member` — instead of
 *     letting the request through (`null`), and never answers the membership
 *     `403`; an engine whose registry does not register the object declares
 *     the gate inapplicable without reading. The last section drives the three
 *     answers through the real plugin route and its envelope.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel, isAuthzStoreUnavailableError } from '@objectstack/core';
import { ApiErrorSchema, BaseResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const USER = 'user-1';
const ENV = 'env-private';

type FindCall = [string, Record<string, unknown> | undefined, { context?: Record<string, unknown> } | undefined];

/** The context the engine would act under: the query's, overridden by the trailing options' (ObjectQL's rule). */
function effectiveContext(call: FindCall): Record<string, unknown> {
  const fromQuery = (call[1]?.context ?? {}) as Record<string, unknown>;
  const fromOptions = (call[2]?.context ?? {}) as Record<string, unknown>;
  return { ...fromQuery, ...fromOptions };
}

function isPrincipalLessNonSystem(ctx: Record<string, unknown>): boolean {
  const positions = (ctx.positions as unknown[] | undefined) ?? [];
  const permissions = (ctx.permissions as unknown[] | undefined) ?? [];
  return positions.length === 0 && permissions.length === 0 && !ctx.userId && ctx.isSystem !== true;
}

/**
 * `registry` is the engine's own registration answer: omitted, the engine is
 * one whose registry cannot be asked (it is read as before); given, the gate
 * asks it before reading. `ql: null` is a kernel that resolves no engine.
 */
function makeDispatcher(
  find: (...args: FindCall) => Promise<unknown>,
  opts: { registry?: { getObject: (name: string) => unknown }; noEngine?: boolean } = {},
) {
  const ql = { find: vi.fn(find), ...(opts.registry ? { registry: opts.registry } : {}) };
  const kernel: any = {
    context: {
      getService: (name: string) => {
        if (name === 'auth') {
          return { getApi: async () => ({ getSession: async () => ({ user: { id: USER } }) }) };
        }
        if (name === 'objectql') return opts.noEngine ? null : ql;
        return null;
      },
    },
  };
  const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: true });
  const check = () =>
    (dispatcher as any).enforceProjectMembership(
      { request: { headers: {} }, environmentId: ENV },
      `/api/v1/environments/${ENV}/data/task`,
    ) as Promise<{ status: number; body: any } | null>;
  return { ql, check };
}

function expectMembershipRefusal(response: { status: number; body: any } | null) {
  expect(response?.status).toBe(403);
  expect(response?.body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
}

describe('environment-membership gate — the read carries the system opt-in', () => {
  it('a non-member is refused, and the membership read was isSystem', async () => {
    const { ql, check } = makeDispatcher(async () => []);
    expectMembershipRefusal(await check());

    expect(ql.find).toHaveBeenCalledTimes(1);
    const call = ql.find.mock.calls[0] as FindCall;
    expect(call[0]).toBe('sys_environment_member');
    expect(call[1]?.where).toEqual({ environment_id: ENV, user_id: USER });
    expect(effectiveContext(call).isSystem, 'the membership read reached the engine without the system opt-in').toBe(true);
  });

  it('a member passes, and the membership read was isSystem', async () => {
    const { ql, check } = makeDispatcher(async () => [{ id: 'm1' }]);
    expect(await check()).toBeNull();
    expect(effectiveContext(ql.find.mock.calls[0] as FindCall).isSystem).toBe(true);
  });
});

describe('environment-membership gate — on an engine that refuses a principal-less, non-system context', () => {
  /** Refuses as the security middleware's principal-less deny would: 403 PERMISSION_DENIED, before any row is read. */
  const refusingEngine = (rows: (o: string, q?: Record<string, unknown>) => Promise<unknown>) =>
    async (...call: FindCall) => {
      if (isPrincipalLessNonSystem(effectiveContext(call))) {
        throw Object.assign(new Error('[Security] Access denied: principal-less context'), {
          code: 'PERMISSION_DENIED',
          status: 403,
        });
      }
      return rows(call[0], call[1]);
    };

  it('still refuses the non-member — the gate is not opened by the refusal', async () => {
    const { check } = makeDispatcher(refusingEngine(async () => []));
    expectMembershipRefusal(await check());
  });

  it('still passes the member', async () => {
    const { check } = makeDispatcher(refusingEngine(async () => [{ id: 'm1' }]));
    expect(await check()).toBeNull();
  });
});

/** Settle to the rejection, or to `undefined` when the call RESOLVED. */
const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);

/** The outage the gate raises when its read cannot answer — asserted on its envelope fields, not on the throw alone. */
function expectStoreUnavailable(err: any) {
  expect(err, 'the gate RESOLVED — a read that could not answer let the request through').toBeDefined();
  expect(isAuthzStoreUnavailableError(err)).toBe(true);
  expect(err.code).toBe('SERVICE_UNAVAILABLE');
  expect(err.status).toBe(503);
  expect(err.object).toBe('sys_environment_member');
}

const registered = { getObject: (name: string) => (name === 'sys_environment_member' ? { name } : undefined) };
const unregistered = { getObject: (_name: string) => undefined };

describe('environment-membership gate — fails closed when its read cannot answer (#21941)', () => {
  it('a read that throws is refused as a store outage (503), not let through', async () => {
    // SUPERSEDED PIN, quoted — what the gate answered before:
    //     expect(await check()).toBeNull();   // a read that throws lets the request through
    const { ql, check } = makeDispatcher(async () => {
      throw new Error('control-plane store unavailable');
    });
    const err: any = await rejectionOf(check());
    expectStoreUnavailable(err);
    expect(String(err.cause?.message)).toBe('control-plane store unavailable');
    expect(ql.find).toHaveBeenCalledTimes(1);
  });

  it('the same on an engine whose registry registers the object — a fault on a registered read refuses', async () => {
    const { ql, check } = makeDispatcher(async () => {
      throw new Error('connection reset');
    }, { registry: registered });
    expectStoreUnavailable(await rejectionOf(check()));
    expect(ql.find).toHaveBeenCalledTimes(1);
  });

  it('a refusal by the engine itself is not a membership verdict either — it is the outage, not the 403', async () => {
    const { check } = makeDispatcher(async () => {
      throw Object.assign(new Error('[Security] Access denied'), { code: 'PERMISSION_DENIED', status: 403 });
    });
    expectStoreUnavailable(await rejectionOf(check()));
  });

  it('no engine resolved on the request kernel is refused the same way — the read cannot be made', async () => {
    // SUPERSEDED PIN, quoted — `if (!ql) return null; // No QL — cannot enforce; fail open.`
    const { ql, check } = makeDispatcher(async () => [], { noEngine: true });
    expectStoreUnavailable(await rejectionOf(check()));
    expect(ql.find).not.toHaveBeenCalled();
  });

  it('a healthy read on a registered object still admits a member and still refuses a non-member', async () => {
    const member = makeDispatcher(async () => [{ id: 'm1' }], { registry: registered });
    expect(await member.check()).toBeNull();
    const stranger = makeDispatcher(async () => [], { registry: registered });
    expectMembershipRefusal(await stranger.check());
  });

  it('an engine that does not register `sys_environment_member` declares the gate inapplicable — nothing is read', async () => {
    // The composition's own answer, from the registry: no membership object,
    // so no membership to judge. Not a swallowed fault — the read never runs.
    const { ql, check } = makeDispatcher(async () => {
      throw new Error('must not be read');
    }, { registry: unregistered });
    expect(await check()).toBeNull();
    expect(ql.find).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The door: the three answers through the real plugin route and its envelope
// ---------------------------------------------------------------------------

describe('environment-membership gate — on the wire (real plugin route, real envelope)', () => {
  type Membership = 'member' | 'non-member' | 'read-faults';

  /**
   * A REAL kernel as a host hands the dispatcher: a resolver that scopes every
   * request to ENV, an `auth` service that signs USER in, and an engine that
   * answers every identity read with no rows — so the identity step completes
   * cleanly and the ONLY read that can fault is the membership one.
   */
  function kernelWith(membership: Membership): ObjectKernel {
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    kernel.registerService('kernel-resolver', {
      resolveKernel: (ctx: any, k: any) => {
        ctx.environmentId = ENV;
        return k;
      },
    });
    kernel.registerService('auth', {
      getApi: async () => ({ getSession: async () => ({ user: { id: USER }, session: { userId: USER } }) }),
    });
    kernel.registerService('objectql', {
      registry: registered,
      find: async (object: string) => {
        if (object !== 'sys_environment_member') return [];
        if (membership === 'read-faults') throw new Error('control-plane store unavailable');
        return membership === 'member' ? [{ id: 'm1' }] : [];
      },
    });
    return kernel;
  }

  async function mountOn(kernel: ObjectKernel) {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
      handlers[`${verb} ${path}`] = handler;
    };
    const server = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') };
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, enforceProjectMembership: true });
    await plugin.start?.({
      getKernel: () => kernel,
      getService: (n: string) => (n === 'http.server' ? server : undefined),
      environmentId: undefined,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      hook: () => {},
      on: () => {},
    } as any);
    return handlers;
  }

  async function drive(kernel: ObjectKernel) {
    const handler = (await mountOn(kernel))[ROUTE];
    expect(handler, 'route must be mounted').toBeTypeOf('function');
    const res: any = {
      statusCode: undefined,
      body: undefined,
      status(c: number) { res.statusCode = c; return res; },
      header() { return res; },
      json(b: any) { res.body = b; return res; },
      end() { return res; },
    };
    await handler({ headers: { cookie: 'session=1' }, query: {} }, res);
    return { status: res.statusCode as number, body: res.body };
  }

  // A route behind the gate with no service wired behind it, so a request the
  // gate ADMITS answers the domain's own 501 — distinguishable from both of
  // the gate's refusals.
  const ROUTE = 'GET /api/v1/automation/_status';

  it('POSITIVE CONTROL: a member is admitted — the domain answers (501, no automation service)', async () => {
    const { status, body } = await drive(kernelWith('member'));
    expect(status).toBe(501);
    expect(body?.error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('CONTROL: a non-member is refused by the gate — 403 PROJECT_MEMBERSHIP_REQUIRED', async () => {
    const { status, body } = await drive(kernelWith('non-member'));
    expect(status).toBe(403);
    expect(body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
  });

  it('the membership read faults → 503 with a declared SERVICE_UNAVAILABLE envelope — neither admitted (501) nor the membership 403', async () => {
    // The transport withholds 5xx prose from the caller, so the failed read is
    // named server-side (the error's `object`, pinned above), not on the wire.
    const { status, body } = await drive(kernelWith('read-faults'));
    expect(status).toBe(503);
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(body?.success).toBe(false);
    expect(ApiErrorSchema.safeParse(body?.error).error?.issues ?? []).toEqual([]);
    expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
  });
});
