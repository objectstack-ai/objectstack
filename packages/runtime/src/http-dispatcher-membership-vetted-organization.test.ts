// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment-membership gate lets a session principal past as platform
 * staff only in the organization the request's resolution VETTED, never on
 * the session's stored `activeOrganizationId`.
 *
 * A multi-tenant host under an `isolated` posture: a stub resolver places
 * every request in one environment, on a tenant kernel whose
 * `sys_environment_member` holds no row for anyone, so every caller the gate
 * judges is refused (`403 PROJECT_MEMBERSHIP_REQUIRED`) and a caller it lets
 * past makes no membership read. The REAL identity step runs on each request
 * (`resolveRequestScope` → `resolveExecutionContext` → `resolveAuthzContext`),
 * which keeps a session's organization only while a `sys_member` row backs it.
 *
 *  - A session whose stored claim names the platform organization, for a user
 *    with no membership there: the claim is dropped by the resolution, so the
 *    gate judges the user and refuses them.
 *  - CONTROL: the same claim for a user who IS a member of the platform
 *    organization passes without a membership read.
 *  - CONTROL: a claim naming another organization the user is in is judged.
 *
 * With no resolution of the session's user on the request, the gate judges
 * them: pinned at the gate in `http-dispatcher.test.ts`.
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
function tenantHost(opts: { user: string; activeOrganizationId: string; memberOf: string[] }) {
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
    const tenant = kernelWith({ objectql, auth, tenancy: { posture: 'isolated' } });
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
    it('a stored platform-organization claim with no membership behind it is judged, and refused', async () => {
        const { dispatcher, membershipReads } = tenantHost({ user: OUTSIDER, activeOrganizationId: PLATFORM_ORG, memberOf: [] });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a member of the platform organization passes without a membership read', async () => {
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
});
