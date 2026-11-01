// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28143] Step 2a of `POST /api/v1/marketplace/install-local` — a package
 * declaring a datasource name another holder owns is refused before any write
 * — judges with the runtime's ONE judge (`datasourceNameHolder`), and so:
 *
 *  - a holder the metadata registry cannot be read for is `503
 *    SERVICE_UNAVAILABLE`, never taken for "no holder": the install does not
 *    proceed past an outage;
 *  - a datasource registered on the data engine only (the legacy `onEnable`
 *    bridge, with no metadata item) holds its name: `409 RESOURCE_CONFLICT`,
 *    where the door used to install and answer that pool `already-registered`.
 *
 * Each refusal leaves the runtime as it found it: no ledger entry, nothing
 * registered. The end-to-end refusals (the boot's datasource, the host's
 * `default`) are pinned by `install-local-declared-datasources.dogfood.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The install and its 2a judge reach `@objectstack/runtime` through a lazy
// `import()`; its first load is paid here, at module top — never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = 'POST /api/v1/marketplace/install-local';
const DS = 'qah_store';

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/** A kernel whose metadata registry and data engine the case shapes. */
function makeCtx(rawApp: any, opts: { metadataFault?: boolean; engineDrivers?: string[] }) {
    const hooks = new Map<string, any>();
    const registered: any[] = [];
    const drivers = new Set(opts.engineDrivers ?? []);
    const services: Record<string, any> = {
        manifest: { register: (m: any) => registered.push({ manifest: m }) },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            syncSchemas: async () => undefined,
            registry: { getAllPackages: () => registered },
            getDriverByName: (name: string) => (drivers.has(name) ? { name } : undefined),
        }),
        metadata: {
            get: async () => {
                if (opts.metadataFault) throw new Error('metadata loader unavailable');
                return undefined;
            },
        },
    };
    return {
        registered,
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            registerService: (name: string, svc: unknown) => { services[name] = svc; },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return { req: { url: 'http://localhost:3000/x', raw: new Request('http://localhost:3000/x'), json: async () => body, param: () => undefined }, json };
}

const BODY = {
    manifest: {
        id: 'com.example.qah',
        version: '1.0.0',
        datasources: [{ name: DS, label: 'QA store', driver: 'sqlite', config: { filename: ':memory:' } }],
        objects: [],
    },
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-ds-holder-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function install(opts: { metadataFault?: boolean; engineDrivers?: string[] }) {
    const rawApp = makeRawApp();
    const k = makeCtx(rawApp, opts);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(k.ctx as any);
    await k.fire();
    const res = await rawApp.routes.get(ROUTE)!(makeC(BODY));
    // The plugin registers its own Installed Apps UI manifest at start; only
    // the package's registration is this case's.
    const registered = k.registered.map((r) => r.manifest.id).filter((id) => id === 'com.example.qah');
    return { res, registered, ledger: readdirSync(dir) };
}

describe('install-local 2a — who holds a declared datasource name', () => {
    it('a holder that cannot be read refuses 503, and nothing is written', async () => {
        const { res, registered, ledger } = await install({ metadataFault: true });
        expect(res.status).toBe(503);
        expect(res.payload?.error?.code).toBe('SERVICE_UNAVAILABLE');
        expect(res.payload?.error?.details).toEqual({ datasource: DS, reading: 'the metadata registry' });
        expect(registered).toEqual([]);
        expect(ledger).toEqual([]);
    });

    it('a datasource registered on the engine only holds its name: 409, and nothing is written', async () => {
        const { res, registered, ledger } = await install({ engineDrivers: [DS] });
        expect(res.status).toBe(409);
        expect(res.payload?.error?.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload?.error?.details).toEqual({ datasource: DS });
        expect(registered).toEqual([]);
        expect(ledger).toEqual([]);
    });

    it('CONTROL: a name nobody holds installs', async () => {
        const { res, registered } = await install({ engineDrivers: ['someone_else'] });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload?.success).toBe(true);
        expect(registered).toEqual(['com.example.qah']);
    });
});
