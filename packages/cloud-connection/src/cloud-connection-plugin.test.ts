// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudConnectionPlugin — route mounting + mode behavior (ADR-0008 Phase 1).
 *
 * Exercises the consolidated /api/v1/cloud-connection/* surface in both
 * resolution modes:
 *   - multi-tenant: env-registry hostname lookup + per-env kernel session
 *   - single-environment: fixed env id + host-kernel auth session
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CloudConnectionPlugin, createCloudConnectionPlugin } from './cloud-connection-plugin.js';

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

const sessionAuth = (userId?: string) => ({
    api: { getSession: async () => (userId ? { user: { id: userId } } : null) },
});

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
        expect(res.payload).toEqual({ success: true, data: { environmentId: ENV, runtimeId: null, bound: true, provider: 'objectstack-cloud', connection: null } });
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
        expect(res.payload.error.code).toBe('environment_not_found');
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
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { installed: true } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({ controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'svc-key' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/install')!(
            makeC('https://t1.example.com/api/v1/cloud-connection/install', { package_id: 'pkg_1', seed_sample_data: true }),
        );
        expect(res.payload.success).toBe(true);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://cloud.test/api/v1/actions/sys_package/install_package');
        expect(JSON.parse((init as any).body)).toEqual({ recordId: 'pkg_1', params: { environment_id: ENV, seed_sample_data: true } });
        expect((init as any).headers.Authorization).toBe('Bearer svc-key');
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
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items } }), { status: 200 }));
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
        expect(res.payload.data).toEqual({ environmentId: null, runtimeId: null, bound: false, provider: 'objectstack-cloud', connection: null });
    });

    it('uses the configured environment id + the host kernel auth session', async () => {
        const rawApp = makeRawApp();
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: { auth: sessionAuth('admin-1') } });
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { packages: [{ id: 'p1' }] } }), { status: 200 }));
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
        const { ctx, fireKernelReady } = makeCtx({ rawApp });
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
        const { ctx, fireKernelReady } = makeCtx({ rawApp, services: { auth: sessionAuth('admin-1') } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
        await new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: 'k' }).start(ctx as any);
        await fireKernelReady();
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('http://localhost:3000/x'));
        expect(res.payload.data.environmentId).toBe('env-from-env-var');
    });
});
