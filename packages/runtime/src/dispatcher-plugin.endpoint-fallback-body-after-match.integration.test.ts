// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * The declarative-endpoint fallback reads the request body only after the
 * endpoint is matched and its policies admitted the caller (#24252) — over a
 * real Hono socket.
 *
 * `@objectstack/plugin-hono-server`'s `req.body` throws its `400
 * INVALID_REQUEST` refusal when a body it could not parse is READ, and answers
 * the request with that refusal whatever the handler then writes. The fallback
 * used to read `req.body` while building `runAppEndpointStep`'s argument, so
 * the refusal fired before the step matched an endpoint or applied
 * `authRequired`: an unmatched path answered `400` where the same request with
 * a readable body answered `404`, and an anonymous caller of an
 * `authRequired: true` endpoint answered `400` where `401` is owed. The
 * fallback now hands the step a deferred body (`deferRequestBody`), and the
 * step reads it with `readDispatchedBody` once the policy chain passed.
 *
 * Readings:
 *
 * 1. no declaration owns the path → the transport's `404`, whatever the body,
 *    signed in or not — and the matcher WAS asked, so the miss is the step's,
 *    not the scoping test's;
 * 2. anonymous caller of an `authRequired: true` endpoint → `401`, whatever
 *    the body, and the target never runs;
 * 3. the control: a caller the endpoint admits (signed in at
 *    `authRequired: true`, anonymous at `authRequired: false`) still gets the
 *    transport's refusal for an unparseable body — the body is read later,
 *    not dropped — and a readable one reaches the target.
 *
 * The refusal is told from a domain's own `INVALID_REQUEST` by its message, as
 * `request-body-refusal.test.ts` in `plugin-hono-server` tells it.
 */

const USER_HEADER = 'x-test-user';
/** `{"params": {"days": 30}` — the closing brace missing. */
const UNPARSEABLE = '{"params": {"days": 30}';
const WELL_FORMED = '{"params": {"days": 30}}';

const UNMATCHED_PATH = '/api/v1/apps/ns/nothing_declared_here';
const GUARDED_PATH = '/api/v1/apps/ns/guarded';
const OPEN_PATH = '/api/v1/apps/ns/open';

const DECLARED: ApiEndpoint[] = [
    ApiEndpointSchema.parse({
        name: 'ns_guarded',
        path: GUARDED_PATH,
        method: 'POST',
        type: 'flow',
        target: 'ns_guarded_flow',
        authRequired: true,
    }),
    ApiEndpointSchema.parse({
        name: 'ns_open',
        path: OPEN_PATH,
        method: 'POST',
        type: 'flow',
        target: 'ns_open_flow',
        authRequired: false,
    }),
];

/** Every `matchEndpoint` query, in order. */
const queries: Array<{ path: string; method: string }> = [];
/** Every flow the automation slot ran, with the context it was handed. */
const flowRuns: Array<{ name: string; context: Record<string, unknown> }> = [];

function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.endpoint-body-after-match',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    async getSession({ headers }: { headers: Headers }) {
                        const uid = headers.get(USER_HEADER);
                        return uid ? { user: { id: uid } } : null;
                    },
                },
            });
            ctx.registerService('metadata', {
                list: async () => [],
                matchEndpoint: async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
                    queries.push(q);
                    const hit = DECLARED.find((e) => e.path === q.path && e.method === q.method.toUpperCase());
                    return hit ? { endpoint: hit, params: {} } : undefined;
                },
            });
            ctx.registerService('automation', {
                async execute(name: string, context: Record<string, unknown>) {
                    flowRuns.push({ name, context });
                    return { runId: 'run_1', status: 'completed' };
                },
            });
        },
    };
}

describe('the declarative-endpoint fallback reads the body after the match and the policies (integration, #24252)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(servicesPlugin());
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
        await kernel.bootstrap();
        baseUrl = `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    async function post(path: string, body: string, user?: string): Promise<{ status: number; json: Record<string, any> }> {
        const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(user ? { [USER_HEADER]: user } : {}) },
            body,
        });
        return { status: res.status, json: (await res.json()) as Record<string, any> };
    }

    function expectRefusal(answer: { status: number; json: Record<string, any> }): void {
        expect(answer.status).toBe(400);
        expect(answer.json.success).toBe(false);
        expect(answer.json.error.code).toBe('INVALID_REQUEST');
        expect(answer.json.error.message).toMatch(/parsed as JSON/);
    }

    for (const user of [undefined, 'u_body_after_match']) {
        const who = user ? 'signed-in' : 'anonymous';
        it(`${who} POST to a path no declaration owns, unparseable body → the transport's 404, as for a well-formed one`, async () => {
            queries.length = 0;
            const unparseable = await post(UNMATCHED_PATH, UNPARSEABLE, user);
            const wellFormed = await post(UNMATCHED_PATH, WELL_FORMED, user);

            expect(unparseable.status).toBe(404);
            expect(unparseable.json.success).toBe(false);
            expect(unparseable.json.error.code).toBe('ENDPOINT_NOT_FOUND');
            expect({ status: wellFormed.status, code: wellFormed.json.error?.code })
                .toEqual({ status: unparseable.status, code: unparseable.json.error.code });
            // The step asked the matcher for both requests: the 404 is its miss,
            // not the scoping test turning the path away before any body could be read.
            expect(queries).toEqual([
                { path: UNMATCHED_PATH, method: 'POST' },
                { path: UNMATCHED_PATH, method: 'POST' },
            ]);
        });
    }

    it('anonymous POST to an authRequired: true endpoint, unparseable body → 401 UNAUTHENTICATED, as for a well-formed one', async () => {
        flowRuns.length = 0;
        const unparseable = await post(GUARDED_PATH, UNPARSEABLE);
        const wellFormed = await post(GUARDED_PATH, WELL_FORMED);

        expect(unparseable.status).toBe(401);
        expect(unparseable.json.success).toBe(false);
        expect(unparseable.json.error.code).toBe('UNAUTHENTICATED');
        expect({ status: wellFormed.status, code: wellFormed.json.error?.code })
            .toEqual({ status: unparseable.status, code: unparseable.json.error.code });
        expect(flowRuns).toEqual([]);
    });

    it('signed-in POST to an authRequired: true endpoint, unparseable body → the transport\'s 400 refusal, and the target never runs', async () => {
        flowRuns.length = 0;
        expectRefusal(await post(GUARDED_PATH, UNPARSEABLE, 'u_body_after_match'));
        expect(flowRuns).toEqual([]);
    });

    it('anonymous POST to an authRequired: false endpoint, unparseable body → the transport\'s 400 refusal, and the target never runs', async () => {
        flowRuns.length = 0;
        expectRefusal(await post(OPEN_PATH, UNPARSEABLE));
        expect(flowRuns).toEqual([]);
    });

    it('signed-in POST to an authRequired: true endpoint, readable body → the target runs on the parsed body', async () => {
        flowRuns.length = 0;
        const { status, json } = await post(GUARDED_PATH, WELL_FORMED, 'u_body_after_match');

        expect(status).toBe(200);
        expect(json).toEqual({ success: true, data: { runId: 'run_1', status: 'completed' } });
        expect(flowRuns).toHaveLength(1);
        expect(flowRuns[0]!.name).toBe('ns_guarded_flow');
        expect(flowRuns[0]!.context).toMatchObject({ userId: 'u_body_after_match', params: { days: 30 } });
    });
});
