// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A member removed from an environment is refused on their next request.
 *
 * The environment-membership gate judges every request against the
 * membership store as it stands: an admission is never carried from one
 * request to the next. So a removal takes effect on the caller's very next
 * request, on every replica serving the environment, and a store that cannot
 * answer refuses the request (`503 SERVICE_UNAVAILABLE`) whoever was admitted
 * a moment before.
 *
 * A multi-tenant host: a stub resolver places every request in one
 * environment, on a tenant kernel whose `sys_environment_member` reads a
 * shared, mutable membership store. "Two replicas" are two dispatchers over
 * that one store. The gate's answer is read off the dispatch result.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { isAuthzStoreUnavailableError } from '@objectstack/core';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from './http-dispatcher.js';

const ENV = 'env-tenant';
const SYSTEM_ENV = '00000000-0000-0000-0000-000000000001';
const MEMBER = 'user-member';
const MCP_CALL = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

/** The membership store every replica reads: rows by `environment:user`, and whether it answers. */
function membershipStore(initial: string[] = [`${ENV}:${MEMBER}`]) {
    const rows = new Set(initial);
    return {
        rows,
        reachable: true,
        remove(environmentId: string, userId: string) { rows.delete(`${environmentId}:${userId}`); },
        add(environmentId: string, userId: string) { rows.add(`${environmentId}:${userId}`); },
    };
}

type Store = ReturnType<typeof membershipStore>;

/** One replica: a dispatcher whose tenant kernel reads `store`, signed in as `user`. */
function replica(store: Store, opts: { user?: string; environmentId?: string } = {}) {
    const user = opts.user ?? MEMBER;
    const environmentId = opts.environmentId ?? ENV;
    const find = vi.fn(async (object: string, query: { where?: Record<string, unknown> }) => {
        const where = query?.where ?? {};
        if (object === 'sys_environment_member') {
            if (!store.reachable) throw new Error('membership store unreachable');
            const key = `${String(where.environment_id)}:${String(where.user_id)}`;
            return store.rows.has(key)
                ? [{ id: `m-${key}`, environment_id: where.environment_id, user_id: where.user_id }]
                : [];
        }
        if (object === 'sys_user' && typeof where.id === 'string') return [{ id: where.id }];
        return [];
    });
    const objectql = {
        find,
        getObjects: vi.fn().mockReturnValue({}),
        registry: {
            getObject: vi.fn((name: string) => (name === 'sys_environment_member' ? { name } : null)),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
    const auth = {
        getApi: async () => ({
            getSession: async () => ({ user: { id: user }, session: { userId: user } }),
        }),
    };
    const tenant = kernelWith({ objectql, auth });
    const resolver: KernelResolver = {
        resolveKernel: async (c: HttpProtocolContext) => {
            c.environmentId = environmentId;
            return tenant;
        },
    };
    return new HttpDispatcher(kernelWith({}), undefined, {
        kernelResolver: resolver,
        enforceProjectMembership: true,
    });
}

const mcp = (): HttpProtocolContext => ({
    request: new Request('http://tenant.example/api/v1/mcp', { method: 'POST' }),
});

const call = (dispatcher: HttpDispatcher) => dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());

function membershipRefusal(result: { response?: { status: number; body?: any } }) {
    const error = result.response?.body?.error;
    return result.response?.status === 403 && error?.code === 'PROJECT_MEMBERSHIP_REQUIRED'
        ? { userId: error?.details?.userId as string | undefined }
        : undefined;
}

describe('a member removed from an environment is refused on their next request', () => {
    it('a member admitted on one request and then removed is refused on the very next request', async () => {
        const store = membershipStore();
        const dispatcher = replica(store);
        expect(membershipRefusal(await call(dispatcher))).toBeUndefined();

        store.remove(ENV, MEMBER);

        const next = await call(dispatcher);
        expect(membershipRefusal(next), JSON.stringify(next.response?.body)).toEqual({ userId: MEMBER });
    });

    it('every replica serving the environment refuses the removed member on its next request', async () => {
        const store = membershipStore();
        const replicas = [replica(store), replica(store)];
        for (const dispatcher of replicas) {
            expect(membershipRefusal(await call(dispatcher))).toBeUndefined();
        }

        store.remove(ENV, MEMBER);

        for (const dispatcher of replicas) {
            expect(membershipRefusal(await call(dispatcher))).toEqual({ userId: MEMBER });
        }
    });

    it('the declarative-endpoint step applies the same rule: the removed member is refused on the next request', async () => {
        const store = membershipStore();
        const dispatcher = replica(store);
        const first = mcp();
        await dispatcher.resolveRequestScope(first, '/mcp');
        expect(await dispatcher.environmentMembershipRefusal(first)).toBeNull();

        store.remove(ENV, MEMBER);

        const next = mcp();
        await dispatcher.resolveRequestScope(next, '/mcp');
        const refusal = await dispatcher.environmentMembershipRefusal(next);
        expect(membershipRefusal({ response: refusal ?? undefined })).toEqual({ userId: MEMBER });
    });

    it('a member admitted a moment ago is answered 503 when the membership store cannot answer, never admitted', async () => {
        const store = membershipStore();
        const dispatcher = replica(store);
        expect(membershipRefusal(await call(dispatcher))).toBeUndefined();

        store.reachable = false;

        const outcome = await call(dispatcher).then(
            (result) => ({ result, error: undefined as unknown }),
            (error: unknown) => ({ result: undefined, error }),
        );
        expect(outcome.result, JSON.stringify(outcome.result?.response?.body)).toBeUndefined();
        expect(isAuthzStoreUnavailableError(outcome.error)).toBe(true);
        expect(outcome.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, object: 'sys_environment_member' });
    });

    it('a member removed and added back is admitted again on the next request', async () => {
        const store = membershipStore();
        const dispatcher = replica(store);
        store.remove(ENV, MEMBER);
        expect(membershipRefusal(await call(dispatcher))).toEqual({ userId: MEMBER });

        store.add(ENV, MEMBER);

        expect(membershipRefusal(await call(dispatcher))).toBeUndefined();
    });

    it('CONTROL: a member who stays a member is admitted on consecutive requests', async () => {
        const store = membershipStore();
        const dispatcher = replica(store);
        for (let i = 0; i < 3; i += 1) {
            expect(membershipRefusal(await call(dispatcher))).toBeUndefined();
        }
    });

    it('CONTROL: the system environment stays open to a signed-in caller who holds no membership row', async () => {
        const store = membershipStore([]);
        const dispatcher = replica(store, { environmentId: SYSTEM_ENV });
        expect(membershipRefusal(await call(dispatcher))).toBeUndefined();
    });
});
