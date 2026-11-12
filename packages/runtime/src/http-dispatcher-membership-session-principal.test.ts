// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A signed-in caller is never admitted because the environment-membership
 * gate could not read its session.
 *
 * When the identity step admitted the request with a session, the gate judges
 * the principal the request resolved (`executionContext.userId`, in the
 * organization its resolution vetted). An input the gate needs that cannot be
 * read is refused as the outage it is (`503 SERVICE_UNAVAILABLE`), never
 * answered "allowed".
 *
 * A multi-tenant host: a stub resolver places every request in one
 * environment, on a tenant kernel whose `sys_environment_member` holds a row
 * only for {@link MEMBER}. The cookie session reads as `cookieUser` for the
 * identity step; every later session read answers as `reread` says. The
 * gate's answer is read off the dispatch result and off the membership reads
 * it made.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { hashApiKey, isAuthzStoreUnavailableError } from '@objectstack/core';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from './http-dispatcher.js';

const ENV = 'env-tenant';
const SYSTEM_ENV = '00000000-0000-0000-0000-000000000001';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000000';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const STAFF = 'user-staff';
const API_KEY = 'osk_probe0123456789abcdefghijklmnopqrstuvwxyz';
const MCP_CALL = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

/** How every session read after the identity step's own answers. */
type Reread = 'throws' | 'no-session' | 'same';

function tenantHost(opts: {
    cookieUser?: string;
    keyOwner?: string;
    reread: Reread;
    environmentId?: string;
    activeOrganizationId?: string;
    platformMembers?: string[];
    membershipReadThrows?: boolean;
}) {
    const environmentId = opts.environmentId ?? ENV;
    const find = vi.fn(async (object: string, query: { where?: Record<string, unknown> }) => {
        const where = query?.where ?? {};
        if (object === 'sys_environment_member') {
            if (opts.membershipReadThrows) throw new Error('membership store unreachable');
            return where.environment_id === ENV && where.user_id === MEMBER
                ? [{ id: 'm1', environment_id: ENV, user_id: MEMBER }]
                : [];
        }
        if (object === 'sys_member' && opts.platformMembers?.includes(String(where.user_id))) {
            return [{ id: 'mem-p', user_id: where.user_id, organization_id: PLATFORM_ORG }];
        }
        if (object === 'sys_member' && where.organization_id === PLATFORM_ORG
            && opts.cookieUser && opts.platformMembers?.includes(opts.cookieUser)) {
            return [{ id: 'mem-p', user_id: opts.cookieUser, organization_id: PLATFORM_ORG }];
        }
        if (object === 'sys_api_key' && opts.keyOwner && where.key === hashApiKey(API_KEY)) {
            return [{ id: 'key-1', key: hashApiKey(API_KEY), user_id: opts.keyOwner }];
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
    let sessionReads = 0;
    const established = () => (opts.cookieUser
        ? {
            user: { id: opts.cookieUser },
            session: {
                userId: opts.cookieUser,
                ...(opts.activeOrganizationId ? { activeOrganizationId: opts.activeOrganizationId } : {}),
            },
        }
        : null);
    const auth = {
        getApi: async () => ({
            getSession: async () => {
                sessionReads += 1;
                // The identity step's read is the first; the gate's is any later one.
                if (sessionReads === 1 || opts.reread === 'same') return established();
                if (opts.reread === 'throws') throw new Error('session store unreachable');
                return null;
            },
        }),
    };
    const tenant = kernelWith({ objectql, auth });
    const resolver: KernelResolver = {
        resolveKernel: async (c: HttpProtocolContext) => {
            c.environmentId = environmentId;
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

const mcp = (headers: Record<string, string> = {}): HttpProtocolContext => ({
    request: new Request('http://tenant.example/api/v1/mcp', { method: 'POST', headers }),
});

function membershipRefusal(result: { response?: { status: number; body?: any } }) {
    const error = result.response?.body?.error;
    return result.response?.status === 403 && error?.code === 'PROJECT_MEMBERSHIP_REQUIRED'
        ? { userId: error?.details?.userId as string | undefined }
        : undefined;
}

describe('a signed-in caller is never admitted because the gate could not read its session', () => {
    it('a signed-in non-member whose session the gate cannot re-read is refused, naming the resolved principal', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER, reread: 'throws' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a signed-in non-member whose session re-read answers no session is refused, naming the resolved principal', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER, reread: 'no-session' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a signed-in member whose session the gate cannot re-read is judged as the resolved principal and passes', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: MEMBER, reread: 'throws' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([MEMBER]);
    });

    it('a member of the platform organization whose session the gate cannot re-read is judged in the organization its resolution vetted and passes', async () => {
        const { dispatcher, membershipReads } = tenantHost({
            cookieUser: STAFF, reread: 'throws', activeOrganizationId: PLATFORM_ORG, platformMembers: [STAFF],
        });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });

    it('when the membership read cannot answer either, the signed-in caller is answered 503, never admitted', async () => {
        const { dispatcher } = tenantHost({ cookieUser: OUTSIDER, reread: 'throws', membershipReadThrows: true });
        const outcome = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp()).then(
            (result) => ({ result, error: undefined as unknown }),
            (error: unknown) => ({ result: undefined, error }),
        );
        expect(outcome.result, JSON.stringify(outcome.result?.response?.body)).toBeUndefined();
        expect(isAuthzStoreUnavailableError(outcome.error)).toBe(true);
        expect(outcome.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, object: 'sys_environment_member' });
    });

    it('the declarative-endpoint step applies the same rule: a signed-in non-member whose session cannot be re-read is refused', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER, reread: 'throws' });
        const context = mcp();
        await dispatcher.resolveRequestScope(context, '/mcp');
        const refusal = await dispatcher.environmentMembershipRefusal(context);
        expect(membershipRefusal({ response: refusal ?? undefined })).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a signed-in non-member whose session re-reads is refused, as before', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER, reread: 'same' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a principal an API key admitted is judged as the key\'s owner, whatever the session re-read does', async () => {
        const { dispatcher, membershipReads } = tenantHost({ keyOwner: OUTSIDER, reread: 'throws' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ 'x-api-key': API_KEY }));
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a request with no resolved principal is not judged here — upstream auth decides', async () => {
        const { dispatcher, membershipReads } = tenantHost({ reread: 'throws' });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });

    it('CONTROL: the system environment stays open to a signed-in caller', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER, reread: 'throws', environmentId: SYSTEM_ENV });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp());
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });
});
