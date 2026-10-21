// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24148] The Cloud Connection page's permission, enforced at the routes
 * behind it.
 *
 * The Console's Cloud Connection panel sits on the Setup app, which declares
 * `requiredPermissions: ['setup.access']`. These pins hold the routes to the
 * same rule, driven through the routes `CloudConnectionPlugin` really mounts
 * (`start()` + `kernel:ready`), under both resolution modes:
 *
 *  - `bind/start`, `bind/poll` and `unbind` refuse a signed-in caller who does
 *    not hold `setup.access` with `403 PERMISSION_DENIED` naming it, in the
 *    declared envelope, before any control-plane call and before the stored
 *    credential is touched — one case per door, so each door's check is held
 *    on its own;
 *  - a caller who holds it is served exactly as before (the control);
 *  - `GET /status` answers every caller, and serves `bound`, `runtimeId` and
 *    `provider` alone unless the caller holds `setup.access`; a holder is
 *    served the connection record too (the control).
 *
 * What a caller holds is read through `resolveAuthzContext`, so the grants
 * below are real permission-set rows served through the engine's `find`, and
 * the set bodies come from the bound security catalog — never a stubbed
 * capability list, which would keep passing if the check read something else.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashApiKey, isAuthzStoreUnavailableError } from '@objectstack/core';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const CC = '/api/v1/cloud-connection';
const ORIGIN = 'https://env.example.test';

/** Holds `setup.access` through the Default Organization's `admin_full_access` grant (the platform-admin shape: it applies with no active organization). */
const ADMIN = 'u_setup_admin';
/** Holds `setup.access` through a grant scoped to the organization its session is active in (the organization-admin shape). */
const ORG_ADMIN = 'u_org_admin';
/** Signed in, holds a permission set in the organization its session is active in, and the set carries no `setup.access`. */
const MEMBER = 'u_member';
/** Holds `setup.access` (the platform-admin shape, as {@link ADMIN}), but the ADR-0069 policy holds the session. */
const HELD_ADMIN = 'u_held_admin';

const ORG = 'org_a';
/** The Default Organization — the owner of the one `admin_full_access` grant that anchors platform standing. */
const DEFAULT_ORG = 'org_default';
const SESSIONS: Record<string, { activeOrganizationId?: string; authGate?: { code: string; message: string } }> = {
    [ADMIN]: {},
    [ORG_ADMIN]: { activeOrganizationId: ORG },
    [MEMBER]: { activeOrganizationId: ORG },
    [HELD_ADMIN]: { authGate: { code: 'PASSWORD_EXPIRED', message: 'You must change your password before continuing.' } },
};

/** A key whose OWNER holds `setup.access`, presented beside someone else's session. */
const ADMIN_KEY = 'osk_setup_admin_key_24148';

function grantRows(): Record<string, any[]> {
    return {
        sys_user: Object.keys(SESSIONS).map((id) => ({ id, email: `${id}@example.test` })),
        sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }, { id: ORG, slug: 'org-a' }],
        sys_member: [{ id: 'mem_1', user_id: ORG_ADMIN, organization_id: ORG, role: 'admin' }],
        sys_user_position: [],
        sys_position: [],
        sys_metadata_activation: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [
            { id: 'ups_admin', user_id: ADMIN, permission_set_id: 'ps_full', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
            { id: 'ups_org_admin', user_id: ORG_ADMIN, permission_set_id: 'ps_setup', permission_set: 'setup_admin', organization_id: ORG },
            { id: 'ups_held', user_id: HELD_ADMIN, permission_set_id: 'ps_full', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
            { id: 'ups_member', user_id: MEMBER, permission_set_id: 'ps_member', permission_set: 'member_basic', organization_id: ORG },
        ],
        sys_permission_set: [
            { id: 'ps_full', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access', 'setup.access'] },
            { id: 'ps_setup', name: 'setup_admin', system_permissions: ['setup.access'] },
            { id: 'ps_member', name: 'member_basic', system_permissions: ['export_data'] },
        ],
        sys_api_key: [{ id: 'key_1', key: hashApiKey(ADMIN_KEY), user_id: ADMIN }],
    };
}

/** A better-auth session read keyed by the `x-test-user` header. */
function sessionAuth() {
    return {
        api: {
            getSession: async ({ headers }: { headers: Headers }) => {
                const uid = headers?.get?.('x-test-user');
                if (!uid || !(uid in SESSIONS)) return null;
                const { activeOrganizationId, authGate } = SESSIONS[uid];
                return {
                    user: { id: uid, ...(authGate ? { authGate } : {}) },
                    session: { id: `sess_${uid}`, ...(activeOrganizationId ? { activeOrganizationId } : {}) },
                };
            },
        },
    };
}

/**
 * A `find` over `rows` honouring the equality `where` the resolver reads with
 * (a grant row belongs to the user it names, never to every caller) and the
 * caller's `limit` — by presence, after the filter.
 */
function boundedFind(rows: Record<string, any[]>) {
    return async (object: string, options?: { where?: Record<string, unknown>; limit?: number }) => {
        const matched = (rows[object] ?? []).filter((row) =>
            Object.entries(options?.where ?? {}).every(([k, v]) => (v !== null && typeof v === 'object') || row[k] === v));
        return typeof options?.limit === 'number' ? matched.slice(0, options.limit) : matched;
    };
}

/** Every read fails as an unreachable store's does. */
const unreachableFind = async (): Promise<never> => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
};

/** The data engine the grants are read from. `outage` makes every read fail. */
function grantsEngine(opts: { outage?: boolean } = {}) {
    const rows = grantRows();
    return bindCatalogFromTables({
        find: opts.outage ? unreachableFind : boundedFind(rows),
        update: async () => undefined,
    }, rows);
}

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    };
}

function makeC(path: string, opts: { user?: string; body?: unknown; apiKey?: string } = {}) {
    const url = `${ORIGIN}${path}`;
    const headers = new Headers();
    if (opts.user) headers.set('x-test-user', opts.user);
    if (opts.apiKey) headers.set('x-api-key', opts.apiKey);
    return {
        req: {
            url,
            raw: new Request(url, { headers }),
            header: (n: string) => headers.get(n) ?? undefined,
            json: async () => opts.body ?? {},
            text: async () => JSON.stringify(opts.body ?? {}),
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

/** What the stand-in control plane answers `status` with: a bound connection and its record. */
const CONNECTION = { runtime_id: 'rt_1', organization_id: 'org_cloud_1', account_email: 'approver@example.test', name: 'Acme' };

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-setup-access-'));
    delete process.env.OS_ENVIRONMENT_ID;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/**
 * `serviceKey` is the plugin's `controlPlaneApiKey`. The default, a key, is the
 * cloud-hosted (platform-managed) shape every case here has always run in;
 * `''` (no key, and `OS_CLOUD_API_KEY` not consulted) is the self-hosted shape,
 * whose credential is the stored device token — the one shape in which
 * `unbind` still disconnects (ruling 甲, #25097).
 */
async function mount(mode: 'single' | 'multi', opts: { outage?: boolean; serviceKey?: string } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const auth = sessionAuth();
    const objectql = grantsEngine(opts);
    const credentialPath = join(dir, 'cloud-connection.json');
    new ConnectionCredentialStore(credentialPath).write({ runtimeToken: 'oscc_pin', runtimeId: 'rt_1', environmentId: 'env-1' });
    const envKernelServices: Record<string, unknown> = { auth, objectql };
    const services: Record<string, unknown> = mode === 'single'
        ? { auth, objectql }
        : {
            'env-registry': { resolveByHostname: async () => ({ environmentId: 'env-1' }) },
            'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async (name: string) => envKernelServices[name] }) },
        };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (name in services) return services[name];
            throw new Error(`service ${name} not registered`);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchCalls.push(String(url));
        const path = new URL(String(url)).pathname;
        const body = path.endsWith('/device/code')
            ? { device_code: 'dc_1', user_code: 'ABCD-EFGH', verification_uri: 'http://cloud.test/device', interval: 5, expires_in: 600 }
            : path.endsWith('/device/token')
                ? { access_token: 'at_1' }
                : path.endsWith('/cloud-connection/bind')
                    ? { success: true, data: { runtime_token: 'oscc_new', runtime_id: 'rt_1', connection: CONNECTION } }
                    : path.endsWith('/cloud-connection/status')
                        ? { success: true, data: { bound: true, runtime_id: 'rt_1', connection: CONNECTION } }
                        : { success: true, data: {} };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await new CloudConnectionPlugin({
        controlPlaneUrl: 'http://cloud.test',
        controlPlaneApiKey: 'serviceKey' in opts ? opts.serviceKey : 'svc-key',
        credentialPath,
        ...(mode === 'single' ? { singleEnvironment: true, environmentId: 'env-1' } : {}),
    }).start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const drive = (route: string, path: string, c: Parameters<typeof makeC>[1] = {}) => rawApp.routes.get(route)!(makeC(path, c));
    return { drive, rawApp, fetchCalls, credentialPath };
}

/** The refusal: status and code first (the case's identity), then the declared ADR-0112 envelope. */
function expectSetupAccessRefusal(res: { status: number; payload: any }, label: string) {
    const shown = `${label}: ${JSON.stringify(res.payload)}`;
    expect(res.status, shown).toBe(403);
    expect(res.payload?.error?.code, shown).toBe('PERMISSION_DENIED');
    expect(res.payload?.error?.message, shown).toContain('`setup.access`');
    expect(BaseResponseSchema.safeParse(res.payload).success, shown).toBe(true);
    expect(envelopeViolations(res.payload), shown).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success, shown).toBe(true);
}

const DOORS = {
    bindStart: { route: `POST ${CC}/bind/start`, path: `${CC}/bind/start`, body: {} },
    bindPoll: { route: `POST ${CC}/bind/poll`, path: `${CC}/bind/poll`, body: { device_code: 'dc_1' } },
    unbind: { route: `POST ${CC}/unbind`, path: `${CC}/unbind`, body: {} },
} as const;

const NARROWED_KEYS = ['bound', 'provider', 'runtimeId'];

for (const mode of ['single', 'multi'] as const) {
    describe(`[#24148] the connection-changing doors refuse a caller without setup.access (${mode}-environment)`, () => {
        for (const [name, door] of Object.entries(DOORS)) {
            it(`${door.route} refuses a signed-in caller without setup.access, before any control-plane call`, async () => {
                const { drive, fetchCalls, credentialPath } = await mount(mode);
                expectSetupAccessRefusal(await drive(door.route, door.path, { user: MEMBER, body: door.body }), name);
                expect(fetchCalls, `${name} reached the control plane`).toEqual([]);
                expect(new ConnectionCredentialStore(credentialPath).read()?.runtimeToken, `${name} touched the stored credential`).toBe('oscc_pin');
            });
        }

        for (const shape of ['self-hosted', 'platform-managed'] as const) {
            it(`CONTROL — a caller holding setup.access is served by all three doors as before (${shape})`, async () => {
                // Ruling 甲 (#25097): on a platform-managed runtime (the service
                // key) `unbind` is refused for every caller, so there its control
                // is that refusal — past this file's 403, before any revoke —
                // while the self-hosted shape disconnects exactly as before.
                const { drive, fetchCalls, credentialPath } = await mount(mode, shape === 'self-hosted' ? { serviceKey: '' } : {});
                const start = await drive(DOORS.bindStart.route, DOORS.bindStart.path, { user: ADMIN });
                expect(start.status, JSON.stringify(start.payload)).toBe(200);
                expect(start.payload.data.device_code).toBe('dc_1');

                const poll = await drive(DOORS.bindPoll.route, DOORS.bindPoll.path, { user: ADMIN, body: DOORS.bindPoll.body });
                expect(poll.status, JSON.stringify(poll.payload)).toBe(200);
                expect(poll.payload.success).toBe(true);
                expect(poll.payload.data.runtime_token, 'the runtime bearer reached the browser').toBeUndefined();
                expect(new ConnectionCredentialStore(credentialPath).read()?.runtimeToken).toBe('oscc_new');

                const beforeUnbind = fetchCalls.length;
                const unbind = await drive(DOORS.unbind.route, DOORS.unbind.path, { user: ADMIN });
                if (shape === 'self-hosted') {
                    expect(unbind.status, JSON.stringify(unbind.payload)).toBe(200);
                    expect(unbind.payload.data).toMatchObject({ revoked: true, cleared: true });
                    expect(new ConnectionCredentialStore(credentialPath).read()?.runtimeToken).toBe('');
                    expect(fetchCalls.length, 'unbind did not reach the control plane').toBeGreaterThan(beforeUnbind);
                } else {
                    expect(unbind.status, JSON.stringify(unbind.payload)).toBe(409);
                    expect(unbind.payload?.error?.code).toBe('RESOURCE_CONFLICT');
                    expect(new ConnectionCredentialStore(credentialPath).read()?.runtimeToken).toBe('oscc_new');
                    expect(fetchCalls.length, 'a refused unbind reached the control plane').toBe(beforeUnbind);
                }
                expect(fetchCalls.length).toBeGreaterThan(0);
            });
        }

        it('CONTROL — a grant scoped to the organization the session is active in counts', async () => {
            const { drive } = await mount(mode);
            const res = await drive(DOORS.bindStart.route, DOORS.bindStart.path, { user: ORG_ADMIN });
            expect(res.status, JSON.stringify(res.payload)).toBe(200);
        });

        it('refuses a session without setup.access even when the request also carries a key whose owner holds it', async () => {
            const { drive, fetchCalls } = await mount(mode);
            expectSetupAccessRefusal(
                await drive(DOORS.bindStart.route, DOORS.bindStart.path, { user: MEMBER, apiKey: ADMIN_KEY }),
                'bind/start with a key beside the session',
            );
            expect(fetchCalls).toEqual([]);
        });

        it('a permission store that cannot be read is an outage, not a 403', async () => {
            const { rawApp, fetchCalls } = await mount(mode, { outage: true });
            const handler = rawApp.routes.get(DOORS.bindStart.route)!;
            const outcome = await handler(makeC(DOORS.bindStart.path, { user: ADMIN })).then(
                (res: any) => ({ answered: res }),
                (err: unknown) => ({ thrown: err }),
            );
            expect('thrown' in outcome && isAuthzStoreUnavailableError(outcome.thrown), JSON.stringify(outcome)).toBe(true);
            expect(fetchCalls).toEqual([]);
        });
    });

    describe(`[#24148] GET /status narrows what it serves to a caller without setup.access (${mode}-environment)`, () => {
        it('anonymous: answers 200 with exactly bound, runtimeId and provider — no connection', async () => {
            const { drive } = await mount(mode);
            const res = await drive(`GET ${CC}/status`, `${CC}/status`);
            expect(res.status).toBe(200);
            expect(res.payload.success).toBe(true);
            expect(Object.keys(res.payload.data).sort()).toEqual(NARROWED_KEYS);
            expect(res.payload.data).toEqual({ bound: true, runtimeId: 'rt_1', provider: 'objectstack-cloud' });
        });

        it('signed in without setup.access: the same narrowed answer', async () => {
            const { drive } = await mount(mode);
            const res = await drive(`GET ${CC}/status`, `${CC}/status`, { user: MEMBER });
            expect(res.status).toBe(200);
            expect(Object.keys(res.payload.data).sort()).toEqual(NARROWED_KEYS);
        });

        it('a session the ADR-0069 policy holds is answered, narrowed, never refused', async () => {
            const { drive } = await mount(mode);
            const res = await drive(`GET ${CC}/status`, `${CC}/status`, { user: HELD_ADMIN });
            expect(res.status).toBe(200);
            expect(Object.keys(res.payload.data).sort()).toEqual(NARROWED_KEYS);
        });

        it('a key whose owner holds setup.access lends nothing to a session without it', async () => {
            const { drive } = await mount(mode);
            const res = await drive(`GET ${CC}/status`, `${CC}/status`, { user: MEMBER, apiKey: ADMIN_KEY });
            expect(Object.keys(res.payload.data).sort()).toEqual(NARROWED_KEYS);
        });

        it('a permission store that cannot be read withholds the details and still answers 200', async () => {
            const { drive } = await mount(mode, { outage: true });
            const res = await drive(`GET ${CC}/status`, `${CC}/status`, { user: ADMIN });
            expect(res.status).toBe(200);
            expect(Object.keys(res.payload.data).sort()).toEqual(NARROWED_KEYS);
        });

        it('CONTROL — a caller holding setup.access is served the connection record and the environment', async () => {
            const { drive } = await mount(mode);
            const res = await drive(`GET ${CC}/status`, `${CC}/status`, { user: ADMIN });
            expect(res.status).toBe(200);
            expect(res.payload.data).toEqual({
                environmentId: 'env-1',
                runtimeId: 'rt_1',
                bound: true,
                provider: 'objectstack-cloud',
                connection: CONNECTION,
            });
        });
    });
}
