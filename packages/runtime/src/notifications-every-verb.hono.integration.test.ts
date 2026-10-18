// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * Every verb on each `/api/v1/notifications` face reaches the `notifications`
 * domain, so its anonymous floor answers first (#24024) — over a real Hono
 * socket.
 *
 * The published v18 text (changeset `23225-domain-floor-anonymous-deny`):
 * "`/notifications`: `401 UNAUTHENTICATED` on every face". The domain keeps that
 * promise as its first statement (`handleNotificationRequest`, ADR-0138 D2),
 * ahead of the inbox probe and of every face. The standalone dispatcher did not:
 * it mounted each face for the one verb it serves (`GET /notifications`,
 * `POST /notifications/read`, `POST /notifications/read/all`), so any other verb
 * matched no route and the adapter's `unmatchedResponse()` answered
 * `405 METHOD_NOT_ALLOWED`, naming the allowed methods, to an anonymous caller.
 *
 * Which DOOR answered is read off the body and the headers, not the status
 * alone, as in `keys-every-verb.hono.integration.test.ts`: the dispatcher's
 * envelope fills `error.httpStatus` and carries no `error.details`; the
 * adapter's 405 fills `error.details.{method,path,allowed}`, no `httpStatus`,
 * and an `Allow` header.
 *
 * The signed-in rows are the control a floor that refused everybody would fail:
 * the caller is still refused, by the DOMAIN, with what it answers on
 * `createHonoApp`'s catch-all for a verb no face serves — `handled: false`,
 * which the dispatcher plugin renders as its `404 ROUTE_NOT_FOUND`. The `auth`
 * slot answers a session only when the request carries `x-test-session`, and a
 * stub inbox fills the `notification` slot so the domain gets past its
 * capability probe (without one a signed-in caller gets the 501 capability
 * answer on every face, which the published text keeps).
 */

const SESSION_HEADER = 'x-test-session';
const FACES = ['/notifications', '/notifications/read', '/notifications/read/all'] as const;
/** The one verb each face serves. Every other verb is a new mount. */
const SERVED: Record<(typeof FACES)[number], string> = {
    '/notifications': 'GET',
    '/notifications/read': 'POST',
    '/notifications/read/all': 'POST',
};
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const UNSERVED: Array<[string, string]> = FACES.flatMap((face) =>
    VERBS.filter((verb) => verb !== SERVED[face]).map((verb): [string, string] => [verb, face]),
);
/**
 * [#24228] Verbs `IHttpServer` cannot register, so no face's mount takes them:
 * `OPTIONS` (CORS is off in this boot; with it on, CORS answers it) and `TRACE`
 * (the transport routes it whatever CORS says).
 */
const UNREGISTRABLE: Array<[string, string]> = FACES.flatMap((face) =>
    (['OPTIONS', 'TRACE'] as const).map((verb): [string, string] => [verb, face]),
);

function fakeAuthAndInboxPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth-notifications-every-verb',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_notifications_verb' } } : undefined),
                },
            });
            ctx.registerService('notification', {
                send: async () => ({}),
                sendBatch: async () => [],
                listInbox: async () => ({ notifications: [], total: 0, unread: 0 }),
                markRead: async () => ({ readCount: 0 }),
                markAllRead: async () => ({ readCount: 0 }),
            });
        },
    };
}

describe('every /api/v1/notifications verb reaches the notifications domain (integration, #24024)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeAuthAndInboxPlugin());
        // port 0 → an OS-assigned free port, read back through getPort().
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
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

    /** Two body shapes can arrive on this path, so every check below is a runtime assertion on the wire. */
    async function call(
        method: string,
        face: string,
        signedIn: boolean,
        rawBody?: string,
    ): Promise<{ res: Response; body: Record<string, any> }> {
        const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
        const res = await fetch(`${baseUrl}/api/v1${face}`, {
            method,
            headers: {
                ...(hasBody ? { 'content-type': 'application/json' } : {}),
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            ...(hasBody ? { body: rawBody ?? JSON.stringify({ ids: ['n_1'] }) } : {}),
        });
        return { res, body: (await res.json()) as Record<string, any> };
    }

    // ── the defect: an anonymous unserved verb is refused 401, by the domain ──
    for (const [method, face] of UNSERVED) {
        it(`anonymous ${method} ${face} → 401 UNAUTHENTICATED in the dispatcher's envelope`, async () => {
            const { res, body } = await call(method, face, false);

            expect(res.status).toBe(401);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('UNAUTHENTICATED');
            expect(body.error.httpStatus).toBe(401);
            expect(body.error).not.toHaveProperty('details');
            expect(res.headers.get('allow')).toBeNull();
        });
    }

    // ── the mounts read no body, so an unparseable one cannot outrank the floor ──
    it('anonymous PUT /notifications with a body the transport cannot parse → still the 401', async () => {
        const { res, body } = await call('PUT', '/notifications', false, '{not json');

        expect(res.status).toBe(401);
        expect(body.error.code).toBe('UNAUTHENTICATED');
        expect(body.error.httpStatus).toBe(401);
    });

    // ── CONTROL: a signed-in unserved verb is still refused, by the DOMAIN ──
    for (const [method, face] of UNSERVED) {
        it(`signed-in ${method} ${face} → the dispatcher's 404 for a route the domain does not serve, not the adapter's 405`, async () => {
            const { res, body } = await call(method, face, true);

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('ROUTE_NOT_FOUND');
            // The door: the dispatcher fills `httpStatus`; the adapter's 405
            // fills `details` and sends `Allow`.
            expect(body.error.httpStatus).toBe(404);
            expect(body.error).not.toHaveProperty('details');
            expect(res.headers.get('allow')).toBeNull();
        });
    }

    // ── [#24228] a verb no mount takes reaches the domain too ──
    // The transport used to answer these itself: `405` with an `Allow` built
    // from the verbs REGISTERED on the face, `DELETE, GET, HEAD, PATCH, POST,
    // PUT`, listing the refusal-only mounts as supported. The dispatcher's
    // fallback seam now hands them to the domain, which answers them as it
    // answers every verb no face serves. Raw `node:http`: `fetch` refuses `TRACE`.
    function rawCall(method: string, face: string, signedIn: boolean): Promise<{ status: number; allow: string | null; body: Record<string, any> }> {
        const { hostname, port } = new URL(baseUrl);
        return new Promise((resolve, reject) => {
            const req = httpRequest({
                host: hostname,
                port,
                method,
                path: `/api/v1${face}`,
                headers: signedIn ? { [SESSION_HEADER]: '1' } : {},
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => {
                    const allow = res.headers.allow;
                    resolve({
                        status: res.statusCode ?? 0,
                        allow: typeof allow === 'string' ? allow : null,
                        body: JSON.parse(text) as Record<string, any>,
                    });
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    for (const [method, face] of UNREGISTRABLE) {
        it(`anonymous ${method} ${face} → 401 UNAUTHENTICATED, no Allow — not the transport's 405 (#24228)`, async () => {
            const { status, allow, body } = await rawCall(method, face, false);

            expect(status).toBe(401);
            expect(allow).toBeNull();
            expect(body.error.code).toBe('UNAUTHENTICATED');
            expect(body.error.httpStatus).toBe(401);
            expect(body.error).not.toHaveProperty('details');
        });

        it(`signed-in ${method} ${face} → the dispatcher's 404, no Allow listing refusal-only mounts (#24228)`, async () => {
            const { status, allow, body } = await rawCall(method, face, true);

            expect(status).toBe(404);
            expect(allow).toBeNull();
            expect(body.error.code).toBe('ROUTE_NOT_FOUND');
            expect(body.error.httpStatus).toBe(404);
            expect(body.error).not.toHaveProperty('details');
        });
    }

    // ── control: the verb each face always served is answered as before ──
    for (const face of FACES) {
        it(`anonymous ${SERVED[face]} ${face} → 401 UNAUTHENTICATED (unchanged)`, async () => {
            const { res, body } = await call(SERVED[face], face, false);

            expect(res.status).toBe(401);
            expect(body.error.code).toBe('UNAUTHENTICATED');
            expect(body.error.httpStatus).toBe(401);
        });

        it(`signed-in ${SERVED[face]} ${face} → served (unchanged)`, async () => {
            const { res, body } = await call(SERVED[face], face, true);

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
        });
    }
});
