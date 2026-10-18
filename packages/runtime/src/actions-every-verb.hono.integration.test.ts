// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * Every verb on `/api/v1/actions/...` reaches the `actions` domain on the
 * standalone server, so its anonymous baseline answers first (#24228) — over
 * a real Hono socket.
 *
 * `handleActionsRequest` decides an anonymous caller as its FIRST statement,
 * ahead of its `405` (ADR-0138 D2: "Everything else answers 401
 * (UNAUTHENTICATED). The decision is taken once per domain, as the domain's
 * first statement"). The standalone dispatcher mounts the three `/actions`
 * paths for `POST` only, so every other verb matched no route and the
 * transport answered it itself: `405` + `Allow: POST`, to an anonymous caller
 * too. A `createHonoApp` host answers the same request `401`, because its
 * catch-all hands the domain every verb.
 *
 * The dispatcher now declares these paths as ones whose domain decides every
 * verb, and its fallback seam hands the domain each request the router could
 * not route there. Deliberately NOT refusal-only `GET`/`PUT`/`PATCH`/`DELETE`
 * mounts (the `/keys` shape): the transport builds `Allow` from the verbs
 * REGISTERED on a path, so each such mount would have been listed as supported
 * in the `405` the transport still answers for the verbs left over (`OPTIONS`
 * with CORS off, `TRACE`, …). The signed-in rows therefore pin `Allow` too.
 *
 * Which DOOR answered is read off the body, as in
 * `keys-every-verb.hono.integration.test.ts`: the dispatcher's envelope fills
 * `error.httpStatus` and carries no `error.details`; the transport's fills
 * `error.details.{method,path,allowed}` and no `httpStatus`. The signed-in
 * rows answered `405` + `Allow: POST` before the fix as well, so the door is
 * what tells them apart.
 *
 * Both prefixes: `enableProjectScoping` mounts the three paths under
 * `/api/v1` and under `/api/v1/environments/:environmentId`, through the same
 * `registerActionRoutes`, and the scoped request reaches `dispatch()` with its
 * environment read off the path rather than off route params (an unrouted
 * request has none) — so the scoped rows are not a copy of the unscoped ones.
 *
 * Raw `node:http`, not `fetch`: `fetch` refuses `TRACE`, and `TRACE` is the
 * verb the transport answers even with CORS on (CORS answers `OPTIONS`).
 * `LiteKernel`, no `objectql`: every answer under test comes before the domain
 * touches storage, so the signed-in `POST` (a real invocation) is not driven.
 */

const SESSION_HEADER = 'x-test-session';
const PREFIXES = ['/api/v1', '/api/v1/environments/env_actions_verb'] as const;
const SHAPES = ['/actions//close_all', '/actions/task/close', '/actions/task/close/rec_1'] as const;
/** Verbs that carry a JSON body on the wire; the rest are sent bodiless. */
const BODY_VERBS = new Set(['PUT', 'PATCH']);
/** Every verb but `POST` and the two whose answer differs in shape (below). */
const REFUSED_VERBS = ['GET', 'PUT', 'PATCH', 'DELETE', 'TRACE'] as const;

function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth-actions-every-verb',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_actions_verb' } } : undefined),
                },
            });
        },
    };
}

interface Answer {
    status: number;
    allow: string | null;
    /** Parsed JSON body; `undefined` for a bodiless answer (`HEAD`). */
    body: Record<string, any> | undefined;
}

describe('every /api/v1/actions verb reaches the actions domain (integration, #24228)', () => {
    let kernel: LiteKernel;
    let port: number;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeAuthPlugin());
        // port 0 → an OS-assigned free port, read back through getPort().
        // CORS off: with it on, CORS answers every `OPTIONS` before routing.
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({
            prefix: '/api/v1',
            securityHeaders: false,
            scoping: { enableProjectScoping: true, projectResolution: 'auto' },
        }));
        await kernel.bootstrap();
        port = kernel.getService<IHttpServer>('http.server').getPort!();
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    function call(method: string, path: string, signedIn: boolean): Promise<Answer> {
        return new Promise((resolve, reject) => {
            const payload = BODY_VERBS.has(method) ? JSON.stringify({ params: {} }) : undefined;
            const req = httpRequest({
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: {
                    ...(payload ? { 'content-type': 'application/json' } : {}),
                    ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
                },
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => {
                    const allow = res.headers.allow;
                    resolve({
                        status: res.statusCode ?? 0,
                        allow: typeof allow === 'string' ? allow : null,
                        body: text.length > 0 ? JSON.parse(text) as Record<string, any> : undefined,
                    });
                });
            });
            req.on('error', reject);
            req.end(payload);
        });
    }

    for (const prefix of PREFIXES) {
        for (const shape of SHAPES) {
            const path = `${prefix}${shape}`;

            // ── the defect: an anonymous non-POST verb is refused 401, by the domain ──
            for (const method of REFUSED_VERBS) {
                it(`anonymous ${method} ${path} → 401 UNAUTHENTICATED, no Allow, in the dispatcher's envelope`, async () => {
                    const { status, allow, body } = await call(method, path, false);

                    expect(status).toBe(401);
                    expect(allow).toBeNull();
                    expect(body?.success).toBe(false);
                    expect(body?.error?.code).toBe('UNAUTHENTICATED');
                    expect(body?.error?.httpStatus).toBe(401);
                    expect(body?.error).not.toHaveProperty('details');
                });
            }

            // ── signed in: the DOMAIN's 405, naming only the verb it serves ──
            for (const method of REFUSED_VERBS) {
                it(`signed-in ${method} ${path} → the actions domain's 405 with \`Allow: POST\`, not the transport's`, async () => {
                    const { status, allow, body } = await call(method, path, true);

                    expect(status).toBe(405);
                    expect(allow).toBe('POST');
                    expect(body?.error?.code).toBe('METHOD_NOT_ALLOWED');
                    // The door: the domain fills `httpStatus`; the transport fills `details`.
                    expect(body?.error?.httpStatus).toBe(405);
                    expect(body?.error).not.toHaveProperty('details');
                });
            }

            // HEAD has no body to read the door from; status and header say it.
            it(`HEAD ${path} → 401 with no Allow anonymously, 405 with \`Allow: POST\` signed in`, async () => {
                const anonymous = await call('HEAD', path, false);
                expect(anonymous.status).toBe(401);
                expect(anonymous.allow).toBeNull();

                const signedIn = await call('HEAD', path, true);
                expect(signedIn.status).toBe(405);
                expect(signedIn.allow).toBe('POST');
            });

            // `shouldDenyAnonymous` lets every `OPTIONS` through (a CORS preflight
            // carries no credentials), so the domain's 405 answers it — on a
            // `createHonoApp` host with CORS off as well. Pinned as the boundary:
            // the domain answers it, and `Allow` names `POST` alone.
            it(`anonymous OPTIONS ${path} (CORS off) → the domain's 405 with \`Allow: POST\` — the preflight exemption`, async () => {
                const { status, allow, body } = await call('OPTIONS', path, false);

                expect(status).toBe(405);
                expect(allow).toBe('POST');
                expect(body?.error?.httpStatus).toBe(405);
                expect(body?.error).not.toHaveProperty('details');
            });

            // ── control: the verb the route always served is answered as before ──
            it(`anonymous POST ${path} → 401 UNAUTHENTICATED (unchanged)`, async () => {
                const { status, body } = await call('POST', path, false);

                expect(status).toBe(401);
                expect(body?.error?.code).toBe('UNAUTHENTICATED');
                expect(body?.error?.httpStatus).toBe(401);
            });
        }
    }

    // ── the claim is narrow: a path no `/actions` route serves stays the transport's 404 ──
    it('a four-segment /actions path no route serves → the transport\'s 404, not the domain', async () => {
        const { status, body } = await call('GET', '/api/v1/actions/task/close/rec_1/extra', false);

        expect(status).toBe(404);
        expect(body?.error?.code).toBe('ENDPOINT_NOT_FOUND');
    });
});
