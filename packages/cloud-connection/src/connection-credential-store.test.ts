// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConnectionCredentialStore + the plugin's credential behavior
 * (cloud ADR-0008 consumption side):
 *   - store round-trip / clear / corrupt tolerance / 0600 mode
 *   - bind/poll persists the one-time runtime_token and STRIPS it from
 *     the browser-facing response
 *   - forwards fall back to the stored bearer when no service key is set
 *   - unbind revokes (best-effort) and clears the local credential
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccs-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

const CRED = { runtimeToken: 'oscc_abc', environmentId: 'env_1', controlPlaneUrl: 'http://cloud.test' };

describe('ConnectionCredentialStore', () => {
    it('round-trips, clears, and tolerates corrupt files', () => {
        const store = new ConnectionCredentialStore(join(dir, 'cc.json'));
        expect(store.read()).toBeNull();
        store.write(CRED);
        expect(store.read()?.runtimeToken).toBe('oscc_abc');
        expect(store.clear()).toBe(true);
        expect(store.clear()).toBe(false);

        writeFileSync(store.path, '{nope', 'utf8');
        expect(store.read()).toBeNull();
    });

    it('writes the secret 0600', () => {
        const store = new ConnectionCredentialStore(join(dir, 'cc.json'));
        store.write(CRED);
        const mode = statSync(store.path).mode & 0o777;
        expect(mode).toBe(0o600);
    });
});

// ── plugin harness ──────────────────────────────────────────────────────
type Handler = (c: any) => Promise<any>;
function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    };
}
const sessionAuth = (userId?: string) => ({ api: { getSession: async () => (userId ? { user: { id: userId } } : null) } });
function makeCtx(rawApp: any, services: Record<string, any> = {}) {
    const hooks = new Map<string, any>();
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}
function makeC(url: string, body?: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return { req: { url, raw: new Request(url), json: async () => body ?? {} }, json };
}

describe('CloudConnectionPlugin credential behavior', () => {
    it('bind/poll persists runtime_token to the store and strips it from the response', async () => {
        const credPath = join(dir, 'cc.json');
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        vi.stubGlobal('fetch', vi.fn(async (url: any) => {
            const u = String(url);
            if (u.includes('/auth/device/token')) {
                return new Response(JSON.stringify({ access_token: 'op-token' }), { status: 200 });
            }
            if (u.includes('/cloud-connection/bind')) {
                return new Response(JSON.stringify({ success: true, data: { bound: true, connection: { organization_id: 'org_x' }, runtime_token: 'oscc_minted' } }), { status: 200 });
            }
            throw new Error(`unexpected fetch ${u}`);
        }));
        await new CloudConnectionPlugin({
            singleEnvironment: true, environmentId: 'env_1',
            controlPlaneUrl: 'http://cloud.test', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/bind/poll')!(
            makeC('http://localhost:3000/x', { device_code: 'dc' }),
        );
        expect(res.payload.success).toBe(true);
        expect(JSON.stringify(res.payload)).not.toContain('oscc_minted');
        const stored = new ConnectionCredentialStore(credPath).read();
        expect(stored?.runtimeToken).toBe('oscc_minted');
        expect(stored?.environmentId).toBe('env_1');
    });

    it('forwards use the stored bearer when no service key is configured', async () => {
        const credPath = join(dir, 'cc.json');
        new ConnectionCredentialStore(credPath).write({ runtimeToken: 'oscc_stored', environmentId: 'env_1' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items: [] } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: '', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        // env id resolves from the STORE (no OS_ENVIRONMENT_ID, no config id).
        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/org-packages')!(
            makeC('http://localhost:3000/api/v1/cloud-connection/org-packages'),
        );
        expect(res.payload.success).toBe(true);
        const [, init] = fetchSpy.mock.calls[0]!;
        expect((init as any).headers.Authorization).toBe('Bearer oscc_stored');
    });

    it('unbind revokes against the control plane and clears the local credential', async () => {
        const credPath = join(dir, 'cc.json');
        const store = new ConnectionCredentialStore(credPath);
        store.write({ runtimeToken: 'oscc_stored', environmentId: 'env_1' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: '', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/unbind')!(
            makeC('http://localhost:3000/x'),
        );
        expect(res.payload.data).toEqual({ environmentId: 'env_1', revoked: true, cleared: true });
        expect(String(fetchSpy.mock.calls[0]![0])).toContain('/cloud-connection/revoke');
        expect((fetchSpy.mock.calls[0]![1] as any).headers.Authorization).toBe('Bearer oscc_stored');
        expect(store.read()).toBeNull();
    });

    it('bind/poll sends the registration claim (hostname/version/stored runtime_id), omits environment_id, persists runtime_id', async () => {
        const credPath = join(dir, 'cc.json');
        // Simulate a prior v2 bind: identity exists, bearer will rotate.
        new ConnectionCredentialStore(credPath).write({ runtimeToken: 'oscc_old', runtimeId: 'rt-1' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        let bindBody: any = null;
        vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
            const u = String(url);
            if (u.includes('/auth/device/token')) {
                return new Response(JSON.stringify({ access_token: 'op-token' }), { status: 200 });
            }
            if (u.includes('/cloud-connection/bind')) {
                bindBody = JSON.parse(init.body);
                return new Response(JSON.stringify({ success: true, data: { bound: true, runtime_id: 'rt-1', connection: { organization_id: 'org_x', runtime_id: 'rt-1' }, runtime_token: 'oscc_new' } }), { status: 200 });
            }
            throw new Error(`unexpected fetch ${u}`);
        }));
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/bind/poll')!(
            makeC('http://localhost:3000/x', { device_code: 'dc' }),
        );
        expect(res.payload.success).toBe(true);
        // The claim: identity + device context, NO environment.
        expect(bindBody.environment_id).toBeUndefined();
        expect(bindBody.runtime_id).toBe('rt-1');
        expect(typeof bindBody.name).toBe('string');
        expect(bindBody.name.length).toBeGreaterThan(0);
        expect(typeof bindBody.runtime_version).toBe('string');
        expect(bindBody.token).toBe('op-token');
        // Identity survives, bearer rotated, no phantom env persisted.
        const stored = new ConnectionCredentialStore(credPath).read();
        expect(stored?.runtimeId).toBe('rt-1');
        expect(stored?.runtimeToken).toBe('oscc_new');
        expect(stored?.environmentId).toBeUndefined();
    });

    it('bind/start works without an environment id in single-environment mode', async () => {
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'http://cloud.test/_console/auth/device',
            verification_uri_complete: 'http://cloud.test/_console/auth/device?user_code=ABCD-EFGH', interval: 5, expires_in: 600,
        }), { status: 200 })));
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', credentialPath: join(dir, 'cc.json'),
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/bind/start')!(
            makeC('http://localhost:3000/x', {}),
        );
        expect(res.status).toBe(200);
        expect(res.payload.data.user_code).toBe('ABCD-EFGH');
        // Device context rides the verification URL for the approval page.
        const complete = new URL(res.payload.data.verification_uri_complete);
        expect(complete.searchParams.get('user_code')).toBe('ABCD-EFGH');
        expect(complete.searchParams.get('runtime_name')).toBeTruthy();
        expect(complete.searchParams.get('runtime_version')).toBeTruthy();
    });

    it('unbind without an environment id revokes via the bearer (empty body) and clears the store', async () => {
        const credPath = join(dir, 'cc.json');
        const store = new ConnectionCredentialStore(credPath);
        store.write({ runtimeToken: 'oscc_stored', runtimeId: 'rt-1' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: '', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/unbind')!(makeC('http://localhost:3000/x'));
        expect(res.payload.data).toEqual({ environmentId: null, revoked: true, cleared: true });
        expect((fetchSpy.mock.calls[0]![1] as any).body).toBe('{}');
        expect((fetchSpy.mock.calls[0]![1] as any).headers.Authorization).toBe('Bearer oscc_stored');
        // Credential gone; identity residual kept for the re-bind claim.
        expect(store.read()?.runtimeToken).toBe('');
        expect(store.read()?.runtimeId).toBe('rt-1');
    });

    it('unbind keeps an identity residual: token cleared, runtimeId survives for the re-bind claim', async () => {
        const credPath = join(dir, 'cc.json');
        const store = new ConnectionCredentialStore(credPath);
        store.write({ runtimeToken: 'oscc_stored', runtimeId: 'rt-keep' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: '', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/cloud-connection/unbind')!(makeC('http://localhost:3000/x'));
        expect(res.payload.data.revoked).toBe(true);
        // Residual: identity kept, credential gone.
        const residual = store.read();
        expect(residual?.runtimeId).toBe('rt-keep');
        expect(residual?.runtimeToken).toBe('');

        // Status reads the residual as UNBOUND (no credential) but surfaces the id.
        const status = await rawApp.routes.get('GET /api/v1/cloud-connection/status')!(makeC('http://localhost:3000/x'));
        expect(status.payload.data.bound).toBe(false);
        expect(status.payload.data.runtimeId).toBe('rt-keep');
    });

    it('org-packages without an environment id forwards bearer-only (org from the connection)', async () => {
        const credPath = join(dir, 'cc.json');
        new ConnectionCredentialStore(credPath).write({ runtimeToken: 'oscc_stored', runtimeId: 'rt-1' });
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { auth: sessionAuth('admin'), manifest: { register: vi.fn() } });
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items: [{ id: 'p1' }] } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        await new CloudConnectionPlugin({
            singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', controlPlaneApiKey: '', credentialPath: credPath,
        }).start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('GET /api/v1/cloud-connection/org-packages')!(
            makeC('http://localhost:3000/api/v1/cloud-connection/org-packages'),
        );
        expect(res.payload.data.total).toBe(1);
        expect(String(fetchSpy.mock.calls[0]![0])).toBe('http://cloud.test/api/v1/cloud/org-packages');
        expect((fetchSpy.mock.calls[0]![1] as any).headers.Authorization).toBe('Bearer oscc_stored');
    });

    it('registers the SDUI bundle (page + nav) with the manifest service', async () => {
        const register = vi.fn();
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, { manifest: { register } });
        await new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: 'http://cloud.test', credentialPath: join(dir, 'cc.json') }).start(ctx as any);
        await fire();
        expect(register).toHaveBeenCalledWith(expect.objectContaining({
            id: 'com.objectstack.cloud-connection.ui',
            pages: [expect.objectContaining({ name: 'cloud_connection_settings' })],
            navigationContributions: [expect.objectContaining({ app: 'setup' })],
        }));
    });
});
