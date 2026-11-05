// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30324 · ruling 6670861426] An installed package's sample rows are owned by
 * the person who seeded them.
 *
 * Two halves:
 *
 *  1. {@link stampSeedOwner} over an engine that applies its predicate writes to
 *     rows in memory, so each pin reads the rows, not the call: which rows get
 *     an owner and a creator, and which keep what they had.
 *  2. The four seeding doors of the real plugin (install, reseed, the boot
 *     heal, the per-organization replayer), each over a loader stand-in that
 *     reports `insertedIds` beside `landedIds`: which person each door names,
 *     and that a door with no person writes nothing.
 *
 * That an owned sample row then follows the ordinary rules (a colleague under
 * `private` sharing reads none of it, the installer reads, edits and deletes
 * it) needs the real security and sharing stack, and is pinned end to end in
 * `packages/cli/test/package-install-local-sample-owner.integration.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let seedResult: any;
let loadCalls: any[] = [];

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: any) { loadCalls.push(request); return seedResult; }
    },
    recordSeedOutcome: vi.fn(),
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
}));
// Only the seed-request parse is stubbed; every other export stays the real one.
vi.mock('@objectstack/spec/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@objectstack/spec/data')>()),
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

import { SEED_OWNER_STAMP_BATCH, SEED_OWNER_STAMP_CTX, stampSeedOwner } from './marketplace-install-local-seed-owner.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Row = Record<string, any>;

/** The audit/ownership columns every user-authored object carries. */
const OWNED_FIELDS = { name: { type: 'text' }, owner_id: { type: 'lookup' }, created_by: { type: 'lookup' } };

/**
 * An engine whose predicate writes land on in-memory rows: equality, `null`
 * as IS NULL, and `$in`, the three terms the stamp writes. `refuse` makes a
 * write throw before it lands, as the engine's whole-write refusals do.
 */
function memoryEngine(schemas: Record<string, any>, rows: Record<string, Row[]>, refuse?: (object: string, where: Row) => boolean) {
    const writes: Array<{ object: string; data: Row; where: Row; context: unknown }> = [];
    const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
        if (v === null) return row[k] == null;
        return row[k] === v;
    });
    return {
        writes,
        getSchema: (name: string) => schemas[name],
        update: async (object: string, data: Row, options: { where: Row; context: unknown }) => {
            writes.push({ object, data, where: options.where, context: options.context });
            if (refuse?.(object, options.where)) throw new Error(`'display_title' on '${object}' is computed from its expression on every write`);
            let n = 0;
            for (const row of rows[object] ?? []) {
                if (!matches(row, options.where)) continue;
                Object.assign(row, data);
                n += 1;
            }
            return n;
        },
    };
}

describe('stampSeedOwner — the rows a load created get the person who seeded them', () => {
    it('writes owner_id and created_by on every row the load CREATED, under the claim\'s write context', async () => {
        const rows = { crm_deal: [{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }] };
        const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields: OWNED_FIELDS } }, rows);

        const out = await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ['d1', 'd2'] }], 'usr_installer');

        expect(rows.crm_deal).toEqual([
            { id: 'd1', name: 'A', owner_id: 'usr_installer', created_by: 'usr_installer' },
            { id: 'd2', name: 'B', owner_id: 'usr_installer', created_by: 'usr_installer' },
        ]);
        expect(out.objects).toEqual([{ object: 'crm_deal', created: 2, owner: 2, createdBy: 2, refused: 0 }]);
        // Attribution, not a user's edit: no app hook, no flow (#22067's context).
        for (const w of engine.writes) expect(w.context).toEqual({ isSystem: true, skipAutomations: true });
        expect(SEED_OWNER_STAMP_CTX).toEqual({ isSystem: true, skipAutomations: true });
    });

    it('NEGATIVE: a row the load only MATCHED (landed, not inserted) keeps the owner it had', async () => {
        // `m1` is a customer's row a seed record's key matched: landed, never inserted.
        const rows = { crm_deal: [{ id: 'd1' }, { id: 'm1', owner_id: null, created_by: null }] };
        const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields: OWNED_FIELDS } }, rows);

        await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ['d1'], landedIds: ['d1', 'm1'] } as any], 'usr_installer');

        expect(rows.crm_deal[1]).toEqual({ id: 'm1', owner_id: null, created_by: null });
        expect(rows.crm_deal[0]).toMatchObject({ owner_id: 'usr_installer', created_by: 'usr_installer' });
    });

    it('NEGATIVE: an owner or creator the seed record authored is kept, and only the empty one is written', async () => {
        const rows = {
            crm_deal: [
                { id: 'd1', owner_id: 'usr_authored', created_by: null },
                { id: 'd2', owner_id: null, created_by: 'usr_authored' },
                { id: 'd3', owner_id: 'usr_authored', created_by: 'usr_authored' },
            ],
        };
        const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields: OWNED_FIELDS } }, rows);

        const out = await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ['d1', 'd2', 'd3'] }], 'usr_installer');

        expect(rows.crm_deal).toEqual([
            { id: 'd1', owner_id: 'usr_authored', created_by: 'usr_installer' },
            { id: 'd2', owner_id: 'usr_installer', created_by: 'usr_authored' },
            { id: 'd3', owner_id: 'usr_authored', created_by: 'usr_authored' },
        ]);
        expect(out.objects[0]).toMatchObject({ owner: 1, createdBy: 1 });
    });

    it('NEGATIVE: under a wall the stamp lands only in the organization the load wrote', async () => {
        const fields = { ...OWNED_FIELDS, organization_id: { type: 'lookup' } };
        const rows = { crm_deal: [{ id: 'd1', organization_id: 'org_a' }, { id: 'd2', organization_id: 'org_b' }] };
        const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields } }, rows);

        await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ['d1', 'd2'] }], 'usr_founder', { organizationId: 'org_a' });

        expect(rows.crm_deal[0]).toMatchObject({ owner_id: 'usr_founder', created_by: 'usr_founder' });
        expect(rows.crm_deal[1]).toEqual({ id: 'd2', organization_id: 'org_b' });
    });

    it('NEGATIVE: no person, or the seed identity, writes nothing', async () => {
        for (const owner of [null, undefined, '', '  ', 'usr_system']) {
            const rows = { crm_deal: [{ id: 'd1' }] };
            const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields: OWNED_FIELDS } }, rows);
            const out = await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ['d1'] }], owner as any);
            expect(out).toEqual({ ownerUserId: null, objects: [] });
            expect(engine.writes).toEqual([]);
            expect(rows.crm_deal[0]).toEqual({ id: 'd1' });
        }
    });

    it('NEGATIVE: platform tables, managed and federated objects, and objects with neither column are left alone', async () => {
        const schemas = {
            sys_thing: { name: 'sys_thing', fields: OWNED_FIELDS },
            managed_thing: { name: 'managed_thing', managedBy: 'package', fields: OWNED_FIELDS },
            remote_thing: { name: 'remote_thing', external: { datasource: 'erp' }, fields: OWNED_FIELDS },
            bare_thing: { name: 'bare_thing', fields: { name: { type: 'text' } } },
        };
        const rows: Record<string, Row[]> = Object.fromEntries(Object.keys(schemas).map((n) => [n, [{ id: `${n}_1` }]]));
        const engine = memoryEngine(schemas, rows);

        const out = await stampSeedOwner(engine, [
            ...Object.keys(schemas).map((object) => ({ object, insertedIds: [`${object}_1`] })),
            { object: 'unknown_thing', insertedIds: ['u1'] },
        ], 'usr_installer');

        expect(engine.writes).toEqual([]);
        expect(out.objects.map((o) => [o.object, o.skipped])).toEqual([
            ['sys_thing', 'platform-object'],
            ['managed_thing', 'platform-object'],
            ['remote_thing', 'external'],
            ['bare_thing', 'no-owner-columns'],
            ['unknown_thing', 'no-schema'],
        ]);
    });

    it('an object with only one of the two columns gets that one', async () => {
        const rows = { crm_note: [{ id: 'n1' }] };
        const engine = memoryEngine({ crm_note: { name: 'crm_note', fields: { name: { type: 'text' }, created_by: { type: 'lookup' } } } }, rows);

        await stampSeedOwner(engine, [{ object: 'crm_note', insertedIds: ['n1'] }], 'usr_installer');

        expect(rows.crm_note[0]).toEqual({ id: 'n1', created_by: 'usr_installer' });
    });

    it('a refused chunk is written row by row: only the row the engine refuses keeps no owner, and it is counted', async () => {
        // HotCRM's `crm_forecast.display_title` shape: one predicate write over
        // rows computing different values is refused whole, by id it is not.
        const rows = { crm_forecast: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] };
        const refuse = (_o: string, where: Row) => Array.isArray(where.id?.$in) || where.id === 'f2';
        const engine = memoryEngine({ crm_forecast: { name: 'crm_forecast', fields: OWNED_FIELDS } }, rows, refuse);

        const out = await stampSeedOwner(engine, [{ object: 'crm_forecast', insertedIds: ['f1', 'f2', 'f3'] }], 'usr_installer');

        expect(rows.crm_forecast).toEqual([
            { id: 'f1', owner_id: 'usr_installer', created_by: 'usr_installer' },
            { id: 'f2' },
            { id: 'f3', owner_id: 'usr_installer', created_by: 'usr_installer' },
        ]);
        expect(out.objects[0]).toMatchObject({ refused: 1, owner: 2, createdBy: 2 });
        expect(out.objects[0].error).toContain('computed from its expression');
    });

    it(`writes at most ${SEED_OWNER_STAMP_BATCH} ids per write, and every created row is reached`, async () => {
        const ids = Array.from({ length: 120 }, (_, i) => `d${i}`);
        const rows = { crm_deal: ids.map((id) => ({ id })) };
        const engine = memoryEngine({ crm_deal: { name: 'crm_deal', fields: OWNED_FIELDS } }, rows);

        await stampSeedOwner(engine, [{ object: 'crm_deal', insertedIds: ids.slice(0, 70) }, { object: 'crm_deal', insertedIds: ids.slice(60) }], 'usr_installer');

        for (const w of engine.writes) expect(w.where.id.$in.length).toBeLessThanOrEqual(SEED_OWNER_STAMP_BATCH);
        expect(rows.crm_deal.every((r) => r.owner_id === 'usr_installer' && r.created_by === 'usr_installer')).toBe(true);
    });
});

// ── The four doors ───────────────────────────────────────────────────────────

const MANIFEST = {
    id: 'app.test.owner',
    version: '1.0.0',
    objects: [{ name: 'own_deal', fields: { name: { type: 'text' } } }],
    data: [{ object: 'own_deal', externalId: 'name', records: [{ name: 'Acme' }, { name: 'Globex' }] }],
};
const SCHEMAS: Record<string, any> = {
    own_deal: { name: 'own_deal', fields: { ...OWNED_FIELDS, organization_id: { type: 'lookup' } } },
};
/** The loader's answer: `d_new` created by this load, `d_old` a pre-existing row a key matched. */
const LOADED = () => ({
    summary: { totalInserted: 1, totalUpdated: 1, totalSkipped: 0 },
    errors: [],
    results: [{ object: 'own_deal', landedIds: ['d_new', 'd_old'], insertedIds: ['d_new'] }],
});

let dir: string;
let restoreOwner: () => void;
const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-seed-owner-'));
    seedResult = LOADED();
    loadCalls = [];
    // Under a wall the installer is the deployment's declared platform owner.
    restoreOwner = declareInstallerPlatformOwner();
});
afterEach(() => {
    restoreOwner();
    rmSync(dir, { recursive: true, force: true });
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    vi.restoreAllMocks();
});

type Handler = (c: any) => Promise<any>;

/** The plugin over a kernel-faithful registry, its session acting as `admin` in `activeOrg`. */
async function bootDoors(opts: { posture: 'single' | 'isolated'; activeOrg?: string; ledger?: Row }) {
    process.env.OS_TENANCY_POSTURE = opts.posture;
    if (opts.ledger) new LocalManifestSource(dir).write(opts.ledger as any);
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const updates: Array<{ object: string; data: Row; where: Row }> = [];
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: opts.activeOrg
            ? { api: { getSession: async () => ({ user: { id: 'admin' }, session: { activeOrganizationId: opts.activeOrg } }) } }
            : installerAuthService(),
        objectql: withInstallerGrants({
            syncSchemas: async () => undefined,
            // Every seeded object reads empty, so the boot heal runs when the ledger holds the package.
            // (`sys_user` is answered by the installer fixture: the installer, `admin`.)
            find: vi.fn(async () => []),
            getSchema: (name: string) => SCHEMAS[name],
            update: vi.fn(async (object: string, data: Row, o: { where: Row }) => { updates.push({ object, data, where: o.where }); return 1; }),
        }),
        metadata: {},
    };
    const registry = new Map<string, unknown>();
    const hooks = new Map<string, () => Promise<void>>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (name === 'tenancy') return { posture: opts.posture };
            if (registry.has(name)) return registry.get(name);
            if (services[name] === undefined) throw new Error(`[Kernel] Service '${name}' not found.`);
            return services[name];
        },
        registerService: (name: string, svc: unknown) => {
            if (registry.has(name) || services[name] !== undefined) throw new Error(`Service '${name}' already registered`);
            registry.set(name, svc);
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const call = (route: string, body: unknown, manifestId?: string) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(route)!({
            req: {
                url: 'http://localhost:3000/api/v1/marketplace/install-local',
                raw: new Request('http://localhost:3000/x'),
                json: async () => body,
                param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
                header: () => undefined,
            },
            json,
        });
    };
    return { updates, logger, registry, call };
}

const ledgerEntry = (installedBy: string | null): Row => ({
    packageId: 'pkg_owner',
    versionId: 'local',
    manifestId: MANIFEST.id,
    version: MANIFEST.version,
    manifest: MANIFEST,
    installedAt: '2026-01-01T00:00:00.000Z',
    installedBy,
    withSampleData: true,
});

/** The owner every write named, and the ids it reached. */
const stamped = (updates: Array<{ data: Row; where: Row }>) => ({
    owners: [...new Set(updates.flatMap((u) => [u.data.owner_id, u.data.created_by]).filter(Boolean))],
    ids: [...new Set(updates.flatMap((u) => u.where.id?.$in ?? [u.where.id]))],
});

const infoLines = (logger: { info: any }) => logger.info.mock.calls.map((c: any[]) => String(c[0]));

describe('#30324 — each seeding door names the person who owns the rows its load created', () => {
    it('install: the installing user owns the rows the install created, and only those', async () => {
        const doors = await bootDoors({ posture: 'single' });

        const res = await doors.call('POST /api/v1/marketplace/install-local', { manifest: MANIFEST });

        expect(res.payload?.success).toBe(true);
        expect(loadCalls).toHaveLength(1);
        expect(stamped(doors.updates)).toEqual({ owners: ['admin'], ids: ['d_new'] });
    });

    it('install under a wall: the stamp is scoped to the installing organization', async () => {
        const doors = await bootDoors({ posture: 'isolated', activeOrg: 'org_a' });

        const res = await doors.call('POST /api/v1/marketplace/install-local', { manifest: MANIFEST });

        expect(res.payload?.success, JSON.stringify(res.payload)).toBe(true);
        expect(doors.updates.length).toBeGreaterThan(0);
        for (const u of doors.updates) expect(u.where.organization_id).toBe('org_a');
        expect(stamped(doors.updates).owners).toEqual(['admin']);
    });

    it('reseed: the reseeding user owns the rows, not the installer the ledger records', async () => {
        // The ledger names another installer, who is not a user any more: the
        // boot heal (every table empty) names nobody, so nothing is stamped
        // until the reseed.
        const doors = await bootDoors({ posture: 'single', ledger: ledgerEntry('usr_original') });
        expect(doors.updates).toEqual([]);

        const res = await doors.call('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data', {}, MANIFEST.id);

        expect(res.status).toBe(200);
        expect(stamped(doors.updates)).toEqual({ owners: ['admin'], ids: ['d_new'] });
    });

    it('boot heal: the installer the ledger records owns the healed rows, once a user lookup finds them', async () => {
        const doors = await bootDoors({ posture: 'single', ledger: ledgerEntry('admin') });

        expect(loadCalls).toHaveLength(1);
        expect(stamped(doors.updates)).toEqual({ owners: ['admin'], ids: ['d_new'] });
    });

    it('NEGATIVE boot heal: a ledger with no installer, or one no longer a user, names nobody — the rows keep no owner, and the log says why', async () => {
        for (const [installedBy, why] of [[null, 'records no installer'], ['usr_gone', 'is no longer a user']] as const) {
            loadCalls = [];
            rmSync(dir, { recursive: true, force: true });
            dir = mkdtempSync(join(tmpdir(), 'mil-seed-owner-'));
            const doors = await bootDoors({ posture: 'single', ledger: ledgerEntry(installedBy) });

            expect(loadCalls).toHaveLength(1);
            expect(doors.updates).toEqual([]);
            expect(infoLines(doors.logger).some((l) => l.includes('keep no owner') && l.includes(why))).toBe(true);
        }
    });

    it('per-organization replay: the founder owns the rows, in that organization', async () => {
        const doors = await bootDoors({ posture: 'isolated' });
        await doors.call('POST /api/v1/marketplace/install-local', { manifest: MANIFEST }); // walled, no active org: merged, not seeded
        expect(doors.updates).toEqual([]);

        const replayer = doors.registry.get('seed-replayer') as (id: string, o?: { userId?: string }) => Promise<any>;
        await replayer('org_new', { userId: 'usr_founder' });

        expect(stamped(doors.updates)).toEqual({ owners: ['usr_founder'], ids: ['d_new'] });
        for (const u of doors.updates) expect(u.where.organization_id).toBe('org_new');
    });

    it('NEGATIVE per-organization replay: no founder named, no owner written, and the log says so', async () => {
        const doors = await bootDoors({ posture: 'isolated' });
        await doors.call('POST /api/v1/marketplace/install-local', { manifest: MANIFEST });

        const replayer = doors.registry.get('seed-replayer') as (id: string, o?: { userId?: string }) => Promise<any>;
        await replayer('org_new');

        expect(doors.updates).toEqual([]);
        expect(infoLines(doors.logger).some((l) => l.includes('keep no owner') && l.includes('names no founder'))).toBe(true);
    });
});
