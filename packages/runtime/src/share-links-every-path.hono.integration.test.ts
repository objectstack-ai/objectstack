// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ANONYMOUS_DENY_MESSAGE, LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { registerShareLinkRoutes } from '@objectstack/plugin-sharing';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * On a standalone server every anonymous request under `/api/v1/share-links`,
 * the two token faces apart, is answered `401 UNAUTHENTICATED` in the
 * dispatcher's standard envelope with the shared message (#24024) — over a real
 * Hono socket, composed as `os dev` composes it.
 *
 * The published v18 text (changeset `23225-domain-floor-anonymous-deny`):
 * "`/share-links`: `401 UNAUTHENTICATED` on the create, list and revoke faces
 * and on every path the domain does not serve", and "the refusal is the
 * dispatcher's standard envelope … with the shared message every other
 * dispatcher domain answers with". The dispatcher twin
 * (`domains/share-links.ts`) keeps it, but on a standalone server it is never
 * reached: the dispatcher mounts no `/share-links` route, and
 * `plugin-sharing`'s `registerShareLinkRoutes` is the surface. That family
 * registered its five routes and nothing else, so another verb or path matched
 * no route and the adapter answered first (`405` naming the allowed methods, or
 * `404`), and its own three management faces answered 401 with a sentence of
 * their own and no `httpStatus`.
 *
 * The family is mounted here exactly as `SharingServicePlugin` mounts it: on the
 * `http.server` slot at `kernel:ready`, after the dispatcher's `start()` has
 * registered its routes. Its context resolver is reduced to the one thing these
 * answers depend on, whether the request carries a session; the plugin's real
 * resolver is pinned in plugin-sharing's own suites.
 *
 * Which DOOR answered is read off the body and headers, as in
 * `keys-every-verb.hono.integration.test.ts`: the adapter's 405 fills
 * `error.details` and an `Allow` header, its 404 is `ENDPOINT_NOT_FOUND` with
 * the bare message `Not found`; the family's 404 names the request it does not
 * serve.
 */

const BASE = '/api/v1/share-links';
const SESSION_HEADER = 'x-test-session';

/** Every request under the base that no token face serves. */
const MANAGED_OR_UNSERVED: Array<[string, string]> = [
    // the three management faces (today's 401, with the family's own sentence)
    ['GET', ''],
    ['POST', ''],
    ['DELETE', '/abc'],
    // the base path under a verb it does not serve
    ['PUT', ''],
    ['PATCH', ''],
    // one segment under a verb revoke does not take
    ['GET', '/abc'],
    ['POST', '/abc'],
    ['PUT', '/abc'],
    ['PATCH', '/abc'],
    // the token faces' paths under a verb they do not take
    ['POST', '/abc/resolve'],
    ['DELETE', '/abc/resolve'],
    ['PUT', '/abc/messages'],
    ['DELETE', '/abc/messages'],
    // paths nothing serves
    ['GET', '/abc/def'],
    ['GET', '/abc/def/ghi'],
    ['POST', '/abc/def/ghi'],
    ['DELETE', '/abc/def/ghi'],
];
const SERVED = new Set(['GET ', 'POST ', 'DELETE /abc']);

function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth-share-links-every-path',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_share_links_path' } } : undefined),
                },
            });
        },
    };
}

/** The share-link family, mounted the way `SharingServicePlugin` mounts it. */
function shareLinkFamilyPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.share-link-family',
        version: '1.0.0',
        init: async () => {},
        start: async (ctx: PluginContext) => {
            ctx.hook('kernel:ready', async () => {
                const http = ctx.getService<IHttpServer>('http.server');
                const service: any = {
                    createLink: async () => ({ id: 'sl_1', token: 'tok_1' }),
                    listLinks: async () => [],
                    revokeLink: async () => undefined,
                    resolveToken: async () => null,
                };
                const engine: any = { find: async () => [], getSchema: () => undefined };
                registerShareLinkRoutes(http, service, engine, {
                    contextFromRequest: (req) =>
                        (req.headers?.[SESSION_HEADER] ? { userId: 'u_share_links_path' } : {}),
                });
            });
        },
    };
}

describe('every /api/v1/share-links verb and path reaches the share-link family door (integration, #24024)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeAuthPlugin());
        // port 0 → an OS-assigned free port, read back through getPort().
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
        kernel.use(shareLinkFamilyPlugin());
        await kernel.bootstrap();
        const httpServer = kernel.getService<IHttpServer>('http.server');
        baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    async function call(
        method: string,
        sub: string,
        signedIn: boolean,
        rawBody?: string,
    ): Promise<{ res: Response; body: Record<string, any> }> {
        const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
        const res = await fetch(`${baseUrl}${BASE}${sub}`, {
            method,
            headers: {
                ...(hasBody ? { 'content-type': 'application/json' } : {}),
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            ...(hasBody ? { body: rawBody ?? JSON.stringify({ object: 'crm_account', recordId: 'acc_1' }) } : {}),
        });
        return { res, body: (await res.json()) as Record<string, any> };
    }

    // ── the defect: one anonymous answer for every request off the token faces ──
    for (const [method, sub] of MANAGED_OR_UNSERVED) {
        it(`anonymous ${method} ${BASE}${sub} → 401 UNAUTHENTICATED, the dispatcher's envelope and message`, async () => {
            const { res, body } = await call(method, sub, false);

            expect(res.status).toBe(401);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('UNAUTHENTICATED');
            expect(body.error.httpStatus).toBe(401);
            // The published text names the shared message, so the identity of
            // the sentence is the contract here: the exported constant, not a copy.
            expect(body.error.message).toBe(ANONYMOUS_DENY_MESSAGE);
            expect(body.error).not.toHaveProperty('details');
            expect(res.headers.get('allow')).toBeNull();
        });
    }

    it('anonymous PUT on the base with a body the transport cannot parse → still the 401', async () => {
        const { res, body } = await call('PUT', '', false, '{not json');

        expect(res.status).toBe(401);
        expect(body.error.code).toBe('UNAUTHENTICATED');
        expect(body.error.httpStatus).toBe(401);
    });

    // ── control: the two token faces still admit an anonymous caller ──
    it('anonymous GET /:token/resolve → judged by the token, not the floor (unchanged)', async () => {
        const { res, body } = await call('GET', '/abc/resolve', false);

        expect(res.status).toBe(404);
        expect(body.error.code).toBe('INVALID_OR_EXPIRED');
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('anonymous GET /:token/messages → judged by the token, not the floor (unchanged)', async () => {
        const { res, body } = await call('GET', '/abc/messages', false);

        expect(res.status).toBe(404);
        expect(body.error.code).toBe('NOT_FOUND');
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    // ── CONTROL: a signed-in caller of an unserved verb or path is still refused, by the FAMILY ──
    for (const [method, sub] of MANAGED_OR_UNSERVED.filter(([m, s]) => !SERVED.has(`${m} ${s}`))) {
        it(`signed-in ${method} ${BASE}${sub} → the family's 404, not the adapter's 405 or 404`, async () => {
            const { res, body } = await call(method, sub, true);

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('ENDPOINT_NOT_FOUND');
            // The door: the family names the request; the adapter's 404 says
            // `Not found` and its 405 fills `details` and sends `Allow`.
            expect(body.error.message).toContain(`${method} ${BASE}${sub}`);
            expect(body.error).not.toHaveProperty('details');
            expect(res.headers.get('allow')).toBeNull();
        });
    }

    // ── control: the management faces still serve a signed-in caller ──
    it('signed-in POST, GET and DELETE are served as before', async () => {
        expect((await call('POST', '', true)).res.status).toBe(201);
        expect((await call('GET', '', true)).res.status).toBe(200);
        expect((await call('DELETE', '/abc', true)).res.status).toBe(200);
    });
});
