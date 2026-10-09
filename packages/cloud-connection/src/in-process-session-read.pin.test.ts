// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] All three of this package's in-process `auth.api.getSession`
 * readers hand better-auth the in-process session-read rule's input
 * (`inProcessSessionReadInput`, `@objectstack/types`):
 *
 *   ① `CloudConnectionPlugin`'s session bridge behind `/api/v1/cloud-connection/*`;
 *   ② `MarketplaceInstallLocalPlugin.resolveActiveOrgId` (the scoping read);
 *   ③ `MarketplaceInstallLocalPlugin.resolveInstallPrincipal`'s session getter,
 *      handed to `resolveAuthzContext` (the admission read).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: these
 * routes answer with their own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded. A bearer-only request
 * reads exactly as before, renewal included. What `disableRefresh` then DOES
 * against real better-auth is pinned end to end in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';
const USER = 'usr_22258';

type Shape = { name: string; headers: Record<string, string> };
const COOKIE: Shape = { name: 'a session cookie', headers: { cookie: SESSION_COOKIE } };
const BOTH: Shape = { name: 'cookie AND bearer (the console)', headers: { cookie: SESSION_COOKIE, authorization: BEARER } };
const BEARER_ONLY: Shape = { name: 'a bearer only', headers: { authorization: BEARER } };

/** An auth service whose session API records every input it is handed. */
function recordingAuth() {
    const calls: any[] = [];
    return {
        calls,
        service: {
            api: {
                getSession: async (input: any) => {
                    calls.push(input);
                    return { user: { id: USER }, session: { activeOrganizationId: 'org_22258' } };
                },
            },
        },
    };
}

/** The rule, stated once: a cookie request never renews in-process; a bearer-only one is untouched. */
function expectTheRule(calls: any[], shape: Shape) {
    expect(calls.length, `${shape.name}: the reader never ran`).toBeGreaterThan(0);
    for (const input of calls) {
        if (shape.headers.cookie) {
            expect(input.query, `${shape.name}: a cookie request renewed in-process`).toEqual({ disableRefresh: true });
        } else {
            expect('query' in input, `${shape.name}: a bearer-only read lost its renewal`).toBe(false);
        }
        const h = input.headers;
        expect(h.get('authorization') ?? undefined).toBe(shape.headers.authorization);
        expect(h.get('cookie') ?? undefined).toBe(shape.headers.cookie);
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('[#22258] ① the cloud-connection routes read the session by the in-process rule', () => {
    async function readInstalled(shape: Shape) {
        const routes = new Map<string, (c: any) => Promise<any>>();
        const rawApp = {
            get: (path: string, h: any) => routes.set(`GET ${path}`, h),
            post: (path: string, h: any) => routes.set(`POST ${path}`, h),
        };
        const auth = recordingAuth();
        const hooks = new Map<string, (...args: any[]) => any>();
        const ctx = {
            hook: (event: string, handler: (...args: any[]) => any) => hooks.set(event, handler),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                if (name === 'auth') return auth.service;
                throw new Error(`service ${name} not registered`);
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        // No control-plane credential: the route answers locally after the
        // session read, so nothing leaves the process.
        await new CloudConnectionPlugin({ singleEnvironment: true, environmentId: 'env-22258', controlPlaneUrl: '' })
            .start(ctx as any);
        await hooks.get('kernel:ready')?.();
        const url = 'http://localhost:3000/api/v1/cloud-connection/installed';
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        const res = await routes.get('GET /api/v1/cloud-connection/installed')!({
            req: { url, raw: new Request(url, { headers: shape.headers }), json: async () => ({}) },
            json,
        });
        return { res, calls: auth.calls };
    }

    for (const shape of [COOKIE, BOTH, BEARER_ONLY]) {
        it(`${shape.name}`, async () => {
            const { res, calls } = await readInstalled(shape);
            expect(res.status, 'the session resolved — the route answered past its 401').toBe(200);
            expectTheRule(calls, shape);
        });
    }
});

describe('[#22258] ② ③ the install-local doors read the session by the in-process rule', () => {
    function pluginWith(shape: Shape) {
        const auth = recordingAuth();
        const ctx: any = {
            getService: (name: string) => {
                if (name === 'auth') return auth.service;
                throw new Error(`service ${name} not registered`);
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        const c = { req: { raw: new Request('http://localhost/api/v1/marketplace/install-local', { headers: shape.headers }) } };
        return { plugin: new MarketplaceInstallLocalPlugin() as any, ctx, c, calls: auth.calls };
    }

    for (const shape of [COOKIE, BOTH, BEARER_ONLY]) {
        it(`② resolveActiveOrgId — ${shape.name}`, async () => {
            const { plugin, ctx, c, calls } = pluginWith(shape);
            expect(await plugin.resolveActiveOrgId(c, ctx), 'the scoping read resolved the session').toBe('org_22258');
            expectTheRule(calls, shape);
        });

        it(`③ resolveInstallPrincipal — ${shape.name}`, async () => {
            const { plugin, ctx, c, calls } = pluginWith(shape);
            const principal = await plugin.resolveInstallPrincipal(c, ctx);
            expect(principal?.userId, 'the admission read resolved the session').toBe(USER);
            expectTheRule(calls, shape);
        });
    }
});
