// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `keys` and `actions` domains' 405 names what each serves, in `Allow`.
 *
 * RFC 9110 §15.5.6: "The origin server MUST generate an Allow header field in
 * a 405 (Method Not Allowed) response containing a list of the target
 * resource's currently supported methods." The `mcp`, `meta` and `ai` domains
 * answer their 405 that way. These two answered theirs through `deps.error`,
 * which builds `{ status, body }` and carries no headers, so the status was
 * right and the header was missing — on every host that reaches the domain.
 *
 * Each domain serves exactly one method on every path it claims: `POST` (the
 * key mint; an action invocation or the activation door). So `Allow: POST`.
 *
 * ## Two legs, because "on both hosts" is a question about the wire
 *
 *  1. `dispatch()` — the call both hosts make: `@objectstack/hono`'s
 *     `createHonoApp` catch-all hands every `${prefix}/*` request to it and
 *     writes `result.response.headers` onto the wire, and the standalone
 *     server's explicit mounts call it too. Driving `dispatch()` rather than
 *     `handleKeys()` / `handleActions()` keeps the domain-registry lookup
 *     inside the pin.
 *  2. A real Hono socket (`HonoServerPlugin` + `createDispatcherPlugin`, the
 *     standalone `os dev` / `os serve` composition), read through `fetch`.
 *     `/api/v1/keys` is mounted for every verb, so a signed-in `GET` reaches
 *     the domain and its 405 is the one on the wire. `/actions` is mounted for
 *     `POST` alone there, so a `GET` never reaches the domain: the adapter's
 *     own unmatched-method 405 answers it, and that one already names `POST`.
 *     The row is kept so "both hosts" is a statement about the wire for both
 *     domains, not about one handler.
 *
 * ## The anonymous baseline stays first (ADR-0138 D2)
 *
 * Both handlers decide an anonymous caller as their first statement, so an
 * anonymous non-`POST` is answered `401` and learns nothing about the route's
 * shape — no `Allow` either. Pinned here beside the new header so the header
 * cannot be won by moving the 405 above that decision.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiErrorSchema, BaseResponseSchema } from '@objectstack/spec/api';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';
import { createDispatcherPlugin } from '../dispatcher-plugin.js';

/** Both domains serve `POST` and nothing else, on every path they claim. */
const ALLOW = 'POST';

const SESSION_HEADER = 'x-test-session';

/** The `auth` slot answers a session only when the request carries the header. */
const authService = () => ({
    api: {
        getSession: async ({ headers }: any) =>
            (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_allow_header' } } : undefined),
    },
});

/** One non-allowed verb and one path per domain. */
const DOMAINS = [
    { domain: 'keys', path: '/keys', verb: 'GET' },
    { domain: 'actions', path: '/actions/task/close', verb: 'GET' },
] as const;

/** The declared dispatcher envelope, parsed against the spec's own schemas. */
function expectDeclaredEnvelope(body: any): void {
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
}

describe('the keys and actions domains answer a 405 with `Allow` (dispatch(), the call both hosts make)', () => {
    function makeDispatcher(): HttpDispatcher {
        const services: Record<string, any> = { auth: authService() };
        const get = (name: string) => services[name] ?? null;
        const kernel = {
            context: { getService: get },
            getService: get,
            getServiceAsync: async (name: string) => get(name),
        } as any;
        // No ObjectQL is composed here, and both answers under test come before
        // either domain touches storage; the environment-membership gate would
        // answer that missing engine as an outage (503), so it is switched off
        // the way the dispatcher option documents for tests that seed none.
        return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    }

    const callerContext = (signedIn: boolean): any => ({
        request: { headers: signedIn ? { [SESSION_HEADER]: '1' } : {} },
    });

    for (const { domain, path, verb } of DOMAINS) {
        it(`signed-in ${verb} ${path} → 405 METHOD_NOT_ALLOWED with \`Allow: ${ALLOW}\``, async () => {
            const result = await makeDispatcher().dispatch(verb, path, undefined, {}, callerContext(true));

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(405);
            expect(result.response?.headers?.Allow).toBe(ALLOW);
            expect(result.response?.body?.success).toBe(false);
            expect(result.response?.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
            expect(result.response?.body?.error?.httpStatus).toBe(405);
            expectDeclaredEnvelope(result.response?.body);
        });

        it(`anonymous ${verb} ${path} → the ${domain} domain's 401 first, naming no method`, async () => {
            const result = await makeDispatcher().dispatch(verb, path, undefined, {}, callerContext(false));

            expect(result.response?.status).toBe(401);
            expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
            expect(result.response?.headers?.Allow).toBeUndefined();
        });
    }
});

describe('the keys and actions 405s carry `Allow` on the wire of the standalone server (real Hono socket)', () => {
    function fakeAuthPlugin(): Plugin {
        return {
            name: 'com.objectstack.test.fake-auth-keys-actions-allow',
            version: '1.0.0',
            init: async (ctx: PluginContext) => {
                ctx.registerService('auth', authService());
            },
        };
    }

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

    async function call(method: string, path: string, signedIn: boolean) {
        const res = await fetch(`${baseUrl}/api/v1${path}`, {
            method,
            headers: signedIn ? { [SESSION_HEADER]: '1' } : {},
        });
        return { res, body: (await res.json()) as Record<string, any> };
    }

    it(`signed-in GET /api/v1/keys → the keys domain's 405, with \`Allow: ${ALLOW}\` on the wire`, async () => {
        const { res, body } = await call('GET', '/keys', true);

        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe(ALLOW);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        // The door: the domain fills `httpStatus`; the adapter fills `details`.
        expect(body.error.httpStatus).toBe(405);
        expect(body.error).not.toHaveProperty('details');
    });

    it('anonymous GET /api/v1/keys → 401, and no `Allow` on the wire', async () => {
        const { res, body } = await call('GET', '/keys', false);

        expect(res.status).toBe(401);
        expect(body.error.code).toBe('UNAUTHENTICATED');
        expect(res.headers.get('allow')).toBeNull();
    });

    it(`signed-in GET /api/v1/actions/task/close → 405 with \`Allow: ${ALLOW}\` (the adapter's: GET is not mounted)`, async () => {
        const { res, body } = await call('GET', '/actions/task/close', true);

        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe(ALLOW);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    });
});
