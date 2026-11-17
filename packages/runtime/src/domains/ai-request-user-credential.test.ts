// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #34184 — an AI route's `req.user` carries the session's `impersonatedBy`
 * and the kind of credential that admitted the caller (`AIRouteUser` in
 * `@objectstack/spec/contracts`).
 *
 * A door reserved to the person (an in-app pending action only the person the
 * call ran as may decide) has to tell an impersonating administrator, or an
 * API key, from the person. Before this, the route saw only "as whom" and had
 * to read request headers for the rest.
 *
 * Ruled on the card (record 6942875153): Q1 A, the vocabulary stays
 * `session | api_key | oauth` and a login session carried in an
 * `Authorization: Bearer` header is `session`; Q2 A, `impersonatedBy` is
 * carried to the door as is and the door judges it.
 *
 * ## Through `dispatch()` (the real identity step)
 *
 *  - a session cookie: `credential: 'session'`, no `impersonatedBy` key;
 *  - an impersonated session: `credential: 'session'` and `impersonatedBy`
 *    naming the administrator, while `id` stays the impersonated user;
 *  - an API key: `credential: 'api_key'`, no `impersonatedBy` key, even with
 *    an impersonated session cookie riding beside it (the key admitted);
 *  - the same session token in an `Authorization: Bearer` header:
 *    `credential: 'session'`, the same user, the same `impersonatedBy`.
 *
 * The fake auth service plays better-auth's bearer plugin: it answers one
 * session read for the session token whether the token arrives as the cookie
 * or as a bearer header.
 *
 * ## At the handler (`handleAIRequest`)
 *
 *  - an agent principal carrying OAuth scopes (an OAuth token, or the
 *    in-process forward credential): `credential: 'oauth'`;
 *  - an authenticated context with no admission recorded: no `credential`
 *    key, which the contract tells a door to read as "not a session";
 *  - a blank `impersonatedBy` adds no key.
 */

import { describe, expect, it, vi } from 'vitest';

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';

import { hashApiKey } from '@objectstack/core';

import { HttpDispatcher, type HttpProtocolContext } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import { handleAIRequest } from './ai.js';

const ORIGIN = 'http://tenant.example';
const ROUTE = '/api/v1/ai/pending-actions/:id/approve';
const KEY = 'osk_ai_route_credential_pin_0001';
const KEY_OWNER = 'u_key_owner';
const PERSON = 'u_person';
const ADMIN = 'u_admin';
const OWN_TOKEN = 'sess_tok_own';
const IMPERSONATED_TOKEN = 'sess_tok_impersonated';

/** A data engine that knows one live API key, owned by `KEY_OWNER`. */
function engine() {
    const keyHash = hashApiKey(KEY);
    return {
        find: vi.fn(async (object: string, q: any) => (
            object === 'sys_api_key' && q?.where?.key === keyHash
                ? [{ id: 'key_1', key: keyHash, user_id: KEY_OWNER, revoked: false, scopes: '[]' }]
                : object === 'sys_user' && (q?.where?.id === KEY_OWNER || q?.where?.id === PERSON)
                    ? [{ id: q.where.id }]
                    : []
        )),
        getObjects: vi.fn().mockReturnValue({}),
        registry: {
            getObject: vi.fn().mockReturnValue(null),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
}

/** The session token a request presents, from the cookie or from a bearer header. */
function sessionTokenOf(headers: Headers): string | undefined {
    const cookie = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
    if (cookie) return cookie;
    const bearer = headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    return bearer && !bearer.startsWith('osk_') ? bearer : undefined;
}

/** One session read per token, whichever carrier brought it (better-auth's bearer plugin). */
function authService() {
    const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
        const token = sessionTokenOf(headers);
        if (token === OWN_TOKEN) {
            return { user: { id: PERSON }, session: { id: 'sess_own', userId: PERSON, token } };
        }
        if (token === IMPERSONATED_TOKEN) {
            return { user: { id: PERSON }, session: { id: 'sess_imp', userId: PERSON, token, impersonatedBy: ADMIN } };
        }
        return null;
    });
    return { isAuthGateActive: () => false, getApi: async () => ({ getSession }) };
}

async function approveThroughDispatch(headers: Record<string, string>) {
    const seen: { req?: any } = {};
    const services: Record<string, unknown> = { objectql: engine(), auth: authService(), ai: {} };
    const kernel: any = {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
        __aiRoutes: [{
            method: 'POST',
            path: ROUTE,
            auth: true,
            handler: async (req: any) => {
                seen.req = req;
                return { status: 200, body: { success: true, data: { ok: true } } };
            },
        }],
    };
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    (dispatcher as any).domainDeps.logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const request = new Request(`${ORIGIN}/api/v1/ai/pending-actions/pa_1/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: '{}',
    });
    const ctx: HttpProtocolContext = { request };
    const result: any = await dispatcher.dispatch('POST', '/ai/pending-actions/pa_1/approve', {}, {}, ctx);
    return { result, user: seen.req?.user };
}

describe('[#34184] AI route req.user — through dispatch()', () => {
    it('a session cookie: credential `session`, no impersonatedBy key', async () => {
        const { result, user } = await approveThroughDispatch({ cookie: `session=${OWN_TOKEN}` });
        expect(result.response?.status).toBe(200);
        expect(user).toMatchObject({ id: PERSON, userId: PERSON, credential: 'session' });
        expect('impersonatedBy' in user).toBe(false);
    });

    it('an impersonated session: credential `session`, impersonatedBy names the administrator, id stays the user', async () => {
        const { result, user } = await approveThroughDispatch({ cookie: `session=${IMPERSONATED_TOKEN}` });
        expect(result.response?.status).toBe(200);
        expect(user).toMatchObject({ id: PERSON, userId: PERSON, credential: 'session', impersonatedBy: ADMIN });
    });

    it('an API key: credential `api_key`, no impersonatedBy key', async () => {
        const { result, user } = await approveThroughDispatch({ 'x-api-key': KEY });
        expect(result.response?.status).toBe(200);
        expect(user).toMatchObject({ id: KEY_OWNER, credential: 'api_key' });
        expect('impersonatedBy' in user).toBe(false);
    });

    it('an API key beside an impersonated session cookie: the key admitted, so `api_key` and no impersonatedBy', async () => {
        const { user } = await approveThroughDispatch({ 'x-api-key': KEY, cookie: `session=${IMPERSONATED_TOKEN}` });
        expect(user).toMatchObject({ id: KEY_OWNER, credential: 'api_key' });
        expect('impersonatedBy' in user).toBe(false);
    });

    it('the session token in an Authorization: Bearer header is the same session: `session`', async () => {
        const { result, user } = await approveThroughDispatch({ authorization: `Bearer ${OWN_TOKEN}` });
        expect(result.response?.status).toBe(200);
        expect(user).toMatchObject({ id: PERSON, credential: 'session' });
        expect('impersonatedBy' in user).toBe(false);
    });

    it('an impersonated session token in a bearer header carries impersonatedBy too', async () => {
        const { user } = await approveThroughDispatch({ authorization: `Bearer ${IMPERSONATED_TOKEN}` });
        expect(user).toMatchObject({ id: PERSON, credential: 'session', impersonatedBy: ADMIN });
    });
});

/** Dispatch the route straight at the handler, under a hand-built request context. */
async function approveAtHandler(context: Partial<HttpProtocolContext>) {
    const seen: { req?: any } = {};
    const deps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => (name === 'ai' ? {} : undefined)) as any,
        getRegisteredAiRoutes: () => [{
            method: 'POST',
            path: ROUTE,
            auth: true,
            handler: async (req: any) => {
                seen.req = req;
                return { status: 200, body: { success: true } };
            },
        }],
        getObjectQL: async () => undefined,
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500) => ({ status: httpStatus, body: { success: false, error: { message } } }),
        routeNotFound: (route: string) => ({ status: 404, body: { success: false, error: { code: 'ROUTE_NOT_FOUND', route } } }),
    } as unknown as DomainHandlerDeps;
    await handleAIRequest(deps, '/ai/pending-actions/pa_1/approve', 'POST', {}, {}, context as HttpProtocolContext);
    return seen.req?.user;
}

describe('[#34184] AI route req.user — at the handler', () => {
    it('an agent principal carrying OAuth scopes: credential `oauth`', async () => {
        const user = await approveAtHandler({
            executionContext: { userId: PERSON, principalKind: 'agent', oauthScopes: ['data:read'] } as any,
        });
        expect(user).toMatchObject({ id: PERSON, credential: 'oauth' });
    });

    it('an authenticated context with no admission recorded carries no credential key', async () => {
        const user = await approveAtHandler({ executionContext: { userId: PERSON } as any });
        expect(user).toMatchObject({ id: PERSON });
        expect('credential' in user).toBe(false);
    });

    it('a blank impersonatedBy adds no key', async () => {
        const user = await approveAtHandler({
            executionContext: { userId: PERSON, impersonatedBy: '   ' } as any,
            admission: { credential: 'session', authGate: undefined },
        });
        expect(user).toMatchObject({ id: PERSON, credential: 'session' });
        expect('impersonatedBy' in user).toBe(false);
    });
});
