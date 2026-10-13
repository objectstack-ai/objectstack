// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 at the declared-endpoint fallback: a session the authentication
 * policy HOLDS (an expired password, enforced MFA not yet enrolled) is refused
 * before a declared endpoint runs, with REST's answer.
 *
 * ## What is pinned, and where
 *
 * The fallback is the dispatcher plugin's `setFallbackHandler` seam, reached
 * only by a request no registered route matched, so it never passes through
 * `HttpDispatcher.enforceAuthGate`. Its policy chain (`applyEndpointPolicies`)
 * now asks the gate, between the meter and `authRequired`, on a session read
 * that runs only while a gate feature is active (`readGatedSessionUser` in
 * `dispatcher-plugin.ts`). The first block boots that composition, a real
 * LiteKernel with the real Hono transport and the real dispatcher plugin, with
 * the services stubbed at the kernel boundary, and drives it over a socket:
 *
 *  - HELD: under both postures, every declared endpoint answers `403` with the
 *    gate's `code` and `message` and no `data`, and the target never ran (no
 *    engine read, no flow run). That holds on the write, and on an
 *    `authRequired: false` endpoint too: the target runs as the caller's
 *    context, so a public endpoint would otherwise read as the held user.
 *  - UN-HELD: the same grants, without a posture, are served exactly as before.
 *  - ALLOW-LISTED: a held session's `/health` read is the un-held answer.
 *  - OUTAGE: an active gate whose session read fails answers `503
 *    SERVICE_UNAVAILABLE`, and nothing runs, as REST answers the same window.
 *  - GATE OFF: with no gate feature active the posture is not read at all.
 *
 * ## The anti-bypass case (the second block)
 *
 * The gate is asked with NO request path, so the shared allow-list can grant
 * no exemption. The allow-list is anchored at a mount boundary (#16839), so
 * under the shipped prefix no declared path is allow-listed. A declared path
 * sits under the dispatcher prefix the HOST chooses, though, and a prefix that
 * lands on an allow-listed boundary (an `auth` segment) makes every declared
 * path under it allow-listed. The second block drives the step under such a
 * prefix, and first asserts that the path really is allow-listed, so the case
 * cannot pass vacuously. Handing the declared path to the allow-list makes it
 * red.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { LiteKernel, Plugin, PluginContext, isAuthGateAllowlisted } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { runAppEndpointStep } from './api-endpoint-step.js';
import { createEndpointRateLimiterRegistry } from './endpoint-policy.js';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'You must change your password before continuing.' };
const MFA_REQUIRED = {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};

/** The posture each test user's session carries. Same grants for all three. */
const POSTURES: Record<string, { code: string; message: string } | undefined> = {
    u_held_pw: PASSWORD_EXPIRED,
    u_held_mfa: MFA_REQUIRED,
    u_member: undefined,
};
const HELD = [
    { user: 'u_held_pw', gate: PASSWORD_EXPIRED },
    { user: 'u_held_mfa', gate: MFA_REQUIRED },
] as const;

const READ: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'gate_pin_tasks',
    path: '/api/v1/apps/showcase/tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
});
const WRITE: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'gate_pin_purge',
    path: '/api/v1/apps/showcase/inquiries/purge',
    method: 'POST',
    type: 'flow',
    target: 'showcase_inquiry_janitor',
});
const OPEN: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'gate_pin_open_tasks',
    path: '/api/v1/apps/showcase/open-tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
    authRequired: false,
});
/** The literal shape of the trap: an `auth` segment INSIDE a declared path. */
const AUTH_SEGMENT: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'gate_pin_auth_callback',
    path: '/api/v1/apps/showcase/auth/callback',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
});
const DECLARED = [READ, WRITE, OPEN, AUTH_SEGMENT];

const TASK_ROWS = [{ id: 'tsk_1', name: 'gate-pin-row-marker', status: 'open' }];
const ADMIN_SET = {
    id: 'ps-admin',
    name: 'admin_full_access',
    object_permissions: { '*': { viewAllRecords: true, modifyAllRecords: true } },
};

/** What the kernel-boundary stubs observed. */
const observed = {
    gateActive: true,
    /** When set, every session read fails (the outage case). */
    failReads: false,
    taskReads: 0,
    flowRuns: 0,
};

function fakeMetadataPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.gate-pin-metadata',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('metadata', {
                list: async () => [],
                matchEndpoint: async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
                    const hit = DECLARED.find(
                        (e) => e.path === q.path.replace(/\/$/, '') && e.method === q.method.toUpperCase(),
                    );
                    return hit ? { endpoint: hit, params: {} } : undefined;
                },
            });
        },
    };
}

function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.gate-pin-services',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                isAuthGateActive: () => observed.gateActive,
                api: {
                    async getSession({ headers }: { headers: Headers }) {
                        if (observed.failReads) throw new Error('session backend unavailable');
                        const uid = headers.get('x-test-user');
                        if (!uid) return null;
                        const authGate = POSTURES[uid];
                        return { user: { id: uid, ...(authGate ? { authGate } : {}) } };
                    },
                },
            });
            ctx.registerService('objectql', {
                async find(object: string, options: any) {
                    if (object === 'sys_user_permission_set') {
                        const uid = options?.where?.user_id;
                        return uid in POSTURES
                            ? [{ user_id: uid, permission_set_id: 'ps-admin', permission_set: 'admin_full_access', organization_id: null }]
                            : [];
                    }
                    if (object === 'sys_permission_set') {
                        const ids: string[] = options?.where?.id?.$in ?? [];
                        return ids.includes('ps-admin') ? [ADMIN_SET] : [];
                    }
                    if (object === 'showcase_task') {
                        observed.taskReads++;
                        return TASK_ROWS;
                    }
                    return [];
                },
            });
            ctx.registerService('automation', {
                async execute() {
                    observed.flowRuns++;
                    return { runId: 'run_1', status: 'completed' };
                },
            });
        },
    };
}

async function shutdown(kernel: LiteKernel | undefined) {
    if (!kernel) return;
    await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}

describe('ADR-0069 at the declared-endpoint fallback (real boot, real socket)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(fakeMetadataPlugin());
        kernel.use(servicesPlugin());
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
        await kernel.bootstrap();
        baseUrl = `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`;
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    beforeEach(() => {
        observed.gateActive = true;
        observed.failReads = false;
        observed.taskReads = 0;
        observed.flowRuns = 0;
    });

    function request(endpoint: ApiEndpoint, user?: string) {
        return fetch(`${baseUrl}${endpoint.path}`, {
            method: endpoint.method,
            headers: {
                ...(user ? { 'x-test-user': user } : {}),
                ...(endpoint.method === 'POST' ? { 'content-type': 'application/json' } : {}),
            },
            ...(endpoint.method === 'POST' ? { body: JSON.stringify({ params: { olderThanDays: 30 } }) } : {}),
        });
    }

    for (const { user, gate } of HELD) {
        for (const endpoint of [READ, WRITE, OPEN, AUTH_SEGMENT]) {
            it(`HELD (${gate.code}): ${endpoint.method} ${endpoint.path} (authRequired: ${endpoint.authRequired}) is refused before the target runs`, async () => {
                const res = await request(endpoint, user);
                const text = await res.text();
                expect(res.status, text).toBe(403);
                const body = JSON.parse(text) as { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
                expect(body.success).toBe(false);
                expect(body.error?.code).toBe(gate.code);
                expect(body.error?.message).toBe(gate.message);
                expect(body).not.toHaveProperty('data');
                expect(text).not.toContain(TASK_ROWS[0]!.name);
                expect(observed.taskReads, 'the target read the store').toBe(0);
                expect(observed.flowRuns, 'the target ran the flow').toBe(0);
            });
        }
    }

    it('UN-HELD: the same grants without a posture are served on every endpoint, the write included', async () => {
        for (const endpoint of [READ, OPEN, AUTH_SEGMENT]) {
            const res = await request(endpoint, 'u_member');
            const text = await res.text();
            expect(res.status, `${endpoint.path}: ${text}`).toBe(200);
            expect(text).toContain(TASK_ROWS[0]!.name);
        }
        expect(observed.taskReads).toBe(3);
        const write = await request(WRITE, 'u_member');
        expect(write.status, await write.text()).toBe(200);
        expect(observed.flowRuns).toBe(1);
    });

    it('UN-HELD: an anonymous caller is answered as before (401 on the default authRequired, served on the public endpoint)', async () => {
        const denied = await request(READ);
        expect(denied.status).toBe(401);
        expect((await denied.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
        const open = await request(OPEN);
        expect(open.status).toBe(200);
        expect(observed.taskReads).toBe(1);
    });

    it('ALLOW-LISTED: a held session reads the dispatcher\'s /health exactly as an un-held one does', async () => {
        expect(isAuthGateAllowlisted('/api/v1/health')).toBe(true);
        const held = await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'u_held_pw' } });
        const unheld = await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'u_member' } });
        expect(held.status).toBe(200);
        expect(held.status).toBe(unheld.status);
    });

    it('OUTAGE: an active gate whose session read fails answers 503 SERVICE_UNAVAILABLE, and nothing runs', async () => {
        observed.failReads = true;
        for (const endpoint of [OPEN, WRITE]) {
            const res = await request(endpoint, 'u_member');
            const text = await res.text();
            expect(res.status, text).toBe(503);
            const body = JSON.parse(text) as { success?: boolean; error?: { code?: string } };
            expect(body.success).toBe(false);
            expect(body.error?.code).toBe('SERVICE_UNAVAILABLE');
        }
        expect(observed.taskReads).toBe(0);
        expect(observed.flowRuns).toBe(0);
    });

    it('GATE OFF: with no gate feature active the posture is never read, and the session is served', async () => {
        observed.gateActive = false;
        const res = await request(READ, 'u_held_pw');
        expect(res.status, await res.text()).toBe(200);
        expect(observed.taskReads).toBe(1);
    });
});

describe('ADR-0069 anti-bypass: no declared path reaches the allow-list', () => {
    /** A host prefix that lands on an allow-listed boundary (`…/auth/…`). */
    const HOST_PREFIX = '/api/v1/auth';
    const PATH = `${HOST_PREFIX}/apps/showcase/callback`;
    const ENDPOINT: ApiEndpoint = ApiEndpointSchema.parse({
        name: 'gate_pin_host_prefix',
        path: PATH,
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
    });

    async function step(path: string, endpoint: ApiEndpoint, prefix: string) {
        const callData = vi.fn(async () => ({ object: 'showcase_task', records: TASK_ROWS, total: 1 }));
        const answer = await runAppEndpointStep({
            method: 'GET',
            path,
            prefix,
            metadataService: { matchEndpoint: async () => ({ endpoint, params: {} }) },
            policy: {
                headers: {},
                resolvePrincipalId: async () => 'u_held_pw',
                resolveGatedSessionUser: async () => ({ id: 'u_held_pw', authGate: PASSWORD_EXPIRED }),
                limiters: createEndpointRateLimiterRegistry({ resolveCache: async () => undefined }),
            },
            execution: {
                request: { method: 'GET', path, query: {}, headers: {}, body: undefined },
                deps: { callData },
                executionContext: { userId: 'u_held_pw', isSystem: false, positions: [], permissions: [] } as any,
            },
        });
        return { answer, callData };
    }

    it('precondition: under this host prefix the declared path IS allow-listed, so the case is not vacuous', () => {
        expect(isAuthGateAllowlisted(PATH)).toBe(true);
        expect(isAuthGateAllowlisted(PATH, 'GET')).toBe(true);
    });

    it('a held session on that declared path is still refused 403 with the gate\'s code, and the target never runs', async () => {
        const { answer, callData } = await step(PATH, ENDPOINT, HOST_PREFIX);
        expect(answer?.status).toBe(403);
        expect((answer?.body as { error?: { code?: string } }).error?.code).toBe('PASSWORD_EXPIRED');
        expect(callData).not.toHaveBeenCalled();
    });

    it('the literal trap shape under the shipped prefix (an `auth` segment inside the declared path) is refused the same way', async () => {
        const { answer, callData } = await step(AUTH_SEGMENT.path, AUTH_SEGMENT, '/api/v1');
        expect(answer?.status).toBe(403);
        expect((answer?.body as { error?: { code?: string } }).error?.code).toBe('PASSWORD_EXPIRED');
        expect(callData).not.toHaveBeenCalled();
    });
});
