// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * `/api/v1/keys` hands EVERY verb to the `keys` domain, so its anonymous floor
 * answers first (#23909) — over a real Hono socket.
 *
 * The published v18 text (changeset `23225-domain-floor-anonymous-deny`):
 * "`/keys`: `401 UNAUTHENTICATED` for every verb. A verb other than `POST` used
 * to be answered `405` to an anonymous caller; a signed-in caller still gets
 * the 405." The domain keeps that promise as its first statement
 * (`handleKeysRequest`, ADR-0138 D2). The standalone dispatcher did not: it
 * mounted `${prefix}/keys` for `POST` alone, so `GET` / `PUT` / `PATCH` /
 * `DELETE` matched no route, and the adapter's `unmatchedResponse()` answered
 * `405 METHOD_NOT_ALLOWED` — naming the allowed method — to an anonymous caller
 * as well as to a signed-in one.
 *
 * Which DOOR answered is read off the body, not the status alone, exactly as in
 * `mcp-skill-method-not-allowed.hono.integration.test.ts`: the dispatcher's
 * envelope fills `error.httpStatus` and carries no `error.details`; the
 * adapter's fills `error.details.{method,path,allowed}` and no `httpStatus`.
 * The signed-in rows answer 405 before and after the fix, so a status-only
 * assertion there could not fail against the old mount.
 *
 * `LiteKernel`, as in `dispatcher-plugin.anonymous-gate.integration.test.ts`:
 * the subject is the mount seam. The `auth` slot answers a session only when
 * the request carries `x-test-session`, so one boot serves both callers and the
 * difference on the wire is that header. No `objectql` is registered: both
 * answers under test (the floor, then the method check) come before the
 * domain touches storage, so the signed-in `POST` (a real mint) is not driven
 * here; `http-dispatcher.keys.test.ts` owns that path.
 */

const KEYS_PATH = '/api/v1/keys';
const SESSION_HEADER = 'x-test-session';
const NON_POST_VERBS = ['GET', 'PUT', 'PATCH', 'DELETE'] as const;

function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth-keys-every-verb',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_keys_verb' } } : undefined),
                },
            });
        },
    };
}

describe('every /api/v1/keys verb reaches the keys domain (integration, #23909)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeAuthPlugin());
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

    /**
     * `Response.json()` is `unknown`, and two body shapes can arrive on this
     * path, so the cast is to an open record and every check below is a
     * runtime assertion on the wire.
     */
    async function call(method: string, signedIn: boolean): Promise<{ res: Response; body: Record<string, any> }> {
        const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
        const res = await fetch(`${baseUrl}${KEYS_PATH}`, {
            method,
            headers: {
                ...(hasBody ? { 'content-type': 'application/json' } : {}),
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            ...(hasBody ? { body: JSON.stringify({ name: 'probe' }) } : {}),
        });
        return { res, body: (await res.json()) as Record<string, any> };
    }

    // ── the defect: an anonymous non-POST verb is refused 401, by the domain ──
    for (const method of NON_POST_VERBS) {
        it(`anonymous ${method} → 401 UNAUTHENTICATED in the dispatcher's envelope`, async () => {
            const { res, body } = await call(method, false);

            expect(res.status).toBe(401);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('UNAUTHENTICATED');
            expect(body.error.httpStatus).toBe(401);
            expect(body.error).not.toHaveProperty('details');
        });
    }

    // ── a signed-in non-POST verb gets the DOMAIN's 405, not the adapter's ──
    for (const method of NON_POST_VERBS) {
        it(`signed-in ${method} → the keys domain's 405, not the adapter's`, async () => {
            const { res, body } = await call(method, true);

            expect(res.status).toBe(405);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
            // The door: the domain fills `httpStatus`; the adapter fills `details`.
            expect(body.error.httpStatus).toBe(405);
            expect(body.error).not.toHaveProperty('details');
        });
    }

    // ── control: the verb the route always served is answered as before ──
    it('anonymous POST → 401 UNAUTHENTICATED (unchanged)', async () => {
        const { res, body } = await call('POST', false);

        expect(res.status).toBe(401);
        expect(body.error.code).toBe('UNAUTHENTICATED');
        expect(body.error.httpStatus).toBe(401);
    });
});
