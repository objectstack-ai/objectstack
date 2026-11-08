// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment-membership gate judges the principal the request resolved,
 * whichever credential admitted it.
 *
 * A multi-tenant host: a stub resolver places every request in one
 * environment, on a tenant kernel whose `sys_environment_member` holds a row
 * only for {@link MEMBER}. The gate's answer is read off the dispatch result
 * (`403 PROJECT_MEMBERSHIP_REQUIRED`, naming the user it judged) and off the
 * membership reads it made.
 *
 *  - CONTROL: a cookie session for a non-member is refused, as before.
 *  - A principal an OAuth access token admitted on `/mcp` is judged: refused
 *    when it is not a member, and admitted when it is.
 *  - A token for a non-member sent beside a member's cookie is judged as the
 *    token's principal, the one the request resolved.
 *  - A principal an API key admitted is judged as the key's owner, on `/mcp`
 *    and on a scoped data route alike.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { hashApiKey } from '@objectstack/core';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from './http-dispatcher.js';

const ENV = 'env-tenant';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
/** JWT-shaped: three dot-separated segments, which is what the token door reads. */
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';
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

/**
 * The tenant host. `cookieUser` is who the cookie session reads as (none when
 * absent); `tokenUser` is who a verified OAuth access token names.
 */
function tenantHost(opts: { cookieUser?: string; tokenUser?: string; keyOwner?: string }) {
    const find = vi.fn(async (object: string, query: { where?: Record<string, unknown> }) => {
        const where = query?.where ?? {};
        if (object === 'sys_environment_member') {
            return where.environment_id === ENV && where.user_id === MEMBER
                ? [{ id: 'm1', environment_id: ENV, user_id: MEMBER }]
                : [];
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
    const auth = {
        getApi: async () => ({
            getSession: async () => (opts.cookieUser
                ? { user: { id: opts.cookieUser }, session: { userId: opts.cookieUser } }
                : null),
        }),
        verifyMcpAccessToken: vi.fn(async () => (opts.tokenUser
            ? { userId: opts.tokenUser, clientId: 'client-1', scopes: ['data:read'] }
            : null)),
    };
    const tenant = kernelWith({ objectql, auth });
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

const mcp = (headers: Record<string, string>): HttpProtocolContext => ({
    request: new Request('http://tenant.example/api/v1/mcp', { method: 'POST', headers }),
});

function membershipRefusal(result: { response?: { status: number; body?: any } }) {
    const error = result.response?.body?.error;
    return result.response?.status === 403 && error?.code === 'PROJECT_MEMBERSHIP_REQUIRED'
        ? { userId: error?.details?.userId as string | undefined }
        : undefined;
}

describe('the environment-membership gate judges the resolved principal', () => {
    it('CONTROL: a cookie session for a non-member is refused', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: OUTSIDER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({}));
        expect(membershipRefusal(result)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a principal an OAuth access token admitted, not a member: refused, naming the token\'s user', async () => {
        const { dispatcher, membershipReads } = tenantHost({ tokenUser: OUTSIDER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ authorization: `Bearer ${TOKEN}` }));
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a token for a non-member beside a member\'s cookie: judged as the token\'s principal, refused', async () => {
        const { dispatcher, membershipReads } = tenantHost({ cookieUser: MEMBER, tokenUser: OUTSIDER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ authorization: `Bearer ${TOKEN}` }));
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a principal an API key admitted, not a member: refused, naming the key\'s owner', async () => {
        const { dispatcher, membershipReads } = tenantHost({ keyOwner: OUTSIDER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ 'x-api-key': API_KEY }));
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('a principal an API key admitted on a scoped non-MCP route, not a member: refused, naming the key\'s owner', async () => {
        const { dispatcher, membershipReads } = tenantHost({ keyOwner: OUTSIDER });
        const context: HttpProtocolContext = {
            request: new Request('http://tenant.example/api/v1/data/task', { headers: { 'x-api-key': API_KEY } }),
        };
        const result = await dispatcher.dispatch('GET', '/data/task', undefined, {}, context);
        expect(membershipRefusal(result), JSON.stringify(result.response?.body)).toEqual({ userId: OUTSIDER });
        expect(membershipReads()).toEqual([OUTSIDER]);
    });

    it('CONTROL: a principal an OAuth access token admitted, a member: passes the gate', async () => {
        const { dispatcher, membershipReads } = tenantHost({ tokenUser: MEMBER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ authorization: `Bearer ${TOKEN}` }));
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([MEMBER]);
    });

    it('CONTROL: a principal an API key admitted, a member: passes the gate', async () => {
        const { dispatcher, membershipReads } = tenantHost({ keyOwner: MEMBER });
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({ 'x-api-key': API_KEY }));
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([MEMBER]);
    });

    it('CONTROL: no credential at all is not judged here', async () => {
        const { dispatcher, membershipReads } = tenantHost({});
        const result = await dispatcher.dispatch('POST', '/mcp', MCP_CALL, {}, mcp({}));
        expect(membershipRefusal(result)).toBeUndefined();
        expect(membershipReads()).toEqual([]);
    });
});
