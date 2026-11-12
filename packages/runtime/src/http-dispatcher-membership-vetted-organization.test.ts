// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment-membership gate reads, for a session principal, the
 * organization the request's resolution vetted (`resolveAuthzContext`, run for
 * real on each request under an `isolated` posture, and once with no tenancy
 * posture), the one every other door reads.
 *
 * A multi-tenant host: a stub resolver places every request in one
 * environment, on a tenant kernel whose `sys_environment_member` holds no row,
 * so a caller the gate judges is answered `403 PROJECT_MEMBERSHIP_REQUIRED`
 * and a caller it passes makes no membership read.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from './http-dispatcher.js';

const ENV = 'env-tenant';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000000';
const OTHER_ORG = 'org-acme';
const STAFF = 'user-staff';
const OUTSIDER = 'user-outsider';
const MCP_CALL = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

/**
 * The tenant host. The cookie session reads as `user`, claiming
 * `activeOrganizationId`; `memberOf` are that user's `sys_member` rows.
 */
function tenantHost(opts: { user: string; activeOrganizationId: string; memberOf: string[]; posture?: string | null }) {
    const find = vi.fn(async (object: string, query: { where?: Record<string, unknown> }) => {
        const where = query?.where ?? {};
        if (object === 'sys_member' && where.user_id === opts.user) {
            return opts.memberOf.map((org, i) => ({ id: `mem-${i}`, user_id: opts.user, organization_id: org }));
        }
        if (object === 'sys_member' && typeof where.organization_id === 'string' && opts.memberOf.includes(where.organization_id)) {
            return [{ id: 'mem-x', user_id: opts.user, organization_id: where.organization_id }];
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
            getSession: async () => ({
                user: { id: opts.user },
                session: { userId: opts.user, activeOrganizationId: opts.activeOrganizationId },
            }),
        }),
    };
    const posture = opts.posture === undefined ? 'isolated' : opts.posture;
    const tenant = kernelWith({ objectql, auth, ...(posture === null ? {} : { tenancy: { posture } }) });
    const resolver: KernelResolver = {
        resolveKernel: async (c: HttpProtocolContext) => {
            c.environmentId = ENV;
            return tenant;
        },
    };
    const dispatcher = new HttpDispatcher(kernelWith({}), undefined, {
        kernelResolver: resolver,
        enforceProjectMembership: true,
    });
    const membershipReads = () => find.mock.calls
        .filter((call) => call[0] === 'sys_environment_member')
        .map((call) => (call[1] as { where: { user_id: string } }).where.user_id);
    return { dispatcher, membershipReads };
}

const mcp = (): HttpProtocolContext => ({
    request: new Request('http://tenant.example/api/v1/mcp', { method: 'POST' }),
});

function membershipRefusal(result: { response?: { status: number; body?: any } }) {
    const error = result.response?.body?.error;
    return result.response?.status === 403 && error?.code === 'PROJECT_MEMBERSHIP_REQUIRED'
        ? { userId: error?.details?.userId as string | undefined }
        : undefined;
}

describe('the environment-membership gate reads the vetted organization of a session', () => {
    it('a session is judged in the organization its resolution vetted', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: OUTSIDER, activeOrganizationId: PLATFORM_ORG, memberOf: [] });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a member of the platform organization passes', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: STAFF, activeOrganizationId: PLATFORM_ORG, memberOf: [PLATFORM_ORG] });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });

    it('CONTROL: a claim naming another organization the user is in is judged', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: OUTSIDER, activeOrganizationId: OTHER_ORG, memberOf: [OTHER_ORG] });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('[ADR-0093 D8.1, as amended] with no tenancy posture too, a platform-organization claim no membership backs is not kept, so the session is judged', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: STAFF, activeOrganizationId: PLATFORM_ORG, memberOf: [], posture: null });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: STAFF });
        expect(membershipReads()).toEqual([STAFF]);
    });

    it('CONTROL: with no tenancy posture, a member of the platform organization passes', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: STAFF, activeOrganizationId: PLATFORM_ORG, memberOf: [PLATFORM_ORG], posture: null });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });
});
