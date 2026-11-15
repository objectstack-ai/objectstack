// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33724] The install door's NOT NULL relax: a package upgrade whose field is
 * now `storage: { notNull: false }` relaxes the column the earlier version
 * built NOT NULL, after the door's additive schema sync, so a write leaving
 * the field empty succeeds. Only the installing package's own declarations
 * count — its objects and the fields its `objectExtensions` contribute — and
 * only the relax: an undeclared NOT NULL stays, and so does a column another
 * package declares.
 *
 * The driver is the real `SqlDriver` on SQLite (`:memory:`); the engine is the
 * door's stand-in (`syncSchemas`, `getDriverForObject`, the served registry),
 * whose sync runs the driver's own `syncSchema` over what the register served.
 * The driver door itself is pinned on every dialect cell in
 * `@objectstack/driver-sql`'s `sql-driver-install-declared-relax.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// [#21321] An install binds the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top — never inside a clocked `it`.
import '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declaredNullableColumns } from './marketplace-install-declared-relaxations.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const VENDOR = 'com.acme.crm';
const OTHER = 'com.acme.addons';
const INSTALLER = 'usr_installer';
const REGISTER_FAILURE = 'object acme_product: the runtime could not bind a handler';

const body = (id: string, version: string, extra: Row): Row => ({ id, namespace: id === VENDOR ? 'acme' : 'addons', version, ...extra });
const product = (fields: Row): Row => ({ name: 'acme_product', label: 'Product', fields });

const V1 = body(VENDOR, '1.0.0', {
    objects: [product({
        name: { type: 'text' },
        list_price: { type: 'number', required: true, storage: { notNull: true } },
        // NOT NULL in v1; v2 removes the declaration (undeclared, not relaxed).
        sku: { type: 'text', storage: { notNull: true } },
    })],
});
const V2 = body(VENDOR, '2.0.0', {
    objects: [product({
        name: { type: 'text' },
        list_price: { type: 'number', required: false, storage: { notNull: false } },
        sku: { type: 'text' },
    })],
});

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(payload: any) {
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => payload,
            param: () => undefined,
        },
        json: vi.fn((p: any, status?: number) => ({ payload: p, status: status ?? 200 })),
    };
}

let dir: string;
let driver: SqlDriver;
beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mil-declared-relax-'));
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as unknown as { logger: unknown }).logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    await driver.connect();
});
afterEach(async () => {
    await driver.disconnect().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** Serve one manifest snapshot from the cloud leg; the public fast-path is off. */
function serveSnapshot(manifest: Row) {
    vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
    // A non-empty service key, so the credential read never reaches the
    // developer's own on-disk binding.
    vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ data: { manifest, version: manifest.version, version_id: `ver_${manifest.version}` } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
}

/**
 * Mount the door over the real driver. `served` is what the registry serves,
 * by object: the register writes the registering package's own objects into
 * it, and an extension's fields onto the object it extends.
 */
async function mount(options: { served?: Record<string, Row>; relax?: 'missing'; controlPlaneUrl?: string; failRegisterOf?: string } = {}) {
    const served: Record<string, Row> = options.served ?? {};
    const register = vi.fn(async (registered: any) => {
        for (const o of registered.objects ?? []) served[o.name] = { ...o, fields: { ...o.fields } };
        for (const e of registered.objectExtensions ?? []) {
            const target = served[e.extend];
            if (target) target.fields = { ...target.fields, ...e.fields };
        }
        // A register that fails AFTER it wrote the body's objects: the
        // registry then serves the new declaration although the install does
        // not count as hot-loaded. An undeclared throw (no 4xx status) is the
        // lenient path's fault, not a refusal.
        if (options.failRegisterOf !== undefined && registered.version === options.failRegisterOf) {
            throw new Error(REGISTER_FAILURE);
        }
    });
    const syncSchemas = vi.fn(async () => {
        for (const o of Object.values(served)) await driver.syncSchema(o.name, o);
    });
    const rawApp = makeRawApp();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const relaxless = options.relax === 'missing'
        ? new Proxy(driver, { get: (t, k) => (k === 'relaxDeclaredNotNull' ? undefined : (t as any)[k]) })
        : driver;
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas,
            getDriverForObject: () => relaxless,
            registry: { getObject: (name: string) => served[name] },
        }, INSTALLER),
    };
    const hooks = new Map<string, any>();
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        registerService: (name: string, service: unknown) => { services[name] = service; },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: options.controlPlaneUrl ?? 'off', storageDir: dir });
    await plugin.init(ctx as any);
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const install = rawApp.routes.get('POST /api/v1/marketplace/install-local')!;
    return { install, logger, served };
}

const nullable = async (table: string): Promise<Record<string, boolean>> => {
    const info = (await driver.getKnex()(table).columnInfo()) as unknown as Record<string, { nullable: boolean }>;
    return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v.nullable]));
};

describe('a package upgrade relaxes the NOT NULL its own declaration makes nullable (#33724)', () => {
    it('v1 notNull: true → v2 notNull: false: the column is relaxed, and a create without the field succeeds', async () => {
        const door = await mount();
        expect((await door.install(makeC({ manifest: V1 }))).status).toBe(200);
        expect((await nullable('acme_product')).list_price).toBe(false);
        await expect(driver.create('acme_product', { name: 'p', sku: 's' })).rejects.toThrow();

        const res = await door.install(makeC({ manifest: V2 }));

        expect(res.status).toBe(200);
        expect((await nullable('acme_product')).list_price).toBe(true);
        const created: any = await driver.create('acme_product', { name: 'p', sku: 's' });
        const row: any = await driver.findOne('acme_product', { where: { id: created.id } });
        expect(row.list_price ?? null).toBeNull();
    });

    it('leaves an undeclared NOT NULL alone (ADR-0113 D5): `sku` lost its `storage`, and stays NOT NULL', async () => {
        const door = await mount();
        await door.install(makeC({ manifest: V1 }));
        await door.install(makeC({ manifest: V2 }));
        expect((await nullable('acme_product')).sku).toBe(false);
    });

    it('relaxes a field the package contributes through `objectExtensions` to an object another package owns', async () => {
        const door = await mount();
        await door.install(makeC({ manifest: V1 }));
        const ext = (version: string, notNull: boolean) => body(OTHER, version, {
            objectExtensions: [{ extend: 'acme_product', fields: { grade: { type: 'text', storage: { notNull } } } }],
        });
        expect((await door.install(makeC({ manifest: ext('1.0.0', true) }))).status).toBe(200);
        expect((await nullable('acme_product')).grade).toBe(false);
        expect((await door.install(makeC({ manifest: ext('2.0.0', false) }))).status).toBe(200);
        expect((await nullable('acme_product')).grade).toBe(true);
    });

    it('never relaxes a column another package declares nullable: the install of an unrelated package leaves it', async () => {
        // The registry serves `list_price` nullable (as a customization or
        // another package might say), but the package being installed says
        // nothing about it.
        const door = await mount();
        await door.install(makeC({ manifest: V1 }));
        door.served.acme_product!.fields.list_price = { type: 'number', storage: { notNull: false } };
        const unrelated = body(OTHER, '1.0.0', { objects: [{ name: 'addons_note', label: 'Note', fields: { text: { type: 'text' } } }] });
        expect((await door.install(makeC({ manifest: unrelated }))).status).toBe(200);
        expect((await nullable('acme_product')).list_price).toBe(false);
    });

    it('the lenient path relaxes nothing: a cloud upgrade whose register throws (no 4xx) leaves the column NOT NULL', async () => {
        // The running kernel does not serve v2 as installed (`hotLoaded:
        // false`), and the restart that loads it is a boot, which never relaxes
        // a column (ADR-0113 D5) — though the failed register already wrote
        // v2's declaration, so the served object says `notNull: false`.
        const door = await mount({ controlPlaneUrl: 'http://cloud.test', failRegisterOf: '2.0.0' });
        expect((await door.install(makeC({ manifest: V1 }))).status).toBe(200);
        serveSnapshot(V2);

        const res = await door.install(makeC({ packageId: VENDOR }));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.hotLoaded).toBe(false);
        expect(res.payload.data.hotLoadError).toBe(REGISTER_FAILURE);
        // The fixture is real: what the registry serves would be relaxed.
        expect(door.served.acme_product!.fields.list_price.storage).toEqual({ notNull: false });
        expect((await nullable('acme_product')).list_price).toBe(false);
        await expect(driver.create('acme_product', { name: 'p', sku: 's' })).rejects.toThrow();
    });

    it('a driver with no relax door installs as before, and the column stays NOT NULL', async () => {
        const door = await mount({ relax: 'missing' });
        await door.install(makeC({ manifest: V1 }));
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(200);
        expect((await nullable('acme_product')).list_price).toBe(false);
        expect(door.logger.warn).toHaveBeenCalledWith(expect.stringContaining(
            "acme_product declares `storage: { notNull: false }` on list_price, and its driver has no NOT NULL relax",
        ));
    });
});

describe('declaredNullableColumns reads only the package body\'s own words (#33724)', () => {
    it('lists `notNull: false` fields of its objects and extensions, never an absent or `true` one', () => {
        const got = declaredNullableColumns(body(VENDOR, '1.0.0', {
            objects: [product({ a: { type: 'text', storage: { notNull: false } }, b: { type: 'text' }, c: { type: 'text', storage: { notNull: true } } })],
            objectExtensions: [{ extend: 'other_obj', fields: { d: { type: 'text', storage: { notNull: false } }, e: { type: 'text' } } }],
        }));
        expect(Object.fromEntries(got)).toEqual({ acme_product: ['a'], other_obj: ['d'] });
    });
});
