// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, #28564] Step 1c'' of `POST /api/v1/marketplace/install-local`
 * — the `__c` extension-field reservation at the marketplace install, at the
 * dependency check's position, before the manifest service sees the artifact.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionFieldSuffix`,
 * the save door's own; its sentences are pinned in that package. What is
 * pinned here is the door:
 *
 *  - (a) a plain package declaring a `__c` field (in an extension or on its own
 *    object) and (b) a `.custom` pair's extension field without the suffix
 *    stop the install `422 VALIDATION_ERROR` (this door's existing body
 *    refusal), one row per field in `details.refusals`, before any write —
 *    nothing registered, no ledger entry;
 *  - each `packages[]` entry is judged under its own id;
 *  - the refusal comes before the install-mode judgement, so the `unmanaged`
 *    branch is refused too;
 *  - the pair's `region__c` and a vendor extension's plain field install.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin); its first load is paid here, at module
// top — never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { judgeExtensionFieldSuffix } from '@objectstack/metadata-protocol';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = 'POST /api/v1/marketplace/install-local';
const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.acme.partner';

const deps = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, '*']));

/** What each installed package holds, as the protocol's per-package listing answers it. */
type Holdings = Record<string, Record<string, Array<Record<string, unknown>>>>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/**
 * A kernel whose registry holds `installed` (BASE read-only — a code or
 * marketplace package is in `manifests`) and whose protocol lists `holdings`.
 */
function makeCtx(rawApp: any, installed: Array<{ id: string; dependencies?: Record<string, string> }>, holdings: Holdings) {
    const hooks = new Map<string, any>();
    const registered: any[] = [];
    const records = installed.map((p) => ({ manifest: { id: p.id, version: '1.0.0', ...(p.dependencies ? { dependencies: p.dependencies } : {}) } }));
    const services: Record<string, any> = {
        manifest: { register: (m: any) => registered.push({ manifest: m }) },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            syncSchemas: async () => undefined,
            manifests: new Map(installed.some((p) => p.id === BASE) ? [[BASE, {}]] : []),
            registry: {
                getAllPackages: () => [...records, ...registered],
                getPackage: (id: string) => records.find((r) => r.manifest.id === id),
            },
        }),
        protocol: {
            getMetaItems: async ({ type, packageId }: { type: string; packageId?: string }) => ({
                type,
                items: (holdings[packageId ?? '']?.[type] ?? []).map((i) => ({ ...i, _packageId: packageId })),
            }),
        },
        metadata: { get: async () => undefined },
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

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-ext-suffix-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const BASE_HOLDINGS: Holdings = {
    [BASE]: {
        dashboard: [{ name: 'crm_board', label: 'Board' }],
        object: [{ name: 'crm_account' }],
    },
};

async function install(
    manifest: Record<string, unknown>,
    installed: Array<{ id: string; dependencies?: Record<string, string> }> = [{ id: BASE }],
    holdings: Holdings = BASE_HOLDINGS,
    extraBody: Record<string, unknown> = {},
) {
    const rawApp = makeRawApp();
    const k = makeCtx(rawApp, installed, holdings);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(k.ctx as any);
    await k.fire();
    const res = await rawApp.routes.get(ROUTE)!(makeC({ manifest, ...extraBody }));
    const registered = k.registered.map((r) => r.manifest.id).filter((id) => id === manifest.id);
    return { res, registered, ledger: readdirSync(dir) };
}

const extension = (field: string) => ({ extend: 'crm_account', fields: { [field]: { type: 'text', label: 'Region' } } });

/** The refusal this file pins: the door's envelope and code, every field located, nothing written. */
function expectRefused(out: Awaited<ReturnType<typeof install>>, expected: ReturnType<typeof judgeExtensionFieldSuffix>) {
    expect(out.res.status, JSON.stringify(out.res.payload)).toBe(422);
    expect(out.res.payload?.success).toBe(false);
    expect(out.res.payload?.error?.code).toBe('VALIDATION_ERROR');
    expect(out.res.payload.error.details.refusals).toEqual(expected);
    expect(out.res.payload.error.message).toContain(expected[0]!.message);
    expect(out.res.payload.error.message).toContain('Nothing was installed or written.');
    expect(out.registered).toEqual([]);
    expect(out.ledger).toEqual([]);
}

describe("install-local 1c'' — the `__c` extension-field reservation at the marketplace install (ADR-0146 D10)", () => {
    it('(a) a plain package extending the base with `region__c` is refused 422; nothing is registered, no ledger entry', async () => {
        const manifest = { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region__c')] };
        expectRefused(await install(manifest), judgeExtensionFieldSuffix({ packageId: PARTNER, objectExtensions: manifest.objectExtensions }));
    });

    it('(a) a plain package\'s own object carrying `region__c` is refused', async () => {
        const objects = [{ name: 'partner_lead', label: 'Lead', fields: { region__c: { type: 'text' } } }];
        const out = await install({ id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objects });
        expectRefused(out, judgeExtensionFieldSuffix({ packageId: PARTNER, objects }));
        expect(out.res.payload.error.details.refusals[0].rule).toBe('reserved_outside_pair');
    });

    it('(b) the `.custom` pair extending the base with a plain `region` is refused 422', async () => {
        const manifest = { id: PAIR, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region')] };
        const out = await install(manifest);
        expectRefused(out, judgeExtensionFieldSuffix({ packageId: PAIR, objectExtensions: manifest.objectExtensions }));
        expect(out.res.payload.error.details.refusals[0].rule).toBe('unsuffixed_in_pair');
    });

    it('a `packages[]` artifact: each entry is judged under its own id', async () => {
        const out = await install({
            id: 'com.acme.bundle', version: '1.0.0',
            packages: [
                { manifest: { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('tier')] } },
                { manifest: { id: PAIR, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region')] } },
            ],
        });
        expect(out.res.status, JSON.stringify(out.res.payload)).toBe(422);
        expect(out.res.payload.error.details.refusals.map((r: any) => [r.packageId, r.path, r.rule])).toEqual([
            [PAIR, 'objectExtensions[0].fields.region', 'unsuffixed_in_pair'],
        ]);
        expect(out.registered).toEqual([]);
        expect(out.ledger).toEqual([]);
    });

    it('is asked before the install-mode judgement, so an `unmanaged` request is refused by it too', async () => {
        const manifest = { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region__c')] };
        expectRefused(
            await install(manifest, undefined, undefined, { installMode: 'unmanaged' }),
            judgeExtensionFieldSuffix({ packageId: PARTNER, objectExtensions: manifest.objectExtensions }),
        );
    });

    it('CONTROL: the `.custom` pair\'s extension field `region__c` installs, and so does a vendor extension\'s plain field', async () => {
        const pair = await install({ id: PAIR, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region__c')] });
        expect(pair.res.status, JSON.stringify(pair.res.payload)).toBe(200);
        expect(pair.registered).toEqual([PAIR]);

        const vendor = await install({ id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension('region')] });
        expect(vendor.res.status, JSON.stringify(vendor.res.payload)).toBe(200);
        expect(vendor.registered).toEqual([PARTNER]);
    });
});
