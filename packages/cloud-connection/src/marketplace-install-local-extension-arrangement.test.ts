// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] Step 1c-arrangement of `POST /api/v1/marketplace/install-local`
 * — an extended object's whole arrangement is the paired `.custom` package's,
 * judged at the marketplace install beside the `__c` reservation, before the
 * manifest service sees the artifact.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionArrangement`,
 * the save door's own; its sentence is pinned in that package. What is pinned
 * here is the door:
 *
 *  - a plain package whose extension writes `fieldGroups` (or `relatedLists`)
 *    stops the install `422 VALIDATION_ERROR` (this door's existing body
 *    refusal), one row per key in `details.refusals`, prescribing `place`,
 *    before any write: nothing registered, no ledger entry;
 *  - each `packages[]` entry is judged under its own id;
 *  - the refusal comes before the install-mode judgement;
 *  - the `.custom` pair's arrangement installs (into its writable pair), and
 *    so does a vendor extension that places what it brings with `place`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin); its first load is paid here, at module
// top — never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { judgeExtensionArrangement } from '@objectstack/metadata-protocol';
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
    const saved: Array<[string, string]> = [];
    // [ADR-0146 D3] BASE declares the namespace its pair's is derived from,
    // as `customizationPairManifestRefusal` reads it.
    const records = installed.map((p) => ({
        manifest: { id: p.id, version: '1.0.0', ...(p.id === BASE ? { namespace: 'crm' } : {}), ...(p.dependencies ? { dependencies: p.dependencies } : {}) },
    }));
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
            // [ADR-0146 D3] The pair's doors: a pair is installed into its
            // writable pair, each item through the save door.
            ensureCustomizationPackage: async () => ({ packageId: PAIR, created: true, writable: true }),
            saveMetaItem: async ({ type, name }: { type: string; name: string }) => { saved.push([type, name]); return { success: true }; },
            deletePackage: async () => ({ success: true, deletedCount: 0, failedCount: 0 }),
        },
        metadata: { get: async () => undefined },
    };
    return {
        registered,
        saved,
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
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-ext-arrangement-')); });
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
    return { res, registered, saved: k.saved, ledger: readdirSync(dir) };
}

const GROUPS = [{ key: 'basic', label: 'Basics', fields: ['name', 'region__c'] }];
const TABS = ['crm_contact', { list: 'crm_task', hidden: true }];

const extension = (extra: Record<string, unknown>) => ({ extend: 'crm_account', ...extra });

/** The refusal this file pins: the door's envelope and code, every key located, nothing written. */
function expectRefused(out: Awaited<ReturnType<typeof install>>, expected: ReturnType<typeof judgeExtensionArrangement>) {
    expect(expected.length).toBeGreaterThan(0);
    expect(out.res.status, JSON.stringify(out.res.payload)).toBe(422);
    expect(out.res.payload?.success).toBe(false);
    expect(out.res.payload?.error?.code).toBe('VALIDATION_ERROR');
    expect(out.res.payload.error.details.refusals).toEqual(expected);
    expect(out.res.payload.error.message).toContain(expected[0]!.message);
    expect(out.res.payload.error.message).toContain('`place`');
    expect(out.res.payload.error.message).toContain('Nothing was installed or written.');
    expect(out.registered).toEqual([]);
    expect(out.ledger).toEqual([]);
}

describe('install-local 1c-arrangement — an extended object\'s arrangement is the `.custom` pair\'s (ADR-0146 D10)', () => {
    it('a plain package whose extension writes `fieldGroups` is refused 422, once, prescribing `place`; nothing is registered', async () => {
        const manifest = { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension({ fieldGroups: GROUPS })] };
        const out = await install(manifest);
        expectRefused(out, judgeExtensionArrangement({ packageId: PARTNER, objectExtensions: manifest.objectExtensions }));
        expect(out.res.payload.error.details.refusals.map((r: any) => [r.packageId, r.path, r.key])).toEqual([
            [PARTNER, 'objectExtensions[0].fieldGroups', 'fieldGroups'],
        ]);
    });

    it('a plain package whose extension writes `relatedLists` is refused too, and both keys are one row each', async () => {
        const manifest = { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension({ fieldGroups: GROUPS, relatedLists: TABS })] };
        const out = await install(manifest);
        expectRefused(out, judgeExtensionArrangement({ packageId: PARTNER, objectExtensions: manifest.objectExtensions }));
        expect(out.res.payload.error.details.refusals.map((r: any) => r.key)).toEqual(['fieldGroups', 'relatedLists']);
    });

    it('a `packages[]` artifact: each entry is judged under its own id', async () => {
        const out = await install({
            id: 'com.acme.bundle', version: '1.0.0',
            packages: [
                { manifest: { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension({ relatedLists: TABS })] } },
                { manifest: { id: PAIR, version: '1.0.0', namespace: 'crm_custom', dependencies: deps(BASE), objectExtensions: [extension({ relatedLists: TABS })] } },
            ],
        });
        expect(out.res.status, JSON.stringify(out.res.payload)).toBe(422);
        expect(out.res.payload.error.details.refusals.map((r: any) => [r.packageId, r.path])).toEqual([
            [PARTNER, 'objectExtensions[0].relatedLists'],
        ]);
        expect(out.registered).toEqual([]);
        expect(out.ledger).toEqual([]);
    });

    it('is asked before the install-mode judgement, so an `unmanaged` request is refused by it too', async () => {
        const manifest = { id: PARTNER, version: '1.0.0', dependencies: deps(BASE), objectExtensions: [extension({ fieldGroups: GROUPS })] };
        expectRefused(
            await install(manifest, undefined, undefined, { installMode: 'unmanaged' }),
            judgeExtensionArrangement({ packageId: PARTNER, objectExtensions: manifest.objectExtensions }),
        );
    });

    it('CONTROL: the `.custom` pair\'s arrangement installs, and so does a vendor extension that places with `place`', async () => {
        const pair = await install({
            id: PAIR, version: '1.0.0', namespace: 'crm_custom', dependencies: deps(BASE),
            objectExtensions: [extension({ fields: { region__c: { type: 'text', label: 'Region' } }, fieldGroups: GROUPS, relatedLists: TABS })],
        });
        expect(pair.res.status, JSON.stringify(pair.res.payload)).toBe(200);
        // [ADR-0146 D3] Into its writable pair, through the save door.
        expect(pair.registered).toEqual([]);
        expect(pair.saved).toEqual([['object_extension', 'crm_account']]);

        const vendor = await install({
            id: PARTNER, version: '1.0.0', dependencies: deps(BASE),
            objectExtensions: [extension({ fields: { tier: { type: 'text', label: 'Tier' } }, place: [{ field: 'tier', group: 'basic' }] })],
        });
        expect(vendor.res.status, JSON.stringify(vendor.res.payload)).toBe(200);
        expect(vendor.registered).toEqual([PARTNER]);
    });
});
