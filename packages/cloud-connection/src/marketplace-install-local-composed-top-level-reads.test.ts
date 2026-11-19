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
 *
 * [#34431] The same holds for the datasources and objects the install, the
 * upgrade and the rehydrate hand `connectPackageDatasources`, for the
 * datasource names step 2a judges against held names, and for the connectors
 * whose credentials the install answer names: a composed bundle and the flat
 * control carrying the same declarations hand the runtime the same lists and
 * answer the same `datasources` and `credentialRefs`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * [#34431] What the runtime's datasource path is handed, one entry per call:
 * the datasource names, the object names, each datasource's owner and whether
 * the call was an installed one.
 */
const connectCalls = vi.hoisted(() => [] as Array<{ datasources: string[]; objects: string[]; owners: string[]; installed: boolean }>);
/** [#34431] The datasource names another holder owns, as the runtime's judge answers them. */
const heldDatasources = vi.hoisted(() => new Map<string, string>());

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        // [#34613] The stored-seed funnel the plugin calls; it ends in `load`.
        async loadStored() { return this.load(); }
        async load() { return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] }; }
        async buildDependencyGraph(objects: string[]) { return { objects }; }
    },
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
    connectPackageDatasources: async (_ctx: unknown, options: any) => {
        connectCalls.push({
            datasources: options.datasources.map((d: any) => d.name),
            objects: options.objects.map((o: any) => o.name),
            owners: options.owned.map((o: any) => o.owner.packageId),
            installed: options.installed === true,
        });
        return options.datasources.map((d: any) => ({ name: d.name, status: 'connected' }));
    },
    datasourceNameHolder: async (_ctx: unknown, _appId: string, name: string) =>
        heldDatasources.has(name) ? { status: 'held', holder: heldDatasources.get(name) } : { status: 'free' },
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
        // [#34431] Every credential reference is unset: the install answer names each one.
        automation: { listConnectorCredentialRefs: async () => [] },
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
    connectCalls.length = 0;
    heldDatasources.clear();
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

// ── [#34431] Datasources and connectors ────────────────────────────────────

const ERP_DB = { name: 'erp_db', driver: 'memory', config: {} };
const WMS_DB = { name: 'wms_db', driver: 'memory', config: {} };
const ERP_API = { name: 'erp_api', label: 'ERP API', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://erp.example.test' }, auth: { type: 'bearer', credentialRef: 'ERP_TOKEN' } };
const WMS_API = { name: 'wms_api', label: 'WMS API', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://wms.example.test' }, auth: { type: 'bearer', credentialRef: 'WMS_TOKEN' } };

const sourceBody = (
    id: string,
    version: string,
    object: Record<string, unknown>,
    datasources: unknown[],
    connectors: unknown[],
    dependencies?: Record<string, string>,
) => ({
    manifest: {
        id,
        name: id,
        version,
        type: 'module',
        ...(dependencies ? { dependencies } : {}),
        objects: [object],
        datasources,
        connectors,
    },
});

/**
 * A composed artifact whose package bodies each declare a datasource and a
 * connector, with no top-level `datasources`, `connectors` or `objects`. The
 * order module is listed FIRST and depends on the core one, so package order
 * (core, then orders) is not array order.
 */
const composedSources = (version = '2.0.0', extra: Record<string, unknown> = {}) => ({
    id: SUITE,
    name: 'Suite',
    version,
    type: 'app',
    packages: [
        sourceBody(`${SUITE}.o2c`, version, ORDER, [WMS_DB], [WMS_API], { [`${SUITE}.core`]: '*' }),
        sourceBody(`${SUITE}.core`, version, ACCOUNT, [ERP_DB], [ERP_API]),
    ],
    ...extra,
});

/** The flat control: the same declarations at the top level, in package order. */
const flatSources = (version = '2.0.0') => ({
    id: SUITE,
    name: 'Suite',
    version,
    type: 'app',
    objects: [ACCOUNT, ORDER],
    datasources: [ERP_DB, WMS_DB],
    connectors: [ERP_API, WMS_API],
});

const CONNECTED = [{ name: 'erp_db', status: 'connected' }, { name: 'wms_db', status: 'connected' }];
const HANDED = { datasources: ['erp_db', 'wms_db'], objects: ['crm_account', 'crm_order'], owners: [SUITE, SUITE], installed: true };

describe('[#34431] a composed bundle: install connects every package body\'s datasources, in package order', () => {
    it('install hands connectPackageDatasources every body\'s datasources and objects, core first, and the answer lists them', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ manifest: composedSources() });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(connectCalls).toEqual([HANDED]);
        expect(res.payload.data.datasources).toEqual(CONNECTED);
    });

    it('a composed bundle and its flat control answer the same datasources and hand connectPackageDatasources the same lists', async () => {
        const composedRt = await boot(dir);
        const composedRes = await composedRt.install({ manifest: composedSources() });
        const composedCalls = connectCalls.splice(0);

        const flatDir = mkdtempSync(join(tmpdir(), 'mil-composed-reads-flat-'));
        try {
            const flatRt = await boot(flatDir);
            const flatRes = await flatRt.install({ manifest: flatSources() });
            expect(flatRes.status, JSON.stringify(flatRes.payload)).toBe(200);
            expect(composedRes.status, JSON.stringify(composedRes.payload)).toBe(200);
            expect(composedCalls).toEqual(connectCalls);
            expect(composedRes.payload.data.datasources).toEqual(flatRes.payload.data.datasources);
            expect(composedRes.payload.data.credentialRefs).toEqual(flatRes.payload.data.credentialRefs);
        } finally {
            rmSync(flatDir, { recursive: true, force: true });
        }
    });

    it('an upgrade connects the new version\'s datasources across every body', async () => {
        const rt = await boot(dir);
        expect((await rt.install({ manifest: composedSources('2.0.0') })).status).toBe(200);
        connectCalls.length = 0;

        const res = await rt.install({ manifest: composedSources('2.1.0') });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(connectCalls).toEqual([HANDED]);
        expect(res.payload.data.datasources).toEqual(CONNECTED);
    });

    it('a restart\'s rehydrate connects them again from the ledger', async () => {
        const first = await boot(dir);
        expect((await first.install({ manifest: composedSources() })).status).toBe(200);
        connectCalls.length = 0;

        await boot(dir);
        expect(connectCalls).toEqual([HANDED]);
    });

    it('the answer names the connector credentials every package body declares', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ manifest: composedSources() });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.credentialRefs).toEqual([
            { ref: 'ERP_TOKEN', connectors: ['erp_api'], status: 'missing', source: null },
            { ref: 'WMS_TOKEN', connectors: ['wms_api'], status: 'missing', source: null },
        ]);
    });

    it('control: a composed artifact that still carries its flattened top-level datasources connects that union once', async () => {
        const rt = await boot(dir);
        const res = await rt.install({
            manifest: composedSources('2.0.0', { objects: [ACCOUNT, ORDER], datasources: [ERP_DB, WMS_DB] }),
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(connectCalls).toEqual([HANDED]);
        expect(res.payload.data.datasources).toEqual(CONNECTED);
    });
});

describe('[#34431] step 2a judges a composed body\'s datasource names as a flat bundle\'s', () => {
    it('a name another holder owns, declared by a package body, refuses the install 409 before any write', async () => {
        heldDatasources.set('wms_db', "the datasource 'wms_db' created in Setup");
        const rt = await boot(dir);

        const res = await rt.install({ manifest: composedSources() });

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details).toEqual({ datasource: 'wms_db' });
        expect(new LocalManifestSource(dir).read(SUITE).entry).toBeNull();
        expect(connectCalls).toEqual([]);
    });

    it('control: the flat bundle declaring the same name is refused the same way', async () => {
        heldDatasources.set('wms_db', "the datasource 'wms_db' created in Setup");
        const rt = await boot(dir);

        const res = await rt.install({ manifest: flatSources() });

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details).toEqual({ datasource: 'wms_db' });
    });
});
