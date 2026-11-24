// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34405, #31021] install-local's seed loads keep, and honour, the record of
 * which seed rows landed in the organization they seed (`sys_seed_landed_key`).
 *
 * The loader's guard (`SeedLoaderService` option `landedKeys`) records every
 * keyed row an `ignore` or `upsert` dataset lands and, in `'honour'` mode, does
 * not insert again a recorded row that is now gone: a person removed it. In
 * `'reseed'` mode it records the same and inserts every missing row. This door
 * built its loader without the option, so it neither read nor wrote the
 * record: a sample row a tenant deleted came back on the next reinstall,
 * upgrade, restart heal or per-organization replay.
 *
 * Real here: `SeedLoaderService` (`@objectstack/runtime`), over a faithful
 * in-memory engine that registers `sys_seed_landed_key` the way
 * `@objectstack/platform-objects` does. Each pin runs on a flat bundle (one
 * top-level `data`) and on a composed one (`packages[]`, the seed datasets in
 * each package body), which must behave the same.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`): the plugin reaches the
// seed loader through a dynamic `import()`.
import '@objectstack/runtime';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { INSTALLER_ORGANIZATION, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Row = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const LEDGER = 'sys_seed_landed_key';
const ORG = INSTALLER_ORGANIZATION.id;

/**
 * `where` as the seed loader spells it here: field equality only. A combinator
 * or a value operator is REFUSED rather than answered, so a shape this double
 * does not implement can never read as a match or a miss.
 */
function rowMatches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`engine double: unsupported combinator ${k}`);
        if (v !== null && typeof v === 'object') {
            throw new Error(`engine double: unsupported value operator on ${k}: ${JSON.stringify(v)}`);
        }
        return (row[k] ?? null) === (v ?? null);
    });
}

/**
 * A faithful in-memory engine: `where` filters, ids minted on insert. `store`
 * outlives a boot. Every dataset here is `ignore` (create-only), and a
 * person's deletion is a direct edit of `store`, so no load here writes
 * anything but an insert (the owner stamp asks `update` and skips an engine
 * without one; the rows have no owner column anyway). `delete` is the purge's:
 * by primary key, under the real dispatch contract.
 */
function createEngine(store: Record<string, Row[]>) {
    let next = 0;
    const engine: any = {
        syncSchemas: async () => undefined,
        async find(object: string, query?: any) {
            let rows = (store[object] ?? []).filter((r) => rowMatches(r, query?.where));
            if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
            return rows.map((r) => ({ ...r }));
        },
        async insert(object: string, data: any) {
            const mint = (d: Row) => ({ id: d.id ?? `gen_${object}_${++next}`, ...d });
            const rows = Array.isArray(data) ? data.map(mint) : [mint(data)];
            (store[object] ??= []).push(...rows);
            return Array.isArray(data) ? rows.map((r) => ({ ...r })) : { ...rows[0] };
        },
        async delete(object: string, options?: any) {
            const dispatch = assertEngineDeleteDispatch(options);
            if (dispatch.kind !== 'by-id') throw new Error('engine double: the purge deletes by primary key only');
            const table = store[object] ?? [];
            const at = table.findIndex((r) => r.id === String(dispatch.id));
            if (at < 0) return false;
            table.splice(at, 1);
            return true;
        },
        async count(object: string, query?: any) {
            return (await engine.find(object, query)).length;
        },
        async aggregate() {
            return [];
        },
    };
    return engine;
}

const objectDef = (name: string) => ({ name, label: name, fields: { name: { type: 'text', label: 'Name' } } });

/** The objects the metadata service answers: the packages' own, the organization and the landed-key record. */
const METADATA_OBJECTS: Record<string, any> = {
    lk_account: objectDef('lk_account'),
    lk_order: objectDef('lk_order'),
    sys_organization: { name: 'sys_organization', systemFields: { tenant: false }, fields: { name: { type: 'text' }, slug: { type: 'text' } } },
    [LEDGER]: {
        name: LEDGER,
        fields: {
            object_name: { type: 'text' },
            seed_key: { type: 'textarea' },
            organization_id: { type: 'lookup', reference: 'sys_organization' },
        },
    },
};

const ACCOUNTS = (withUpgradeRow: boolean) => ({
    object: 'lk_account',
    externalId: 'name',
    records: [{ name: 'Acme' }, { name: 'Globex' }, ...(withUpgradeRow ? [{ name: 'Initech' }] : [])],
});
const ORDERS = { object: 'lk_order', externalId: 'name', records: [{ name: 'SO-1' }, { name: 'SO-2' }] };

/** A flat bundle: one top-level `data`. v2 adds a row to the seed. */
const flat = (version: '1.0.0' | '2.0.0') => ({
    id: 'com.example.lkflat',
    name: 'Landed keys flat',
    version,
    type: 'app',
    objects: [objectDef('lk_account'), objectDef('lk_order')],
    data: [ACCOUNTS(version === '2.0.0'), ORDERS],
});

/** A composed bundle: `packages[]`, the datasets in each package body, no top-level `data`. v2 adds a row to the seed. */
const composed = (version: '1.0.0' | '2.0.0') => ({
    id: 'com.example.lksuite',
    name: 'Landed keys suite',
    version,
    type: 'app',
    packages: [
        {
            manifest: {
                id: 'com.example.lksuite.o2c', name: 'o2c', version, type: 'module',
                dependencies: { 'com.example.lksuite.core': '*' },
                objects: [objectDef('lk_order')],
                data: [ORDERS],
            },
        },
        {
            manifest: {
                id: 'com.example.lksuite.core', name: 'core', version, type: 'module',
                objects: [objectDef('lk_account')],
                data: [ACCOUNTS(version === '2.0.0')],
            },
        },
    ],
});

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

let dir: string;
let store: Record<string, Row[]>;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-landed-keys-'));
    // The `single` posture's Default Organization, the sole one: the loads seed it.
    store = { sys_organization: [{ id: ORG, slug: 'default', name: 'Default' }] };
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * One runtime over the ledger directory and `store`: a fresh plugin, booted
 * through `kernel:ready` (so a second boot is a restart over the same
 * database, its rehydrate and heal included). `posture: 'isolated'` puts the
 * organization wall in force, the session's active organization the one the
 * install seeds.
 */
async function boot(opts: { posture?: 'single' | 'isolated' } = {}) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const auth = installerAuthService();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: {
            api: {
                getSession: async () => ({
                    ...(await auth.api.getSession()),
                    session: opts.posture === 'isolated' ? { activeOrganizationId: ORG } : {},
                }),
            },
        },
        objectql: withInstallerGrants(createEngine(store)),
        metadata: {
            getObject: async (name: string) => METADATA_OBJECTS[name],
            listObjects: async () => Object.values(METADATA_OBJECTS),
            get: async (_type: string, name: string) => METADATA_OBJECTS[name],
            list: async () => [],
        },
        ...(opts.posture ? { tenancy: { posture: opts.posture } } : {}),
    };
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        registerService: (name: string, svc: unknown) => { services[name] = svc; },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const install = async (manifest: unknown) => {
        const res = await routes.get(`POST ${ROUTE}`)!(makeC({ manifest }));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        return res;
    };
    const reseed = (manifestId: string) => routes.get(`POST ${ROUTE}/:manifestId/reseed-sample-data`)!(makeC({}, manifestId));
    const purge = (manifestId: string) => routes.get(`POST ${ROUTE}/:manifestId/purge-sample-data`)!(makeC({}, manifestId));
    /** The per-organization replayer this door registered (no other plugin registers one here). */
    const replayer = () => services['seed-replayer'] as (orgId: string, options?: { userId?: string; reseed?: boolean }) => Promise<any>;
    return { plugin, ctx, install, reseed, purge, replayer, logger };
}

/** The seed rows of `object` in `org`, by name. */
const names = (object: string, org: string = ORG) =>
    (store[object] ?? []).filter((r) => r.organization_id === org).map((r) => r.name).sort();
/** The landed-key record of `org`, as `object:name` pairs. */
const landed = (org: string = ORG) =>
    (store[LEDGER] ?? [])
        .filter((r) => r.organization_id === org)
        .map((r) => `${r.object_name}:${(JSON.parse(r.seed_key) as Array<[string, string]>).map(([, v]) => v).join('|')}`)
        .sort();
/** A person deletes the seed row `name` of `object` in `org`. */
const removeRow = (object: string, name: string, org: string = ORG) => {
    store[object] = (store[object] ?? []).filter((r) => !(r.name === name && r.organization_id === org));
};

/**
 * What a boot's restart heal recorded for `manifestId` on the kernel's
 * `seed-summary`: the outcome the boot banner, `objectstack:seed-settled`,
 * `GET /ready` and `os verify` judge, an `emptyInstall` or a `rejected` row
 * reading as a failed seed in each.
 */
const healOutcome = (rt: { ctx: any }, manifestId: string) =>
    (rt.ctx.getService('seed-summary') as Array<Record<string, unknown>>).find((s) => s.source === manifestId && s.marketplace === true);
/** The heal's own log lines for `manifestId` at `level`. */
const healLines = (rt: { logger: Record<string, any> }, level: 'info' | 'warn', manifestId: string) =>
    (rt.logger[level].mock.calls as unknown[][])
        .map((c) => String(c[0]))
        .filter((line) => line.includes('[MarketplaceInstallLocal]') && line.includes(manifestId) && /heal/.test(line));
/** The outcome a heal that withheld every row records: the real `skipped`, nothing flagged. */
const withheldOutcome = (manifestId: string) =>
    ({ source: manifestId, marketplace: true, inserted: 0, updated: 0, skipped: 4, rejected: 0, droppedRefs: 0 });

const BUNDLES = [
    { kind: 'flat', id: 'com.example.lkflat', body: flat },
    { kind: 'composed', id: 'com.example.lksuite', body: composed },
] as const;

describe.each(BUNDLES)('$kind bundle: install-local keeps and honours the record of landed seed rows', ({ id, body }) => {
    it('install writes sys_seed_landed_key for every row it lands, in the organization it seeds', async () => {
        const rt = await boot();
        const res = await rt.install(body('1.0.0'));
        expect(res.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 4, errors: 0 });
        expect(names('lk_account')).toEqual(['Acme', 'Globex']);
        expect(names('lk_order')).toEqual(['SO-1', 'SO-2']);
        expect(landed()).toEqual(['lk_account:Acme', 'lk_account:Globex', 'lk_order:SO-1', 'lk_order:SO-2']);
    });

    it('a seed row deleted after the install stays deleted across a reinstall and an upgrade; the row the upgrade adds lands', async () => {
        const rt = await boot();
        await rt.install(body('1.0.0'));
        removeRow('lk_account', 'Globex');

        const reinstall = await rt.install(body('1.0.0'));
        expect(names('lk_account')).toEqual(['Acme']);
        expect(reinstall.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 0, errors: 0 });

        const upgrade = await rt.install(body('2.0.0'));
        expect(upgrade.payload.data.upgradedFrom, JSON.stringify(upgrade.payload)).toBeDefined();
        expect(names('lk_account')).toEqual(['Acme', 'Initech']);
        expect(names('lk_order')).toEqual(['SO-1', 'SO-2']);
        expect(upgrade.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 1, errors: 0 });
        expect(landed()).toContain('lk_account:Initech');
    });

    it('under the organization wall, the install and the upgrade keep it in the caller\'s active organization', async () => {
        // A second organization, so no sole organization stands in for the caller's.
        store.sys_organization.push({ id: 'org_other', slug: 'other', name: 'Other' });
        const rt = await boot({ posture: 'isolated' });
        await rt.install(body('1.0.0'));
        expect(landed()).toEqual(['lk_account:Acme', 'lk_account:Globex', 'lk_order:SO-1', 'lk_order:SO-2']);
        expect(landed('org_other')).toEqual([]);
        removeRow('lk_order', 'SO-2');

        await rt.install(body('2.0.0'));
        expect(names('lk_order')).toEqual(['SO-1']);
        expect(names('lk_account')).toEqual(['Acme', 'Globex', 'Initech']);
    });

    it('reseed is the deliberate re-seed: it inserts every missing row and records it again', async () => {
        const rt = await boot();
        await rt.install(body('1.0.0'));
        removeRow('lk_account', 'Globex');
        removeRow('lk_order', 'SO-1');

        const res = await rt.reseed(id);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload).toEqual({
            success: true,
            data: { manifestId: id, inserted: 2, updated: 0, skipped: 2, errors: 0, withSampleData: true },
        });
        expect(names('lk_account')).toEqual(['Acme', 'Globex']);
        expect(names('lk_order')).toEqual(['SO-1', 'SO-2']);
        // Recorded once per key: the re-seed does not duplicate the record.
        expect(landed()).toEqual(['lk_account:Acme', 'lk_account:Globex', 'lk_order:SO-1', 'lk_order:SO-2']);

        // …and the record still stands for the next removal.
        removeRow('lk_account', 'Globex');
        await rt.install(body('1.0.0'));
        expect(names('lk_account')).toEqual(['Acme']);
    });

    it('a restart does not heal back the seed rows a person deleted, and still heals a database that never held them', async () => {
        const first = await boot();
        await first.install(body('1.0.0'));
        for (const r of ['Acme', 'Globex']) removeRow('lk_account', r);
        for (const r of ['SO-1', 'SO-2']) removeRow('lk_order', r);

        // Every seeded object empty, the purge never run: the heal's own trigger.
        const restart = await boot();
        expect(names('lk_account')).toEqual([]);
        expect(names('lk_order')).toEqual([]);
        // The withheld rows are the declared outcome, so the restart reports a
        // settled seed: the real `skipped`, no `emptyInstall`, said at `info`.
        expect(healOutcome(restart, id)).toEqual(withheldOutcome(id));
        expect(healLines(restart, 'warn', id)).toEqual([]);
        expect(healLines(restart, 'info', id)).toHaveLength(1);

        // Control: a new database (no row, no record) is healed from the ledger body.
        for (const object of Object.keys(store)) if (object !== 'sys_organization') delete store[object];
        const fresh = await boot();
        expect(names('lk_account')).toEqual(['Acme', 'Globex']);
        expect(names('lk_order')).toEqual(['SO-1', 'SO-2']);
        expect(healOutcome(fresh, id)).toEqual(expect.objectContaining({ inserted: 4, rejected: 0, healed: true }));
        expect(healOutcome(fresh, id)).not.toHaveProperty('emptyInstall');
    });

    it('a purge stays purged across a reinstall and a restart', async () => {
        const first = await boot();
        await first.install(body('1.0.0'));
        const purged = await first.purge(id);
        expect(purged.status, JSON.stringify(purged.payload)).toBe(200);
        expect(purged.payload.data).toMatchObject({ deleted: 4, errors: 0 });

        // The reinstall withholds every recorded row (counted in `skipped`).
        const reinstall = await first.install(body('1.0.0'));
        expect(reinstall.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 0, errors: 0 });
        expect(names('lk_account')).toEqual([]);
        expect(names('lk_order')).toEqual([]);

        // Every seeded object empty again: the restart's heal runs, and leaves it,
        // reporting a settled seed rather than an empty install.
        const restart = await boot();
        expect(names('lk_account')).toEqual([]);
        expect(names('lk_order')).toEqual([]);
        expect(healOutcome(restart, id)).toEqual(withheldOutcome(id));
        expect(healLines(restart, 'warn', id)).toEqual([]);
    });

    it('the per-organization replayer honours it per organization, and `{ reseed: true }` brings a removed row back', async () => {
        const rt = await boot();
        await rt.install(body('1.0.0'));
        const replay = rt.replayer();
        expect(typeof replay).toBe('function');

        await replay('org_a');
        await replay('org_b');
        removeRow('lk_account', 'Acme', 'org_a');

        const again = await replay('org_a');
        await replay('org_b');
        expect(again).toMatchObject({ inserted: 0, errors: [] });
        expect(names('lk_account', 'org_a')).toEqual(['Globex']);
        expect(names('lk_account', 'org_b')).toEqual(['Acme', 'Globex']);
        expect(landed('org_a')).toEqual(['lk_account:Acme', 'lk_account:Globex', 'lk_order:SO-1', 'lk_order:SO-2']);

        const reseeded = await replay('org_a', { reseed: true });
        expect(reseeded).toMatchObject({ inserted: 1, errors: [] });
        expect(names('lk_account', 'org_a')).toEqual(['Acme', 'Globex']);
    });
});

describe('an unmanaged copy\'s sample data: the install honours the record, the reseed re-seeds', () => {
    it('a row deleted after the copy\'s first load is not loaded again by another install load; the reseed brings it back', async () => {
        const rt = await boot();
        const seed = (door: 'install' | 'reseed') => (rt.plugin as any).seedUnmanagedCopy(makeC({}), rt.ctx, {
            app: flat('1.0.0'),
            appId: 'com.example.lkflat',
            targetPackageId: 'com.example.lkflat-copy',
            datasets: [ACCOUNTS(false)],
            userId: null,
            door,
        });

        expect(await seed('install')).toMatchObject({ mode: 'inline', inserted: 2, errors: 0 });
        expect(landed()).toEqual(['lk_account:Acme', 'lk_account:Globex']);
        removeRow('lk_account', 'Acme');

        expect(await seed('install')).toMatchObject({ mode: 'inline', inserted: 0, errors: 0 });
        expect(names('lk_account')).toEqual(['Globex']);

        expect(await seed('reseed')).toMatchObject({ mode: 'inline', inserted: 1, errors: 0 });
        expect(names('lk_account')).toEqual(['Acme', 'Globex']);
    });
});

/**
 * The record has no package component (`(organization_id, object_name,
 * seed_key)`), so it is the organization's, not the installing package's. The
 * scenario runner loads its seed, and puts a removed seed row back, as data-only
 * packages keyed on `id`, each under a namespace of its own
 * (`loadSeedRows` in `packages/qa/scenarios/src/runner/orchestrate.ts`). This
 * pins what such a load meets at this door: a second package carrying a
 * recorded row that is gone does not insert it (withheld, counted in
 * `skipped`, no error), and that package's reseed does.
 */
describe('a data-only package keyed on `id`: the record is the organization\'s, whichever package carries the row', () => {
    const dataOnly = (namespace: string, records: Row[]) => ({
        id: `com.scenario.seed.${namespace}`,
        namespace,
        version: '0.0.1',
        type: 'app',
        scope: 'project',
        name: 'Scenario seed',
        data: [{ object: 'lk_account', externalId: 'id', records }],
    });
    const ids = (object: string) => (store[object] ?? []).filter((r) => r.organization_id === ORG).map((r) => r.id).sort();

    it('a row deleted after one package seeded it is withheld from a second package\'s install; the second package\'s reseed brings it back', async () => {
        const rt = await boot();
        const first = await rt.install(dataOnly('scenarioseeda', [{ id: 'ct1', name: 'Ann' }, { id: 'ct2', name: 'Ben' }]));
        expect(first.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 2, skipped: 0, errors: 0 });
        expect(landed()).toEqual(['lk_account:ct1', 'lk_account:ct2']);
        store.lk_account = store.lk_account!.filter((r) => r.id !== 'ct2');

        const second = await rt.install(dataOnly('scenarioseedb', [{ id: 'ct2', name: 'Ben' }]));
        expect(second.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 0, skipped: 1, errors: 0, errorList: [] });
        expect(ids('lk_account')).toEqual(['ct1']);

        const reseed = await rt.reseed('com.scenario.seed.scenarioseedb');
        expect(reseed.status, JSON.stringify(reseed.payload)).toBe(200);
        expect(reseed.payload.data).toMatchObject({ inserted: 1, skipped: 0, errors: 0 });
        expect(ids('lk_account')).toEqual(['ct1', 'ct2']);
        expect(landed()).toEqual(['lk_account:ct1', 'lk_account:ct2']);
    });

    it('control: a row no load recorded is inserted by a second package\'s install', async () => {
        const rt = await boot();
        await rt.install(dataOnly('scenarioseeda', [{ id: 'ct1', name: 'Ann' }]));
        const second = await rt.install(dataOnly('scenarioseedb', [{ id: 'ct2', name: 'Ben' }]));
        expect(second.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 1, skipped: 0, errors: 0 });
        expect(ids('lk_account')).toEqual(['ct1', 'ct2']);
    });
});
