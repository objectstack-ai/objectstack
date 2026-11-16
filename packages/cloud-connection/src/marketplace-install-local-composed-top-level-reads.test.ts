// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34407, ADR-0130 D4] The translations and the ADR-0120 D5e global-unique
 * ceremony of a COMPOSED bundle read every package body, not the top level
 * alone.
 *
 * A multi-package `dist/objectstack.json` carries `packages[]`, one assembled
 * body per package, and no flattened `translations` or `objects` beside it.
 * Two readers of install-local read only the top level:
 *
 * - the side effects' translation step answered `translationsLoaded: 0`, so a
 *   composed app's labels never reached the i18n service (zh-CN users read the
 *   source language);
 * - the `isolated`-posture ceremony collected the installation-wide uniques of
 *   the top-level `objects` only, so a composed app's `unique: 'global'`
 *   installed with no question asked and no attestation recorded.
 *
 * Both now read through `resolveStackCollection`, the reader the seed datasets
 * use (`marketplace-install-local-composed-bundle-seeds.test.ts`): the
 * top-level list when the body carries one, otherwise every package body's, in
 * the artifact's package order. The controls pin that a flat bundle reads its
 * own top-level list unchanged, and that a composed artifact which still
 * carries its flattened union reads it once, never once more per package.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load() { return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] }; }
        async buildDependencyGraph(objects: string[]) { return { objects }; }
    },
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const SUITE = 'com.example.suite';

const CORE_ZH = { 'zh-CN': { objects: { crm_account: { label: '客户' } } } };
const O2C_ZH = { 'zh-CN': { objects: { crm_order: { label: '订单' } } }, 'ja-JP': { objects: { crm_order: { label: '注文' } } } };

const body = (id: string, version: string, object: Record<string, unknown>, translations: unknown[], dependencies?: Record<string, string>) => ({
    manifest: {
        id,
        name: id,
        version,
        type: 'module',
        ...(dependencies ? { dependencies } : {}),
        objects: [object],
        translations,
    },
});

const ACCOUNT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' }, tax_id: { type: 'text', label: 'Tax ID', unique: 'global' } } };
const ORDER = {
    name: 'crm_order',
    label: 'Order',
    fields: { name: { type: 'text', label: 'Name', unique: true } },
    indexes: [{ name: 'uk_order_ext', fields: ['external_id'], unique: 'global' }],
};
/** The installation-wide uniques the two package bodies declare, core first. */
const COMPOSED_FINDINGS = ['crm_account:field:tax_id', 'crm_order:index:external_id'];

/**
 * A composed artifact: `packages[]` and no top-level `translations` or
 * `objects`. The order module is listed FIRST and depends on the core one, so
 * the artifact's package order (core, then orders) is not its array order.
 */
const composed = (version = '6.3.0') => ({
    id: SUITE,
    name: 'Suite',
    version,
    type: 'app',
    packages: [
        body(`${SUITE}.o2c`, version, ORDER, [O2C_ZH], { [`${SUITE}.core`]: '*' }),
        body(`${SUITE}.core`, version, ACCOUNT, [CORE_ZH]),
    ],
});

const FLAT = {
    id: 'com.example.flat',
    version: '1.0.0',
    objects: [ACCOUNT],
    translations: [CORE_ZH],
};

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(reqBody: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => reqBody,
            param: () => undefined,
            header: () => undefined,
            query: () => undefined,
        },
        json,
    };
}

/** One runtime over the ledger directory: a fresh plugin, booted through `kernel:ready`. */
async function boot(dir: string) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    /** Every bundle the i18n service was handed, as `locale:labels`, in order. */
    const loaded: string[] = [];
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
        metadata: {},
        i18n: {
            loadTranslations: (locale: string, data: any) => {
                const labels = Object.values(data?.objects ?? {}).map((o: any) => o.label).join('|');
                loaded.push(`${locale}:${labels}`);
            },
        },
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        registerService: (name: string, svc: unknown) => { services[name] = svc; },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    return {
        install: (reqBody: Record<string, unknown>) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(reqBody)),
        loaded,
        ctx,
    };
}

let dir: string;
let posture: string | undefined;
let restoreOwner: () => void;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-composed-reads-'));
    posture = process.env.OS_TENANCY_POSTURE;
    // The request carries no organization, and the ceremony runs walled: the
    // installer is the deployment's declared platform owner.
    restoreOwner = declareInstallerPlatformOwner('admin');
});
afterEach(() => {
    restoreOwner();
    rmSync(dir, { recursive: true, force: true });
    if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = posture;
    vi.restoreAllMocks();
});

describe('a composed bundle: the side effects load every package body\'s translations, in package order', () => {
    it('install loads each package body\'s locale bundles, core before the module that depends on it', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ manifest: composed() });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.translationsLoaded).toBe(3);
        expect(rt.loaded).toEqual(['zh-CN:客户', 'zh-CN:订单', 'ja-JP:注文']);
    });

    it('a restart loads them again from the ledger', async () => {
        const first = await boot(dir);
        expect((await first.install({ manifest: composed() })).status).toBe(200);

        const restarted = await boot(dir);
        expect(restarted.loaded).toEqual(['zh-CN:客户', 'zh-CN:订单', 'ja-JP:注文']);
    });
});

describe('controls: a body that carries top-level translations reads that list, once', () => {
    it('a flat bundle loads its top-level translations, unchanged', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ manifest: FLAT });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.translationsLoaded).toBe(1);
        expect(rt.loaded).toEqual(['zh-CN:客户']);
    });

    it('a composed artifact that still carries its flattened top-level translations loads that union once, never per package as well', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ manifest: { ...composed(), translations: [CORE_ZH, O2C_ZH] } });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.translationsLoaded).toBe(3);
        expect(rt.loaded).toEqual(['zh-CN:客户', 'zh-CN:订单', 'ja-JP:注文']);
    });
});

describe("ADR-0120 D5e — a composed bundle installed into an 'isolated' environment", () => {
    it('stops on the installation-wide uniques every package body declares, core first', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const rt = await boot(dir);

        const res = await rt.install({ manifest: composed() });

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.error.code).toBe('UNIQUE_SCOPE_CONFIRMATION_REQUIRED');
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(COMPOSED_FINDINGS);
        expect(new LocalManifestSource(dir).read(SUITE).entry).toBeNull();
    });

    it('confirming records the attestation for every package body\'s uniques and installs', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const rt = await boot(dir);

        const res = await rt.install({ manifest: composed(), confirmGlobalUniques: true });

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(new LocalManifestSource(dir).read(SUITE).entry!.globalUniqueAttestation).toMatchObject({
            posture: 'isolated',
            confirmed: COMPOSED_FINDINGS.slice().sort(),
        });
    });

    it('control: a composed artifact that still carries its flattened top-level objects lists each unique once', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const rt = await boot(dir);

        const res = await rt.install({ manifest: { ...composed(), objects: [ACCOUNT, ORDER] } });

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(COMPOSED_FINDINGS);
    });

    it('a composed artifact whose packages the resolver refuses is answered with that refusal, and nothing is written', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const rt = await boot(dir);

        const res = await rt.install({ manifest: { ...composed(), packages: 'not-a-list' } });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGES');
        expect(new LocalManifestSource(dir).read(SUITE).entry).toBeNull();
    });
});
