// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One authenticated dispatcher request reads its session ONCE, on a REAL
 * kernel with an ADR-0069 gate feature active (password expiry), the
 * composition `default-organization-statements.golden.test.ts` boots.
 *
 * ## What doubled
 *
 * The identity step (`HttpDispatcher.resolveRequestScope`) reads the session
 * through the auth service and records the posture decided off that read
 * (`context.admission`). With any gate feature active, the gate
 * (`HttpDispatcher.enforceAuthGate`) then read the SAME session again for a
 * principal that read had just admitted, so `sys_session` by token and the
 * session's `sys_user` row were each read twice per request, one remote round
 * trip each on a hosted database. The gate now judges that principal by the
 * posture off the identity step's read.
 *
 * ## What this pins
 *
 *  1. ⭐ A warm authenticated request issues ONE `sys_session` lookup by token
 *     and ONE better-auth `sys_user` lookup by id (two each before).
 *  2. CONTROLS, each through the same gate:
 *     - a session the policy holds is still refused at the gate, 403 with the
 *       posture's code, and the domain never answers;
 *     - a revoked session resolves no principal: 401, as an anonymous caller;
 *     - an anonymous request resolves no principal and reads no session row;
 *     - two concurrent requests with different tokens each get their own
 *       answer, interleaved several times.
 *
 * Counted: every statement the SQL driver issues inside the request's own
 * async context (knex's `query` event), as the statements golden counts them.
 * Warm: two requests first, so the localization cache and the served metadata
 * are warm before any count is read.
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
/** A dispatcher-served route outside the ADR-0069 allow-list, answering 401 to an anonymous caller. */
const ROUTE = '/packages';
/** The better-auth session read's token lookup — one per session read. */
const SESSION_TOKEN_LOOKUP = /^select \* from `sys_session` where `token` = \? limit \?$/;
/** The better-auth session read's own user lookup — one per session read. */
const SESSION_USER_LOOKUP = /^select \* from `sys_user` where `id` = \? limit \?$/;

const PIN_APP: any = {
    manifest: { id: 'com.pin.sessionreadonce', name: 'Session read once pins', version: '1.0.0' },
    objects: [{ name: 'pin_note', label: 'Pin note', fields: { title: { type: 'text', label: 'Title' } } }],
};

const statements = new AsyncLocalStorage<string[]>();
let kernel: any;
let engine: any;
let app: any;
let auth: any;
let ownerToken = '';
let heldToken = '';
let prevNodeEnv: string | undefined;

async function signIn(who: { email: string; password: string }): Promise<string> {
    const res: Response = await app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(who),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { token: string }).token;
}

/** One request to {@link ROUTE}, and the statements the driver issued for it. */
async function request(token?: string): Promise<{ status: number; body: any; sql: string[] }> {
    const sql: string[] = [];
    const res: Response = await statements.run(sql, () =>
        app.request(`${ORIGIN}${API}${ROUTE}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, sql: [...sql] };
}

const sessionReads = (sql: string[]) => ({
    sys_session: sql.filter((s) => SESSION_TOKEN_LOOKUP.test(s)).length,
    sys_user: sql.filter((s) => SESSION_USER_LOOKUP.test(s)).length,
});

beforeAll(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` arms it
    kernel = new ObjectKernel();
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(new AppPlugin(PIN_APP));
    await kernel.use(new PlatformObjectsPlugin());
    // ADR-0069 D3: password expiry on, so the gate is ACTIVE on every request.
    await kernel.use(new AuthPlugin({ secret: 'session-read-once-pin-secret-0001', passwordExpiryDays: 365 }));
    await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
    await kernel.use(new SharingServicePlugin());
    await kernel.use(createRestApiPlugin({}));
    await kernel.use(createDispatcherPlugin({}));
    await kernel.bootstrap();
    engine = await kernel.getServiceAsync('objectql');
    app = (await kernel.getServiceAsync('http-server')).getRawApp();
    auth = await kernel.getServiceAsync('auth');
    (engine as any).getDriver('sys_user').knex.on('query', (q: { sql?: unknown }) => {
        statements.getStore()?.push(String(q?.sql ?? ''));
    });
    ownerToken = await signIn(OWNER);

    // The held member, provisioned through the operator door as the stack's
    // own auth manager stages it, then flagged for an administrator-issued
    // password change: a posture the gate refuses.
    const ticket = auth.stageOperatorProvisioning(HELD.email);
    let signUp: Response;
    try {
        signUp = await app.request(`${ORIGIN}${API}/auth/sign-up/email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...HELD, [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket }),
        });
    } finally {
        auth.clearOperatorProvisioning(HELD.email);
    }
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    heldToken = await signIn(HELD);
    const [held] = await engine.find('sys_user', { where: { email: HELD.email }, limit: 1, context: SYS });
    await engine.update('sys_user', { id: held.id, must_change_password: true }, { context: SYS });
}, BOOT_TIMEOUT);

afterAll(async () => {
    try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('one authenticated dispatcher request reads its session once (real kernel, gate active)', () => {
    it('precondition: an ADR-0069 gate feature is active, so the gate runs on every request', () => {
        expect(auth.isAuthGateActive()).toBe(true);
    });

    it('⭐ a warm authenticated request reads sys_session once and the session user once', async () => {
        await request(ownerToken);
        await request(ownerToken);
        const r = await request(ownerToken);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(sessionReads(r.sql)).toEqual({ sys_session: 1, sys_user: 1 });
    });

    it('CONTROL — a session the policy holds is still refused at the gate, with the posture\'s code', async () => {
        const r = await request(heldToken);
        expect(r.status).toBe(403);
        expect(r.body?.error?.code).toBe('PASSWORD_RESET_REQUIRED');
        expect(sessionReads(r.sql), r.sql.join('\n')).toEqual({ sys_session: 1, sys_user: 1 });
    });

    it('CONTROL — an anonymous request resolves no principal and reads no session row', async () => {
        const r = await request();
        expect(r.status, JSON.stringify(r.body)).toBe(401);
        expect(r.sql.filter((s) => /`sys_session`/.test(s))).toEqual([]);
    });

    it('CONTROL — two concurrent requests with different tokens each get their own answer', async () => {
        const answers = await Promise.all(
            Array.from({ length: 8 }, (_, i) => request(i % 2 === 0 ? ownerToken : heldToken)),
        );
        expect(answers.map((a) => a.status)).toEqual([200, 403, 200, 403, 200, 403, 200, 403]);
        for (const a of answers) expect(sessionReads(a.sql)).toEqual({ sys_session: 1, sys_user: 1 });
    });

    it('CONTROL — a revoked session resolves no principal: 401, as an anonymous caller', async () => {
        const token = await signIn(OWNER);
        expect((await request(token)).status).toBe(200);
        const [row] = await engine.find('sys_session', { where: { token }, limit: 1, context: SYS });
        expect(row, 'precondition: the session row exists').toBeDefined();
        await engine.delete('sys_session', { where: { id: row.id }, context: SYS });
        const r = await request(token);
        expect(r.status, JSON.stringify(r.body)).toBe(401);
    });
});
