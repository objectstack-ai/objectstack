// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling record 6227928430, letter A item 2; ruling record 6257816853, slice
 * 5 letter A] The `/auth/me` door, proven on the one request-to-
 * `ExecutionContext` composition by this pin plus its existing ones.
 *
 * The door is `makeExecutionContextResolver`, which all three current-user
 * routes call before they answer. It is driven here through the routes
 * themselves, `GET /auth/me/permissions`, `GET /auth/me/localization` and
 * `GET /me/apps`, on the real `HonoServerPlugin` booted through `init()`,
 * `start()` and its `kernel:ready` hooks, with no seam captured. Each row reads
 * what the routes answered and what reached the security service: the
 * context `/auth/me/permissions` and `/me/apps` hand to
 * `resolvePermissionSetsForContext` for the caller's sets.
 *
 *  - ADR-0096: a request that resolves no principal is answered by each
 *    route's own signed-out body, and the security service is never asked:
 *    no credential, a cookie the auth service does not recognise, a session
 *    read that throws, an API key alone (this door never opened an API-key
 *    door), and a host with no auth service.
 *  - ADR-0069: these routes are allow-listed for a gated user (they
 *    bootstrap the remediation UI), so a session the authentication policy
 *    holds is served, and the context the door hands on carries no
 *    `authGate`.
 *  - An authorization store that cannot be read is the host's `503`, never a
 *    signed-out body.
 *  - The composition's reading (ruling record 6257816853 item 1): a session
 *    read that carries `session.userId` and no `user.id` is served as that
 *    user, as at every other door.
 *
 * The CONTROL row proves the door admits somebody and withholds what it
 * declares: an ungated session is served, and its context carries no session
 * bearer, locale or time zone, although the session carries a bearer, the
 * request a language and the host a settings service.
 *
 * Every row but the ruled reading's was green on the door's hand-written
 * composition; all of them are green on the shared one.
 */

import { describe, expect, it } from 'vitest';
import { AUTHZ_STORE_UNAVAILABLE_CODE, AUTHZ_STORE_UNAVAILABLE_STATUS, hashApiKey } from '@objectstack/core';
import { HonoServerPlugin } from './hono-plugin';

const ORG = 'org_alpha';
const COOKIE = 'better-auth.session_token=tok_auth_me_door.c2ln';
const HELD_COOKIE = 'better-auth.session_token=tok_auth_me_door_held.c2ln';
const SESSION_USER_ID_COOKIE = 'better-auth.session_token=tok_auth_me_door_session_user_id.c2ln';
const STRANGER_COOKIE = 'better-auth.session_token=tok_auth_me_door_unknown.c2ln';
const KEY = 'osk_auth_me_door_key';
const FUTURE = '2999-01-01T00:00:00Z';
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };

const PERMISSIONS = '/api/v1/auth/me/permissions';
const LOCALIZATION = '/api/v1/auth/me/localization';
const APPS = '/api/v1/me/apps';

/** The one app the engine's registry holds: a signed-in caller is shown it, a signed-out one never is. */
const APP = { name: 'door_app', label: 'Door App' };

interface Host {
    /** The auth service: one with a session read, or none at all. */
    auth: 'session' | 'none';
    /** The auth service's session read throws for every request. */
    sessionReadThrows?: true;
    /** The permission store's membership read fails. */
    storeDown?: true;
}

/**
 * One deployment: an engine answering the grant tables and holding one app,
 * a metadata service, a settings service with a time zone, a security service
 * that records every context it is asked about, and the host's auth service.
 * A gate is active throughout, so a held session is held by policy.
 */
function services(host: Host, asked: unknown[]): Record<string, unknown> {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_api_key: [{ id: 'k_live', key: hashApiKey(KEY), revoked: false, user_id: 'u_key', active_organization_id: ORG, expires_at: FUTURE }],
        sys_member: [
            { user_id: 'u_key', organization_id: ORG, role: 'member' },
            { user_id: 'u_ses', organization_id: ORG, role: 'member' },
            { user_id: 'u_held', organization_id: ORG, role: 'member' },
        ],
    };
    const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined) =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
            if (v !== null && typeof v === 'object') {
                const list = (v as { $in?: unknown[] }).$in;
                if (!Array.isArray(list)) throw new Error(`fixture: unsupported operator on ${k}`);
                return list.includes(row[k] ?? null);
            }
            return (v ?? null) === (row[k] ?? null);
        });
    const objectql = {
        async find(object: string, q: { where?: Record<string, unknown>; limit?: number } = {}) {
            if (host.storeDown && object === 'sys_member') throw new Error('connection refused');
            const rows = (tables[object] ?? []).filter((row) => matches(row, q.where));
            return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        registry: { getAllApps: () => [APP], getAllObjects: () => [] },
        getSchema: () => undefined,
    };

    const registered: Record<string, unknown> = {
        objectql,
        metadata: { list: async () => [] },
        settings: {
            async get(namespace: string, key: string) {
                return { value: `${namespace}.${key}` === 'localization.timezone' ? 'Europe/Paris' : undefined };
            },
        },
        security: {
            async resolvePermissionSetsForContext(context: unknown) {
                asked.push(context);
                return [];
            },
        },
    };
    if (host.auth === 'session') {
        const sessions: Record<string, unknown> = {
            [COOKIE]: { user: { id: 'u_ses' }, session: { id: 'sess_ses', userId: 'u_ses', token: 'bearer_ses', activeOrganizationId: ORG } },
            [HELD_COOKIE]: {
                user: { id: 'u_held', authGate: PASSWORD_EXPIRED },
                session: { id: 'sess_held', userId: 'u_held', token: 'bearer_held', activeOrganizationId: ORG },
            },
            [SESSION_USER_ID_COOKIE]: { session: { id: 'sess_uid', userId: 'u_ses', token: 'bearer_uid', activeOrganizationId: ORG } },
        };
        registered.auth = {
            api: {
                async getSession(input: { headers: Headers }) {
                    if (host.sessionReadThrows) throw new Error('session backend unavailable');
                    return sessions[input.headers.get('cookie') ?? ''] ?? null;
                },
            },
            isAuthGateActive: () => true,
            resolveUserAuthGates: async () => [],
        };
    }
    return registered;
}

/** Boot the real plugin on `host` and answer the three routes for one request. */
async function boot(host: Host, headers: Record<string, string>) {
    const asked: unknown[] = [];
    const registered: Record<string, unknown> = services(host, asked);
    const readyHooks: Array<() => Promise<void> | void> = [];
    const quiet = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return quiet; } };
    const ctx: any = {
        logger: quiet,
        registerService: (name: string, value: unknown) => { registered[name] = value; },
        // The kernel's locator: an absent slot THROWS.
        getService: <T,>(name: string): T => {
            if (!(name in registered)) throw new Error(`[Kernel] Service '${name}' not found`);
            return registered[name] as T;
        },
        getKernel: () => ({ hasPlugin: () => false }),
        hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') readyHooks.push(fn); },
    };
    const plugin = new HonoServerPlugin({ port: 0, cors: false });
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const fn of readyHooks) await fn();
    const app = (plugin as any).server.getRawApp();

    const answers: Record<string, { status: number; body: any }> = {};
    for (const route of [PERMISSIONS, LOCALIZATION, APPS]) {
        const res: Response = await app.request(`http://localhost${route}`, { headers });
        answers[route] = { status: res.status, body: await res.json() };
    }
    return { answers, asked: asked as Array<Record<string, unknown>> };
}

const SIGNED_OUT = {
    [PERMISSIONS]: { authenticated: false },
    [LOCALIZATION]: { authenticated: false },
    [APPS]: { apps: [] },
};

const ROWS: Array<{
    name: string;
    host: Host;
    headers: Record<string, string>;
    /** Each route's own signed-out body, and the security service never asked. */
    signedOut?: true;
    /** The host's outage answer on every route, and the security service never asked. */
    outage?: true;
    /** Who the security service was asked about, by both routes that ask it. */
    principal?: string;
}> = [
    { name: 'ADR-0096: no credential is signed out on every route', host: { auth: 'session' }, headers: {}, signedOut: true },
    {
        name: 'ADR-0096: a cookie the auth service does not recognise is signed out on every route',
        host: { auth: 'session' }, headers: { cookie: STRANGER_COOKIE }, signedOut: true,
    },
    {
        name: 'ADR-0096: a session read that throws resolved no caller, so it is signed out and not an outage',
        host: { auth: 'session', sessionReadThrows: true }, headers: { cookie: COOKIE }, signedOut: true,
    },
    {
        name: 'ADR-0096: an API key alone is signed out, because this door never opened an API-key door',
        host: { auth: 'session' }, headers: { 'x-api-key': KEY }, signedOut: true,
    },
    {
        name: 'ADR-0096: a host with no auth service signs nobody in',
        host: { auth: 'none' }, headers: { cookie: COOKIE }, signedOut: true,
    },
    {
        name: 'ADR-0069: a held session is served on these allow-listed routes, and its context carries no authGate',
        host: { auth: 'session' }, headers: { cookie: HELD_COOKIE }, principal: 'u_held',
    },
    {
        name: "a permission store that cannot be read is the host's 503 on every route, never a signed-out body",
        host: { auth: 'session', storeDown: true }, headers: { cookie: COOKIE }, outage: true,
    },
    {
        name: 'the ruled reading: a session read carrying session.userId and no user.id is served as that user',
        host: { auth: 'session' }, headers: { cookie: SESSION_USER_ID_COOKIE }, principal: 'u_ses',
    },
    {
        name: 'CONTROL: an ungated session is served, and its context carries no session bearer, locale or time zone',
        host: { auth: 'session' }, headers: { cookie: COOKIE, 'accept-language': 'zh-CN' }, principal: 'u_ses',
    },
];

describe('[ruling 6227928430 item 2, ruling 6257816853] the /auth/me door: the ADR-0096 principal-less refusal and the ADR-0069 allow-list on its three routes', () => {
    it.each(ROWS)('$name', async (row) => {
        const { answers, asked } = await boot(row.host, row.headers);

        if (row.signedOut) {
            for (const [route, body] of Object.entries(SIGNED_OUT)) {
                expect(answers[route], route).toEqual({ status: 200, body });
            }
            expect(asked).toHaveLength(0);
            return;
        }
        if (row.outage) {
            for (const route of [PERMISSIONS, LOCALIZATION, APPS]) {
                expect(answers[route]!.status, route).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
                expect(answers[route]!.body?.error?.code, route).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
            }
            expect(asked).toHaveLength(0);
            return;
        }

        expect(answers[PERMISSIONS]).toMatchObject({ status: 200, body: { authenticated: true, userId: row.principal, tenantId: ORG } });
        expect(answers[LOCALIZATION]).toMatchObject({ status: 200, body: { authenticated: true } });
        expect(answers[APPS]).toEqual({ status: 200, body: { apps: [APP] } });
        // `/auth/me/permissions` and `/me/apps` each ask once, about this caller.
        expect(asked).toHaveLength(2);
        for (const context of asked) {
            expect(context).toMatchObject({ userId: row.principal, tenantId: ORG, principalKind: 'human', isSystem: false });
            // Withheld by this door: the ADR-0069 posture, the session bearer and
            // the localization the endpoints resolve for themselves.
            expect(context.authGate).toBeUndefined();
            expect(context.accessToken).toBeUndefined();
            expect(context.locale).toBeUndefined();
            expect(context.timezone).toBeUndefined();
        }
    });
});
