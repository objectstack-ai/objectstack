// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The share-link management routes' in-process `auth.api.getSession`
 * read (`verifiedContextFromRequest`'s `getSession`) hands better-auth the
 * in-process session-read rule's input (`inProcessSessionReadInput`,
 * `@objectstack/types`).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: these
 * routes answer with their own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded — the browser's
 * cookie would then die before its session (a split session). A bearer-only
 * request reads exactly as before, renewal included. What that input DOES
 * against real better-auth is pinned end to end in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts` and
 * `packages/plugins/plugin-auth/src/in-process-session-renewal.pin.test.ts`.
 *
 * The plugin is booted for real (`start` → `kernel:ready`), as
 * `share-link-tenancy-posture-admission.test.ts` boots it, because the read
 * under test is a closure inside that hook; the route is `GET /share-links`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SharingServicePlugin } from './sharing-plugin.js';

const BASE = '/api/v1/share-links';
const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

class MockHttp implements IHttpServer {
    routes = new Map<string, RouteHandler>();
    private add(method: string, path: string, handler: RouteHandler) {
        this.routes.set(`${method} ${path}`, handler);
    }
    get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
    post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
    put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
    delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
    patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
    use() { return this as any; }
    listen() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    getInstance() { return null; }
}

async function listLinks(headers: Record<string, string>) {
    const calls: any[] = [];
    const engine = {
        async find() { return []; },
        async insert(_object: string, row: any) { return row; },
        getSchema(object: string) { return { name: object }; },
    };
    const http = new MockHttp();
    // No `tenancy` registered: the branded "never registered" arm, a quiet
    // `undefined` posture — this file's subject is the session read alone.
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};
    const ctx = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        hook: (event: string, handler: () => Promise<void> | void) => {
            (hooks[event] ??= []).push(handler);
        },
        getService: <T>(name: string): T => {
            if (name === 'objectql') return engine as unknown as T;
            if (name === 'http.server') return http as unknown as T;
            if (name === 'auth') {
                return {
                    api: {
                        getSession: async (input: any) => {
                            calls.push(input);
                            return { user: { id: 'usr_22258' }, session: { userId: 'usr_22258' } };
                        },
                    },
                } as unknown as T;
            }
            return kernel.getService<T>(name);
        },
        registerService: vi.fn(),
        getKernel: () => kernel,
    };
    const plugin = new SharingServicePlugin({ enforce: false });
    await plugin.start(ctx as unknown as PluginContext);
    for (const handler of hooks['kernel:ready'] ?? []) await handler();

    const handler = http.routes.get(`GET ${BASE}`);
    if (!handler) throw new Error(`no handler for GET ${BASE}`);
    const captured: { status: number; body: any } = { status: 200, body: undefined };
    const res: IHttpResponse = {
        json: vi.fn((data: any) => { captured.body = data; }) as any,
        send: vi.fn() as any,
        status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
        header: vi.fn(() => res) as any,
    };
    const req = { params: {}, query: {}, headers, method: 'GET', path: BASE } as unknown as IHttpRequest;
    await handler(req, res);
    return { calls, status: captured.status };
}

describe('[#22258] the share-link routes read the session by the in-process rule', () => {
    it('a request carrying a session cookie reads without renewal', async () => {
        const { calls, status } = await listLinks({ cookie: SESSION_COOKIE });
        // Admitted: the read resolved the caller (an unresolved one is refused 401).
        expect(status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
        expect(calls[0].headers.get('cookie')).toBe(SESSION_COOKIE);
    });

    it('the console sends cookie AND bearer — still no renewal in-process', async () => {
        const { calls } = await listLinks({ cookie: SESSION_COOKIE, authorization: BEARER });
        expect(calls).toHaveLength(1);
        expect(calls[0].query).toEqual({ disableRefresh: true });
    });

    it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
        const { calls, status } = await listLinks({ authorization: BEARER });
        expect(status).toBe(200);
        expect(calls).toHaveLength(1);
        expect('query' in calls[0], 'a bearer-only read lost its renewal').toBe(false);
        expect(calls[0].headers.get('authorization')).toBe(BEARER);
    });
});
