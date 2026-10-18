// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24150] The release this server reports to the cloud is the release
 * discovery reports.
 *
 * `runtime_version` reaches the cloud at two sites, both driven here through
 * the routes `CloudConnectionPlugin` really mounts (`start()` +
 * `kernel:ready`): the approval links `bind/start` returns (the page an
 * approver reads to see WHAT they are authorizing), and the registration claim
 * `bind/poll` sends to the control plane's `/bind`, captured at a stand-in
 * control plane.
 *
 *  - With `OS_RUNTIME_VERSION` unset, both sites carry the `version` the real
 *    discovery producer (`ObjectStackProtocolImplementation.getDiscovery()`,
 *    the one `GET /api/v1/discovery` serves) returns on the same harness. The
 *    expected value is READ from that producer, never written here, so a
 *    constant at either site fails whatever constant it picks.
 *  - A set `OS_RUNTIME_VERSION` is sent verbatim, with or without a discovery
 *    producer on the kernel: the operator's stamp is the plugin's own read.
 *  - With no discovery read (no `protocol` service, or one that throws),
 *    neither site sends a version. Before this, both sent the plugin's own
 *    `version` field, which names the plugin, not the server's release.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const CC = '/api/v1/cloud-connection';
const ORIGIN = 'https://env.example.test';
const CLOUD = 'http://cloud.test';

/** Holds `setup.access`, which the two bind doors demand. */
const ADMIN = 'u_admin';
const GRANTS: Record<string, any[]> = {
    sys_user_permission_set: [{ id: 'ups_1', user_id: ADMIN, permission_set_id: 'ps_1', permission_set: 'setup_admin', organization_id: null }],
    sys_permission_set: [{ id: 'ps_1', name: 'setup_admin', system_permissions: ['setup.access'] }],
};

/**
 * The discovery producer `GET /api/v1/discovery` serves, over the minimal
 * engine `discovery-version.test.ts` in `@objectstack/metadata-protocol` uses.
 */
function discoveryProducer() {
    const engine = { registry: { getObject: () => undefined, getRegisteredTypes: () => [] } };
    return new ObjectStackProtocolImplementation(engine as any, () => new Map());
}

/** What the discovery producer reports, read on this harness. */
async function discoveryRelease(): Promise<unknown> {
    return (await discoveryProducer().getDiscovery()).version;
}

type Handler = (c: any) => Promise<any>;
type Mode = 'single' | 'multi';
/** `real` mounts the discovery producer; `none` mounts no `protocol` service; `throws` mounts one whose read fails. */
type Discovery = 'real' | 'none' | 'throws';

function makeC(path: string, body?: unknown) {
    const url = `${ORIGIN}${path}`;
    const headers = new Headers();
    return {
        req: {
            url,
            raw: new Request(url, { headers }),
            header: (n: string) => headers.get(n) ?? undefined,
            json: async () => body ?? {},
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

let dir: string;
const ORIGINAL_STAMP = process.env.OS_RUNTIME_VERSION;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-runtime-version-'));
    delete process.env.OS_RUNTIME_VERSION;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (ORIGINAL_STAMP === undefined) delete process.env.OS_RUNTIME_VERSION;
    else process.env.OS_RUNTIME_VERSION = ORIGINAL_STAMP;
    vi.unstubAllGlobals();
});

async function mount(mode: Mode, discovery: Discovery) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const auth = { api: { getSession: async () => ({ user: { id: ADMIN }, session: { id: 'sess_admin' } }) } };
    const objectql = bindCatalogFromTables({ find: async (object: string) => GRANTS[object] ?? [] }, GRANTS);
    const protocol = discovery === 'real'
        ? discoveryProducer()
        : discovery === 'throws'
            ? { getDiscovery: async () => { throw new Error('discovery unavailable'); } }
            : undefined;
    const envKernelServices: Record<string, unknown> = { auth, objectql };
    const services: Record<string, unknown> = {
        ...(mode === 'single'
            ? { auth, objectql }
            : {
                'env-registry': { resolveByHostname: async () => ({ environmentId: 'env-1' }) },
                'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async (name: string) => envKernelServices[name] }) },
            }),
        ...(protocol ? { protocol } : {}),
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
    // The stand-in control plane: a device code with both approval links, a
    // granted token, and a `/bind` that records the claim it was sent.
    const bindBodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        let body: unknown = { success: true, data: {} };
        if (path.endsWith('/device/code')) {
            body = {
                device_code: 'dc_1', user_code: 'ABCD-EFGH', interval: 5, expires_in: 600,
                verification_uri: `${CLOUD}/device`,
                verification_uri_complete: `${CLOUD}/device?user_code=ABCD-EFGH`,
            };
        } else if (path.endsWith('/device/token')) {
            body = { access_token: 'at_1' };
        } else if (path.endsWith('/cloud-connection/bind')) {
            bindBodies.push(JSON.parse(String(init?.body)));
            body = { success: true, data: { runtime_token: 'oscc_new', runtime_id: 'rt_1', connection: { runtime_id: 'rt_1' } } };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const plugin = new CloudConnectionPlugin({
        controlPlaneUrl: CLOUD,
        credentialPath: join(dir, 'cloud-connection.json'),
        ...(mode === 'single' ? { singleEnvironment: true, environmentId: 'env-1' } : {}),
    });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();

    /** `runtime_version` on each approval link `bind/start` answered with (`null` = no such parameter). */
    const approvalLinkVersions = async () => {
        const res = await routes.get(`POST ${CC}/bind/start`)!(makeC(`${CC}/bind/start`));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        const { verification_uri, verification_uri_complete } = res.payload.data;
        return [verification_uri, verification_uri_complete].map((uri: string) => new URL(uri).searchParams.get('runtime_version'));
    };
    /** The registration claim `bind/poll` sent the control plane's `/bind`. */
    const bindClaim = async () => {
        const res = await routes.get(`POST ${CC}/bind/poll`)!(makeC(`${CC}/bind/poll`, { device_code: 'dc_1' }));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(bindBodies, 'the control plane received exactly one bind').toHaveLength(1);
        return bindBodies[0];
    };
    return { plugin, approvalLinkVersions, bindClaim };
}

for (const mode of ['single', 'multi'] as const) {
    describe(`[#24150] runtime_version is the release discovery reports (${mode}-environment)`, () => {
        it('OS_RUNTIME_VERSION unset: both approval links carry the discovery release', async () => {
            const { plugin, approvalLinkVersions } = await mount(mode, 'real');
            const release = await discoveryRelease();
            // Not vacuous: discovery reports a real release, and it is not the
            // plugin's own version field (which the defect sent instead).
            expect(typeof release === 'string' && release.length > 0, String(release)).toBe(true);
            expect(release).not.toBe(plugin.version);

            expect(await approvalLinkVersions()).toEqual([release, release]);
        });

        it('OS_RUNTIME_VERSION unset: the bind claim sent to the control plane carries the discovery release', async () => {
            const { bindClaim } = await mount(mode, 'real');
            const release = await discoveryRelease();

            expect((await bindClaim()).runtime_version).toBe(release);
        });

        for (const discovery of ['real', 'none'] as const) {
            it(`CONTROL: a set OS_RUNTIME_VERSION is sent verbatim at both sites (discovery producer: ${discovery})`, async () => {
                const stamp = `stamp-24150-${mode}-${discovery}-not-a-release`;
                process.env.OS_RUNTIME_VERSION = stamp;
                const { approvalLinkVersions, bindClaim } = await mount(mode, discovery);

                expect(await approvalLinkVersions()).toEqual([stamp, stamp]);
                expect((await bindClaim()).runtime_version).toBe(stamp);
            });
        }

        for (const discovery of ['none', 'throws'] as const) {
            it(`no discovery read (${discovery === 'none' ? 'no protocol service' : 'the read throws'}): neither site sends a version`, async () => {
                const { approvalLinkVersions, bindClaim } = await mount(mode, discovery);

                expect(await approvalLinkVersions()).toEqual([null, null]);
                const claim = await bindClaim();
                expect('runtime_version' in claim, JSON.stringify(claim)).toBe(false);
            });
        }
    });
}
