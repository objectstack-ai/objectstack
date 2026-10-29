// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /keys` mints only for a principal a signed-in session admitted.
 *
 * Minting is a credential-lifecycle act. The door reads which credential
 * admitted the caller from `HttpProtocolContext.admission`, which the
 * dispatcher's identity step writes from the shared resolver, and refuses
 * every other admission with `403 PERMISSION_DENIED` before the body is read
 * and before any service is resolved.
 *
 * ## What is pinned, through `dispatch()` (the real identity step)
 *
 *  - a session-admitted caller mints: `201`, one row, pinned to that caller;
 *  - an API-key-admitted caller is refused `403 PERMISSION_DENIED` and nothing
 *    is written, in each spelling the key header accepts (`x-api-key`,
 *    `Authorization: ApiKey`, `Authorization: Bearer osk_…`);
 *  - a session cookie sent beside the key does not lift the refusal (the key
 *    is the credential that admitted the caller);
 *  - the refusal is domain-wide: every verb answers it, not the `405`;
 *  - control: an anonymous caller still answers `401 UNAUTHENTICATED`.
 *
 * ## And at the handler (`handleKeys`)
 *
 *  - an authenticated context with NO admission recorded is refused too: an
 *    admitting credential the door was never told about is not a session;
 *  - a refused caller's body is never read.
 *
 * Refusals assert the ADR-0112 envelope (`code` and `status`), never prose.
 */

import { describe, expect, it, vi } from 'vitest';

import { hashApiKey } from '@objectstack/core';

import { deferRequestBody } from '../deferred-request-body.js';
import { HttpDispatcher, type HttpProtocolContext } from '../http-dispatcher.js';

const ORIGIN = 'http://tenant.example';
const KEY = 'osk_keys_mint_session_pin_0001';
const KEY_OWNER = 'u_key_owner';
const SESSION_USER = 'u_session_user';

function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

/** A data engine that knows one live key (owned by `KEY_OWNER`) and records every insert. */
function engine() {
    const keyHash = hashApiKey(KEY);
    const inserted: Array<{ object: string; row: Record<string, unknown> }> = [];
    const ql = {
        find: vi.fn(async (object: string, q: any) => (
            object === 'sys_api_key' && q?.where?.key === keyHash
                ? [{ id: 'key_existing', key: keyHash, user_id: KEY_OWNER, revoked: false, scopes: '[]' }]
                : []
        )),
        insert: vi.fn(async (object: string, row: Record<string, unknown>) => {
            inserted.push({ object, row });
            return { id: `key_${inserted.length}` };
        }),
        getObjects: vi.fn().mockReturnValue({}),
        registry: {
            getObject: vi.fn().mockReturnValue(null),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
    return { ql, inserted };
}

/** An auth service whose session read answers `SESSION_USER` whenever a cookie is sent. */
function authService() {
    const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
        if (!headers.get('cookie')) return null;
        return { user: { id: SESSION_USER }, session: { id: 'sess_1', userId: SESSION_USER } };
    });
    return { isAuthGateActive: () => false, getApi: async () => ({ getSession }) };
}

function harness() {
    const { ql, inserted } = engine();
    const dispatcher = new HttpDispatcher(
        kernelWith({ objectql: ql, auth: authService() }),
        undefined,
        { enforceProjectMembership: false },
    );
    (dispatcher as any).domainDeps.logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    return { dispatcher, ql, inserted };
}

const request = (method: string, headers: Record<string, string>) => new Request(`${ORIGIN}/api/v1/keys`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify({ name: 'k' }) }),
});

async function mint(headers: Record<string, string>, method = 'POST') {
    const h = harness();
    const ctx: HttpProtocolContext = { request: request(method, headers) };
    const result: any = await h.dispatcher.dispatch(method, '/keys', { name: 'k' }, {}, ctx);
    return { ...h, result, ctx };
}

describe('POST /keys — minting requires an interactive session (through dispatch)', () => {
    it('a session-admitted caller mints: 201, one row pinned to the session user', async () => {
        const { result, inserted, ctx } = await mint({ cookie: 'session=live' });
        expect(ctx.admission?.credential).toBe('session');
        expect(result.response?.status).toBe(201);
        expect(typeof result.response?.body?.data?.key).toBe('string');
        expect(inserted).toHaveLength(1);
        expect(inserted[0].object).toBe('sys_api_key');
        expect(inserted[0].row.user_id).toBe(SESSION_USER);
    });

    it.each([
        ['x-api-key', { 'x-api-key': KEY }],
        ['Authorization: ApiKey', { authorization: `ApiKey ${KEY}` }],
        ['Authorization: Bearer', { authorization: `Bearer ${KEY}` }],
    ])('an API-key-admitted caller (%s) is refused 403 PERMISSION_DENIED, nothing written', async (_label, headers) => {
        const { result, inserted, ctx } = await mint(headers);
        // The principal WAS resolved, by the key: this is the authorization
        // refusal, not the anonymous floor.
        expect(ctx.executionContext?.userId).toBe(KEY_OWNER);
        expect(ctx.admission?.credential).toBe('api_key');
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.success).toBe(false);
        expect(result.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(result.response?.body?.error?.httpStatus).toBe(403);
        expect(inserted).toHaveLength(0);
    });

    it('a session cookie beside the key does not lift the refusal', async () => {
        const { result, inserted, ctx } = await mint({ 'x-api-key': KEY, cookie: 'session=live' });
        expect(ctx.admission?.credential).toBe('api_key');
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(inserted).toHaveLength(0);
    });

    it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('domain-wide: an API-key-admitted %s answers the same 403, not the 405', async (method) => {
        const { result, inserted } = await mint({ 'x-api-key': KEY }, method);
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(inserted).toHaveLength(0);
    });

    it('control: a session-admitted wrong verb still answers 405', async () => {
        const { result } = await mint({ cookie: 'session=live' }, 'GET');
        expect(result.response?.status).toBe(405);
        expect(result.response?.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('control: an anonymous caller still answers 401 UNAUTHENTICATED', async () => {
        const { result, inserted } = await mint({});
        expect(result.response?.status).toBe(401);
        expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
        expect(inserted).toHaveLength(0);
    });
});

describe('POST /keys — the handler judges the recorded admission (handleKeys)', () => {
    const signedIn = { userId: 'u1', isSystem: false, positions: [], permissions: [] };

    function direct(admission: HttpProtocolContext['admission']) {
        const { ql, inserted } = engine();
        const services: Record<string, unknown> = { objectql: ql };
        const resolved: string[] = [];
        const kernel: any = {
            getService: (n: string) => { resolved.push(n); return services[n]; },
            getServiceAsync: async (n: string) => { resolved.push(n); return services[n]; },
        };
        let bodyReads = 0;
        const body = deferRequestBody({ get body() { bodyReads += 1; return { name: 'k' }; } });
        const ctx: HttpProtocolContext = {
            request: { headers: {} },
            executionContext: signedIn as any,
            ...(admission ? { admission } : {}),
        };
        const dispatcher = new HttpDispatcher(kernel);
        return {
            // Lookups made while CONSTRUCTING the dispatcher are not the
            // handler's; only the ones `handleKeys` makes are counted.
            run: () => { resolved.length = 0; return dispatcher.handleKeys('POST', body, ctx); },
            inserted,
            resolved,
            bodyReads: () => bodyReads,
        };
    }

    it('no admission recorded: refused 403 PERMISSION_DENIED, body unread, no service resolved', async () => {
        const d = direct(undefined);
        const res: any = await d.run();
        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(d.bodyReads()).toBe(0);
        expect(d.resolved).toEqual([]);
        expect(d.inserted).toHaveLength(0);
    });

    it('an api_key admission: refused 403 PERMISSION_DENIED, body unread, no service resolved', async () => {
        const d = direct({ credential: 'api_key', authGate: undefined });
        const res: any = await d.run();
        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(d.bodyReads()).toBe(0);
        expect(d.resolved).toEqual([]);
        expect(d.inserted).toHaveLength(0);
    });

    it('control: a session admission mints (201)', async () => {
        const d = direct({ credential: 'session', authGate: undefined });
        const res: any = await d.run();
        expect(res.response?.status).toBe(201);
        expect(d.bodyReads()).toBe(1);
        expect(d.inserted).toHaveLength(1);
    });
});
