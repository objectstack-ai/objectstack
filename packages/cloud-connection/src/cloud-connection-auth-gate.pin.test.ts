// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 at cloud-connection's raw-app plugins: a session the authentication
 * policy HOLDS (an expired password, enforced MFA not yet enrolled) is refused
 * by every door that resolves a session, with REST's answer (`403`, the gate's
 * `code` and `message`), before any door logic runs.
 *
 * ## The two plugins that resolve a session, and where each consults
 *
 *  - `CloudConnectionPlugin` reads the session in ONE place
 *    (`sessionFromAuthService`, under both resolution modes). Seven of its
 *    eight doors call it; `/status` reads no session at all.
 *  - `MarketplaceInstallLocalPlugin` reads it in ONE place
 *    (`resolveInstallPrincipal`), and all five doors open with the same
 *    admission (`admitInstallCaller`).
 *
 * Each consults `evaluateAuthGate` (`@objectstack/core`) once, with no request
 * path, so the shared allow-list can grant no exemption. No route either plugin
 * mounts is allow-listed (asserted below), so there is no exemption to keep.
 *
 * `MarketplaceProxyPlugin` is not here: it resolves no session. It forwards the
 * public catalog with no credential, and every caller gets the same answer.
 *
 * ## The cases, per plugin
 *
 *  - HELD: under both postures, every session door answers `403` with the
 *    gate's `code` and `message`, and no effect fires (no control-plane call,
 *    no credential cleared; no registry, schema, ledger, seed or delete write).
 *  - UN-HELD: the same caller and grants, without a posture, are served.
 *  - Anonymous is refused `401` as before, and `/status` is untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAuthGateAllowlisted } from '@objectstack/core';

const seedCalls: unknown[] = [];
vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: unknown) {
            seedCalls.push(request);
            return { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        }
        async buildDependencyGraph(objectNames: string[]) {
            return {
                nodes: objectNames.map((object) => ({ object, dependsOn: [], references: [] })),
                insertOrder: objectNames,
                circularDependencies: [],
            };
        }
    },
    recordSeedOutcome: vi.fn(),
}));

import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'You must change your password before continuing.' };
const MFA_REQUIRED = {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const HELD = [
    { user: 'u_held_pw', gate: PASSWORD_EXPIRED },
    { user: 'u_held_mfa', gate: MFA_REQUIRED },
] as const;
/** The posture each test user's session carries. The grants are the same for all three. */
const POSTURES: Record<string, { code: string; message: string } | undefined> = {
    u_held_pw: PASSWORD_EXPIRED,
    u_held_mfa: MFA_REQUIRED,
    u_member: undefined,
};

/** A better-auth session read keyed by the `x-test-user` header, counting its calls. */
function sessionAuth() {
    const reads = { count: 0 };
    return {
        reads,
        api: {
            getSession: async ({ headers }: { headers: Headers }) => {
                reads.count++;
                const uid = headers?.get?.('x-test-user');
                if (!uid || !(uid in POSTURES)) return null;
                const authGate = POSTURES[uid];
                return { user: { id: uid, ...(authGate ? { authGate } : {}) }, session: {} };
            },
        },
    };
}

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(url: string, user: string | undefined, body: unknown = {}, manifestId?: string) {
    const headers = new Headers(user ? { 'x-test-user': user } : {});
    return {
        req: {
            url,
            raw: new Request(url, { headers }),
            header: (n: string) => headers.get(n) ?? undefined,
            json: async () => body,
            param: () => manifestId,
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-gate-pin-'));
    seedCalls.length = 0;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// CloudConnectionPlugin
// ---------------------------------------------------------------------------

const CC = '/api/v1/cloud-connection';
const ORIGIN = 'https://env.example.test';

/** The seven doors that resolve a session, each with what it needs to reach the control plane. */
const CC_SESSION_DOORS = [
    { route: `POST ${CC}/bind/start`, url: `${ORIGIN}${CC}/bind/start`, body: {} },
    { route: `POST ${CC}/bind/poll`, url: `${ORIGIN}${CC}/bind/poll`, body: { device_code: 'dc_1' } },
    { route: `POST ${CC}/unbind`, url: `${ORIGIN}${CC}/unbind`, body: {} },
    { route: `POST ${CC}/install`, url: `${ORIGIN}${CC}/install`, body: { package_id: 'pkg_1' } },
    { route: `GET ${CC}/installation`, url: `${ORIGIN}${CC}/installation?package_id=pkg_1`, body: {} },
    { route: `GET ${CC}/installed`, url: `${ORIGIN}${CC}/installed`, body: {} },
    { route: `GET ${CC}/org-packages`, url: `${ORIGIN}${CC}/org-packages`, body: {} },
] as const;

async function mountCloudConnection(mode: 'single' | 'multi') {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const auth = sessionAuth();
    const credentialPath = join(dir, 'cloud-connection.json');
    const store = new ConnectionCredentialStore(credentialPath);
    store.write({ runtimeToken: 'oscc_pin', runtimeId: 'rt_1', environmentId: 'env-1' });
    const services: Record<string, unknown> = mode === 'single'
        ? { auth }
        : {
            'env-registry': { resolveByHostname: async () => ({ environmentId: 'env-1' }) },
            'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async () => auth }) },
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
        // One body that every door can read: the device-token grant reads
        // `access_token` at the top level, the others read `data`.
        return new Response(JSON.stringify({ success: true, access_token: 'at_1', data: { installed: false, packages: [], items: [] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }));
    await new CloudConnectionPlugin({
        controlPlaneUrl: 'http://cloud.test',
        controlPlaneApiKey: 'svc-key',
        credentialPath,
        ...(mode === 'single' ? { singleEnvironment: true, environmentId: 'env-1' } : {}),
    }).start(ctx as any);
    await hooks.get('kernel:ready')?.();
    return { rawApp, auth, fetchCalls, credentialPath };
}

describe('ADR-0069 at CloudConnectionPlugin', () => {
    it('census: eight routes, none allow-listed; seven resolve a session and /status resolves none', async () => {
        const { rawApp, auth } = await mountCloudConnection('single');
        const keys = [...rawApp.routes.keys()];
        expect(keys).toHaveLength(8);
        for (const key of keys) expect(isAuthGateAllowlisted(key.split(' ')[1]), key).toBe(false);
        expect(keys.filter((k) => k !== `GET ${CC}/status`).sort()).toEqual(CC_SESSION_DOORS.map((d) => d.route).sort());
        await rawApp.routes.get(`GET ${CC}/status`)!(makeC(`${ORIGIN}${CC}/status`, 'u_held_pw'));
        expect(auth.reads.count, '/status read a session').toBe(0);
    });

    for (const mode of ['single', 'multi'] as const) {
        for (const { user, gate } of HELD) {
            it(`HELD (${gate.code}, ${mode}-environment): all seven session doors answer 403 with the gate's code, and nothing reaches the control plane`, async () => {
                const { rawApp, fetchCalls, credentialPath } = await mountCloudConnection(mode);
                for (const door of CC_SESSION_DOORS) {
                    const res = await rawApp.routes.get(door.route)!(makeC(door.url, user, door.body));
                    expect(res.status, door.route).toBe(403);
                    expect(res.payload, door.route).toEqual({ success: false, error: { code: gate.code, message: gate.message } });
                }
                expect(fetchCalls, 'a held session reached the control plane').toEqual([]);
                expect(new ConnectionCredentialStore(credentialPath).read()?.runtimeToken, 'unbind cleared the credential').toBe('oscc_pin');
            });
        }
    }

    it('UN-HELD: the same caller without a posture is served by all seven doors', async () => {
        const { rawApp, fetchCalls } = await mountCloudConnection('single');
        for (const door of CC_SESSION_DOORS) {
            const before = fetchCalls.length;
            const res = await rawApp.routes.get(door.route)!(makeC(door.url, 'u_member', door.body));
            expect(res.status, `${door.route}: ${JSON.stringify(res.payload)}`).toBe(200);
            expect(fetchCalls.length, `${door.route} did not reach the control plane`).toBeGreaterThan(before);
        }
    });

    it('anonymous: every session door still answers 401 UNAUTHENTICATED', async () => {
        const { rawApp, fetchCalls } = await mountCloudConnection('single');
        for (const door of CC_SESSION_DOORS) {
            const res = await rawApp.routes.get(door.route)!(makeC(door.url, undefined, door.body));
            expect(res.status, door.route).toBe(401);
            expect(res.payload?.error?.code, door.route).toBe('UNAUTHENTICATED');
        }
        expect(fetchCalls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// MarketplaceInstallLocalPlugin
// ---------------------------------------------------------------------------

const IL = '/api/v1/marketplace/install-local';
const APP = {
    id: 'com.acme.gated',
    namespace: 'gated',
    version: '1.0.0',
    objects: [{ name: 'widget', fields: { code: { type: 'text' } } }],
    data: [{ object: 'widget', externalId: 'code', records: [{ code: 'a' }, { code: 'b' }] }],
};
const LEDGER_FILE = 'com.acme.gated.json';

/** Every test user holds the authoring capability, so a refusal below is the gate's alone. */
function grantRows(): Record<string, any[]> {
    return {
        sys_user: Object.keys(POSTURES).map((id) => ({ id, email: `${id}@acme.test` })),
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_metadata_activation: [],
        sys_position_permission_set: [],
        sys_user_permission_set: Object.keys(POSTURES).map((id, i) => ({
            id: `ups${i}`, user_id: id, permission_set_id: 'ps1', permission_set: 'admin_full_access', organization_id: null,
        })),
        sys_permission_set: [{ id: 'ps1', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access', 'setup.access'] }],
    };
}

async function mountInstallLocal(storageDir: string) {
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const widgets = [{ id: 'w1', code: 'a' }, { id: 'w2', code: 'b' }];
    const engineDelete = vi.fn(async (object: string, options?: any) => {
        const dispatch = assertEngineDeleteDispatch(options);
        if (object !== 'widget' || dispatch.kind !== 'by-id') return false;
        const at = widgets.findIndex((w) => w.id === dispatch.id);
        if (at < 0) return false;
        widgets.splice(at, 1);
        return true;
    });
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const rows = grantRows();
    const services: Record<string, any> = {
        manifest: { register },
        auth: sessionAuth(),
        objectql: bindCatalogFromTables({
            syncSchemas,
            find: async (object: string) => (object === 'widget' ? widgets.map((w) => ({ ...w })) : rows[object] ?? []),
            delete: engineDelete,
        }, rows),
        metadata: { getObject: async () => ({ name: 'widget', fields: {} }) },
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        registerService: () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    await new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }).start(ctx);
    await hooks.get('kernel:ready')?.();
    // `kernel:ready` rehydrates the ledger (registry, schema sync, seed heal),
    // so every counter starts AFTER it: the observation window is the request.
    register.mockClear();
    syncSchemas.mockClear();
    engineDelete.mockClear();
    seedCalls.length = 0;
    return {
        rawApp,
        effects: () => register.mock.calls.length + syncSchemas.mock.calls.length + seedCalls.length + engineDelete.mock.calls.length,
    };
}

/** The five doors, addressed with what each needs to act. */
const IL_DOORS = [
    { route: `POST ${IL}`, body: { manifest: APP } },
    { route: `GET ${IL}`, body: {} },
    { route: `DELETE ${IL}/:manifestId`, body: {} },
    { route: `POST ${IL}/:manifestId/reseed-sample-data`, body: {} },
    { route: `POST ${IL}/:manifestId/purge-sample-data`, body: {} },
] as const;

/** Install the app as the un-held operator, so the follow-on doors have a target. */
async function seedInstall(storageDir: string) {
    const { rawApp } = await mountInstallLocal(storageDir);
    const res = await rawApp.routes.get(`POST ${IL}`)!(makeC(`http://localhost${IL}`, 'u_member', { manifest: APP }));
    expect(res.payload.success, JSON.stringify(res.payload)).toBe(true);
    expect(existsSync(join(storageDir, LEDGER_FILE))).toBe(true);
}

describe('ADR-0069 at MarketplaceInstallLocalPlugin', () => {
    it('census: five routes, none allow-listed, all five covered below', async () => {
        const { rawApp } = await mountInstallLocal(dir);
        const keys = [...rawApp.routes.keys()].sort();
        expect(keys).toEqual(IL_DOORS.map((d) => d.route).sort());
        for (const key of keys) expect(isAuthGateAllowlisted(key.split(' ')[1]), key).toBe(false);
    });

    for (const { user, gate } of HELD) {
        it(`HELD (${gate.code}): all five doors answer 403 with the gate's code, before any effect and before the ledger is touched`, async () => {
            await seedInstall(dir);
            const ledgerBefore = existsSync(join(dir, LEDGER_FILE));
            const { rawApp, effects } = await mountInstallLocal(dir);
            for (const door of IL_DOORS) {
                const res = await rawApp.routes.get(door.route)!(makeC(`http://localhost${IL}`, user, door.body, APP.id));
                expect(res.status, door.route).toBe(403);
                expect(res.payload, door.route).toEqual({ success: false, error: { code: gate.code, message: gate.message } });
            }
            expect(effects(), 'a held session caused an effect').toBe(0);
            expect(existsSync(join(dir, LEDGER_FILE))).toBe(ledgerBefore);
        });
    }

    it('UN-HELD: the same operator without a posture is served on every door', async () => {
        await seedInstall(dir);
        const { rawApp, effects } = await mountInstallLocal(dir);
        const list = await rawApp.routes.get(`GET ${IL}`)!(makeC(`http://localhost${IL}`, 'u_member'));
        expect(list.status).toBe(200);
        expect(list.payload.success).toBe(true);
        for (const route of [`POST ${IL}/:manifestId/reseed-sample-data`, `POST ${IL}/:manifestId/purge-sample-data`, `DELETE ${IL}/:manifestId`]) {
            const res = await rawApp.routes.get(route)!(makeC(`http://localhost${IL}`, 'u_member', {}, APP.id));
            expect(res.status, `${route}: ${JSON.stringify(res.payload)}`).toBe(200);
        }
        expect(effects()).toBeGreaterThan(0);
        expect(existsSync(join(dir, LEDGER_FILE)), 'the uninstall removed the ledger entry').toBe(false);
    });

    it('anonymous: every door still answers 401 UNAUTHENTICATED', async () => {
        const { rawApp, effects } = await mountInstallLocal(dir);
        for (const door of IL_DOORS) {
            const res = await rawApp.routes.get(door.route)!(makeC(`http://localhost${IL}`, undefined, door.body, APP.id));
            expect(res.status, door.route).toBe(401);
            expect(res.payload?.error?.code, door.route).toBe('UNAUTHENTICATED');
        }
        expect(effects()).toBe(0);
    });
});
