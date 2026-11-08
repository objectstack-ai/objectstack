// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';

// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

/**
 * The declarative-endpoint step on the dispatcher plugin's fallback seam runs
 * the environment-membership check `dispatch()` runs after the same request
 * resolution, over a real Hono socket.
 *
 * A multi-environment host: the `kernel-resolver` places every request in
 * {@link ENV}, whose `sys_environment_member` holds a row for {@link MEMBER}
 * only, and the plugin enforces membership.
 *
 *  - A signed-in caller who is not a member of the environment is answered
 *    `403 PROJECT_MEMBERSHIP_REQUIRED` by a matched endpoint, `authRequired`
 *    or not, and its target never runs.
 *  - CONTROL: a member reaches the target; an anonymous caller is answered as
 *    before (`401` at `authRequired: true`, the target at `authRequired:
 *    false`); a path no declaration owns keeps its `404`.
 */

const USER_HEADER = 'x-test-user';
const ENV = 'env-tenant';
const MEMBER = 'u_member';
const OUTSIDER = 'u_outsider';
const BODY = '{"params": {"days": 30}}';

const UNMATCHED_PATH = '/api/v1/apps/ns/nothing_declared_here';
const GUARDED_PATH = '/api/v1/apps/ns/guarded';
const OPEN_PATH = '/api/v1/apps/ns/open';

const DECLARED: ApiEndpoint[] = [
    ApiEndpointSchema.parse({ name: 'ns_guarded', path: GUARDED_PATH, method: 'POST', type: 'flow', target: 'ns_guarded_flow', authRequired: true }),
    ApiEndpointSchema.parse({ name: 'ns_open', path: OPEN_PATH, method: 'POST', type: 'flow', target: 'ns_open_flow', authRequired: false }),
];

/** Every flow the automation slot ran. */
const flowRuns: string[] = [];
/** The user of every membership read, in order. */
const membershipReads: string[] = [];

function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.endpoint-environment-membership',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('kernel-resolver', {
                resolveKernel: async (context: HttpProtocolContext, fallback: unknown) => {
                    context.environmentId = ENV;
                    return fallback;
                },
            });
            ctx.registerService('auth', {
                api: {
                    // The identity step hands a `Headers`, the membership check
                    // the transport's plain header map; the shipped `auth`
                    // service reads either (`better-call` wraps a plain map).
                    async getSession({ headers }: { headers: any }) {
                        const uid: string | null | undefined = typeof headers?.get === 'function'
                            ? headers.get(USER_HEADER)
                            : headers?.[USER_HEADER];
                        return uid ? { user: { id: uid }, session: { userId: uid } } : null;
                    },
                },
            });
            ctx.registerService('objectql', {
                find: async (object: string, query: { where?: Record<string, unknown> }) => {
                    const where = query?.where ?? {};
                    if (object === 'sys_environment_member') {
                        membershipReads.push(String(where.user_id));
                        return where.environment_id === ENV && where.user_id === MEMBER
                            ? [{ id: 'm1', environment_id: ENV, user_id: MEMBER }]
                            : [];
                    }
                    if (object === 'sys_user' && typeof where.id === 'string') return [{ id: where.id }];
                    return [];
                },
                registry: {
                    getObject: (name: string) => (name === 'sys_environment_member' ? { name } : null),
                    getRegisteredTypes: () => [],
                },
            });
            ctx.registerService('metadata', {
                list: async () => [],
                matchEndpoint: async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
                    const hit = DECLARED.find((e) => e.path === q.path && e.method === q.method.toUpperCase());
                    return hit ? { endpoint: hit, params: {} } : undefined;
                },
            });
            ctx.registerService('automation', {
                async execute(name: string) {
                    flowRuns.push(name);
                    return { runId: 'run_1', status: 'completed' };
                },
            });
        },
    };
}

describe('the declarative-endpoint step runs the environment-membership check (integration)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(servicesPlugin());
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, enforceProjectMembership: true }));
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

    async function post(path: string, user?: string): Promise<{ status: number; json: Record<string, any> }> {
        flowRuns.length = 0;
        membershipReads.length = 0;
        const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(user ? { [USER_HEADER]: user } : {}) },
            body: BODY,
        });
        return { status: res.status, json: (await res.json()) as Record<string, any> };
    }

    for (const path of [GUARDED_PATH, OPEN_PATH]) {
        it(`a signed-in non-member of the environment → 403 PROJECT_MEMBERSHIP_REQUIRED at ${path}, and the target never runs`, async () => {
            const { status, json } = await post(path, OUTSIDER);
            expect(status, JSON.stringify(json)).toBe(403);
            expect(json.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
            expect(json.error?.details).toMatchObject({ environmentId: ENV, userId: OUTSIDER });
            expect(membershipReads).toEqual([OUTSIDER]);
            expect(flowRuns).toEqual([]);
        });
    }

    it('CONTROL: a member reaches the target', async () => {
        const { status, json } = await post(GUARDED_PATH, MEMBER);
        expect(status, JSON.stringify(json)).toBe(200);
        expect(flowRuns).toEqual(['ns_guarded_flow']);
        expect(membershipReads).toEqual([MEMBER]);
    });

    it('CONTROL: an anonymous caller is answered as before, and no membership is read', async () => {
        const guarded = await post(GUARDED_PATH);
        expect(guarded.status).toBe(401);
        expect(guarded.json.error?.code).toBe('UNAUTHENTICATED');
        expect(flowRuns).toEqual([]);

        const open = await post(OPEN_PATH);
        expect(open.status, JSON.stringify(open.json)).toBe(200);
        expect(flowRuns).toEqual(['ns_open_flow']);
        expect(membershipReads).toEqual([]);
    });

    it('CONTROL: a path no declaration owns keeps its 404 for a signed-in non-member', async () => {
        const { status, json } = await post(UNMATCHED_PATH, OUTSIDER);
        expect(status).toBe(404);
        expect(json.error?.code).toBe('ENDPOINT_NOT_FOUND');
        expect(membershipReads).toEqual([]);
    });
});
