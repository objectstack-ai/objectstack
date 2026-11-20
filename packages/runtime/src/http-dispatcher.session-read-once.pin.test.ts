// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One authenticated request reads its session ONCE, on a REAL kernel, on every
 * door and in every posture that used to read it more than once.
 *
 * ## What doubled
 *
 * The identity step (`HttpDispatcher.resolveRequestScope`, REST's
 * `computeExecCtx`, both through core `resolveRequestExecutionContext`) reads
 * the session through the auth service. Three more readers asked the SAME
 * request the same question:
 *
 *  - the dispatcher's ADR-0069 gate (`HttpDispatcher.enforceAuthGate`), with a
 *    gate feature active. It now judges a principal the identity step admitted
 *    by the posture off that read (`context.admission`);
 *  - REST's gate (`authGate: 'reread-when-active'`, core `decideAuthGate`),
 *    with a gate feature active;
 *  - the inbound rate limiter (`server.security.rateLimit` armed), which keys
 *    its bucket by the principal in the transport's middleware seam, before
 *    any route runs.
 *
 * The last two now read through the request's session-read carrier
 * (`@objectstack/core` `request-session-read.ts`): the transport runs its
 * middleware chain in a scope and hands that scope to the route it serves
 * past whole-server middleware only, so a read one of them made is served to
 * the next, within the same request, while no write has landed since it was
 * read. Each read was one
 * `sys_session` lookup by token and one `sys_user` lookup by id, one remote
 * round trip each on a hosted database.
 *
 * ## What this pins, per door and posture
 *
 *  1. ⭐ A warm authenticated request calls `getSession` ONCE and issues ONE
 *     `sys_session` lookup by token and ONE better-auth `sys_user` lookup by
 *     id: on the dispatcher with a gate active, on REST with a gate active, on
 *     both doors with the limiter armed, and on both with both.
 *  2. CONTROLS, each through the same composition:
 *     - a session the policy holds is still refused, 403 with the posture's code;
 *     - a revoked session resolves no principal: 401, as an anonymous caller;
 *     - an anonymous request resolves no principal and reads no session row;
 *     - concurrent requests with different tokens each get their own answer;
 *     - the limiter still keys by the principal and still refuses over budget;
 *     - a read that throws keeps its outage answer, and is never served;
 *     - a revocation landing between the limiter's read and the route's is seen;
 *     - a raw mount behind plugin-auth's door reads for itself, never answered
 *       by the limiter's read made in front of it (ADR-0069 D5).
 *
 * Counted: every statement the SQL driver issues inside the request's own
 * async context (knex's `query` event), as the statements golden counts them,
 * and every `getSession` call on the auth service's API. Warm: two requests
 * first, so the localization cache and the served metadata are warm before any
 * count is read.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthManager, AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
// Paid at collection, not inside the boot's clock: the app plugin's reach loads it lazily.
import '@objectstack/metadata';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SYS = { isSystem: true };
/** `AuthPlugin`'s dev-admin defaults (`OS_SEED_ADMIN_*` unset). */
const OWNER = { email: 'admin@objectos.ai', password: 'admin123' };
const HELD = { email: 'held@pin.test', password: 'held-pin-password-session-once', name: 'Held member' };
const BURST = { email: 'burst@pin.test', password: 'burst-pin-password-session-once', name: 'Burst member' };
/** A dispatcher-served route outside the ADR-0069 allow-list, answering 401 to an anonymous caller. */
const ROUTE = '/packages';
/** The REST data door, on the pin app's own object. */
const REST_ROUTE = '/data/pin_note';
/** A plugin-auth raw mount behind its door under the auth base path that resolves its caller in process. */
const AUTH_MOUNT_ROUTE = '/auth/client-address';
/** The better-auth session read's token lookup — one per session read. */
const SESSION_TOKEN_LOOKUP = /^select \* from `sys_session` where `token` = \? limit \?$/;
/** The better-auth session read's own user lookup — one per session read. */
const SESSION_USER_LOOKUP = /^select \* from `sys_user` where `id` = \? limit \?$/;
/**
 * The armed limiter's budget: whole requests per principal, refilled over an
 * hour, so no token refills inside a test and the refusal lands on the request
 * the budget names.
 */
const BUDGET = { enabled: true, maxRequests: 30, windowMs: 3_600_000 };
/** A header only {@link revokeBetweenReads} reads: the session row it names is deleted in the seam, after the limiter. */
const REVOKE_HEADER = 'x-pin-revoke-session';

const PIN_APP: any = {
    manifest: { id: 'com.pin.sessionreadonce', name: 'Session read once pins', version: '1.0.0' },
    objects: [{ name: 'pin_note', label: 'Pin note', fields: { title: { type: 'text', label: 'Title' } } }],
};

/** What one request did: the statements its own async context issued, and its `getSession` calls. */
interface RequestTrace {
    sql: string[];
    getSession: number;
}

const traces = new AsyncLocalStorage<RequestTrace>();

/** One booted composition, and the knobs its pins turn. */
interface Stack {
    kernel: any;
    engine: any;
    app: any;
    auth: any;
    ownerToken: string;
    /** Signed in as {@link HELD}: held by the gate where a gate is active, an ordinary member elsewhere. */
    heldToken: string;
    /** `'all'`: every `getSession` call throws. `n > 0`: the next `n` calls throw. */
    failReads: 'all' | number;
}

/** A gate feature on (ADR-0069 D3 password expiry), so a gate is ACTIVE on every request. */
type Posture = { gate: boolean; limiter: boolean };

async function signIn(stack: Stack, who: { email: string; password: string }): Promise<string> {
    const res: Response = await stack.app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(who),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { token: string }).token;
}

/** A member provisioned through the operator door, as the stack's own auth manager stages it. */
async function provision(stack: Stack, who: { email: string; password: string; name: string }): Promise<string> {
    const ticket = stack.auth.stageOperatorProvisioning(who.email);
    let signUp: Response;
    try {
        signUp = await stack.app.request(`${ORIGIN}${API}/auth/sign-up/email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...who, [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket }),
        });
    } finally {
        stack.auth.clearOperatorProvisioning(who.email);
    }
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    return signIn(stack, who);
}

async function bootStack(posture: Posture): Promise<Stack> {
    const kernel: any = new ObjectKernel();
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(new AppPlugin(PIN_APP));
    await kernel.use(new PlatformObjectsPlugin());
    await kernel.use(new AuthPlugin({
        secret: 'session-read-once-pin-secret-0001',
        ...(posture.gate ? { passwordExpiryDays: 365 } : {}),
    }));
    await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
    await kernel.use(new SharingServicePlugin());
    await kernel.use(createRestApiPlugin({}));
    await kernel.use(createDispatcherPlugin(posture.limiter ? { rateLimit: { budget: BUDGET, trustProxy: false } } : {}));
    await kernel.bootstrap();
    const engine = await kernel.getServiceAsync('objectql');
    const server = await kernel.getServiceAsync('http-server');
    const app = server.getRawApp();
    const auth = await kernel.getServiceAsync('auth');
    const stack: Stack = { kernel, engine, app, auth, ownerToken: '', heldToken: '', failReads: 0 };
    engine.getDriver('sys_user').knex.on('query', (q: { sql?: unknown }) => {
        traces.getStore()?.sql.push(String(q?.sql ?? ''));
    });
    // Every reader reaches the same better-auth API object; count (and, for the
    // outage pins, fail) its session read there.
    const api = await auth.getApi();
    const read = api.getSession;
    api.getSession = function countedGetSession(this: unknown, ...args: unknown[]) {
        const trace = traces.getStore();
        if (trace) trace.getSession += 1;
        if (trace && (stack.failReads === 'all' || stack.failReads > 0)) {
            if (stack.failReads !== 'all') stack.failReads -= 1;
            return Promise.reject(new Error('pin: the session store is unreachable'));
        }
        return read.apply(this, args);
    };
    if (posture.limiter) revokeBetweenReads(server, engine);
    stack.ownerToken = await signIn(stack, OWNER);
    stack.heldToken = await provision(stack, HELD);
    if (posture.gate) {
        // Flagged for an administrator-issued password change: a posture the gate
        // refuses. Only where a gate is meant to be active: a flagged user switches
        // the gate on by itself (`isAuthGateActive()` reads "any user flagged").
        const [held] = await engine.find('sys_user', { where: { email: HELD.email }, limit: 1, context: SYS });
        await engine.update('sys_user', { id: held.id, must_change_password: true }, { context: SYS });
    }
    return stack;
}

/**
 * A seam middleware registered AFTER the limiter (the dispatcher installs it in
 * `start()`, this runs after boot): on a request carrying {@link REVOKE_HEADER}
 * it deletes that session's row, between the limiter's read and the route's.
 */
function revokeBetweenReads(server: any, engine: any): void {
    server.use(async (req: any, _res: any, next: () => Promise<void>) => {
        const token = req.headers?.[REVOKE_HEADER];
        if (typeof token === 'string' && token) {
            const [row] = await engine.find('sys_session', { where: { token }, limit: 1, context: SYS });
            if (row) await engine.delete('sys_session', { where: { id: row.id }, context: SYS });
        }
        await next();
    });
}

/** One request to `path`, and what it did. */
async function request(
    stack: Stack,
    path: string,
    token?: string,
    extra: Record<string, string> = {},
): Promise<{ status: number; body: any } & RequestTrace> {
    const trace: RequestTrace = { sql: [], getSession: 0 };
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
    const res: Response = await traces.run(trace, () => stack.app.request(`${ORIGIN}${API}${path}`, { headers }));
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    return { status: res.status, body, sql: [...trace.sql], getSession: trace.getSession };
}

const sessionReads = (r: RequestTrace) => ({
    getSession: r.getSession,
    sys_session: r.sql.filter((s) => SESSION_TOKEN_LOOKUP.test(s)).length,
    sys_user: r.sql.filter((s) => SESSION_USER_LOOKUP.test(s)).length,
});
const ONCE = { getSession: 1, sys_session: 1, sys_user: 1 };

async function warm(stack: Stack, path: string, token: string) {
    await request(stack, path, token);
    await request(stack, path, token);
    return request(stack, path, token);
}

async function shutdown(stack: Stack | undefined) {
    try { await stack?.kernel?.shutdown?.(); } catch { /* best-effort */ }
}

let prevNodeEnv: string | undefined;
beforeAll(() => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` arms it
});
afterAll(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
});

describe('gate active: the dispatcher reads its session once (real kernel)', () => {
    let g: Stack;
    beforeAll(async () => { g = await bootStack({ gate: true, limiter: false }); }, BOOT_TIMEOUT);
    afterAll(() => shutdown(g), 60_000);

    it('precondition: an ADR-0069 gate feature is active, so the gate runs on every request', () => {
        expect(g.auth.isAuthGateActive()).toBe(true);
    });

    it('⭐ a warm authenticated request reads sys_session once and the session user once', async () => {
        const r = await warm(g, ROUTE, g.ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r)).toEqual(ONCE);
    });

    it('CONTROL — a session the policy holds is still refused at the gate, with the posture\'s code', async () => {
        const r = await request(g, ROUTE, g.heldToken);
        expect(r.status).toBe(403);
        expect(r.body?.error?.code).toBe('PASSWORD_RESET_REQUIRED');
        expect(sessionReads(r), r.sql.join('\n')).toEqual(ONCE);
    });

    it('CONTROL — an anonymous request resolves no principal and reads no session row', async () => {
        const r = await request(g, ROUTE);
        expect(r.status, JSON.stringify(r.body)).toBe(401);
        expect(r.sql.filter((s) => /`sys_session`/.test(s))).toEqual([]);
    });

    it('CONTROL — two concurrent requests with different tokens each get their own answer', async () => {
        const answers = await Promise.all(
            Array.from({ length: 8 }, (_, i) => request(g, ROUTE, i % 2 === 0 ? g.ownerToken : g.heldToken)),
        );
        expect(answers.map((a) => a.status)).toEqual([200, 403, 200, 403, 200, 403, 200, 403]);
        for (const a of answers) expect(sessionReads(a)).toEqual(ONCE);
    });

    it('CONTROL — a revoked session resolves no principal: 401, as an anonymous caller', async () => {
        const token = await signIn(g, OWNER);
        expect((await request(g, ROUTE, token)).status).toBe(200);
        const [row] = await g.engine.find('sys_session', { where: { token }, limit: 1, context: SYS });
        expect(row, 'precondition: the session row exists').toBeDefined();
        await g.engine.delete('sys_session', { where: { id: row.id }, context: SYS });
        const r = await request(g, ROUTE, token);
        expect(r.status, JSON.stringify(r.body)).toBe(401);
    });

    describe('the REST door, same composition: `reread-when-active` reuses the identity read', () => {
        it('⭐ a warm authenticated REST read calls getSession once and reads its rows once', async () => {
            const r = await warm(g, REST_ROUTE, g.ownerToken);
            expect(r.status, JSON.stringify(r.body)).toBe(200);
            expect(sessionReads(r)).toEqual(ONCE);
        });

        it('CONTROL — a session the policy holds is still refused, 403 with the posture\'s code, on one read', async () => {
            const r = await request(g, REST_ROUTE, g.heldToken);
            expect(r.status, JSON.stringify(r.body)).toBe(403);
            expect(r.body?.error?.code).toBe('PASSWORD_RESET_REQUIRED');
            expect(sessionReads(r)).toEqual(ONCE);
        });

        it('CONTROL — an anonymous REST read is 401 and reads no session row', async () => {
            const r = await request(g, REST_ROUTE);
            expect(r.status, JSON.stringify(r.body)).toBe(401);
            expect(r.sql.filter((s) => /`sys_session`/.test(s))).toEqual([]);
        });

        it('CONTROL — concurrent REST reads with two tokens each get their own answer, on one read each', async () => {
            const answers = await Promise.all(
                Array.from({ length: 8 }, (_, i) => request(g, REST_ROUTE, i % 2 === 0 ? g.ownerToken : g.heldToken)),
            );
            expect(answers.map((a) => a.status)).toEqual([200, 403, 200, 403, 200, 403, 200, 403]);
            for (const a of answers) expect(sessionReads(a)).toEqual(ONCE);
        });

        it('CONTROL — a revoked session is 401 on REST', async () => {
            const token = await signIn(g, OWNER);
            expect((await request(g, REST_ROUTE, token)).status).toBe(200);
            const [row] = await g.engine.find('sys_session', { where: { token }, limit: 1, context: SYS });
            await g.engine.delete('sys_session', { where: { id: row.id }, context: SYS });
            const r = await request(g, REST_ROUTE, token);
            expect(r.status, JSON.stringify(r.body)).toBe(401);
        });

        it('CONTROL — a session read that throws keeps its outage answer on each door, and is never served', async () => {
            g.failReads = 'all';
            try {
                // REST degrades a failed identity read to anonymous: fail-closed 401.
                const rest = await request(g, REST_ROUTE, g.ownerToken);
                expect(rest.status, JSON.stringify(rest.body)).toBe(401);
                // The dispatcher's active gate cannot read the session it must judge: 503.
                const dispatcher = await request(g, ROUTE, g.ownerToken);
                expect(dispatcher.status, JSON.stringify(dispatcher.body)).toBe(503);
                expect(dispatcher.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
                // Every reader that read asked the store itself: a failure is never handed on.
                expect(dispatcher.getSession).toBe(2);
            } finally {
                g.failReads = 0;
            }
            expect((await request(g, REST_ROUTE, g.ownerToken)).status).toBe(200);
        });
    });
});

describe('limiter armed: the limiter\'s read is the request\'s read (real kernel)', () => {
    let l: Stack;
    beforeAll(async () => { l = await bootStack({ gate: false, limiter: true }); }, BOOT_TIMEOUT);
    afterAll(() => shutdown(l), 60_000);

    it('precondition: no gate feature is active; the limiter is armed', async () => {
        expect(l.auth.isAuthGateActive()).toBe(false);
    });

    it('⭐ a warm authenticated dispatcher request calls getSession once and reads its rows once', async () => {
        const r = await warm(l, ROUTE, l.ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r)).toEqual(ONCE);
    });

    it('⭐ a warm authenticated REST read calls getSession once and reads its rows once', async () => {
        const r = await warm(l, REST_ROUTE, l.ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r)).toEqual(ONCE);
    });

    it('CONTROL — an anonymous request is 401 on both doors and reads no session row', async () => {
        for (const path of [ROUTE, REST_ROUTE]) {
            const r = await request(l, path);
            expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(401);
            expect(r.sql.filter((s) => /`sys_session`/.test(s))).toEqual([]);
        }
    });

    it('CONTROL — the limiter still keys by the principal and still refuses over budget, 429', async () => {
        const burstToken = await provision(l, BURST);
        const answers: Array<Awaited<ReturnType<typeof request>>> = [];
        for (let i = 0; i < BUDGET.maxRequests + 1; i++) answers.push(await request(l, ROUTE, burstToken));
        // The whole budget is spent on this principal's own bucket, each request
        // reaching the route (a member without the capability: its own 403), and
        // the next one is refused.
        expect(answers.map((a) => a.status)).toEqual([...Array(BUDGET.maxRequests).fill(403), 429]);
        expect(answers[0]?.body?.error?.code).toBe('PERMISSION_DENIED');
        const refused = answers[BUDGET.maxRequests]!;
        expect(refused.body?.error?.details?.retryAfterSeconds).toBeGreaterThan(0);
        // The refusal was decided on the limiter's own read, and the route never ran.
        expect(sessionReads(refused)).toEqual(ONCE);
        // Keyed by principal, not by address: another principal is untouched.
        expect((await request(l, ROUTE, l.ownerToken)).status).toBe(200);
    });

    it('CONTROL — concurrent requests with two tokens each get their own answer, on one read each', async () => {
        const answers = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                request(l, i % 4 < 2 ? ROUTE : REST_ROUTE, i % 2 === 0 ? l.ownerToken : l.heldToken)),
        );
        // No gate feature is active here: the member is refused by its own
        // permissions on both doors, the owner is served.
        expect(answers.map((a) => a.status)).toEqual([200, 403, 200, 403, 200, 403, 200, 403]);
        for (const a of answers) expect(sessionReads(a)).toEqual(ONCE);
    });

    it('CONTROL — a limiter read that throws is not served: the route reads afresh and admits', async () => {
        l.failReads = 1;
        try {
            const r = await request(l, ROUTE, l.ownerToken);
            expect(r.status, JSON.stringify(r.body)).toBe(200);
            expect(r.getSession).toBe(2);
        } finally {
            l.failReads = 0;
        }
    });

    it('CONTROL — a raw mount behind the auth door reads for itself: the limiter\'s read never answers there', async () => {
        // `GET /auth/client-address` resolves its caller in process
        // (`resolveRequestExecutionContext`) behind plugin-auth's door under the
        // auth base path, where the organization's IP list is judged on the
        // read (ADR-0069 D5). The limiter's read is made in front of that door
        // and judged without it, so it must not be the answer there: the route
        // reads for itself. `host` on the request, as a socket-served request
        // carries it, so the route's header set is the limiter's exactly.
        const host = { host: new URL(ORIGIN).host };
        await request(l, AUTH_MOUNT_ROUTE, l.ownerToken, host);
        const r = await request(l, AUTH_MOUNT_ROUTE, l.ownerToken, host);
        expect(r.status, JSON.stringify(r.body)).not.toBe(429);
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
        expect(r.getSession).toBe(2);
    });

    it('CONTROL — a revocation landing between the limiter\'s read and the route\'s is seen: 401', async () => {
        for (const path of [ROUTE, REST_ROUTE]) {
            const token = await signIn(l, OWNER);
            expect((await request(l, path, token)).status).toBe(200);
            const r = await request(l, path, token, { [REVOKE_HEADER]: token });
            expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(401);
        }
    });
});

describe('limiter armed and gate active: one read on both doors (real kernel)', () => {
    let b: Stack;
    beforeAll(async () => { b = await bootStack({ gate: true, limiter: true }); }, BOOT_TIMEOUT);
    afterAll(() => shutdown(b), 60_000);

    it('precondition: a gate feature is active', () => {
        expect(b.auth.isAuthGateActive()).toBe(true);
    });

    it('⭐ a warm authenticated dispatcher request calls getSession once and reads its rows once', async () => {
        const r = await warm(b, ROUTE, b.ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r)).toEqual(ONCE);
    });

    it('⭐ a warm authenticated REST read calls getSession once and reads its rows once', async () => {
        const r = await warm(b, REST_ROUTE, b.ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r)).toEqual(ONCE);
    });

    it('CONTROL — a held session is refused on both doors, 403 with the posture\'s code, on one read', async () => {
        for (const path of [ROUTE, REST_ROUTE]) {
            const r = await request(b, path, b.heldToken);
            expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(403);
            expect(r.body?.error?.code).toBe('PASSWORD_RESET_REQUIRED');
            expect(sessionReads(r)).toEqual(ONCE);
        }
    });

    it('CONTROL — concurrent requests with two tokens on both doors each get their own answer', async () => {
        const answers = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                request(b, i % 4 < 2 ? ROUTE : REST_ROUTE, i % 2 === 0 ? b.ownerToken : b.heldToken)),
        );
        expect(answers.map((a) => a.status)).toEqual([200, 403, 200, 403, 200, 403, 200, 403]);
        for (const a of answers) expect(sessionReads(a)).toEqual(ONCE);
    });
});
