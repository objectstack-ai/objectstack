// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34336, ADR-0130 D4] The seed datasets of a COMPOSED bundle reach every
 * seed door of install-local.
 *
 * A multi-package `dist/objectstack.json` carries `packages[]`, one assembled
 * body per package, and no flattened `data` beside it: the seed datasets sit
 * in each package body. Every door of this plugin that reads seed datasets
 * read the top-level `data` alone, so a composed bundle installed, reseeded,
 * upgraded, purged, counted and rehydrated as a package with no sample data
 * ("no-datasets"). Each door now reads them through one reader,
 * `resolveStackCollection(body, 'data')`: the top-level list when the body
 * carries one, otherwise every package body's, in the artifact's package
 * order (dependency-topological, the order the packages register in).
 *
 * The flat-bundle control pins that a body with a top-level `data` reads
 * exactly that list, and the composed control that a composed artifact which
 * still carries a flattened top-level `data` reads it once, never twice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeedLoaderRequestSchema } from '@objectstack/spec/data';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Every request the (mocked) seed loader was handed, in order. */
let loadCalls: any[] = [];
let seedResult: any;

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        // [#34613] The real `loadStored` parses the stored request and hands it to `load`;
        // the stand-in keeps that funnel, so the request `load` records is the parsed one.
        async loadStored(raw: any) {
            return this.load(SeedLoaderRequestSchema.parse(raw));
        }
        async load(request: any) { loadCalls.push(request); return seedResult; }
        async buildDependencyGraph(objects: string[]) { return { objects }; }
    },
    // The locale is not this suite's subject (marketplace-install-local-seed-replayer.test.ts pins it).
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
}));
// Only the seed-request parse is stubbed; every other export stays the real one.
vi.mock('@objectstack/spec/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@objectstack/spec/data')>()),
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));
// The purge, the count and the listing's row match: what each door was handed.
const purgeCalls: any[] = [];
const countCalls: any[] = [];
const matchCalls: any[] = [];
vi.mock('./marketplace-install-local-purge.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./marketplace-install-local-purge.js')>()),
    purgeSeedRows: async (args: any) => { purgeCalls.push(args); return { deleted: 1, skipped: 0, errors: [] }; },
    countSeedRows: async (args: any) => { countCalls.push(args); return { count: 1, unidentified: 0 }; },
    matchSeedRows: async (args: any) => { matchCalls.push(args); return { rows: [{ id: 'r1' }] }; },
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const SUITE = 'com.example.suite';

const CORE_DATA = { object: 'crm_account', records: [{ name: '华东客户' }, { name: '华南客户' }] };
const O2C_DATA = { object: 'crm_order', records: [{ name: 'SO-0001' }] };
const PSA_DATA = { object: 'crm_project', records: [{ name: 'PRJ-0001' }] };

const body = (id: string, version: string, object: string, data: unknown, dependencies?: Record<string, string>) => ({
    manifest: {
        id,
        name: id,
        version,
        type: 'module',
        ...(dependencies ? { dependencies } : {}),
        objects: [{ name: object, label: object, fields: { name: { type: 'text', label: 'Name' } } }],
        data: [data],
    },
});

/**
 * A composed artifact: `packages[]` and no top-level `data`. The order module
 * is listed FIRST and depends on the core one, so the artifact's package order
 * (core, then orders) is not its array order.
 */
const composed = (version: string, withPsa = false) => ({
    id: SUITE,
    name: 'Suite',
    version,
    type: 'app',
    packages: [
        body(`${SUITE}.o2c`, version, 'crm_order', O2C_DATA, { [`${SUITE}.core`]: '*' }),
        body(`${SUITE}.core`, version, 'crm_account', CORE_DATA),
        ...(withPsa ? [body(`${SUITE}.psa`, version, 'crm_project', PSA_DATA, { [`${SUITE}.core`]: '*' })] : []),
    ],
});

const FLAT = {
    id: 'com.example.flat',
    version: '1.0.0',
    objects: [{ name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }],
    data: [CORE_DATA],
};

/** What a dataset list comes to, by object and record names: the reader's answer, not the parse's defaults. */
const shape = (datasets: any[] | undefined) =>
    (datasets ?? []).map((d: any) => `${d.object}:${(d.records ?? []).map((r: any) => r.name).join('|')}`);
const CORE = shape([CORE_DATA])[0];
const O2C = shape([O2C_DATA])[0];
const PSA = shape([PSA_DATA])[0];

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(reqBody: any, manifestId?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => reqBody,
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
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
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
        metadata: {},
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
    const route = (key: string) => rawApp.routes.get(key)!;
    return {
        install: (manifest: unknown) => route(`POST ${ROUTE}`)(makeC({ manifest })),
        reseed: (id: string) => route(`POST ${ROUTE}/:manifestId/reseed-sample-data`)(makeC({}, id)),
        purge: (id: string) => route(`POST ${ROUTE}/:manifestId/purge-sample-data`)(makeC({}, id)),
        count: (id: string) => route(`GET ${ROUTE}/:manifestId/sample-data`)(makeC({}, id)),
        list: () => route(`GET ${ROUTE}`)(makeC({})),
        uninstall: (id: string) => route(`DELETE ${ROUTE}/:manifestId`)(makeC({}, id)),
        /** The kernel's shared `seed-datasets` list — what the per-organization replay seeds a new organization from. */
        sharedSeedDatasets: () => services['seed-datasets'] as any[] | undefined,
    };
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-composed-seeds-'));
    loadCalls = [];
    purgeCalls.length = 0;
    countCalls.length = 0;
    matchCalls.length = 0;
    seedResult = { summary: { totalInserted: 3, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('a composed bundle: every seed door reads each package body, in package order', () => {
    it('install seeds every package body\'s datasets, core before the module that depends on it, and shares them for new organizations', async () => {
        const rt = await boot(dir);
        const res = await rt.install(composed('6.3.0'));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 3 });
        expect(loadCalls).toHaveLength(1);
        expect(shape(loadCalls[0].seeds)).toEqual([CORE, O2C]);
        expect(shape(rt.sharedSeedDatasets())).toEqual([CORE, O2C]);
    });

    it('reseed loads them again', async () => {
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);
        loadCalls = [];
        const res = await rt.reseed(SUITE);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data).toMatchObject({ manifestId: SUITE, inserted: 3, withSampleData: true });
        expect(shape(loadCalls[0].seeds)).toEqual([CORE, O2C]);
    });

    it('an upgrade that adds a package seeds the incoming version\'s datasets, the added package\'s included', async () => {
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);
        loadCalls = [];
        const res = await rt.install(composed('6.4.0', true));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.upgradedFrom).toBe('previous-marketplace-version');
        expect(shape(loadCalls[0].seeds)).toEqual(expect.arrayContaining([CORE, O2C, PSA]));
        expect(shape(loadCalls[0].seeds)).toHaveLength(3);
        // Package order: the core body before both modules that depend on it.
        expect(shape(loadCalls[0].seeds)[0]).toBe(CORE);
    });

    it('the sample-data count and the purge match the rows of every package body', async () => {
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);

        const counted = await rt.count(SUITE);
        expect(counted.status, JSON.stringify(counted.payload)).toBe(200);
        expect(counted.payload.data).toEqual({ manifestId: SUITE, count: 1, unidentified: 0 });
        expect(shape(countCalls[0].datasets)).toEqual([CORE, O2C]);

        const purged = await rt.purge(SUITE);
        expect(purged.status, JSON.stringify(purged.payload)).toBe(200);
        expect(shape(purgeCalls[0].datasets)).toEqual([CORE, O2C]);
    });

    it('the installed-apps listing reads the package\'s sample data from every package body', async () => {
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);
        const res = await rt.list();
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        const entry = res.payload.data.items.find((e: any) => e.manifestId === SUITE);
        expect(shape(matchCalls[0]?.datasets)).toEqual([CORE, O2C]);
        expect(entry?.withSampleData).toBe(true);
    });

    it('a restart shares them for new organizations and heals an empty database from them', async () => {
        const first = await boot(dir);
        expect((await first.install(composed('6.3.0'))).status).toBe(200);
        loadCalls = [];

        const restarted = await boot(dir);
        expect(shape(restarted.sharedSeedDatasets())).toEqual([CORE, O2C]);
        // Single-tenant, every seeded object empty: the heal seeds the package bodies.
        expect(loadCalls).toHaveLength(1);
        expect(shape(loadCalls[0].seeds)).toEqual([CORE, O2C]);
    });
});

describe('#35375 — uninstalling a composed bundle takes every package body\'s datasets off the shared list', () => {
    it('the entry\'s uninstall withdraws the sets it merged for all its package bodies, and keeps another package\'s', async () => {
        const other = {
            id: 'com.example.notes',
            version: '1.0.0',
            objects: [{ name: 'note_item', label: 'Note', fields: { name: { type: 'text', label: 'Name' } } }],
            data: [{ object: 'note_item', records: [{ name: 'N-1' }] }],
        };
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);
        expect((await rt.install(other)).status).toBe(200);
        expect(shape(rt.sharedSeedDatasets())).toEqual([CORE, O2C, 'note_item:N-1']);

        const res = await rt.uninstall(SUITE);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);

        expect(shape(rt.sharedSeedDatasets())).toEqual(['note_item:N-1']);
    });
});

describe('controls: a body that carries a top-level data reads that list, once', () => {
    it('a flat bundle seeds its top-level data, unchanged', async () => {
        const rt = await boot(dir);
        const res = await rt.install(FLAT);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(shape(loadCalls[0].seeds)).toEqual([CORE]);
        expect(shape(rt.sharedSeedDatasets())).toEqual([CORE]);
    });

    it('a composed artifact that still carries its flattened top-level data seeds that union once, never per package as well', async () => {
        const rt = await boot(dir);
        const res = await rt.install({ ...composed('6.3.0'), data: [CORE_DATA, O2C_DATA] });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(shape(loadCalls[0].seeds)).toEqual([CORE, O2C]);
    });

    it('a composed artifact with no dataset in any package body still answers no-datasets', async () => {
        const rt = await boot(dir);
        const bare = composed('6.3.0');
        for (const p of bare.packages) delete (p.manifest as any).data;
        const res = await rt.install(bare);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.seeded).toEqual({ mode: 'skipped', reason: 'no-datasets' });
        expect(loadCalls).toHaveLength(0);
    });
});

/**
 * A ledger entry whose body the resolver refuses — a `packages` that is present
 * but is not an array (ADR-0112 `INVALID_ARTIFACT_PACKAGES`) — reaches the purge
 * and the count as the answer those doors give an unreadable entry: the stable
 * `MARKETPLACE_STORAGE_FAILED` 500 naming the ledger file to repair, never a
 * throw into the route's error path with no entry named.
 */
describe('purge and count over a ledger body the resolver refuses', () => {
    async function installThenCorrupt() {
        const rt = await boot(dir);
        expect((await rt.install(composed('6.3.0'))).status).toBe(200);
        const ledger = new LocalManifestSource(dir);
        const { entry } = ledger.read(SUITE);
        ledger.write({ ...entry!, manifest: { ...(entry!.manifest as object), packages: 'not-a-list' } } as any);
        // The ledger file's basename, as it sits on disk.
        return { rt, file: `${SUITE}.json` };
    }

    it('the purge answers the unreadable-entry 500 naming the ledger file, and deletes nothing', async () => {
        const { rt, file } = await installThenCorrupt();
        const res = await rt.purge(SUITE);
        expect(res.status).toBe(500);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        expect(res.payload.error.message).toContain(file);
        expect(purgeCalls).toHaveLength(0);
    });

    it('the count answers the same', async () => {
        const { rt, file } = await installThenCorrupt();
        const res = await rt.count(SUITE);
        expect(res.status).toBe(500);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        expect(res.payload.error.message).toContain(file);
        expect(countCalls).toHaveLength(0);
    });
});
