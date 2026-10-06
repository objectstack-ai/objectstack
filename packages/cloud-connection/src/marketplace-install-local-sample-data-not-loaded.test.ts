// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21834] The two sample-data doors run ADR-0087 D1's handshake on the ledger
 * entry they are asked to act on, and refuse an entry whose declared protocol
 * range excludes this runtime before any side effect.
 *
 * ## The defect this file pins shut
 *
 * The `kernel:ready` rehydrate does not load such an entry (#21762): nothing is
 * registered, synced, bound or seeded for it. `reseed-sample-data` and
 * `purge-sample-data` acted on it anyway. The reseed loaded the package's
 * translations into the i18n service and merged its seed datasets into the
 * shared `seed-datasets` list, and only then failed (`400 RESEED_SKIPPED`) on
 * objects nobody registered. The purge rewrote the ledger's `withSampleData`
 * with no row deleted.
 *
 * ## What these cases pin (triage ruling `5990436064`)
 *
 *   - on a refused entry, reseed and purge answer the install route's
 *     `422 OS_PROTOCOL_INCOMPATIBLE` for the same manifest, and leave the i18n
 *     service, the seed-dataset list, the engine and the ledger unchanged;
 *   - that holds ahead of the organization wall's refusal too, which the
 *     reseed used to decide after its side effects;
 *   - the doors judge the entry themselves: an entry another runtime wrote to
 *     the ledger after this boot's rehydrate is refused as well;
 *   - on a loadable entry both doors answer as before, and the probes above see
 *     their side effects (the control for every "unchanged" below);
 *   - DELETE and a compatible re-install still act on the refused entry.
 *
 * A "restart" here is a fresh plugin mounted over a ledger that already holds
 * the entries, through its real `start()` + `kernel:ready`, with the REAL
 * `SeedLoaderService` over an in-memory engine that answers only for objects a
 * package REGISTERED. The real-boot pin across a restart is
 * `packages/qa/dogfood/test/install-local-sample-data-not-loaded.dogfood.test.ts`.
 *
 * Ranges derive from the running protocol, never literals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
// The doors seed and purge through `@objectstack/runtime` (lazy `import()`s
// inside the plugin). Its first load is paid here, at module top, never inside
// a clocked `it`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource, type InstalledManifestEntry } from './local-manifest-source.js';
import { installerGrantRows, INSTALLER_USER_ID } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, unknown> & { id: string };

const ROUTE = '/api/v1/marketplace/install-local';
const OLD_RANGE = `^${PROTOCOL_MAJOR - 1}`;
const CURRENT_RANGE = `^${PROTOCOL_MAJOR}`;

/** Two locales: each application of a package's side effects loads two bundles. */
const translationsFor = (object: string) => [{
    en: { objects: { [object]: { label: 'Account' } } },
    'zh-CN': { objects: { [object]: { label: '客户' } } },
}];

/** Installed for the previous protocol major: the rehydrate refuses it. */
const REFUSED = {
    id: 'com.example.qaold21834', name: 'Old', version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: OLD_RANGE },
    objects: [{ name: 'qa_old_account', fields: { name: { type: 'text' } } }],
    translations: translationsFor('qa_old_account'),
    data: [{ object: 'qa_old_account', externalId: 'name', records: [{ name: 'Acme' }] }],
};
/** Built for this protocol: the rehydrate loads it. */
const LOADED = {
    id: 'com.example.qacurrent21834', name: 'Current', version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: CURRENT_RANGE },
    objects: [{ name: 'qa_cur_account', fields: { name: { type: 'text' } } }],
    translations: translationsFor('qa_cur_account'),
    data: [{ object: 'qa_cur_account', externalId: 'name', records: [{ name: 'Beta' }] }],
};
/** Declares no range at all: grandfathered, loaded like before the handshake existed. */
const NO_RANGE = {
    id: 'com.example.qanorange21834', name: 'NoRange', version: '1.0.0', type: 'app', scope: 'project',
    objects: [{ name: 'qa_nr_account', fields: { name: { type: 'text' } } }],
    data: [{ object: 'qa_nr_account', externalId: 'name', records: [{ name: 'Gamma' }] }],
};

function ledgerEntry(manifest: { id: string; version: string }): InstalledManifestEntry {
    return {
        packageId: manifest.id,
        versionId: manifest.version,
        manifestId: manifest.id,
        version: manifest.version,
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: INSTALLER_USER_ID,
        withSampleData: true,
    };
}

/** Every file in the ledger directory and its bytes: "the ledger is unchanged" is this, equal. */
function ledgerBytes(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of readdirSync(dir).sort()) out[f] = readFileSync(join(dir, f), 'utf8');
    return out;
}

/**
 * Mount the plugin over a ledger that already holds `manifests`, the way a
 * restarted runtime meets it. Each package's seed row is already in the
 * database: the refused package's was written while an earlier runtime still
 * loaded it.
 */
async function restartWith(
    manifests: Array<{ id: string; version: string }>,
    dir: string,
    opts: { posture?: 'single' | 'isolated' } = {},
) {
    for (const m of manifests) new LocalManifestSource(dir).write(ledgerEntry(m));
    const tables: Record<string, Row[]> = {
        qa_old_account: [{ id: 'o1', name: 'Acme' }],
        qa_cur_account: [{ id: 'c1', name: 'Beta' }],
        qa_nr_account: [{ id: 'n1', name: 'Gamma' }],
    };
    const objects = new Map<string, any>();
    const writes: string[] = [];
    let nextId = 0;
    const known = (object: string) => {
        if (!objects.has(object)) throw new Error(`Object '${object}' not found`);
        return (tables[object] ??= []);
    };
    const engine = {
        syncSchemas: vi.fn(async () => undefined),
        registry: { getAllPackages: () => [] },
        async find(object: string, query?: any): Promise<unknown[]> {
            const granted = installerGrantRows();
            if (Object.prototype.hasOwnProperty.call(granted, object)) return granted[object]!;
            if (object === 'sys_organization') return [];
            const where: Record<string, unknown> = query?.where ?? {};
            const rows = known(object).filter((row) => Object.entries(where).every(([k, v]) => {
                // Scalar equality only; anything else is refused, never guessed.
                if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
                    throw new Error(`only scalar equality is implemented here (got '${k}')`);
                }
                return row[k] === v;
            }));
            return (typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows).map((row) => ({ ...row }));
        },
        async insert(object: string, record: Record<string, unknown>): Promise<Row> {
            const row = { ...record, id: `new${++nextId}` } as Row;
            known(object).push(row);
            writes.push(`insert ${object}#${row.id}`);
            return { ...row };
        },
        async delete(object: string, options?: any): Promise<boolean> {
            const dispatch = assertEngineDeleteDispatch(options);
            if (dispatch.kind !== 'by-id') throw new Error('fake engine: the purge deletes by primary key only');
            const table = known(object);
            const at = table.findIndex((r) => r.id === String(dispatch.id));
            if (at < 0) return false;
            table.splice(at, 1);
            writes.push(`delete ${object}#${String(dispatch.id)}`);
            return true;
        },
    };
    const register = vi.fn((m: any) => { for (const o of m?.objects ?? []) objects.set(o.name, o); });
    const i18n = { loadTranslations: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: { register },
        auth: { api: { getSession: async () => ({ user: { id: INSTALLER_USER_ID }, session: {} }) } },
        objectql: engine,
        metadata: { getObject: async (name: string) => objects.get(name) },
        i18n,
        ...(opts.posture ? { tenancy: { posture: opts.posture } } : {}),
    };
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
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
    const door = (verb: 'reseed-sample-data' | 'purge-sample-data') => (manifestId: string) =>
        routes.get(`POST ${ROUTE}/:manifestId/${verb}`)!(makeC({}, { manifestId }));
    return {
        tables,
        writes,
        logger,
        registered: () => register.mock.calls.map(([m]) => m?.id),
        /** What the ruling says the doors must leave unchanged, read in one go. */
        state: () => ({
            translationsLoaded: i18n.loadTranslations.mock.calls.length,
            seedDatasets: (services['seed-datasets'] as unknown[] | undefined)?.length ?? 0,
            engineWrites: writes.length,
            ledger: ledgerBytes(dir),
        }),
        reseed: door('reseed-sample-data'),
        purge: door('purge-sample-data'),
        uninstall: (manifestId: string) => routes.get(`DELETE ${ROUTE}/:manifestId`)!(makeC(undefined, { manifestId })),
        install: (body: unknown) => routes.get(`POST ${ROUTE}`)!(makeC(body)),
    };
}

function makeC(body?: unknown, params: Record<string, string> = {}) {
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => body,
            param: (k: string) => params[k],
            header: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

/** The ledger's record for one entry, read from the ledger itself. */
const recorded = (dir: string, manifestId: string) => {
    const e = new LocalManifestSource(dir).read(manifestId).entry;
    return e ? { withSampleData: e.withSampleData, sampleDataPurged: e.sampleDataPurged } : undefined;
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-sample-not-loaded-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('reseed and purge on an entry the rehydrate refused to load', () => {
    it('PRECONDITION: the rehydrate refused the old entry, loaded the current one, and the probes see the loaded one\'s side effects', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        expect(h.registered()).toContain(LOADED.id);
        expect(h.registered()).not.toContain(REFUSED.id);
        const said = h.logger.error.mock.calls.map(([m]) => String(m));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(`OS_PROTOCOL_INCOMPATIBLE: ${REFUSED.id}@1.0.0 is NOT loaded`);
        // The loaded package's two bundles and its one dataset; none of the refused one's.
        expect(h.state()).toMatchObject({ translationsLoaded: 2, seedDatasets: 1, engineWrites: 0 });
    });

    it('reseed answers the install route\'s 422 OS_PROTOCOL_INCOMPATIBLE, and leaves i18n, seed-datasets, the engine and the ledger unchanged', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const before = h.state();
        const res = await h.reseed(REFUSED.id);
        const after = h.state();

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(res.payload.error.details).toMatchObject({ requiredRange: OLD_RANGE, rangeSource: 'engines.protocol' });
        expect(after).toEqual(before);

        // The install route's answer for the same manifest, byte for byte.
        const install = await h.install({ manifest: REFUSED });
        expect(install.status).toBe(422);
        expect(JSON.stringify(res.payload)).toBe(JSON.stringify(install.payload));
    });

    it('purge answers the same 422, deletes nothing, and leaves withSampleData and the rest of the ledger unchanged', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const before = h.state();
        const res = await h.purge(REFUSED.id);

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(res.payload.error.details).toMatchObject({ requiredRange: OLD_RANGE });
        expect(h.state()).toEqual(before);
        expect(recorded(dir, REFUSED.id)).toEqual({ withSampleData: true, sampleDataPurged: undefined });
        expect(h.tables.qa_old_account).toEqual([{ id: 'o1', name: 'Acme' }]);

        const install = await h.install({ manifest: REFUSED });
        expect(JSON.stringify(res.payload)).toBe(JSON.stringify(install.payload));
    });

    it('walled, with no active organization: the refused entry is answered 422 ahead of the wall\'s 403, and nothing moves', async () => {
        const h = await restartWith([REFUSED, LOADED], dir, { posture: 'isolated' });
        const before = h.state();

        const reseed = await h.reseed(REFUSED.id);
        const purge = await h.purge(REFUSED.id);

        expect([reseed.status, reseed.payload.error.code]).toEqual([422, 'OS_PROTOCOL_INCOMPATIBLE']);
        expect([purge.status, purge.payload.error.code]).toEqual([422, 'OS_PROTOCOL_INCOMPATIBLE']);
        expect(h.state()).toEqual(before);

        // Control: the same session on the loadable entry meets the wall, so
        // the wall is in force in this boot.
        const walled = await h.purge(LOADED.id);
        expect([walled.status, walled.payload.error.code]).toEqual([403, 'PERMISSION_DENIED']);
    });

    it('an entry written to the ledger after this boot\'s rehydrate is judged by the door itself', async () => {
        const h = await restartWith([LOADED], dir);
        // Another runtime, of the previous protocol, shares this ledger.
        new LocalManifestSource(dir).write(ledgerEntry(REFUSED));
        const before = h.state();

        const reseed = await h.reseed(REFUSED.id);
        const purge = await h.purge(REFUSED.id);

        expect([reseed.status, reseed.payload.error.code]).toEqual([422, 'OS_PROTOCOL_INCOMPATIBLE']);
        expect([purge.status, purge.payload.error.code]).toEqual([422, 'OS_PROTOCOL_INCOMPATIBLE']);
        expect(h.state()).toEqual(before);
    });

    it('DELETE on the refused entry still works after both doors refused it', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        expect((await h.reseed(REFUSED.id)).status).toBe(422);
        expect((await h.purge(REFUSED.id)).status).toBe(422);

        const res = await h.uninstall(REFUSED.id);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.manifestId).toBe(REFUSED.id);
        expect(new LocalManifestSource(dir).has(REFUSED.id)).toBe(false);
    });

    it('a compatible version installed over the refused entry: reseed and purge then act on it', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        expect((await h.reseed(REFUSED.id)).status).toBe(422);

        const installed = await h.install({ manifest: { ...REFUSED, version: '2.0.0', engines: { protocol: CURRENT_RANGE } } });
        expect(installed.status, JSON.stringify(installed.payload)).toBe(200);
        expect(h.registered()).toContain(REFUSED.id);

        const reseed = await h.reseed(REFUSED.id);
        expect(reseed.status, JSON.stringify(reseed.payload)).toBe(200);
        expect(reseed.payload.data).toEqual({ manifestId: REFUSED.id, inserted: 0, updated: 0, skipped: 1, errors: 0, withSampleData: true });

        const purge = await h.purge(REFUSED.id);
        expect(purge.status, JSON.stringify(purge.payload)).toBe(200);
        expect(purge.payload.data).toEqual({ manifestId: REFUSED.id, deleted: 1, skipped: 0, errors: 0, withSampleData: false });
        expect(h.tables.qa_old_account).toEqual([]);
    });
});

describe('reseed and purge on a loadable entry answer as before', () => {
    it('reseed: 200 with the loader\'s counts, and its side effects land (the control for every "unchanged" above)', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const before = h.state();
        const res = await h.reseed(LOADED.id);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload).toEqual({
            success: true,
            data: { manifestId: LOADED.id, inserted: 0, updated: 0, skipped: 1, errors: 0, withSampleData: true },
        });
        const after = h.state();
        expect(after.translationsLoaded - before.translationsLoaded).toBe(2);
        expect(after.seedDatasets - before.seedDatasets).toBe(1);
        expect(recorded(dir, LOADED.id)).toEqual({ withSampleData: true, sampleDataPurged: false });
    });

    it('purge: 200 with its counts, the seed row deleted, and the ledger rewritten (the control for the ledger probe)', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const before = h.state();
        const res = await h.purge(LOADED.id);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload).toEqual({
            success: true,
            data: { manifestId: LOADED.id, deleted: 1, skipped: 0, errors: 0, withSampleData: false },
        });
        expect(h.writes).toEqual(['delete qa_cur_account#c1']);
        expect(h.state().ledger).not.toEqual(before.ledger);
        expect(recorded(dir, LOADED.id)).toEqual({ withSampleData: false, sampleDataPurged: true });
    });

    it('an entry declaring no range is admitted, with no protocol warning from either door', async () => {
        const h = await restartWith([NO_RANGE], dir);
        h.logger.warn.mockClear();

        const reseed = await h.reseed(NO_RANGE.id);
        const purge = await h.purge(NO_RANGE.id);

        expect(reseed.status, JSON.stringify(reseed.payload)).toBe(200);
        expect(purge.status, JSON.stringify(purge.payload)).toBe(200);
        expect(purge.payload.data).toMatchObject({ deleted: 1 });
        const protocolWarnings = h.logger.warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('[protocol]'));
        expect(protocolWarnings).toEqual([]);
    });
});
