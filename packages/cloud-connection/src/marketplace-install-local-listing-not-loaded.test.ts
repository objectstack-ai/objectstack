// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21822] `GET /api/v1/marketplace/install-local` lists a ledger entry the
 * `kernel:ready` rehydrate refused to load with a not-loaded marker.
 *
 * ## The defect this file pins shut
 *
 * The rehydrate keeps an entry whose `engines.protocol` excludes this runtime
 * in the ledger and loads none of it (ADR-0087 D1, #21762). The listing then
 * served that entry exactly like a loaded one, `withSampleData` included, so
 * the console's Installed Apps said "installed"; and since #21775 each GET also
 * tried to read the package's seed rows from objects nobody registered, and
 * logged one `warn` per request saying it could not.
 *
 * ## What these cases pin (triage ruling `5988934231`)
 *
 *   - after a restart whose rehydrate refused an entry, the listing serves it
 *     with `notLoaded: { code, requiredRange }`, a CLOSED pair, in place of
 *     `withSampleData`, to the operator and the narrowed caller alike;
 *   - no seed row is read for the marked entry and the listing's
 *     "could not read this package's seed rows" warning does not fire;
 *   - a loadable entry is served unchanged: its rows are read and its item is
 *     the one a ledger without the refused entry serves;
 *   - DELETE on the marked entry still works, and a compatible version
 *     installed over it is listed as loaded.
 *
 * A "restart" here is a fresh plugin mounted over a ledger that already holds
 * the entries, through its real `start()` + `kernel:ready`. The real-boot pin
 * across a restart is `packages/qa/dogfood/test/install-local-listing-not-loaded.dogfood.test.ts`.
 *
 * Ranges derive from the running protocol, never literals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
// The rehydrate binds handlers and the listing builds its seed graph through
// `@objectstack/runtime` (lazy `import()`s inside the plugin). Its first load
// is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource, type InstalledManifestEntry } from './local-manifest-source.js';
import { installerGrantRows, INSTALLER_USER_ID } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, unknown> & { id: string };

const ROUTE = '/api/v1/marketplace/install-local';
const OLD_RANGE = `^${PROTOCOL_MAJOR - 1}`;
const CURRENT_RANGE = `^${PROTOCOL_MAJOR}`;
const SEED_WARNING = 'the installed-apps listing could not read this package\'s seed rows';

/** Installed for the previous protocol major: the rehydrate refuses it. */
const REFUSED = {
    id: 'com.example.qaold21822', name: 'Old', version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: OLD_RANGE },
    objects: [{ name: 'qa_old_account', fields: { name: { type: 'text' } } }],
    data: [{ object: 'qa_old_account', externalId: 'name', records: [{ name: 'Acme' }] }],
};
/** Built for this protocol: the rehydrate loads it. */
const LOADED = {
    id: 'com.example.qacurrent21822', name: 'Current', version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: CURRENT_RANGE },
    objects: [{ name: 'qa_cur_account', fields: { name: { type: 'text' } } }],
    data: [{ object: 'qa_cur_account', externalId: 'name', records: [{ name: 'Beta' }] }],
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

/** A tenant administrator that does NOT hold `manage_metadata`: the narrowed caller. */
const MEMBER_ID = 'usr_member';
const MEMBER_GRANTS: Record<string, unknown[]> = {
    sys_user: [{ id: MEMBER_ID, email: 'member@objectstack.test' }],
    sys_member: [],
    sys_user_position: [],
    sys_position: [],
    sys_position_permission_set: [],
    sys_user_permission_set: [{ id: 'ups_member', user_id: MEMBER_ID, permission_set_id: 'ps_member', organization_id: null }],
    sys_permission_set: [{ id: 'ps_member', name: 'organization_admin', system_permissions: ['setup.access', 'manage_org_users'] }],
};

/**
 * Mount the plugin over a ledger that already holds `manifests`, the way a
 * restarted runtime meets it. The engine answers only for objects a package
 * REGISTERED, the way the real one answers `Object '…' not found` for a
 * refused package's objects, and it records every read.
 */
async function restartWith(manifests: Array<{ id: string; version: string }>, dir: string) {
    for (const m of manifests) new LocalManifestSource(dir).write(ledgerEntry(m));
    // Both packages' seed rows are in the database: the refused package's
    // were written while an earlier runtime still loaded it.
    const tables: Record<string, Row[]> = {
        qa_old_account: [{ id: 'o1', name: 'Acme' }],
        qa_cur_account: [{ id: 'c1', name: 'Beta' }],
    };
    const objects = new Map<string, any>();
    const reads: string[] = [];
    const caller = { as: 'operator' as 'operator' | 'member' };
    const grants = () => (caller.as === 'operator' ? installerGrantRows() : MEMBER_GRANTS);
    const engine = {
        syncSchemas: vi.fn(async () => undefined),
        registry: { getAllPackages: () => [] },
        async find(object: string, query?: any): Promise<unknown[]> {
            const granted = grants();
            if (Object.prototype.hasOwnProperty.call(granted, object)) return granted[object]!;
            reads.push(object);
            if (!objects.has(object)) throw new Error(`Object '${object}' not found`);
            const where: Record<string, unknown> = query?.where ?? {};
            const rows = (tables[object] ?? []).filter((row) => Object.entries(where).every(([k, v]) => {
                // Scalar equality only; anything else is refused, never guessed.
                if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
                    throw new Error(`only scalar equality is implemented here (got '${k}')`);
                }
                return row[k] === v;
            }));
            return (typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows).map((row) => ({ ...row }));
        },
    };
    const register = vi.fn((m: any) => { for (const o of m?.objects ?? []) objects.set(o.name, o); });
    const services: Record<string, unknown> = {
        manifest: { register },
        auth: { api: { getSession: async () => ({ user: { id: caller.as === 'operator' ? INSTALLER_USER_ID : MEMBER_ID }, session: {} }) } },
        objectql: engine,
        metadata: { getObject: async (name: string) => objects.get(name) },
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
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    return {
        caller,
        reads,
        logger,
        registered: () => register.mock.calls.map(([m]) => m?.id),
        list: async () => {
            reads.length = 0;
            logger.warn.mockClear();
            const res = await routes.get(`GET ${ROUTE}`)!(makeC());
            return { status: res.status, data: res.payload?.data, byId: new Map<string, any>((res.payload?.data?.items ?? []).map((i: any) => [i.manifestId, i])) };
        },
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

const seedWarnings = (logger: { warn: { mock: { calls: unknown[][] } } }) =>
    logger.warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes(SEED_WARNING));

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-not-loaded-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('GET install-local after a restart whose rehydrate refused an entry', () => {
    it('PRECONDITION: the rehydrate refused the old entry and loaded the current one', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        expect(h.registered()).toContain(LOADED.id);
        expect(h.registered()).not.toContain(REFUSED.id);
        const said = h.logger.error.mock.calls.map(([m]) => String(m));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(`OS_PROTOCOL_INCOMPATIBLE: ${REFUSED.id}@1.0.0 is NOT loaded`);
    });

    it('lists the refused entry with the marker and the code: notLoaded { code, requiredRange }, in place of withSampleData', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const listing = await h.list();
        expect(listing.status).toBe(200);
        expect(listing.data.total).toBe(2);
        expect(listing.byId.get(REFUSED.id)).toEqual({
            packageId: REFUSED.id,
            versionId: '1.0.0',
            manifestId: REFUSED.id,
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: OLD_RANGE },
            installedBy: INSTALLER_USER_ID,
        });
        // CLOSED: exactly the two members, nothing else of the diagnostic.
        expect(Object.keys(listing.byId.get(REFUSED.id).notLoaded).sort()).toEqual(['code', 'requiredRange']);
    });

    it('reads no seed row for the marked entry, and the listing\'s seed-row warning does not fire for it', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const listing = await h.list();
        expect(listing.status).toBe(200);
        // Control: the double sees the listing's reads; the loadable entry's rows were read.
        expect(h.reads).toContain('qa_cur_account');
        // One expectation, so a regression shows both facts at once.
        expect({
            readsOfMarkedEntry: h.reads.filter((object) => object === 'qa_old_account'),
            seedWarnings: seedWarnings(h.logger),
        }).toEqual({ readsOfMarkedEntry: [], seedWarnings: [] });
    });

    it('a loadable entry is unchanged: its rows answer withSampleData, and its item is the one served without the refused entry', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const beside = (await h.list()).byId.get(LOADED.id);
        expect(beside).toEqual({
            packageId: LOADED.id,
            versionId: '1.0.0',
            manifestId: LOADED.id,
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            withSampleData: true,
            installedBy: INSTALLER_USER_ID,
        });
        expect(beside).not.toHaveProperty('notLoaded');

        const alone = mkdtempSync(join(tmpdir(), 'mil-not-loaded-alone-'));
        try {
            const solo = await restartWith([LOADED], alone);
            expect(JSON.stringify((await solo.list()).byId.get(LOADED.id))).toBe(JSON.stringify(beside));
        } finally {
            rmSync(alone, { recursive: true, force: true });
        }
    });

    it('the narrowed caller sees the marker too, without the two operator fields', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        h.caller.as = 'member';
        const listing = await h.list();
        expect(listing.status).toBe(200);
        expect(listing.data).not.toHaveProperty('storageDir');
        expect(listing.byId.get(REFUSED.id)).toEqual({
            packageId: REFUSED.id,
            versionId: '1.0.0',
            manifestId: REFUSED.id,
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: OLD_RANGE },
        });
    });

    it('DELETE on the marked entry still works, and the listing then serves the loadable entry alone', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const res = await h.uninstall(REFUSED.id);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.manifestId).toBe(REFUSED.id);
        expect(new LocalManifestSource(dir).has(REFUSED.id)).toBe(false);
        const listing = await h.list();
        expect(listing.data.total).toBe(1);
        expect([...listing.byId.keys()]).toEqual([LOADED.id]);
    });

    it('a compatible version installed over the marked entry is listed as loaded, with no marker', async () => {
        const h = await restartWith([REFUSED, LOADED], dir);
        const { data: _seed, ...withoutSeed } = REFUSED;
        const res = await h.install({ manifest: { ...withoutSeed, version: '2.0.0', engines: { protocol: CURRENT_RANGE } } });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.registered()).toContain(REFUSED.id);
        const item = (await h.list()).byId.get(REFUSED.id);
        expect(item).toMatchObject({ manifestId: REFUSED.id, version: '2.0.0', withSampleData: false });
        expect(item).not.toHaveProperty('notLoaded');
    });
});
