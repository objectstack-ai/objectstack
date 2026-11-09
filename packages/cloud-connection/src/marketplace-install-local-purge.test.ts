// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The install-local purge: which rows it deletes, in which scope, in which
 * order, and how it reports a row it could not delete.
 *
 * ## The defect these pin
 *
 * The purge looked up a bare `driver` service — a name no kernel registers
 * (drivers register as `driver.<name>`) — so the door answered
 * `500 DRIVER_UNAVAILABLE` on every runtime. Behind that it matched seed
 * records by `rec.id`, which the CRM example's 28 records do not carry (they
 * key by `name` / `email` / `subject`), and called the driver's `delete`
 * directly, past every engine hook. The suites around it stayed green because
 * they mocked a bare `driver` the kernel never has.
 *
 * ## The doubles here
 *
 * The engine is in-memory and honest about what it does not implement: `find`
 * answers scalar equality and REFUSES anything else, and `delete` opens with
 * the real dispatch contract (`assertEngineDeleteDispatch`), so a purge that
 * sent a predicate-shaped delete would fail here exactly as it fails on the
 * real engine. The route block runs the REAL `SeedLoaderService` — its
 * dependency graph is the order the purge must reverse — over a metadata
 * service serving the package's object definitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';

import { countSeedRows, matchSeedRows, purgeSeedRows, seedDatasetOfReceiptItem, type PurgeSeedDataset, type SeedMatchProblem } from './marketplace-install-local-purge.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, installerEmail, INSTALLER_USER_ID, withInstallerGrants } from './install-local-principal.fixtures.js';
// The purge route loads the REAL `SeedLoaderService` through a dynamic import;
// paid here, during collection, so no clocked window measures that load.
import '@objectstack/runtime';

type Row = Record<string, unknown> & { id: string };

/**
 * An in-memory engine over `tables`. `refuse` names an `object#id` the engine
 * throws on, the way a hook or a `restrict` reference refuses a delete.
 */
function makeEngine(tables: Record<string, Row[]>, refuse: Record<string, string> = {}) {
    const reads: Array<{ object: string; query: any }> = [];
    const deletes: Array<{ object: string; id: string; context: unknown }> = [];
    const engine = {
        async find(object: string, query?: any): Promise<any[]> {
            reads.push({ object, query });
            const where: Record<string, unknown> = query?.where ?? {};
            const rows = (tables[object] ?? []).filter((row) => Object.entries(where).every(([k, v]) => {
                // Scalar equality only; anything else is refused, never guessed.
                if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
                    throw new Error(`only scalar equality is implemented here (got '${k}')`);
                }
                return row[k] === v;
            }));
            const page = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
            return page.map((row) => ({ ...row }));
        },
        async delete(object: string, options?: any): Promise<boolean> {
            const dispatch = assertEngineDeleteDispatch(options);
            if (dispatch.kind !== 'by-id') throw new Error('fake engine: the purge deletes by primary key only');
            const id = String(dispatch.id);
            const reason = refuse[`${object}#${id}`];
            if (reason) throw new Error(reason);
            deletes.push({ object, id, context: options?.context });
            const table = tables[object] ?? [];
            const at = table.findIndex((r) => r.id === id);
            if (at < 0) return false;
            table.splice(at, 1);
            return true;
        },
    };
    return { engine, reads, deletes };
}

/** account ← contact; both keyed by a natural key, the CRM shape. */
const GRAPH = {
    insertOrder: ['acc', 'con'],
    nodes: [
        { object: 'acc', dependsOn: [], references: [] },
        { object: 'con', dependsOn: ['acc'], references: [{ field: 'account', targetObject: 'acc', targetField: 'name', fieldType: 'lookup' as const }] },
    ],
};

const DATASETS: PurgeSeedDataset[] = [
    { object: 'acc', externalId: 'name', records: [{ name: 'Acme' }, { name: 'Globex' }] },
    { object: 'con', externalId: 'email', records: [{ email: 'ada@acme.test', account: 'Acme' }] },
];

function names(rows: Row[] | undefined, field = 'name'): unknown[] {
    return (rows ?? []).map((r) => r[field]).sort();
}

describe('purgeSeedRows — what is a seed row', () => {
    it('deletes exactly the rows carrying a key a seed record declares; a user row in a seeded object survives', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }, { id: 'u1', name: 'User Authored Co' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }, { id: 'u2', email: 'mine@user.test', account: 'u1' }],
        };
        const { engine } = makeEngine(tables);
        const warn = vi.fn();

        const out = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn });

        expect(out).toEqual({ deleted: 3, skipped: 0, errors: 0 });
        expect(names(tables.acc)).toEqual(['User Authored Co']);
        expect(names(tables.con, 'email')).toEqual(['mine@user.test']);
        expect(warn).not.toHaveBeenCalled();
    });

    it('matches by the seed key, not by an id the seed record happens to carry', async () => {
        // The authored id names no row (a per-organization replay re-identifies
        // rows; an id-keyed purge was the defect). The key still finds it.
        const tables: Record<string, Row[]> = { acc: [{ id: 'row-7', name: 'Acme' }] };
        const { engine } = makeEngine(tables);
        const out = await purgeSeedRows({
            engine,
            datasets: [{ object: 'acc', externalId: 'name', records: [{ id: 'authored-1', name: 'Acme' }] }],
            graph: { insertOrder: ['acc'], nodes: [{ object: 'acc', dependsOn: [], references: [] }] },
            warn: vi.fn(),
        });
        expect(out).toEqual({ deleted: 1, skipped: 0, errors: 0 });
        expect(tables.acc).toEqual([]);
    });

    it('keys a dataset that names no externalId by the spec default (`name`)', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'a1', name: 'Acme' }, { id: 'u1', name: 'Mine' }] };
        const { engine } = makeEngine(tables);
        const out = await purgeSeedRows({
            engine,
            datasets: [{ object: 'acc', records: [{ name: 'Acme' }] }],
            graph: { insertOrder: ['acc'], nodes: [{ object: 'acc', dependsOn: [], references: [] }] },
            warn: vi.fn(),
        });
        expect(out).toEqual({ deleted: 1, skipped: 0, errors: 0 });
        expect(names(tables.acc)).toEqual(['Mine']);
    });

    it('counts a seed key no row carries as skipped (already purged)', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'a1', name: 'Acme' }], con: [] };
        const { engine } = makeEngine(tables);
        const out = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn: vi.fn() });
        // Globex and the contact are gone already; Acme is deleted.
        expect(out).toEqual({ deleted: 1, skipped: 2, errors: 0 });
    });
});

describe('purgeSeedRows — it does not guess', () => {
    it('a key carried by TWO rows in scope is an error, and neither row is deleted', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'a1', name: 'Acme' }, { id: 'u1', name: 'Acme' }] };
        const { engine, deletes } = makeEngine(tables);
        const warn = vi.fn();
        const out = await purgeSeedRows({
            engine,
            datasets: [{ object: 'acc', externalId: 'name', records: [{ name: 'Acme' }] }],
            graph: { insertOrder: ['acc'], nodes: [{ object: 'acc', dependsOn: [], references: [] }] },
            warn,
        });
        expect(out).toEqual({ deleted: 0, skipped: 0, errors: 1 });
        expect(deletes).toEqual([]);
        expect(String(warn.mock.calls[0]?.[0])).toContain('2 rows in scope carry the seed key');
    });

    it('a seed record with no value for its key field is an error, not a skip', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'a1', name: 'Acme' }] };
        const { engine } = makeEngine(tables);
        const warn = vi.fn();
        const out = await purgeSeedRows({
            engine,
            datasets: [{ object: 'acc', externalId: 'name', records: [{ industry: 'tech' }] }],
            graph: { insertOrder: ['acc'], nodes: [{ object: 'acc', dependsOn: [], references: [] }] },
            warn,
        });
        expect(out).toEqual({ deleted: 0, skipped: 0, errors: 1 });
        expect(String(warn.mock.calls[0]?.[0])).toContain("no value for its key field 'name'");
        expect(tables.acc).toHaveLength(1);
    });

    it('an engine refusal is counted in errors with its reason — never as skipped — and the rest still go', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { engine } = makeEngine(tables, { 'acc#a1': 'beforeDelete: accounts with open deals cannot be deleted' });
        const warn = vi.fn();
        const out = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn });
        expect(out).toEqual({ deleted: 2, skipped: 0, errors: 1 });
        expect(names(tables.acc)).toEqual(['Acme']);
        expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('accounts with open deals cannot be deleted');
    });
});

describe('purgeSeedRows — order, context and scope', () => {
    it('deletes child before parent — the reverse of the loader insert order — under the seed write context', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { engine, deletes } = makeEngine(tables);
        await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn: vi.fn() });
        expect(deletes.map((d) => d.object)).toEqual(['con', 'acc', 'acc']);
        for (const d of deletes) expect(d.context).toEqual(SEED_WRITE_EXECUTION_CONTEXT);
    });

    it('with an organization, every read is pinned to it and another organization\'s seed rows are never touched', async () => {
        const tables: Record<string, Row[]> = {
            acc: [
                { id: 'a1', name: 'Acme', organization_id: 'org_a' },
                { id: 'b1', name: 'Acme', organization_id: 'org_b' },
                { id: 'b2', name: 'Globex', organization_id: 'org_b' },
            ],
            con: [],
        };
        const { engine, reads } = makeEngine(tables);
        const out = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, organizationId: 'org_a', warn: vi.fn() });
        expect(out).toEqual({ deleted: 1, skipped: 2, errors: 0 });
        expect(tables.acc.map((r) => r.id).sort()).toEqual(['b1', 'b2']);
        for (const r of reads) expect(r.query.where).toEqual({ organization_id: 'org_a' });
    });

    it('without an organization (no wall) the match is table-wide, as the loader\'s upsert match is', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'a1', name: 'Acme', organization_id: null }], con: [] };
        const { engine, reads } = makeEngine(tables);
        const out = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn: vi.fn() });
        expect(out.deleted).toBe(1);
        for (const r of reads) expect(r.query.where).toBeUndefined();
    });
});

describe('purgeSeedRows — reference parts of a key', () => {
    // The showcase's junction shape: `externalId: ['team', 'project']`, both
    // lookups, stored as the parent rows' ids (framework#3434).
    const JUNCTION_GRAPH = {
        insertOrder: ['team', 'project', 'membership'],
        nodes: [
            { object: 'team', dependsOn: [], references: [] },
            { object: 'project', dependsOn: [], references: [] },
            {
                object: 'membership',
                dependsOn: ['team', 'project'],
                references: [
                    { field: 'team', targetObject: 'team', targetField: 'name', fieldType: 'lookup' as const },
                    { field: 'project', targetObject: 'project', targetField: 'name', fieldType: 'lookup' as const },
                ],
            },
        ],
    };

    it('translates a reference part through the parent row this purge matched', async () => {
        const tables: Record<string, Row[]> = {
            team: [{ id: 't1', name: 'Platform' }],
            project: [{ id: 'p1', name: 'Data Platform' }],
            membership: [{ id: 'm1', team: 't1', project: 'p1' }, { id: 'm2', team: 't1', project: 'user-project' }],
        };
        const { engine } = makeEngine(tables);
        const out = await purgeSeedRows({
            engine,
            datasets: [
                { object: 'team', externalId: 'name', records: [{ name: 'Platform' }] },
                { object: 'project', externalId: 'name', records: [{ name: 'Data Platform' }] },
                { object: 'membership', externalId: ['team', 'project'], records: [{ team: 'Platform', project: 'Data Platform' }] },
            ],
            graph: JUNCTION_GRAPH,
            warn: vi.fn(),
        });
        expect(out).toEqual({ deleted: 3, skipped: 0, errors: 0 });
        expect(tables.membership.map((r) => r.id)).toEqual(['m2']);
    });

    it('a key part referencing an object this package does not seed is an error', async () => {
        const tables: Record<string, Row[]> = { membership: [{ id: 'm1', team: 't1', project: 'p1' }] };
        const { engine } = makeEngine(tables);
        const warn = vi.fn();
        const out = await purgeSeedRows({
            engine,
            datasets: [{ object: 'membership', externalId: ['team', 'project'], records: [{ team: 'Platform', project: 'Data Platform' }] }],
            graph: { insertOrder: ['membership'], nodes: [JUNCTION_GRAPH.nodes[2]] },
            warn,
        });
        expect(out).toEqual({ deleted: 0, skipped: 0, errors: 1 });
        expect(String(warn.mock.calls[0]?.[0])).toContain("references 'team', which this package does not seed");
    });
});

describe('matchSeedRows — the identification, read-only', () => {
    it('identifies exactly the rows the purge deletes, and deletes nothing', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }, { id: 'u1', name: 'User Authored Co' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { engine, deletes } = makeEngine(tables);
        const match = await matchSeedRows({ engine, datasets: DATASETS, graph: GRAPH, report: vi.fn() });
        expect(match).toEqual({
            rows: [{ object: 'acc', id: 'a1' }, { object: 'acc', id: 'a2' }, { object: 'con', id: 'c1' }],
            absent: 0,
            unidentified: 0,
        });
        expect(deletes).toEqual([]);
        expect(tables.acc).toHaveLength(3);
    });

    it('`firstOnly` stops at the first identified row: one object read when the first parent matches', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { engine, reads } = makeEngine(tables);
        const match = await matchSeedRows({ engine, datasets: DATASETS, graph: GRAPH, report: vi.fn(), firstOnly: true });
        expect(match.rows).toEqual([{ object: 'acc', id: 'a1' }]);
        expect(reads.map((r) => r.object)).toEqual(['acc']);
    });

    it('`firstOnly` with no seed row in scope reads every seeded object and identifies nothing', async () => {
        const tables: Record<string, Row[]> = { acc: [{ id: 'u1', name: 'User Authored Co' }], con: [] };
        const { engine, reads } = makeEngine(tables);
        const match = await matchSeedRows({ engine, datasets: DATASETS, graph: GRAPH, report: vi.fn(), firstOnly: true });
        expect(match.rows).toEqual([]);
        expect(reads.map((r) => r.object)).toEqual(['acc', 'con']);
    });

    it('reports a failed read as `read` data, counting every record of that dataset as unidentified', async () => {
        const { engine } = makeEngine({ con: [] });
        const failing = {
            ...engine,
            find: async (object: string, query?: any) => {
                if (object === 'acc') throw new Error('no such table: acc');
                return engine.find(object, query);
            },
        };
        const problems: SeedMatchProblem[] = [];
        const match = await matchSeedRows({ engine: failing, datasets: DATASETS, graph: GRAPH, report: (p) => problems.push(p) });
        expect(problems[0]).toEqual({ object: 'acc', kind: 'read', records: 2, detail: 'no such table: acc' });
        expect(match.unidentified).toBe(2);
        expect(match.rows).toEqual([]);
    });
});

describe('countSeedRows — the purge\'s reading, before it deletes', () => {
    it('counts exactly the rows the purge then deletes, and deletes nothing itself', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a2', name: 'Globex' }, { id: 'u1', name: 'User Co' }],
            con: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { engine, deletes } = makeEngine(tables);
        const counted = await countSeedRows({ engine, datasets: DATASETS, graph: GRAPH, report: () => {} });
        expect(counted).toEqual({ count: 3, unidentified: 0 });
        expect(deletes).toEqual([]);

        const purged = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn: () => {} });
        expect(purged.deleted).toBe(counted.count);
        expect(names(tables.acc)).toEqual(['User Co']);
    });

    it('a key two rows carry is unidentified — counted out, the purge\'s error, never a row it deletes', async () => {
        const tables: Record<string, Row[]> = {
            acc: [{ id: 'a1', name: 'Acme' }, { id: 'a9', name: 'Acme' }, { id: 'a2', name: 'Globex' }],
            con: [],
        };
        const { engine } = makeEngine(tables);
        const problems: SeedMatchProblem[] = [];
        const counted = await countSeedRows({ engine, datasets: DATASETS, graph: GRAPH, report: (p) => problems.push(p) });
        expect(counted).toEqual({ count: 1, unidentified: 1 });
        expect(problems.map((p) => p.kind)).toEqual(['ambiguous']);

        const purged = await purgeSeedRows({ engine, datasets: DATASETS, graph: GRAPH, warn: () => {} });
        expect(purged).toMatchObject({ deleted: counted.count, errors: counted.unidentified });
    });
});

// ── The route: scope chosen by the install's own rule, order from the loader ──

type Handler = (c: any) => Promise<any>;

const MANIFEST = {
    id: 'app.test.purge',
    version: '1.0.0',
    objects: [
        { name: 'pg_account', fields: { name: { type: 'text' } } },
        { name: 'pg_contact', fields: { email: { type: 'text' }, account: { type: 'lookup', reference: 'pg_account' } } },
    ],
    data: [
        { object: 'pg_contact', externalId: 'email', records: [{ email: 'ada@acme.test', account: 'Acme' }] },
        { object: 'pg_account', externalId: 'name', records: [{ name: 'Acme' }] },
    ],
};

const PURGE = 'POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data';
const LIST = 'GET /api/v1/marketplace/install-local';
const COUNT = 'GET /api/v1/marketplace/install-local/:manifestId/sample-data';

function makeC(manifestId: string, query?: Record<string, string>) {
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => ({}),
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            // Hono's `c.req.query()`: every parameter, by name.
            query: () => ({ ...query }),
            header: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-purge-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * Boot the plugin over a ledger that already holds the install, the way a
 * restarted runtime meets it. `posture` is the `tenancy` service's posture in
 * force; `activeOrg` what the session's `activeOrganizationId` says.
 */
async function bootWith(opts: {
    tables: Record<string, Row[]>;
    posture?: 'single' | 'isolated';
    activeOrg?: string;
    services?: Record<string, unknown>;
    /** The ledgered package; {@link MANIFEST} unless a pin needs another shape. */
    manifest?: Record<string, unknown> & { id: string; version: string };
}) {
    const manifest = opts.manifest ?? MANIFEST;
    new LocalManifestSource(dir).write({
        packageId: manifest.id,
        versionId: manifest.version,
        manifestId: manifest.id,
        version: manifest.version,
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: true,
    });
    const { engine, deletes, reads } = makeEngine(opts.tables);
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const auth = installerAuthService();
    const services: Record<string, unknown> = {
        manifest: { register: vi.fn() },
        auth: {
            api: {
                getSession: async () => ({
                    ...(await auth.api.getSession()),
                    session: opts.activeOrg ? { activeOrganizationId: opts.activeOrg } : {},
                }),
            },
        },
        objectql: withInstallerGrants(engine),
        metadata: { getObject: async (name: string) => MANIFEST.objects.find((o) => o.name === name) },
        ...(opts.posture ? { tenancy: { posture: opts.posture } } : {}),
        ...opts.services,
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
    return { purge: routes.get(PURGE)!, list: routes.get(LIST)!, count: routes.get(COUNT)!, deletes, reads, logger };
}

describe('POST …/purge-sample-data — through the engine, in the install\'s scope', () => {
    it('no wall: deletes every seed row by its key, child first in the LOADER\'s order, and flips the ledger', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme' }, { id: 'u1', name: 'User Authored Co' }],
            pg_contact: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { purge, deletes } = await bootWith({ tables, posture: 'single' });
        const res = await purge(makeC(MANIFEST.id));

        expect(res.status).toBe(200);
        expect(res.payload).toEqual({
            success: true,
            data: { manifestId: MANIFEST.id, deleted: 2, skipped: 0, errors: 0, withSampleData: false },
        });
        // The manifest lists the contact dataset FIRST; the order is the real
        // SeedLoaderService's graph reversed, not the manifest's.
        expect(deletes.map((d) => d.object)).toEqual(['pg_contact', 'pg_account']);
        expect(tables.pg_account.map((r) => r.id)).toEqual(['u1']);
        const entry = new LocalManifestSource(dir).read(MANIFEST.id).entry!;
        expect(entry.sampleDataPurged).toBe(true);
        expect(entry.withSampleData).toBe(false);
    });

    it('wall, active organization: only that organization\'s seed rows go', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme', organization_id: 'org_a' }, { id: 'b1', name: 'Acme', organization_id: 'org_b' }],
            pg_contact: [
                { id: 'c1', email: 'ada@acme.test', account: 'a1', organization_id: 'org_a' },
                { id: 'd1', email: 'ada@acme.test', account: 'b1', organization_id: 'org_b' },
            ],
        };
        const { purge } = await bootWith({ tables, posture: 'isolated', activeOrg: 'org_a' });
        const res = await purge(makeC(MANIFEST.id));
        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ deleted: 2, skipped: 0, errors: 0 });
        expect(tables.pg_account.map((r) => r.id)).toEqual(['b1']);
        expect(tables.pg_contact.map((r) => r.id)).toEqual(['d1']);
    });

    it('wall, no active organization: refused the way reseed refuses it (ADR-0123 D2 / D4), and nothing is deleted', async () => {
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme', organization_id: 'org_a' }], pg_contact: [] };
        const { purge, deletes } = await bootWith({ tables, posture: 'isolated' });
        const res = await purge(makeC(MANIFEST.id));
        expect(res.status).toBe(403);
        expect(res.payload.error.code).toBe('PERMISSION_DENIED');
        expect(res.payload.error.message).toContain('this session has no active organization');
        expect(deletes).toEqual([]);
        expect(tables.pg_account).toHaveLength(1);
        // The install still carries its sample data: the ledger is untouched.
        expect(new LocalManifestSource(dir).read(MANIFEST.id).entry?.sampleDataPurged).toBeUndefined();
    });

    it('no metadata service to read the dependency order from: 500 DRIVER_UNAVAILABLE, and the ledger is untouched', async () => {
        // (A missing `objectql` never gets this far: admission already fails
        // closed without the engine it resolves grants through.)
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme' }], pg_contact: [] };
        const { purge, deletes } = await bootWith({ tables, posture: 'single', services: { metadata: undefined } });
        const res = await purge(makeC(MANIFEST.id));
        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('DRIVER_UNAVAILABLE');
        expect(deletes).toEqual([]);
        expect(new LocalManifestSource(dir).read(MANIFEST.id).entry?.sampleDataPurged).toBeUndefined();
    });
});

/** The listing's `withSampleData` for the one ledgered package. */
async function listedSampleData(list: Handler): Promise<{ status: number; withSampleData: unknown; items: number }> {
    const res = await list(makeC(MANIFEST.id));
    const items = res.payload?.data?.items ?? [];
    return { status: res.status, withSampleData: items[0]?.withSampleData, items: items.length };
}

describe('GET … listing — `withSampleData` is the caller\'s own scope, read from its rows (#21775)', () => {
    it('wall: after a purge in organization A, the listing read as B still answers true and read as A answers false', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [
                { id: 'a1', name: 'Acme', organization_id: 'org_a' },
                { id: 'u1', name: 'User Authored Co', organization_id: 'org_a' },
                { id: 'b1', name: 'Acme', organization_id: 'org_b' },
            ],
            pg_contact: [
                { id: 'c1', email: 'ada@acme.test', account: 'a1', organization_id: 'org_a' },
                { id: 'd1', email: 'ada@acme.test', account: 'b1', organization_id: 'org_b' },
            ],
        };
        const opts: { tables: Record<string, Row[]>; posture: 'isolated'; activeOrg?: string } = { tables, posture: 'isolated', activeOrg: 'org_a' };
        const { purge, list, reads } = await bootWith(opts);

        // Both organizations hold their seed rows before the purge.
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: true, items: 1 });
        opts.activeOrg = 'org_b';
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: true, items: 1 });

        opts.activeOrg = 'org_a';
        const purged = await purge(makeC(MANIFEST.id));
        expect(purged.payload.data).toMatchObject({ deleted: 2, skipped: 0, errors: 0 });
        // The install-wide record now says "no sample data" — for every organization.
        expect(new LocalManifestSource(dir).read(MANIFEST.id).entry).toMatchObject({ withSampleData: false, sampleDataPurged: true });

        reads.length = 0;
        opts.activeOrg = 'org_b';
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: true, items: 1 });
        // B's answer came from B's rows, and from no other organization's. (The
        // resolver's Default Organization read — the installer's grant is owned
        // by it — is an authorization read, not a row of the listing's.)
        const rowReads = reads.filter((r) => r.object !== 'sys_organization');
        expect(rowReads.length).toBeGreaterThan(0);
        for (const r of rowReads) expect(r.query.where).toEqual({ organization_id: 'org_b' });

        // A keeps a user-authored row in a seeded object; it is not a seed row.
        opts.activeOrg = 'org_a';
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: false, items: 1 });
    });

    it('wall, no active organization: every entry answers false, 200, and no seed row is read (ADR-0123 D2)', async () => {
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme', organization_id: 'org_a' }], pg_contact: [] };
        const { list, reads } = await bootWith({ tables, posture: 'isolated' });
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: false, items: 1 });
        expect(reads.filter((r) => r.object in tables)).toEqual([]);
    });

    it('no wall: the derived answer is the one the ledger records, before and after a purge', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme' }, { id: 'u1', name: 'User Authored Co' }],
            pg_contact: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { purge, list } = await bootWith({ tables, posture: 'single' });
        const recorded = () => new LocalManifestSource(dir).read(MANIFEST.id).entry?.withSampleData;

        expect(recorded()).toBe(true);
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: recorded(), items: 1 });

        expect((await purge(makeC(MANIFEST.id))).status).toBe(200);
        expect(recorded()).toBe(false);
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: recorded(), items: 1 });
    });

    it('rows the engine will not return: the entry answers false, and the operator is told why', async () => {
        const failing = withInstallerGrants({
            find: async (object: string) => { throw new Error(`no such table: ${object}`); },
        });
        const { list, logger } = await bootWith({ tables: {}, posture: 'single', services: { objectql: failing } });
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: false, items: 1 });
        const warned = logger.warn.mock.calls.map((c) => String(c[0])).join('\n');
        expect(warned).toContain(`${MANIFEST.id}: the installed-apps listing could not read this package's seed rows`);
        expect(warned).toContain('no such table: pg_account');
    });
});

/** The count door's answer for the one ledgered package. */
async function counted(count: Handler, query?: Record<string, string>): Promise<{ status: number; payload: any }> {
    const res = await count(makeC(MANIFEST.id, query));
    return { status: res.status, payload: res.payload };
}

describe('GET …/sample-data — how many sample rows a purge would delete now (#30323)', () => {
    it('no wall: counts N; a user-added row and a key-edited sample row are not counted, a field-edited one is; the purge then deletes exactly the count; after it, 0 and withSampleData false', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme' }],
            pg_contact: [{ id: 'c1', email: 'ada@acme.test', account: 'a1' }],
        };
        const { count, purge, list, deletes } = await bootWith({ tables, posture: 'single' });

        // Freshly installed: both sample rows.
        expect(await counted(count)).toEqual({
            status: 200,
            payload: { success: true, data: { manifestId: MANIFEST.id, count: 2, unidentified: 0 } },
        });

        // A user adds a record to a seeded object, edits the sample contact's
        // KEY (its email), and edits a non-key field of the sample account.
        tables.pg_account.push({ id: 'u1', name: 'User Authored Co' });
        tables.pg_contact[0].email = 'ada@renamed.test';
        tables.pg_account[0].phone = '555-0100';
        expect((await counted(count)).payload.data).toEqual({ manifestId: MANIFEST.id, count: 1, unidentified: 0 });
        expect(deletes).toEqual([]);

        // The purge that follows deletes exactly what the count said.
        const purged = await purge(makeC(MANIFEST.id));
        expect(purged.payload.data).toMatchObject({ deleted: 1, errors: 0 });
        expect(deletes.map((d) => `${d.object}#${d.id}`)).toEqual(['pg_account#a1']);
        expect(tables.pg_account.map((r) => r.id)).toEqual(['u1']);
        expect(tables.pg_contact.map((r) => r.id)).toEqual(['c1']);

        // After it: nothing left, and the listing agrees.
        expect((await counted(count)).payload.data).toEqual({ manifestId: MANIFEST.id, count: 0, unidentified: 0 });
        expect(await listedSampleData(list)).toEqual({ status: 200, withSampleData: false, items: 1 });
    });

    it('wall, active organization: only that organization\'s rows are counted, every read pinned to it', async () => {
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme', organization_id: 'org_a' }, { id: 'b1', name: 'Acme', organization_id: 'org_b' }],
            pg_contact: [{ id: 'd1', email: 'ada@acme.test', account: 'b1', organization_id: 'org_b' }],
        };
        const { count, reads } = await bootWith({ tables, posture: 'isolated', activeOrg: 'org_a' });
        reads.length = 0;
        expect((await counted(count)).payload.data).toEqual({ manifestId: MANIFEST.id, count: 1, unidentified: 0 });
        const rowReads = reads.filter((r) => r.object in tables);
        expect(rowReads.length).toBeGreaterThan(0);
        for (const r of rowReads) expect(r.query.where).toEqual({ organization_id: 'org_a' });
    });

    it('wall, no active organization: 200 with count 0 and no seed row read (ADR-0123 D2, a read), where the purge refuses', async () => {
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme', organization_id: 'org_a' }], pg_contact: [] };
        const { count, reads } = await bootWith({ tables, posture: 'isolated' });
        expect(await counted(count)).toEqual({
            status: 200,
            payload: { success: true, data: { manifestId: MANIFEST.id, count: 0, unidentified: 0 } },
        });
        expect(reads.filter((r) => r.object in tables)).toEqual([]);
    });

    it('a package that declares no seed datasets: count 0, and no row is read', async () => {
        const bare = { ...MANIFEST, id: 'app.test.bare', data: [] };
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme' }], pg_contact: [] };
        const { count, reads } = await bootWith({ tables, posture: 'single', manifest: bare });
        const res = await count(makeC(bare.id));
        expect([res.status, res.payload]).toEqual([200, { success: true, data: { manifestId: bare.id, count: 0, unidentified: 0 } }]);
        expect(reads.filter((r) => r.object in tables)).toEqual([]);
    });

    it('a query parameter is refused with a located 400 — a GET carrying "dryRun=0" or "confirm" still deletes and reads nothing', async () => {
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme' }], pg_contact: [] };
        const { count, deletes, reads } = await bootWith({ tables, posture: 'single' });
        reads.length = 0;
        for (const query of [{ dryRun: '0' }, { confirm: 'true' }] as Array<Record<string, string>>) {
            const res = await counted(count, query);
            expect(res.status).toBe(400);
            expect(res.payload.error.code).toBe('VALIDATION_ERROR');
            expect(res.payload.error.message).toContain(`"${Object.keys(query)[0]}" query parameter is not supported`);
        }
        expect(deletes).toEqual([]);
        expect(reads.filter((r) => r.object in tables)).toEqual([]);
        expect(tables.pg_account).toHaveLength(1);
    });

    it('no install: 404; no metadata service: the purge\'s 500 DRIVER_UNAVAILABLE, never a 0', async () => {
        const tables: Record<string, Row[]> = { pg_account: [{ id: 'a1', name: 'Acme' }], pg_contact: [] };
        const first = await bootWith({ tables, posture: 'single' });
        const missing = await first.count(makeC('app.not.installed'));
        expect([missing.status, missing.payload.error.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);

        const { count } = await bootWith({ tables, posture: 'single', services: { metadata: undefined } });
        const res = await counted(count);
        expect([res.status, res.payload.error.code]).toEqual([500, 'DRIVER_UNAVAILABLE']);
    });

    it('a signed-in caller without `manage_metadata` is refused the purge\'s 403, and no seed row is read', async () => {
        // The installer's user row, and no permission-set grant at all.
        const tables: Record<string, Row[]> = {
            pg_account: [{ id: 'a1', name: 'Acme' }],
            pg_contact: [],
            sys_user: [{ id: INSTALLER_USER_ID, email: installerEmail(), email_verified: true }],
        };
        const ungranted = makeEngine(tables);
        const { count, logger } = await bootWith({ tables, posture: 'single', services: { objectql: ungranted.engine } });
        ungranted.reads.length = 0;
        const res = await counted(count);
        expect(res.status, JSON.stringify(res.payload)).toBe(403);
        expect(res.payload.error).toMatchObject({ code: 'FORBIDDEN' });
        expect(res.payload.error.message).toContain('manage_metadata');
        expect(ungranted.reads.filter((r) => r.object.startsWith('pg_'))).toEqual([]);
        expect(logger.warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('refused Counting sample data');
    });
});

describe('seedDatasetOfReceiptItem — a served seed item as the dataset it declares (#30808)', () => {
    it('keeps every member SeedSchema declares, `files` included, and drops a key it does not declare', () => {
        const files = { 'fixtures/hello.txt': { contentType: 'text/plain', size: 2, sha256: 'a'.repeat(64), data: 'aGk=' } };
        const dataset = seedDatasetOfReceiptItem({
            object: 'crm_account', externalId: 'name', records: [{ name: 'Acme' }], files, _diagnostics: { valid: true },
        });
        expect(dataset).toEqual({ object: 'crm_account', externalId: 'name', records: [{ name: 'Acme' }], files });
    });

    it('answers undefined for anything that is not a dataset', () => {
        expect([null, [], 'x', { object: 'crm_account' }, { records: [] }].map(seedDatasetOfReceiptItem)).toEqual([
            undefined, undefined, undefined, undefined, undefined,
        ]);
    });
});
