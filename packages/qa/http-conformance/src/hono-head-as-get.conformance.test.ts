// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24245] On a `createHonoApp` host, a `HEAD` is answered as its `GET`, with
 * no body — through the host's own pipeline, against the standalone server.
 *
 * ## The defect
 *
 * `HEAD /api/v1/mcp/skill` answered `405 METHOD_NOT_ALLOWED` with `Allow: GET`
 * on a `createHonoApp` host while `GET` served the skill (RFC 9110 §9.3.2: a
 * server that serves `GET` on a resource serves `HEAD` on it). Hono answers a
 * `HEAD` from the `GET` route, but the catch-all handed `dispatch()` the raw
 * verb `HEAD`, and every dispatcher domain decides its verb by comparing it
 * with `'GET'`. The skill domain refused it; `/health`, `/ready` and the scoped
 * root answered `404 ROUTE_NOT_FOUND`; signed in, `/analytics/meta` answered
 * `404` and `/ai/agents` `501`; anonymous, the public
 * `/share-links/:token/resolve` answered `401` where `GET` answers `501`.
 *
 * The standalone server (`HonoServerPlugin` + the dispatcher plugin) answered
 * every one of them as `GET`: its transport routes a `HEAD` to the `GET`
 * mount, which hands `dispatch()` a literal `'GET'`. The catch-all now hands
 * `dispatch()` `GET` for a `HEAD` too, and the request beside it stays the
 * client's `HEAD`.
 *
 * ## What is pinned
 *
 *  1. Each row, on the hosted door (`app.request` into the Hono app
 *     `createHonoApp` returns — the host's own pipeline): `HEAD` has the `GET`
 *     answer's status and headers, and no body. A refused `GET` is read for its
 *     `code` and `status` (the `HEAD` carries no body to read).
 *  2. A path that serves no `GET` (`/keys`, `/actions/...`) keeps the `GET`
 *     answer for `HEAD`: its `405` with `Allow: POST`, or, anonymous, its `401`
 *     — never a `GET` served there.
 *  3. Where both doors serve the row, the hosted `HEAD` has the standalone
 *     `HEAD`'s status (and `Allow`).
 *  4. Only the verb moves: the `/mcp` transport is handed the client's `HEAD`
 *     request on both doors.
 *
 * `LiteKernel`, fake services only (no storage): the `auth` slot answers a
 * session only for a request carrying `x-test-session`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const SESSION_HEADER = 'x-test-session';

/** The methods the fake `/mcp` transport was handed, in order. */
const transportMethods: string[] = [];

function fakeServicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-services-head-as-get',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers?: Headers }) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_head_as_get' } } : undefined),
                },
            });
            ctx.registerService('analytics', { query: async () => ({ rows: [] }), getMeta: async () => [] });
            ctx.registerService('mcp', {
                handleHttpRequest: async (request: Request) => {
                    transportMethods.push(request.method);
                    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
                },
                renderSkill: () => '# skill',
            });
        },
    };
}

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);

interface Snapshot { status: number; headers: Array<[string, string]>; body: string }
async function snapshot(res: Response): Promise<Snapshot> {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

/** What a `GET` answers on a row: a status, and for a refusal its envelope `code`. */
interface Row {
    path: string;
    signedIn: boolean;
    get: { status: number; code?: string; allow?: string };
    /** Both doors serve the row, so the hosted `HEAD` is compared with the standalone one. */
    standalone: boolean;
}

const ROWS: Row[] = [
    // The card's row: public, served.
    { path: '/mcp/skill', signedIn: false, get: { status: 200 }, standalone: true },
    { path: '/health', signedIn: false, get: { status: 200 }, standalone: true },
    { path: '/ready', signedIn: false, get: { status: 200 }, standalone: true },
    { path: '/analytics/meta', signedIn: true, get: { status: 200 }, standalone: true },
    { path: '/ai/agents', signedIn: true, get: { status: 200 }, standalone: true },
    // The scoped API root is the discovery route; the standalone server mounts no such path.
    { path: '/environments/env_head', signedIn: true, get: { status: 200 }, standalone: false },
    // Public on GET: an anonymous HEAD must get the anonymous GET answer, not the floor's 401.
    { path: '/share-links/tok_head/resolve', signedIn: false, get: { status: 501, code: 'NOT_IMPLEMENTED' }, standalone: false },
    // Paths that serve no GET: the GET answer, 405 + Allow, or the anonymous 401.
    { path: '/keys', signedIn: true, get: { status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'POST' }, standalone: true },
    { path: '/keys', signedIn: false, get: { status: 401, code: 'UNAUTHENTICATED' }, standalone: true },
    { path: '/actions/task/close', signedIn: true, get: { status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'POST' }, standalone: true },
    { path: '/actions/task/close', signedIn: false, get: { status: 401, code: 'UNAUTHENTICATED' }, standalone: true },
    // Served to a signed-in caller only: the anonymous floor answers HEAD as it answers GET.
    { path: '/mcp', signedIn: false, get: { status: 401, code: 'UNAUTHENTICATED' }, standalone: true },
];

describe('[#24245] a HEAD is answered as its GET on a createHonoApp host (conformance)', () => {
    let hostedKernel: LiteKernel;
    let standaloneKernel: LiteKernel;
    let hosted: (path: string, init: RequestInit) => Promise<Response>;
    let standalone: (path: string, init: RequestInit) => Promise<Response>;

    beforeAll(async () => {
        hostedKernel = new LiteKernel();
        hostedKernel.use(fakeServicesPlugin());
        await hostedKernel.bootstrap();
        const app = createHonoApp({ kernel: hostedKernel as any, prefix: PREFIX, cors: false });
        hosted = (path, init) => app.request(`http://hosted.test${PREFIX}${path}`, init);

        standaloneKernel = new LiteKernel();
        standaloneKernel.use(fakeServicesPlugin());
        standaloneKernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        standaloneKernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
        await standaloneKernel.bootstrap();
        const base = `http://127.0.0.1:${standaloneKernel.getService<IHttpServer>('http.server').getPort!()}`;
        standalone = (path, init) => fetch(`${base}${PREFIX}${path}`, init);
    }, 30_000);

    afterAll(async () => {
        for (const kernel of [hostedKernel, standaloneKernel]) {
            if (!kernel) continue;
            await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
        }
    }, 30_000);

    const init = (method: 'GET' | 'HEAD', signedIn: boolean): RequestInit =>
        ({ method, headers: signedIn ? { [SESSION_HEADER]: '1' } : {} });

    for (const row of ROWS) {
        const who = row.signedIn ? 'signed-in' : 'anonymous';

        it(`${who} HEAD ${row.path}: the GET's ${row.get.status}${row.get.code ? ` ${row.get.code}` : ''} status and headers, no body`, async () => {
            const getRes = await hosted(row.path, init('GET', row.signedIn));
            const get = await snapshot(getRes);
            const head = await snapshot(await hosted(row.path, init('HEAD', row.signedIn)));

            expect(get.status).toBe(row.get.status);
            if (row.get.code) {
                const body = JSON.parse(get.body) as { success?: boolean; error?: { code?: string; httpStatus?: number } };
                expect(body.success).toBe(false);
                expect(body.error?.code).toBe(row.get.code);
                expect(body.error?.httpStatus).toBe(row.get.status);
            } else {
                expect(get.body).not.toBe('');
            }

            expect(head.status).toBe(get.status);
            expect(head.headers).toEqual(get.headers);
            expect(head.body).toBe('');
            const allow = head.headers.find(([k]) => k === 'allow')?.[1];
            expect(allow).toBe(row.get.allow);
        });

        if (row.standalone) {
            it(`${who} HEAD ${row.path}: the hosted door answers the standalone server's HEAD`, async () => {
                const viaHost = await hosted(row.path, init('HEAD', row.signedIn));
                const viaStandalone = await standalone(row.path, init('HEAD', row.signedIn));

                expect(viaHost.status).toBe(viaStandalone.status);
                expect(viaHost.headers.get('allow')).toBe(viaStandalone.headers.get('allow'));
                expect(await viaHost.text()).toBe('');
                expect(await viaStandalone.text()).toBe('');
            });
        }
    }

    it('HEAD /mcp/skill carries the skill\'s own headers on both doors', async () => {
        const viaHost = await hosted('/mcp/skill', init('HEAD', false));
        const viaStandalone = await standalone('/mcp/skill', init('HEAD', false));

        for (const res of [viaHost, viaStandalone]) {
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/markdown');
            expect(res.headers.get('content-disposition')).toBe('inline; filename="SKILL.md"');
            expect(res.headers.get('cache-control')).toContain('no-store');
            expect(await res.text()).toBe('');
        }
    });

    it('only the verb moves: the /mcp transport is handed the client\'s HEAD on both doors', async () => {
        transportMethods.length = 0;
        const viaHost = await hosted('/mcp', init('HEAD', true));
        const viaStandalone = await standalone('/mcp', init('HEAD', true));

        expect(viaHost.status).toBe(200);
        expect(viaStandalone.status).toBe(200);
        expect(transportMethods).toEqual(['HEAD', 'HEAD']);
    });
});
