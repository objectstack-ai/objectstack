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
 *  3. the catch around the read is unchanged: a read that throws lets the
 *     request through (`null`), as it did before. That is pre-existing
 *     behaviour, pinned as it stands, not endorsed here.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

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

function makeDispatcher(find: (...args: FindCall) => Promise<unknown>) {
  const ql = { find: vi.fn(find) };
  const kernel: any = {
    context: {
      getService: (name: string) => {
        if (name === 'auth') {
          return { getApi: async () => ({ getSession: async () => ({ user: { id: USER } }) }) };
        }
        if (name === 'objectql') return ql;
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

describe('environment-membership gate — the catch around the read is unchanged (pre-existing)', () => {
  it('a read that throws lets the request through (null), as before', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { ql, check } = makeDispatcher(async () => {
        throw new Error('control-plane store unavailable');
      });
      expect(await check()).toBeNull();
      expect(ql.find).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
    }
  });
});
