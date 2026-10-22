// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A runtime whose control-plane credential is the environment service key is
 * PLATFORM-MANAGED: its cloud connection belongs to the platform, so this
 * runtime registers no Cloud Connection Setup page and refuses to connect or
 * disconnect. Everywhere else the page registers, under Setup → Integrations.
 * (Ruling 甲 on #25097; the bind doors, #25113.)
 *
 * ## What this file pins
 *
 * The one predicate (`CloudConnectionPlugin`: the effective credential is the
 * service key, `controlPlaneApiKey` or `OS_CLOUD_API_KEY`) read at both of its
 * uses, each against a runtime that does not hold the key as the control:
 *
 *   - Registration, read back from a REAL kernel's `manifest` service and
 *     metadata protocol (an `ObjectKernel` with `ObjectQLPlugin`), after the
 *     plugin's own `kernel:ready`, through the merge `GET /api/v1/meta/app/setup`
 *     serves:
 *       - managed: no `cloud_connection_settings` page and no
 *         `nav_cloud_connection` entry anywhere in Setup's tree;
 *       - not managed: the page is served and the entry sits in
 *         `group_integrations`, not `group_apps`, declaring
 *         `manage_platform_settings` on itself (ruling 乙, #25119).
 *     Both readings carry a lit control in the same composition: a page and a
 *     contributed `group_apps` entry that ARE served, so "absent" is read off a
 *     listing that carries plugin metadata, not off an empty one.
 *   - The three connection-changing doors — `POST /bind/start`,
 *     `POST /bind/poll` and `POST /unbind` — driven through the routes the
 *     plugin mounts, under both resolution modes, by a caller who holds
 *     `manage_platform_settings` (so each refusal below comes after the
 *     identity and capability checks, never instead of them):
 *       - managed: `409 RESOURCE_CONFLICT` in the declared envelope at each
 *         door, its message naming the platform as the connection's manager,
 *         with no control-plane call (no device code, no token poll, no
 *         `/bind`, no revoke) and the stored credential neither replaced nor
 *         cleared (#25113: a completed bind persisted a device credential the
 *         service key shadows);
 *       - not managed: the device code is requested, the bind completes and
 *         persists its credential, and the revoke is called and the stored
 *         credential cleared, as before.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { CloudConnectionSettingsPage } from './cloud-connection-ui.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { MARKETPLACE_BROWSE_UI_BUNDLE } from './marketplace-ui.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const CC = '/api/v1/cloud-connection';
const SERVICE_KEY = 'svc-key-platform';

/** The organization the session acts in, and the one the grant below is owned by. */
const ORG = 'o1';
/** Signed in, holding `manage_platform_settings`: the caller the Setup page is for (ruling 乙, #25119). */
const ADMIN = 'u_platform_admin';
const GRANTS: Record<string, any[]> = {
    sys_user_permission_set: [{ id: 'ups_1', user_id: ADMIN, permission_set_id: 'ps_1', permission_set: 'platform_admin', organization_id: ORG }],
    sys_permission_set: [{ id: 'ps_1', name: 'platform_admin', system_permissions: ['setup.access', 'manage_platform_settings'] }],
};

/** The control page: the plugin's own page under another name, so its shape is one the registry admits. */
const CONTROL_PAGE = { ...structuredClone(CloudConnectionSettingsPage), name: 'control_settings', label: 'Control' };

/**
 * A Setup shell carrying the two group anchors this file reads, and the control
 * page. The real shell (`SETUP_APP` in `@objectstack/platform-objects`) is not a
 * dependency of this package; the merge under test is the engine's, which
 * reads an anchor by id.
 */
const SETUP_SHELL = {
    id: 'test.setup-shell',
    namespace: 'sys',
    version: '0.0.0',
    type: 'plugin',
    scope: 'system',
    name: 'Setup shell (test)',
    apps: [{
        name: 'setup',
        label: 'Setup',
        navigation: [
            { id: 'group_apps', type: 'group', label: 'Apps', children: [] },
            { id: 'group_integrations', type: 'group', label: 'Integrations', children: [] },
        ],
    }],
    pages: [CONTROL_PAGE],
};

/** A driver holding no row of anything: every answer below comes from the registry. */
const EMPTY_STORE = {
    name: 'empty-store',
    version: '0.0.0',
    supports: {},
    connect: async () => undefined,
    disconnect: async () => undefined,
    find: async () => [],
    findOne: async () => null,
    count: async () => 0,
};

let dir: string;
let savedEnvKey: string | undefined;
const kernels: ObjectKernel[] = [];
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-platform-managed-'));
    savedEnvKey = process.env.OS_CLOUD_API_KEY;
    delete process.env.OS_CLOUD_API_KEY;
    delete process.env.OS_ENVIRONMENT_ID;
});
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    if (savedEnvKey === undefined) delete process.env.OS_CLOUD_API_KEY;
    else process.env.OS_CLOUD_API_KEY = savedEnvKey;
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    };
}

// ── Registration ────────────────────────────────────────────────────────────

/**
 * A real kernel carrying the Setup shell and the marketplace browse bundle (the
 * contributed `group_apps` control), with the plugin booted to `kernel:ready`
 * against that kernel's own `manifest` service. `serviceKey` is the plugin's
 * `controlPlaneApiKey`; left `undefined`, the plugin reads `OS_CLOUD_API_KEY`.
 */
async function composeRegistration(serviceKey: string | undefined) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    ql.registerDriver(EMPTY_STORE as never, true);
    const manifest = kernel.getService<{ register(m: unknown): void }>('manifest');
    manifest.register(structuredClone(SETUP_SHELL));
    manifest.register(structuredClone(MARKETPLACE_BROWSE_UI_BUNDLE));

    const rawApp = makeRawApp();
    const hooks = new Map<string, () => Promise<void>>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (name === 'manifest') return manifest;
            throw new Error(`no ${name}`);
        },
        logger,
    };
    await new CloudConnectionPlugin({
        singleEnvironment: true,
        controlPlaneUrl: 'http://cloud.test',
        controlPlaneApiKey: serviceKey,
        credentialPath: join(dir, 'cloud-connection.json'),
    }).start(ctx as never);
    await hooks.get('kernel:ready')?.();
    return { protocol: kernel.getService<any>('protocol'), logger, routes: rawApp.routes };
}

/** The page names `GET /api/v1/meta/page` serves. */
async function servedPageNames(protocol: any): Promise<string[]> {
    const res = await protocol.getMetaItems({ type: 'page' });
    const items: Bag[] = Array.isArray(res) ? res : res?.items ?? [];
    return items.map((it) => it?.name).filter((n): n is string => typeof n === 'string');
}

/** Setup's merged navigation, as the metadata protocol serves the app. */
async function setupNavigation(protocol: any): Promise<Bag[]> {
    const res = await protocol.getMetaItem({ type: 'app', name: 'setup' });
    return (res?.item?.navigation ?? []) as Bag[];
}

const groupIds = (navigation: Bag[], groupId: string): string[] => {
    const group = navigation.find((g) => g?.id === groupId);
    expect(group, `the Setup shell's ${groupId} anchor is served`).toBeDefined();
    return ((group?.children ?? []) as Bag[]).map((i) => i?.id);
};

/** Every nav id in the tree, depth-first, groups and top-level entries included. */
const allNavIds = (items: Bag[]): string[] =>
    items.flatMap((i) => [i?.id, ...allNavIds(Array.isArray(i?.children) ? i.children : [])]);

describe('platform-managed runtime — no Setup page, no nav entry (ruling 甲)', () => {
    it('managed (controlPlaneApiKey): no cloud_connection_settings page and no nav_cloud_connection entry are served', async () => {
        const { protocol } = await composeRegistration(SERVICE_KEY);
        const pages = await servedPageNames(protocol);
        // Control: the listing carries plugin-registered pages.
        expect(pages).toContain('control_settings');
        expect(pages).not.toContain('cloud_connection_settings');

        const navigation = await setupNavigation(protocol);
        // Control: the read reaches contributed entries.
        expect(groupIds(navigation, 'group_apps')).toContain('nav_marketplace_browse');
        expect(allNavIds(navigation)).not.toContain('nav_cloud_connection');
    });

    it('managed (OS_CLOUD_API_KEY): the env spelling of the key is the same predicate', async () => {
        process.env.OS_CLOUD_API_KEY = SERVICE_KEY;
        const { protocol } = await composeRegistration(undefined);
        const pages = await servedPageNames(protocol);
        expect(pages).toContain('control_settings');
        expect(pages).not.toContain('cloud_connection_settings');
        const navigation = await setupNavigation(protocol);
        expect(groupIds(navigation, 'group_apps')).toContain('nav_marketplace_browse');
        expect(allNavIds(navigation)).not.toContain('nav_cloud_connection');
    });

    it('managed: says so once at boot, naming what it did not register', async () => {
        const { logger } = await composeRegistration(SERVICE_KEY);
        const lines = logger.info.mock.calls.map((call) => String(call[0]));
        expect(lines.filter((l) => l.includes('platform-managed'))).toHaveLength(1);
    });

    it('not managed: the page is served and the entry sits in group_integrations, not group_apps', async () => {
        const { protocol } = await composeRegistration(undefined);
        const pages = await servedPageNames(protocol);
        expect(pages).toContain('cloud_connection_settings');

        const navigation = await setupNavigation(protocol);
        expect(groupIds(navigation, 'group_integrations')).toEqual(['nav_cloud_connection']);
        // Ruling 乙 (#25119): the entry carries the doors' rule on itself, as served.
        const entry = (navigation.find((g) => g?.id === 'group_integrations')?.children as Bag[])
            .find((i) => i?.id === 'nav_cloud_connection');
        expect(entry?.requiredPermissions).toEqual(['manage_platform_settings']);
        const apps = groupIds(navigation, 'group_apps');
        expect(apps).toContain('nav_marketplace_browse');
        expect(apps).not.toContain('nav_cloud_connection');
        // Exactly one entry by that id in the whole tree: moved, not copied.
        expect(allNavIds(navigation).filter((id) => id === 'nav_cloud_connection')).toHaveLength(1);
    });
});

// ── The three connection-changing doors ─────────────────────────────────────

function makeC(path: string, user?: string, body: unknown = {}) {
    const url = `https://env.example.test${path}`;
    const headers = new Headers();
    if (user) headers.set('x-test-user', user);
    return {
        req: {
            url,
            raw: new Request(url, { headers }),
            header: (n: string) => headers.get(n) ?? undefined,
            json: async () => body,
            text: async () => JSON.stringify(body),
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

/** The doors, each with the body it needs to reach the control plane. */
const DOORS = {
    'bind/start': {},
    'bind/poll': { device_code: 'dc_1' },
    unbind: {},
} as const;
type Door = keyof typeof DOORS;

/**
 * The plugin mounted in either resolution mode, holding a stored device
 * credential, with every control-plane call recorded and answered as a real
 * control plane would (a device code, a granted token, a completed `/bind`
 * carrying a NEW runtime bearer, a revoke). `serviceKey` decides whether the
 * runtime is platform-managed.
 */
async function mountDoors(mode: 'single' | 'multi', serviceKey: string | undefined) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, () => Promise<void>>();
    const auth = {
        api: {
            getSession: async ({ headers }: { headers: Headers }) => {
                const uid = headers?.get?.('x-test-user');
                return uid ? { user: { id: uid }, session: { id: `sess_${uid}`, activeOrganizationId: ORG } } : null;
            },
        },
    };
    const objectql = bindCatalogFromTables({ find: async (object: string) => GRANTS[object] ?? [] }, GRANTS);
    const envKernelServices: Record<string, unknown> = { auth, objectql };
    const services: Record<string, unknown> = mode === 'single'
        ? { auth, objectql, manifest: { register: vi.fn() } }
        : {
            'env-registry': { resolveByHostname: async () => ({ environmentId: 'env-1' }) },
            'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async (name: string) => envKernelServices[name] }) },
            manifest: { register: vi.fn() },
        };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (name in services) return services[name];
            throw new Error(`service ${name} not registered`);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const credentialPath = join(dir, 'cloud-connection.json');
    new ConnectionCredentialStore(credentialPath).write({ runtimeToken: 'oscc_pin', runtimeId: 'rt_1', environmentId: 'env-1' });
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchCalls.push(String(url));
        const path = new URL(String(url)).pathname;
        const body = path.endsWith('/device/code')
            ? { device_code: 'dc_1', user_code: 'ABCD-EFGH', verification_uri: 'http://cloud.test/device', interval: 5, expires_in: 600 }
            : path.endsWith('/device/token')
                ? { access_token: 'at_1' }
                : path.endsWith('/cloud-connection/bind')
                    ? { success: true, data: { runtime_token: 'oscc_new', runtime_id: 'rt_1', connection: { runtime_id: 'rt_1' } } }
                    : { success: true, data: {} };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await new CloudConnectionPlugin({
        controlPlaneUrl: 'http://cloud.test',
        controlPlaneApiKey: serviceKey,
        credentialPath,
        ...(mode === 'single' ? { singleEnvironment: true, environmentId: 'env-1' } : {}),
    }).start(ctx as never);
    await hooks.get('kernel:ready')?.();
    const drive = (door: Door) => rawApp.routes.get(`POST ${CC}/${door}`)!(makeC(`${CC}/${door}`, ADMIN, DOORS[door]));
    return { drive, fetchCalls, store: new ConnectionCredentialStore(credentialPath) };
}

for (const mode of ['single', 'multi'] as const) {
    describe(`platform-managed runtime — the three connection-changing doors are refused (${mode}-environment)`, () => {
        for (const door of Object.keys(DOORS) as Door[]) {
            it(`managed: POST /${door} answers 409 RESOURCE_CONFLICT naming the platform, before any control-plane call and any store write`, async () => {
                const { drive, fetchCalls, store } = await mountDoors(mode, SERVICE_KEY);
                const res = await drive(door);
                const shown = JSON.stringify(res.payload);
                // The exit's identity.
                expect(res.status, shown).toBe(409);
                expect(res.payload?.error?.code, shown).toBe('RESOURCE_CONFLICT');
                // The declared ADR-0112 envelope, code vocabulary included.
                expect(BaseResponseSchema.safeParse(res.payload).success, shown).toBe(true);
                expect(envelopeViolations(res.payload), shown).toEqual([]);
                expect(ApiErrorSchema.safeParse(res.payload.error).success, shown).toBe(true);
                expect(res.payload.error.message, shown).toMatch(/^This runtime's cloud connection is managed by the platform/);
                // Nothing happened: no control-plane call (no device code, no
                // token poll, no `/bind`, no revoke), and the stored credential
                // neither replaced by a bind nor cleared by an unbind.
                expect(fetchCalls, `a refused ${door} reached the control plane`).toEqual([]);
                expect(store.read(), `a refused ${door} touched the stored credential`)
                    .toMatchObject({ runtimeToken: 'oscc_pin', runtimeId: 'rt_1', environmentId: 'env-1' });
            });
        }

        it('CONTROL — not managed: bind/start asks for a device code, bind/poll completes and persists the bind, unbind revokes and clears', async () => {
            const { drive, fetchCalls, store } = await mountDoors(mode, undefined);
            const start = await drive('bind/start');
            expect(start.status, JSON.stringify(start.payload)).toBe(200);
            expect(start.payload.data.device_code).toBe('dc_1');
            expect(fetchCalls).toEqual(['http://cloud.test/api/v1/auth/device/code']);

            const poll = await drive('bind/poll');
            expect(poll.status, JSON.stringify(poll.payload)).toBe(200);
            expect(fetchCalls.slice(1)).toEqual([
                'http://cloud.test/api/v1/auth/device/token',
                'http://cloud.test/api/v1/cloud-connection/bind',
            ]);
            expect(store.read()?.runtimeToken).toBe('oscc_new');

            const unbind = await drive('unbind');
            expect(unbind.status, JSON.stringify(unbind.payload)).toBe(200);
            expect(unbind.payload.data).toMatchObject({ revoked: true, cleared: true });
            expect(fetchCalls.slice(3)).toEqual(['http://cloud.test/api/v1/cloud-connection/revoke']);
            expect(store.read()?.runtimeToken).toBe('');
        });
    });
}
