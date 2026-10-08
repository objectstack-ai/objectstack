// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21908] ADR-0096 D5 strict mode closes `HttpDispatcher.resolveRequestScope`'s
 * infrastructure-fault class BY CONSTRUCTION.
 *
 * `resolveRequestScope` re-raises only the authorization-store-unavailable
 * class out of identity resolution; any other fault leaves the request's
 * `executionContext` undefined, and a data call the request then delegates
 * reaches the engine with no principal. The engine refuses that class now
 * (strict mode), whichever door delegated the call.
 *
 * Composition: the real dispatcher plugin over a real hono socket, the real
 * fallback seam, policy chain, endpoint step and `callData`, and the REAL
 * plugin-security middleware, run by the kernel-boundary engine stub before
 * it serves anything. The fault is induced at the one seam that raises it:
 * the dispatcher's timed identity resolution rejects once with a plain error.
 *
 * What is pinned is what the engine was HANDED (no principal), whether the
 * store was REACHED (never), and what the caller was TOLD (403
 * PERMISSION_DENIED, nothing of the rows). The controls: with no fault the
 * same anonymous request executes as the guest principal (#22147's posture,
 * unchanged) and is refused by the deny baseline, and a signed-in caller who
 * holds a grant is served through the same composition.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';
import type { PermissionSet } from '@objectstack/spec/security';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'showcase_task';

const OPEN_FIND: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'showcase_open_tasks',
    path: '/api/v1/apps/showcase/open-tasks',
    method: 'GET',
    type: 'object_operation',
    target: OBJECT,
    objectParams: { object: OBJECT, operation: 'find' },
    authRequired: false,
});

/** Rows the stub store serves, so a body can be checked for them byte by byte. */
const TASK_ROWS = [
    { id: 'tsk_1', name: 'pl-deny-row-marker-one', status: 'open' },
    { id: 'tsk_2', name: 'pl-deny-row-marker-two', status: 'done' },
];

/** The deployment's baseline: read on the object, for every caller that carries a user id. */
const READER_SET = {
    name: 'pl_deny_reader',
    label: 'Synthetic reader',
    objects: { [OBJECT]: { allowRead: true } },
} as unknown as PermissionSet;

/** What the engine was handed for the fixture object, and whether the store was reached. */
const engineFinds: Array<{ context: Record<string, unknown> | undefined }> = [];
const storeReached: string[] = [];

/** The real plugin-security middleware, booted on its own so the stub engine can run it. */
async function securityMiddleware(): Promise<(opCtx: any, next: () => Promise<void>) => Promise<void>> {
    let middleware: ((opCtx: any, next: () => Promise<void>) => Promise<void>) | undefined;
    const services: Record<string, unknown> = {
        manifest: { register: () => undefined },
        objectql: {
            registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
            getSchema: (name: string) => (name === OBJECT
                ? { name: OBJECT, fields: { name: { type: 'text' }, status: { type: 'text' } } }
                : undefined),
            findOne: async () => null,
        },
        metadata: {
            get: async (_type: string, name: string) => (name === OBJECT
                ? { name: OBJECT, fields: { name: { type: 'text' }, status: { type: 'text' } } }
                : undefined),
            list: async () => [READER_SET],
        },
    };
    const ctx: any = {
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        registerService: () => undefined,
        getService: (name: string) => {
            if (!(name in services)) throw new Error(`service not registered: ${name}`);
            return services[name];
        },
    };
    // The baseline applies to a caller with a user id only, so it reaches the
    // signed-in control and neither the guest nor a principal-less call.
    const plugin = new SecurityPlugin({ defaultPermissionSets: [], fallbackPermissionSet: READER_SET.name });
    await plugin.init(ctx);
    await plugin.start(ctx);
    if (!middleware) throw new Error('SecurityPlugin registered no middleware');
    return middleware;
}

function fakeMetadataPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.pl-deny-metadata',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('metadata', {
                list: async () => [],
                matchEndpoint: async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> =>
                    q.path.replace(/\/$/, '') === OPEN_FIND.path && q.method.toUpperCase() === OPEN_FIND.method
                        ? { endpoint: OPEN_FIND, params: {} }
                        : undefined,
            });
        },
    };
}

/** The kernel-boundary services: a session by header, and an engine that runs the security middleware first. */
function servicesPlugin(middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>): Plugin {
    return {
        name: 'com.objectstack.test.pl-deny-services',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    async getSession({ headers }: { headers: Headers }) {
                        const uid = headers.get('x-test-user');
                        return uid ? { user: { id: uid } } : null;
                    },
                },
            });
            ctx.registerService('objectql', {
                async find(object: string, options: any) {
                    // The authorization store the identity resolver reads holds
                    // no row: every grant here is the deployment baseline.
                    if (object !== OBJECT) return [];
                    engineFinds.push({ context: options?.context });
                    const opCtx: any = {
                        object, operation: 'find', context: options?.context, options, ast: { where: options?.where },
                    };
                    await middleware(opCtx, async () => {
                        storeReached.push('find');
                        opCtx.result = TASK_ROWS;
                    });
                    return opCtx.result;
                },
            });
        },
    };
}

describe('[#21908] an identity-resolution fault at an authRequired:false endpoint is refused by the engine', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        const middleware = await securityMiddleware();
        kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(fakeMetadataPlugin());
        kernel.use(servicesPlugin(middleware));
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
        await kernel.bootstrap();
        baseUrl = `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (!kernel) return;
        await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }, 30_000);

    afterEach(() => {
        vi.restoreAllMocks();
        engineFinds.length = 0;
        storeReached.length = 0;
    });

    it('the faulted request reaches the engine with no principal, the store is never reached, and the caller gets 403 with nothing of the rows', async () => {
        vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
            .mockRejectedValueOnce(new Error('synthetic identity-resolution fault'));

        const res = await fetch(`${baseUrl}${OPEN_FIND.path}`);
        const text = await res.text();

        expect(engineFinds, 'the endpoint delegated its data call').toHaveLength(1);
        const handed = engineFinds[0]!.context;
        expect(handed?.userId, 'no user').toBeUndefined();
        expect((handed?.positions as unknown[] | undefined) ?? [], 'no position').toEqual([]);
        expect((handed?.permissions as unknown[] | undefined) ?? [], 'no permission set').toEqual([]);
        expect(handed?.isSystem, 'never the system principal').not.toBe(true);

        expect(storeReached).toEqual([]);
        expect(res.status, text).toBe(403);
        const body = JSON.parse(text) as { success?: boolean; data?: unknown; error?: { code?: string } };
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('PERMISSION_DENIED');
        expect(body).not.toHaveProperty('data');
        for (const row of TASK_ROWS) expect(text).not.toContain(row.name);
    });

    it('CONTROL: with no fault the same anonymous request executes as the guest principal, refused by the deny baseline', async () => {
        const res = await fetch(`${baseUrl}${OPEN_FIND.path}`);
        expect(res.status).toBe(403);
        expect(engineFinds).toHaveLength(1);
        expect(engineFinds[0]!.context).toMatchObject({ principalKind: 'guest', positions: ['guest'], isSystem: false });
        expect(storeReached).toEqual([]);
    });

    it('CONTROL: a signed-in caller the baseline grants is served through the same composition', async () => {
        const res = await fetch(`${baseUrl}${OPEN_FIND.path}`, { headers: { 'x-test-user': 'u_reader' } });
        const text = await res.text();
        expect(res.status, text).toBe(200);
        expect(engineFinds).toHaveLength(1);
        expect(engineFinds[0]!.context).toMatchObject({ userId: 'u_reader', isSystem: false });
        expect(storeReached).toEqual(['find']);
        expect(text).toContain(TASK_ROWS[0]!.name);
    });
});
