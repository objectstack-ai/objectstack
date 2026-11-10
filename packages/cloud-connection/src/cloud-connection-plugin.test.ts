// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudConnectionPlugin — route mounting + mode behavior (cloud ADR-0008 Phase 1).
 *
 * Exercises the consolidated /api/v1/cloud-connection/* surface in both
 * resolution modes:
 *   - multi-tenant: env-registry hostname lookup + per-env kernel session
 *   - single-environment: fixed env id + host-kernel auth session
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CLOUD_BINDING_SERVICE, type ICloudBindingService } from '@objectstack/spec/contracts';
import { CloudConnectionPlugin, createCloudConnectionPlugin } from './cloud-connection-plugin.js';
import { TARGET_NAMESPACE_ON_MANAGED_INSTALL_MESSAGE } from './install-local-door-service.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

type Handler = (c: any) => Promise<Response | any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (path: string, h: Handler) => routes.set(`GET ${path}`, h),
        post: (path: string, h: Handler) => routes.set(`POST ${path}`, h),
    };
}

function makeCtx(opts: {
    rawApp: ReturnType<typeof makeRawApp>;
    services?: Record<string, any>;
}) {
    const hooks = new Map<string, (...args: any[]) => any>();
    return {
        ctx: {
            hook: (event: string, handler: (...args: any[]) => any) => hooks.set(event, handler),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => opts.rawApp };
                const svc = opts.services?.[name];
                if (svc === undefined) throw new Error(`service ${name} not registered`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        fireKernelReady: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(url: string, body?: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url,
            raw: new Request(url),
            json: async () => body ?? {},
        },
        json,
    };
}

/** The organization the sessions act in, and the one {@link platformSettingsEngine}'s grant is owned by. */
const ORG = 'o1';

const sessionAuth = (userId?: string) => ({
    api: { getSession: async () => (userId ? { user: { id: userId }, session: { activeOrganizationId: ORG } } : null) },
});

/**
 * [#24148, #25119] A data engine under which `userId` holds
 * `manage_platform_settings` — what `/status` serves its full answer behind.
 * Real permission-set rows, read by the shared resolver through `find`. The
 * grant is owned by {@link ORG}, the organization the session acts in: a grant
 * applies only in its own organization.
 */
const platformSettingsEngine = (userId: string) => {
    const rows: Record<string, any[]> = {
        sys_user: [{ id: userId, email: `${userId}@example.test` }],
        sys_user_permission_set: [{ id: 'ups_1', user_id: userId, permission_set_id: 'ps_1', permission_set: 'platform_admin', organization_id: ORG }],
        sys_permission_set: [{ id: 'ps_1', name: 'platform_admin', system_permissions: ['setup.access', 'manage_platform_settings'] }],
    };
    return bindCatalogFromTables({ find: async (object: string) => rows[object] ?? [] }, rows);
};

/** [#24148, #25119] What `/status` serves a caller without `manage_platform_settings`. */
const narrowed = (data: { bound: boolean; runtimeId: string | null }) => ({ ...data, provider: 'objectstack-cloud' });

beforeEach(() => {
    delete process.env.OS_ENVIRONMENT_ID;
});
afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OS_ENVIRONMENT_ID;
});

describe('CloudConnectionPlugin — mounting', () => {
    it('mounts all 8 routes on kernel:ready', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp });
        const plugin = new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test' });
        await plugin.start(ctx as any);
        await fireKernelReady();
        const keys = [...rawApp.routes.keys()];
        expect(keys).toEqual(expect.arrayContaining([
            'GET /api/v1/cloud-connection/status',
            'POST /api/v1/cloud-connection/bind/start',
            'POST /api/v1/cloud-connection/bind/poll',
            'POST /api/v1/cloud-connection/unbind',
            'POST /api/v1/cloud-connection/install',
            'GET /api/v1/cloud-connection/installation',
            'GET /api/v1/cloud-connection/installed',
            'GET /api/v1/cloud-connection/org-packages',
        ]));
        expect(keys).toHaveLength(8);
    });

    it('warns and mounts nothing without an http-server', async () => {
        const hooks = new Map<string, any>();
        const warn = vi.fn();
        const ctx = {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: () => { throw new Error('nope'); },
            logger: { warn },
        };
        await createCloudConnectionPlugin().start(ctx as any);
        await hooks.get('kernel:ready')?.();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('http-server unavailable'));
    });
});

describe('multi-tenant mode (env-registry + per-env kernel auth)', () => {
    const ENV = 'env-123';
    function mtServices(userId?: string) {
        return {
            'env-registry': { resolveByHostname: async () => ({ environmentId: ENV }) },
            'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async () => sessionAuth(userId) }) },
        };
    }

    it('status falls back to implicit binding from the service key when the control plane is down', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices() });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('https://t1.example.com/api/v1/cloud-connection/status'));
        expect(res.payload).toEqual({ success: true, data: narrowed({ runtimeId: null, bound: true }) });
    });

    it('status 404s for an unknown hostname', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({
            rawApp,
            services: { 'env-registry': { resolveByHostname: async () => null } },
        });
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('https://nope.example.com/x'));
        expect(res.status).toBe(404);
        expect(res.payload.error.code).toBe('ENVIRONMENT_NOT_FOUND');
    });

    it('install rejects unauthenticated callers with 401 (no control-plane call)', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices(undefined) });
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/install')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/install', { package_id: 'pkg_1' }),
        );
        expect(res.status).toBe(401);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('install forwards to the control plane install action for an authenticated session', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices('user-1') });
        const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { installed: true } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/install')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/install', { package_id: 'pkg_1', seed_sample_data: true }),
        );
        expect(res.payload.success).toBe(true);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://cloud.test/api/v1/actions/sys_package/install_package');
        // [#30964] No mode asked: no `install_mode` sent (the control plane's absent value is `managed`); the installer always is.
        expect(JSON.parse((init as any).body)).toEqual({
            recordId: 'pkg_1', params: { environment_id: ENV, seed_sample_data: true, installer_user_id: 'user-1' },
        });
        expect((init as any).headers.Authorization).toBe('Bearer svc-key');
    });

    // ── [#30964, cloud#3624 ruling A] the install mode and the installing user, forwarded ──

    async function installWith(body: Record<string, unknown>, userId = 'user-1') {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices(userId) });
        const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { installed: true } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/install')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/install', body),
        );
        const sent = fetchSpy.mock.calls[0] ? JSON.parse((fetchSpy.mock.calls[0][1] as any).body) : undefined;
        return { res, fetchSpy, sent };
    }

    it('install forwards `install_mode` as the control plane spells it, from either spelling of the body', async () => {
        for (const body of [{ package_id: 'pkg_1', install_mode: 'unmanaged' }, { package_id: 'pkg_1', installMode: 'unmanaged' }]) {
            // What is SENT is pinned here; what the answer does with an unmanaged grant is pinned below.
            const { sent } = await installWith(body);
            expect(sent).toEqual({
                recordId: 'pkg_1',
                params: { environment_id: ENV, seed_sample_data: false, install_mode: 'unmanaged', installer_user_id: 'user-1' },
            });
        }
        const managed = await installWith({ package_id: 'pkg_1', install_mode: 'managed' });
        expect(managed.sent.params).toMatchObject({ install_mode: 'managed', installer_user_id: 'user-1' });
    });

    it('install forwards the admitted session\'s user as `installer_user_id`, never one the body names', async () => {
        const { sent } = await installWith({ package_id: 'pkg_1', installer_user_id: 'usr_someone_else', installerUserId: 'usr_other' }, 'user-7');
        expect(sent.params.installer_user_id).toBe('user-7');
        expect(Object.keys(sent.params).sort()).toEqual(['environment_id', 'installer_user_id', 'seed_sample_data']);
    });

    it('install refuses an install mode the manifest enum does not hold, or two spellings that disagree: 400, no control-plane call', async () => {
        for (const body of [
            { package_id: 'pkg_1', install_mode: 'copy' },
            { package_id: 'pkg_1', installMode: true },
            { package_id: 'pkg_1', install_mode: 'managed', installMode: 'unmanaged' },
        ]) {
            const { res, fetchSpy } = await installWith(body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain('install_mode');
            expect(fetchSpy).not.toHaveBeenCalled();
        }
    });

    // ── [#31799] a named package version, forwarded; omitted means the latest ──

    it('install forwards a named `version` to the control plane, as named', async () => {
        for (const version of ['1.2.3', '2.0.0-beta.1', '1.0.0+20260101']) {
            const { res, sent } = await installWith({ package_id: 'pkg_1', version });
            expect(res.payload.success, version).toBe(true);
            expect(sent, version).toEqual({
                recordId: 'pkg_1',
                params: { environment_id: ENV, seed_sample_data: false, version, installer_user_id: 'user-1' },
            });
        }
        // Surrounding blanks are not part of the version.
        const padded = await installWith({ package_id: 'pkg_1', version: ' 1.2.3 ' });
        expect(padded.sent.params.version).toBe('1.2.3');
        // Beside an install mode, both travel.
        const unmanaged = await installWith({ package_id: 'pkg_1', version: '1.2.3', install_mode: 'managed' });
        expect(unmanaged.sent.params).toMatchObject({ version: '1.2.3', install_mode: 'managed' });
    });

    it('install refuses a malformed `version`: 400 INVALID_REQUEST naming the key, no control-plane call', async () => {
        for (const version of ['latest', '1.2', 'v1.2.3', '01.2.3', '', '   ', '1.2.3 || 2.0.0', '^1.2.3', 123, true, { major: 1 }, ['1.2.3']]) {
            const { res, fetchSpy } = await installWith({ package_id: 'pkg_1', version });
            expect(res.status, JSON.stringify(version)).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain('`version`');
            expect(res.payload.error.message).toContain('Nothing was installed');
            expect(fetchSpy, JSON.stringify(version)).not.toHaveBeenCalled();
        }
    });

    it('CONTROL — install with no `version` (absent or null) sends the body it always sent: no `version` key', async () => {
        for (const body of [{ package_id: 'pkg_1' }, { package_id: 'pkg_1', version: null }]) {
            const { res, sent } = await installWith(body);
            expect(res.payload.success).toBe(true);
            expect((res as any).status ?? 200).toBe(200);
            expect(JSON.stringify(sent), JSON.stringify(body)).toBe(JSON.stringify({
                recordId: 'pkg_1',
                params: { environment_id: ENV, seed_sample_data: false, installer_user_id: 'user-1' },
            }));
        }
    });

    // ── [#31482, cloud#3648] the namespace an unmanaged copy takes, forwarded ──

    it('[#31482] install forwards `target_namespace` beside an unmanaged install, as the control plane spells it', async () => {
        const { res, sent } = await installWith({ package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: 'acme' });
        expect(res.payload.success).toBe(true);
        expect(sent).toEqual({
            recordId: 'pkg_1',
            params: { environment_id: ENV, seed_sample_data: false, install_mode: 'unmanaged', target_namespace: 'acme', installer_user_id: 'user-1' },
        });
    });

    it('[#31482] CONTROL — install with no `target_namespace` (absent or null) sends no `target_namespace` key', async () => {
        for (const body of [{ package_id: 'pkg_1', install_mode: 'unmanaged' }, { package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: null }]) {
            const { res, sent } = await installWith(body);
            expect(res.payload.success, JSON.stringify(body)).toBe(true);
            expect(sent.params, JSON.stringify(body)).not.toHaveProperty('target_namespace');
        }
    });

    it('[#31482] install refuses `target_namespace` beside a managed install or no mode: 400, the install-local door\'s own sentence, no control-plane call', async () => {
        for (const body of [
            { package_id: 'pkg_1', target_namespace: 'acme' },
            { package_id: 'pkg_1', install_mode: 'managed', target_namespace: 'acme' },
            // The value is not judged first: beside a managed install any value is refused the same way.
            { package_id: 'pkg_1', installMode: 'managed', target_namespace: 'Not A Namespace' },
        ]) {
            const { res, fetchSpy } = await installWith(body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.payload.error).toEqual({ code: 'INVALID_REQUEST', message: TARGET_NAMESPACE_ON_MANAGED_INSTALL_MESSAGE });
            expect(fetchSpy, JSON.stringify(body)).not.toHaveBeenCalled();
        }
    });

    it('[#31482] install refuses a `target_namespace` the manifest namespace declaration refuses: 400 INVALID_REQUEST, `details.targetNamespace`, no control-plane call', async () => {
        for (const value of ['Acme', 'acme-corp', '1acme', '', 42, true, { ns: 'acme' }, ['acme']]) {
            const { res, fetchSpy } = await installWith({ package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: value });
            expect(res.status, JSON.stringify(value)).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain('`target_namespace`');
            expect(res.payload.error.message).toContain('Nothing was installed');
            expect(res.payload.error.details).toEqual({ targetNamespace: value });
            expect(fetchSpy, JSON.stringify(value)).not.toHaveBeenCalled();
        }
    });

    it('installed degrades to an empty disconnected list without cloud credentials', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices('user-1') });
        await new CloudConnectionPlugin({ controlPlaneUrl: '', controlPlaneApiKey: '' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/installed')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/installed'),
        );
        expect(res.payload).toEqual({ success: true, data: { packages: [], total: 0, connected: false } });
    });

    it('org-packages forwards environment_id and unwraps items', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: mtServices('user-1') });
        const items = [{ id: 'pkg_a', manifest_id: 'com.acme.crm' }];
        const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { items } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/org-packages')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/org-packages'),
        );
        expect(String(fetchSpy.mock.calls[0]![0])).toBe(`http://cloud.test/api/v1/cloud/org-packages?environment_id=${ENV}`);
        expect(res.payload.data).toEqual({ items, total: 1, connected: true });
    });
});

describe('single-environment mode (host auth, fixed env id)', () => {
    it('status reports bound:false (200, not 404) before the runtime is bound', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp });
        await new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('http://localhost:3000/x'));
        expect(res.status).toBe(200);
        expect(res.payload.data).toEqual(narrowed({ runtimeId: null, bound: false }));
    });

    it('uses the configured environment id + the host kernel auth session', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: { auth: sessionAuth('admin-1') } });
        const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { packages: [{ id: 'p1' }] } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            singleEnvironment: true,
            environmentId: 'env-ee-1',
            controlPlaneUrl: 'http://cloud.test',
            controlPlaneApiKey: 'svc-key',
        }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/installed')!(makeC('http://localhost:3000/api/v1/cloud-connection/installed'));
        expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/cloud/environments/env-ee-1/packages');
        expect(res.payload.data.total).toBe(1);
    });

    it("ignores the CLI's local sentinel env ids (env_local / proj_local)", async () => {
        process.env.OS_ENVIRONMENT_ID = 'env_local';
        const rawApp = makeRawApp();
        // A caller holding `manage_platform_settings`, who is served the environment id.
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: { auth: sessionAuth('admin-1'), objectql: platformSettingsEngine('admin-1') } });
        await new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('http://localhost:3000/x'));
        expect(res.status).toBe(200);
        // Treated as "no cloud environment", not presented to the control plane.
        expect(res.payload.data.environmentId).toBeNull();
        expect(res.payload.data.bound).toBe(false);
    });

    it('falls back to OS_ENVIRONMENT_ID when no config id is given', async () => {
        process.env.OS_ENVIRONMENT_ID = 'env-from-env-var';
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: { auth: sessionAuth('admin-1'), objectql: platformSettingsEngine('admin-1') } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
        await new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'k' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('http://localhost:3000/x'));
        expect(res.payload.data.environmentId).toBe('env-from-env-var');
    });
});

/**
 * [#30762] One reading of the control-plane URL. The routes read it through
 * the `cloud-binding` service the plugin registers, the same answer the push
 * relay sender reads, so the two cannot disagree on an option. An explicit
 * empty option is "cloud not configured" for both, and does not fall through
 * to `OS_CLOUD_URL` or the default.
 */
describe('CloudConnectionPlugin — the routes and the binding read the control-plane URL once', () => {
    const ENV = 'env-123';
    const services = {
        'env-registry': { resolveByHostname: async () => ({ environmentId: ENV }) },
        'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async () => sessionAuth('user-1') }) },
    };

    afterEach(() => { vi.unstubAllEnvs(); });

    /** Boot the plugin, drive `GET /installed` once, and answer where it went and what the binding says. */
    async function readBoth(controlPlaneUrl: string | undefined) {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services });
        const registered = new Map<string, unknown>();
        const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ success: true, data: { packages: [], total: 0 } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        const plugin = new CloudConnectionPlugin({ controlPlaneApiKey: 'svc-key', ...(controlPlaneUrl === undefined ? {} : { controlPlaneUrl }) });
        await plugin.init({ ...ctx, registerService: (name: string, svc: unknown) => registered.set(name, svc) } as any);
        await plugin.start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/installed')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/installed'),
        );
        const binding = registered.get(CLOUD_BINDING_SERVICE) as ICloudBindingService;
        const called = fetchSpy.mock.calls.map(([url]) => String(url));
        return { res, binding: binding.controlPlaneUrl(), called };
    }

    it.each(['', '   '])('an explicit empty option %j is "cloud not configured" for both, over OS_CLOUD_URL', async (option) => {
        vi.stubEnv('OS_CLOUD_URL', 'https://env.example.com');
        const { res, binding, called } = await readBoth(option);
        expect(binding).toBe('');
        expect(called).toEqual([]);
        expect(res.payload).toEqual({ success: true, data: { packages: [], total: 0, connected: false } });
    });

    it('a declined OS_CLOUD_URL under an absent option is "cloud not configured" for both', async () => {
        vi.stubEnv('OS_CLOUD_URL', 'off');
        const { binding, called } = await readBoth(undefined);
        expect(binding).toBe('');
        expect(called).toEqual([]);
    });

    it.each([
        ['the configured URL', 'https://cp.example.com/', 'https://env.example.com', 'https://cp.example.com'],
        ['OS_CLOUD_URL under an absent option', undefined, 'https://env.example.com/', 'https://env.example.com'],
    ])('%s: the routes call the URL the binding answers', async (_label, option, env, expected) => {
        vi.stubEnv('OS_CLOUD_URL', env);
        const { binding, called } = await readBoth(option);
        expect(binding).toBe(expected);
        expect(called).toEqual([`${expected}/api/v1/cloud/environments/${ENV}/packages`]);
    });
});

// ── [#30964, cloud#3624 ruling A] an UNMANAGED grant: the copy is made in the environment, by its install-local door ──
//
// Cross-repo, NOT MEASURED: the grant's shape. The control-plane double below
// answers what the cloud half is assumed to (cloud PR #3683 is not readable
// from this repository): on an unmanaged grant it skips its own install and
// echoes `install_mode: 'unmanaged'` with the granted `version_id`.

describe('[#30964] an unmanaged grant hands the copy to the environment\'s install-local door', () => {
    const ENV = 'env-123';
    const COOKIE = 'os.session=abc';

    function cWithCookie(body: any) {
        const url = 'https://t1.example.com/api/v1/cloud-connection/install';
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return { req: { url, raw: new Request(url, { method: 'POST', headers: { cookie: COOKIE } }), json: async () => body }, json };
    }

    async function grant(opts: {
        body?: Record<string, unknown>;
        answer?: { status?: number; json: unknown };
        door?: { install: (r: Request, options?: { grant?: unknown }) => Promise<Response> } | null;
        singleEnvironment?: boolean;
        /** [#31481] The audit slot throws. */
        auditThrows?: boolean;
    } = {}) {
        const rawApp = makeRawApp();
        const seen: { request?: Request; body?: any; options?: any } = {};
        // [#31481] The environment's `audit` slot, recording what it is handed.
        const auditEvents: any[] = [];
        const audit = {
            recordPackageLifecycleEvent: async (event: unknown) => {
                if (opts.auditThrows) throw new Error('ledger offline');
                auditEvents.push(event);
            },
        };
        const door = opts.door === null ? undefined : opts.door ?? {
            install: vi.fn(async (request: Request, options?: { grant?: unknown }) => {
                seen.request = request;
                seen.options = options;
                seen.body = await request.json();
                return new Response(JSON.stringify({ success: true, data: { installMode: 'unmanaged', targetPackageId: 'com.acme.crm-copy' } }), { status: 200 });
            }),
        };
        const envKernel = {
            getServiceAsync: async (name: string) => {
                if (name === 'auth') return sessionAuth('user-1');
                if (name === 'marketplace-install-local' && door) return door;
                if (name === 'audit') return audit;
                throw new Error(`no ${name}`);
            },
        };
        const services: Record<string, any> = opts.singleEnvironment
            ? { auth: sessionAuth('user-1'), audit, ...(door ? { 'marketplace-install-local': door } : {}) }
            : { 'env-registry': { resolveByHostname: async () => ({ environmentId: ENV }) }, 'kernel-manager': { getOrCreate: async () => envKernel } };
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services });
        const answer = opts.answer ?? { json: { success: true, data: { install_mode: 'unmanaged', version_id: 'ver_9', version: '2.0.0' } } };
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify(answer.json), { status: answer.status ?? 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key',
            ...(opts.singleEnvironment ? { singleEnvironment: true, environmentId: ENV } : {}),
        }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/install')!(
            cWithCookie(opts.body ?? { package_id: 'pkg_1', install_mode: 'unmanaged' }),
        );
        return { res, door, seen, fetchSpy, auditEvents, logger: ctx.logger };
    }

    it('copies the granted version through the door, as the caller (their own headers), and answers the door\'s answer', async () => {
        const { res, seen, fetchSpy } = await grant();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload).toEqual({ success: true, data: { installMode: 'unmanaged', targetPackageId: 'com.acme.crm-copy' } });
        expect(seen.request!.method).toBe('POST');
        expect(new URL(seen.request!.url).pathname).toBe('/api/v1/marketplace/install-local');
        expect(seen.request!.headers.get('cookie')).toBe(COOKIE);
        expect(seen.request!.headers.get('authorization')).toBeNull();
        // No sample data unless asked (framework parity), and no manifest when the grant carries none.
        expect(seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged' });
    });

    // ── [#31963, cloud#3624 ruling A] the grant's own manifest, handed inline ──

    const MANIFEST = { id: 'com.acme.crm', version: '2.0.0', name: 'CRM' };
    const grantWith = (extra: Record<string, unknown>) =>
        ({ json: { success: true, data: { install_mode: 'unmanaged', version_id: 'ver_9', version: '2.0.0', ...extra } } });

    it('[#31963] a record-id grant naming its manifest id hands the door the grant\'s manifest inline, with the id and version to hold it to', async () => {
        const { res, seen } = await grant({ answer: grantWith({ manifest: MANIFEST, manifest_id: 'com.acme.crm' }) });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged', manifest: MANIFEST });
        expect(seen.options).toEqual({
            grant: { packageId: 'pkg_1', version: '2.0.0', manifestId: 'com.acme.crm', environmentId: ENV, actor: 'user-1' },
        });
    });

    it('[#31963] a grant for a package named by its manifest id hands the manifest inline, held to that id', async () => {
        const { seen } = await grant({
            body: { package_id: 'com.acme.crm', install_mode: 'unmanaged' },
            answer: grantWith({ manifest: MANIFEST, manifest_id: 'com.acme.other' }),
        });
        expect(seen.body).toEqual({ packageId: 'com.acme.crm', versionId: 'ver_9', installMode: 'unmanaged', manifest: MANIFEST });
        expect(seen.options.grant.manifestId).toBe('com.acme.crm');
    });

    it('[#31963] CONTROL: a record-id grant that does not say which manifest it granted keeps the cloud fetch, as does one with no manifest', async () => {
        for (const extra of [{ manifest: MANIFEST }, {}, { manifest: [MANIFEST], manifest_id: 'com.acme.crm' }, { manifest: 'x', manifest_id: 'com.acme.crm' }]) {
            const { res, seen } = await grant({ answer: grantWith(extra) });
            expect(res.status, JSON.stringify(extra)).toBe(200);
            expect(seen.body, JSON.stringify(extra)).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged' });
            expect(seen.options.grant).not.toHaveProperty('manifestId');
        }
    });

    it('[#31963] a grant carrying its manifest but no version fails closed: 502, nothing copied, audited', async () => {
        const answer = { json: { success: true, data: { install_mode: 'unmanaged', version_id: 'ver_9', manifest: MANIFEST, manifest_id: 'com.acme.crm' } } };
        const { res, door, auditEvents } = await grant({ answer });
        expect(res.status).toBe(502);
        expect(res.payload.error.code).toBe('PLUGIN_INSTALL_FAILED');
        expect(res.payload.error.message).toContain('Nothing was copied');
        expect((door as any).install).not.toHaveBeenCalled();
        expect(auditEvents).toEqual([{
            action: 'package_unmanaged_import', packageId: 'pkg_1', environmentId: ENV, actor: 'user-1',
            outcome: 'failure', errorCode: 'PLUGIN_INSTALL_FAILED', status: 502,
        }]);
    });

    it('[#31963] the manifest comes only from the grant: a manifest in the caller\'s body never reaches the door', async () => {
        const forged = { id: 'com.evil.app', version: '9.9.9' };
        const body = { package_id: 'pkg_1', install_mode: 'unmanaged', manifest: forged };
        const without = await grant({ body });
        expect(without.seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged' });
        const withGrant = await grant({ body, answer: grantWith({ manifest: MANIFEST, manifest_id: 'com.acme.crm' }) });
        expect(withGrant.seen.body.manifest).toEqual(MANIFEST);
        // The control plane is never sent a manifest either.
        const sent = JSON.parse(String((withGrant.fetchSpy.mock.calls[0] as any[])[1].body));
        expect(sent).not.toHaveProperty('manifest');
        expect(sent.params).not.toHaveProperty('manifest');
    });

    it('asked for the sample data, the door is asked for it too (the #30808 copy, owned by the installer)', async () => {
        const { seen } = await grant({ body: { package_id: 'pkg_1', install_mode: 'unmanaged', seed_sample_data: true } });
        expect(seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged', seedSampleData: true });
    });

    it('a door refusal is the answer, status and all', async () => {
        const door = { install: vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'nope' } }), { status: 403 })) };
        const { res } = await grant({ door });
        expect(res.status).toBe(403);
        expect(res.payload.error.code).toBe('FORBIDDEN');
    });

    it('single-environment: the door is the host kernel\'s', async () => {
        const { res, seen } = await grant({ singleEnvironment: true });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(seen.body).toMatchObject({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged' });
    });

    it('fails closed on a grant it cannot read: no echoed mode, or no version id — 502, nothing copied', async () => {
        for (const data of [
            { version_id: 'ver_9' },
            { install_mode: 'managed', version_id: 'ver_9' },
            { install_mode: 'unmanaged' },
            { install_mode: 'unmanaged', version_id: '  ' },
            // A manifest in the answer is never a substitute for the granted version.
            { install_mode: 'unmanaged', manifest: { id: 'com.acme.crm', version: '2.0.0' } },
        ]) {
            const { res, door } = await grant({ answer: { json: { success: true, data } } });
            expect(res.status, JSON.stringify(data)).toBe(502);
            expect(res.payload.error.code).toBe('PLUGIN_INSTALL_FAILED');
            expect(res.payload.error.message).toContain('Nothing was copied');
            expect((door as any).install).not.toHaveBeenCalled();
        }
    });

    it('no echoed install_mode at all says the package may already be installed managed; an echoed mismatch or a missing version does not', async () => {
        const MANAGED_NOTE = 'The control plane did not echo install_mode; a control plane that does not read it may have '
            + 'installed the package managed. Check Installed before retrying.';
        for (const data of [{ version_id: 'ver_9' }, { install_mode: null, version_id: 'ver_9' }, {}]) {
            const { res, logger } = await grant({ answer: { json: { success: true, data } } });
            expect(res.status, JSON.stringify(data)).toBe(502);
            expect(res.payload.error.message).toContain('Nothing was copied.');
            expect(res.payload.error.message).toContain(MANAGED_NOTE);
            const warned = (logger.warn as any).mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
            expect(warned).toContain(MANAGED_NOTE);
        }
        for (const data of [
            { install_mode: 'managed', version_id: 'ver_9' },
            { install_mode: 'unmanaged' },
            { install_mode: 'unmanaged', version_id: '  ' },
        ]) {
            const { res, logger } = await grant({ answer: { json: { success: true, data } } });
            expect(res.status, JSON.stringify(data)).toBe(502);
            expect(res.payload.error.message).not.toContain('may have installed the package managed');
            const warned = (logger.warn as any).mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
            expect(warned).toContain('was not copied');
            expect(warned).not.toContain('may have installed the package managed');
        }
    });

    // ── [#31482, cloud#3648] the namespace the grant names governs the copy ──

    const echoing = (extra: Record<string, unknown>) =>
        ({ json: { success: true, data: { install_mode: 'unmanaged', version_id: 'ver_9', version: '2.0.0', ...extra } } });

    it('[#31482] a namespace asked for and echoed by the grant reaches the door as `targetNamespace`; the control plane was sent it', async () => {
        const { res, seen, fetchSpy } = await grant({
            body: { package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: 'acme' },
            answer: echoing({ target_namespace: 'acme' }),
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged', targetNamespace: 'acme' });
        const sent = JSON.parse(String((fetchSpy.mock.calls[0] as any[])[1].body));
        expect(sent.params.target_namespace).toBe('acme');
    });

    it('[#31482] with no ask, the namespace the grant names is the copy\'s: the grant governs it', async () => {
        const { res, seen, fetchSpy } = await grant({ answer: echoing({ target_namespace: 'acme_default' }) });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(seen.body).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged', targetNamespace: 'acme_default' });
        const sent = JSON.parse(String((fetchSpy.mock.calls[0] as any[])[1].body));
        expect(sent.params).not.toHaveProperty('target_namespace');
    });

    it('[#31482] CONTROL: no ask and no echo (absent or null) hands the door no `targetNamespace`: the copy keeps the source\'s namespace', async () => {
        for (const extra of [{}, { target_namespace: null }]) {
            const { res, seen } = await grant({ answer: echoing(extra) });
            expect(res.status, JSON.stringify(extra)).toBe(200);
            expect(seen.body, JSON.stringify(extra)).toEqual({ packageId: 'pkg_1', versionId: 'ver_9', installMode: 'unmanaged' });
        }
    });

    it('[#31482] a namespace asked for that the grant does not echo, or echoes another, fails closed: 502, nothing copied, audited', async () => {
        for (const extra of [{}, { target_namespace: null }, { target_namespace: 'other' }]) {
            const { res, door, auditEvents } = await grant({
                body: { package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: 'acme' },
                answer: echoing(extra),
            });
            expect(res.status, JSON.stringify(extra)).toBe(502);
            expect(res.payload.error.code).toBe('PLUGIN_INSTALL_FAILED');
            expect(res.payload.error.message).toContain('cannot tell which namespace it granted');
            expect(res.payload.error.message).toContain('Nothing was copied');
            expect((door as any).install).not.toHaveBeenCalled();
            expect(auditEvents).toEqual([{
                action: 'package_unmanaged_import', packageId: 'pkg_1', version: '2.0.0', environmentId: ENV, actor: 'user-1',
                outcome: 'failure', errorCode: 'PLUGIN_INSTALL_FAILED', status: 502,
            }]);
        }
    });

    it('[#31482] a grant whose `target_namespace` is not a string fails closed: 502, nothing copied, asked or not', async () => {
        for (const body of [{ package_id: 'pkg_1', install_mode: 'unmanaged' }, { package_id: 'pkg_1', install_mode: 'unmanaged', target_namespace: 'acme' }]) {
            const { res, door } = await grant({ body, answer: echoing({ target_namespace: ['acme'] }) });
            expect(res.status, JSON.stringify(body)).toBe(502);
            expect(res.payload.error.code).toBe('PLUGIN_INSTALL_FAILED');
            expect((door as any).install).not.toHaveBeenCalled();
        }
    });

    it('[#31482] the namespace comes only from the grant: a `targetNamespace` in the caller\'s body never reaches the door', async () => {
        const { seen } = await grant({ body: { package_id: 'pkg_1', install_mode: 'unmanaged', targetNamespace: 'forged' } });
        expect(seen.body).not.toHaveProperty('targetNamespace');
    });

    it('a control-plane refusal is relayed as it was, and nothing is copied', async () => {
        const { res, door } = await grant({ answer: { status: 403, json: { success: false, error: { code: 'FORBIDDEN', message: 'not entitled' } } } });
        expect(res.status).toBe(403);
        expect(res.payload).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'not entitled' } });
        expect((door as any).install).not.toHaveBeenCalled();
    });

    it('a managed install is never handed to the door', async () => {
        const { res, door } = await grant({ body: { package_id: 'pkg_1' }, answer: { json: { success: true, data: { installed: true } } } });
        expect(res.payload).toEqual({ success: true, data: { installed: true } });
        expect((door as any).install).not.toHaveBeenCalled();
    });

    it('an environment with no install-local door answers 503 and copies nothing', async () => {
        const { res } = await grant({ door: null });
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(res.payload.error.message).toContain('Nothing was copied');
    });

    // ── [#31481, ruling A「两边审计」] a refusal after the grant leaves the environment's audit row ──

    /** The failure event this door hands for a grant it refuses itself. */
    const refusedGrant = (errorCode: string, status: number) => ({
        action: 'package_unmanaged_import',
        packageId: 'pkg_1',
        version: '2.0.0',
        environmentId: ENV,
        actor: 'user-1',
        outcome: 'failure',
        errorCode,
        status,
    });

    it('[#31481] the door is handed the grant beside the request: package, version, environment and installer', async () => {
        const { res, seen, auditEvents } = await grant();
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(seen.options).toEqual({ grant: { packageId: 'pkg_1', version: '2.0.0', environmentId: ENV, actor: 'user-1' } });
        // The copy's own events are the door's; this door writes none for a copy it handed over.
        expect(auditEvents).toEqual([]);
    });

    it('[#31481] a grant it cannot read hands the environment\'s audit slot one failure event (502), in either deployment', async () => {
        for (const singleEnvironment of [false, true]) {
            const { res, auditEvents } = await grant({
                singleEnvironment,
                answer: { json: { success: true, data: { install_mode: 'unmanaged', version: '2.0.0' } } },
            });
            expect(res.status).toBe(502);
            expect(auditEvents).toEqual([refusedGrant('PLUGIN_INSTALL_FAILED', 502)]);
        }
    });

    it('[#31481] no install-local door hands the environment\'s audit slot one failure event (503)', async () => {
        const { res, auditEvents } = await grant({ door: null });
        expect(res.status).toBe(503);
        expect(auditEvents).toEqual([refusedGrant('SERVICE_UNAVAILABLE', 503)]);
    });

    it('[#31481] a door refusal is the door\'s to audit: this door hands no second event', async () => {
        const door = { install: vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'nope' } }), { status: 403 })) };
        const { res, auditEvents } = await grant({ door });
        expect(res.status).toBe(403);
        expect(auditEvents).toEqual([]);
    });

    it('[#31481] no grant, no event: a control-plane refusal and a managed install hand none', async () => {
        const refused = await grant({ answer: { status: 403, json: { success: false, error: { code: 'FORBIDDEN', message: 'not entitled' } } } });
        expect(refused.auditEvents).toEqual([]);
        const managed = await grant({ body: { package_id: 'pkg_1' }, answer: { json: { success: true, data: { installed: true } } } });
        expect(managed.auditEvents).toEqual([]);
    });

    it('[#31481] an audit slot that throws changes no answer, and is logged at error', async () => {
        const { res, logger } = await grant({ door: null, auditThrows: true });
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        const errors = (logger.error as any).mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
        expect(errors).toContain('package_unmanaged_import');
        expect(errors).toContain('ledger offline');
    });
});
