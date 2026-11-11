// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D1, D2, D8] A `mapping` with a `datasourceSource`, pulled through
 * `pullConnectorSource` — the contract method a job's `pull` binds through —
 * end to end on a real engine: the source is a federated SQLite table on an
 * external datasource (the built-in read path) or a plugin driver behind the
 * engine's floor (the floored path), the target a `synced` object on the
 * managed SQLite datasource, and every row written through the import runner.
 *
 * The protocol the pull reads and writes through is the engine's own, adapted
 * the way `connector-pull.integration.test.ts` adapts it. Every refusal asserts
 * the ADR-0112 `code` + `status` and the `reason`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LifecycleService, ObjectQL, assertEngineDeleteDispatch, type LifecycleEngineLike, type LifecycleObjectLike } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { pullConnectorSource, type ConnectorPullDeps, type ConnectorPullProtocol } from './connector-pull.js';
import { REFUSED_ROW_SAMPLE } from './datasource-pull.js';
import { ConnectorPullError } from './pull-refusal.js';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SysSyncRun } from './sys-sync-run.object.js';
import { ObjectStoreSyncRunLedger, SYNC_RUN_OBJECT, closeInterruptedSyncRuns } from './sync-run-ledger.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

type Rec = Record<string, unknown>;

const SYSTEM = { isSystem: true };

const TARGET = {
    name: 'order_copy',
    label: 'Order (synced)',
    managedBy: 'synced',
    fields: {
        external_no: { name: 'external_no', label: 'External no', type: 'text' },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
        // Not `updated_at`: that is the platform's audit column, stamped on every write.
        source_updated_at: { name: 'source_updated_at', label: 'Updated at (source)', type: 'datetime' },
    },
};

const SOURCE = {
    name: 'erp_order',
    label: 'ERP order',
    datasource: 'erp',
    external: {
        remoteName: 'ERP_ORDERS',
        columnMap: { ORDER_NO: 'id', UPDATED_AT: 'updated_at', AMOUNT: 'amount', ORG: 'organization_id' },
    },
    fields: {
        updated_at: { name: 'updated_at', label: 'Updated at', type: 'datetime' },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
    },
};

const MAPPING = {
    name: 'erp_orders_pull',
    targetObject: 'order_copy',
    mode: 'upsert',
    upsertKey: ['external_no'],
    fieldMapping: [
        { source: 'id', target: 'external_no' },
        { source: 'amount', target: 'amount' },
        { source: 'updated_at', target: 'source_updated_at' },
    ],
    datasourceSource: { object: 'erp_order', watermark: { field: 'updated_at', start: '2026-01-01' } },
};

const ERP_DEF = { name: 'erp', driver: 'sqlite', schemaMode: 'external' };

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

interface Harness {
    ql: ObjectQL;
    /** The managed SQLite driver: the target's, and `sys_sync_run`'s when `runs` is on. */
    main: SqlDriver;
    erp: any;
    meta: { object: Map<string, Rec>; mapping: Map<string, Rec>; datasource: Map<string, Rec> };
    deps: ConnectorPullDeps;
}

let open: Harness | undefined;
afterEach(async () => {
    await open?.erp?.disconnect?.();
    open = undefined;
    delete process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_DATA_MAX_PAGE_SIZE;
});

/** The engine's own protocol, adapted as the connector pull's integration test adapts it; metadata from `meta`. */
function protocolOver(ql: ObjectQL, meta: Harness['meta']): ConnectorPullProtocol {
    return {
        async getMetaItem({ type, name }) {
            const item = (meta as Record<string, Map<string, Rec>>)[type]?.get(name);
            return item ? { type, name, item } : undefined;
        },
        async findData({ object, query, context }) {
            // `count` is the door's own (it decides whether to count beside the page); the engine never sees it.
            const { object: _omit, count: _count, ...rest } = (query ?? {}) as EngineQueryOptions & { object?: string; count?: unknown };
            return { object, records: await ql.find(object, { ...rest, context: context as EngineQueryOptions['context'] }) };
        },
        async createData({ object, data, context }) {
            return ql.insert(object, data, { context: context as never });
        },
        async updateData({ object, id, data, context }) {
            return ql.update(object, data, { where: { id }, context: context as never });
        },
    };
}

/** A managed SQLite target and an external SQLite datasource `erp` holding `ERP_ORDERS`. */
async function harness(
    rows: Array<{ no: string; at: string | null; amount?: number; org?: string }>,
    over: { source?: Rec; target?: Rec; mapping?: Rec; runs?: boolean; logger?: Rec } = {},
    setup?: (ql: ObjectQL) => void,
): Promise<Harness> {
    const ql = new ObjectQL();
    const main = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    ql.registerDriver(main, true);
    const erp: any = new SqlDriver({
        client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, schemaMode: 'external',
    } as any);
    erp.name = 'erp';
    ql.registerDriver(erp);
    ql.registerDatasourceDef(ERP_DEF as any);
    await ql.init();
    await erp.knex.raw('create table ERP_ORDERS (ORDER_NO text primary key, UPDATED_AT text, AMOUNT integer, ORG text)');
    for (const r of rows) {
        await erp.knex.raw('insert into ERP_ORDERS values (?, ?, ?, ?)', [r.no, r.at, r.amount ?? 1, r.org ?? DEFAULT_ORGANIZATION_ID]);
    }
    setup?.(ql);
    const source = over.source ?? SOURCE;
    const target = over.target ?? TARGET;
    ql.registry.registerObject(target as any);
    ql.registry.registerObject(source as any);
    // [ADR-0153 D7] The run record, as the automation plugin registers it.
    if (over.runs) ql.registry.registerObject(SysSyncRun as any);
    await ql.syncSchemas();
    await installDefaultOrganization(ql);
    const meta = {
        object: new Map<string, Rec>([[String(target.name), target as Rec], [String(source.name), source as Rec]]),
        mapping: new Map<string, Rec>([[MAPPING.name, (over.mapping ?? MAPPING) as Rec]]),
        datasource: new Map<string, Rec>([['erp', ERP_DEF]]),
    };
    const silent = { debug() {}, info() {}, warn() {}, error() {} };
    const deps: ConnectorPullDeps = {
        protocol: protocolOver(ql, meta),
        registry: {
            resolveConnectorAction: () => undefined,
            getConnectorOrigin: () => undefined,
            getConnectorDegradedReason: () => undefined,
            getConnectorDescriptors: () => [],
        } as never,
        providerOf: () => undefined,
        logger: (over.logger ?? silent) as never,
        ...(over.runs ? { runs: new ObjectStoreSyncRunLedger(ql as never) } : {}),
    };
    open = { ql, main, erp, meta, deps };
    return open;
}

async function refusalOf(p: Promise<unknown>): Promise<ConnectorPullError> {
    const err = await p.then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ConnectorPullError);
    return err as ConnectorPullError;
}

async function copies(ql: ObjectQL): Promise<Rec[]> {
    const rows = await ql.find('order_copy', { orderBy: [{ field: 'external_no', order: 'asc' }], context: SYSTEM as never });
    return rows.map((r: Rec) => ({ external_no: r.external_no, amount: r.amount, updated_at: r.source_updated_at }));
}

describe('[ADR-0153 D1] a datasourceSource pull, end to end (built-in read path)', () => {
    it('copies every row of the federated object into the synced target, and a second run updates rather than duplicates', async () => {
        const h = await harness([
            { no: 'A-1', at: at(1000), amount: 10 },
            { no: 'A-2', at: at(2000), amount: 20 },
            { no: 'A-3', at: at(3000), amount: 30 },
        ]);
        const first = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(first.source).toBe('datasource');
        if (first.source !== 'datasource') return;
        expect(first.summary.errors, JSON.stringify(first.summary.results)).toBe(0);
        expect({ pulled: first.pulled, created: first.summary.created, readPath: first.readPath, object: first.object, datasource: first.datasource })
            .toEqual({ pulled: 3, created: 3, readPath: 'builtin', object: 'erp_order', datasource: 'erp' });
        expect(first.watermark).toEqual({ field: 'updated_at', from: '2026-01-01T00:00:00.000Z', committed: at(3000) });
        expect(await copies(h.ql)).toEqual([
            { external_no: 'A-1', amount: 10, updated_at: at(1000) },
            { external_no: 'A-2', amount: 20, updated_at: at(2000) },
            { external_no: 'A-3', amount: 30, updated_at: at(3000) },
        ]);

        await h.erp.knex.raw('update ERP_ORDERS set AMOUNT = 25, UPDATED_AT = ? where ORDER_NO = ?', [at(4000), 'A-2']);
        const second = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect({ created: second.summary.created, updated: second.summary.updated }).toEqual({ created: 0, updated: 3 });
        expect((await copies(h.ql)).find((r) => r.external_no === 'A-2')).toEqual({ external_no: 'A-2', amount: 25, updated_at: at(4000) });
    });

    it('a mapping that names neither source is refused naming both keys (no_connector_source, 400)', async () => {
        const { datasourceSource: _drop, ...bare } = MAPPING;
        const h = await harness([], { mapping: bare });
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['VALIDATION_ERROR', 400, 'no_connector_source']);
        expect(err.message).toContain('datasourceSource');
    });
});

describe('[ADR-0153 D1, D3, D4] the binding is judged again before the first read', () => {
    const cases: Array<[string, { source?: Rec; target?: Rec; mapping?: Rec }, string, number, string]> = [
        ['a target that is not managedBy synced', { target: { ...TARGET, managedBy: undefined } }, 'VALIDATION_ERROR', 400, 'mapping_target_refused'],
        ['a source with no external binding', { source: { ...SOURCE, external: undefined } }, 'VALIDATION_ERROR', 400, 'source_binding_invalid'],
        ['a columnMap that maps nothing onto id', {
            source: { ...SOURCE, external: { ...SOURCE.external, columnMap: { UPDATED_AT: 'updated_at', AMOUNT: 'amount' } } },
        }, 'VALIDATION_ERROR', 400, 'source_key_missing'],
        ['a watermark field no window can be halved on', {
            source: { ...SOURCE, fields: { ...SOURCE.fields, updated_at: { name: 'updated_at', type: 'text' } } },
        }, 'VALIDATION_ERROR', 400, 'source_binding_invalid'],
        ['a watermark no fieldMapping entry copies unchanged', {
            mapping: { ...MAPPING, fieldMapping: MAPPING.fieldMapping.filter((e) => e.source !== 'updated_at') },
        }, 'VALIDATION_ERROR', 400, 'watermark_field_unmapped'],
    ];
    for (const [name, over, code, status, reason] of cases) {
        it(`${name} is refused ${reason} (${status}) and nothing is read or written`, async () => {
            const h = await harness([{ no: 'A-1', at: at(1) }], over);
            const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
            expect([err.code, err.status, err.reason]).toEqual([code, status, reason]);
            if (over.target === undefined) expect(await copies(h.ql)).toEqual([]);
        });
    }

    it('a source on a managed datasource is refused source_binding_invalid (400): its rows are already local', async () => {
        const h = await harness([{ no: 'A-1', at: at(1) }]);
        h.meta.datasource.set('erp', { ...ERP_DEF, schemaMode: 'managed' });
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['VALIDATION_ERROR', 400, 'source_binding_invalid']);
    });
});

describe('[ADR-0153 D8] whose rows a pull reads under a walled posture', () => {
    const WALLED_SOURCE = {
        ...SOURCE,
        fields: { ...SOURCE.fields, organization_id: { name: 'organization_id', label: 'Organization', type: 'text' } },
    };

    it('a source with its own organization_id is read for the job\'s organization only, on every read', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const h = await harness([
            { no: 'A-1', at: at(1), org: DEFAULT_ORGANIZATION_ID },
            { no: 'B-1', at: at(2), org: 'org_other' },
            { no: 'A-2', at: at(3), org: DEFAULT_ORGANIZATION_ID },
        ], { source: WALLED_SOURCE });
        const sent: unknown[] = [];
        const findData = h.deps.protocol.findData.bind(h.deps.protocol);
        h.deps.protocol.findData = async (req) => { if (req.object === 'erp_order') sent.push(req.query?.where); return findData(req); };
        const result = await pullConnectorSource(h.deps, {
            mapping: MAPPING.name, context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID },
        });
        expect(result.summary.errors, JSON.stringify(result.summary.results)).toBe(0);
        expect((await copies(h.ql)).map((r) => r.external_no)).toEqual(['A-1', 'A-2']);
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every((w) => JSON.stringify(w).includes(`"organization_id":"${DEFAULT_ORGANIZATION_ID}"`))).toBe(true);
    });

    it('a source that states no organization scope is refused source_organization_scope_unstated (400), nothing read', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const h = await harness([{ no: 'A-1', at: at(1) }]);
        let reads = 0;
        const findData = h.deps.protocol.findData.bind(h.deps.protocol);
        h.deps.protocol.findData = async (req) => { if (req.object === 'erp_order') reads++; return findData(req); };
        const err = await refusalOf(pullConnectorSource(h.deps, {
            mapping: MAPPING.name, context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID },
        }));
        expect([err.code, err.status, err.reason]).toEqual(['VALIDATION_ERROR', 400, 'source_organization_scope_unstated']);
        expect(reads).toBe(0);
    });

    it('a walled source pulled in no organization is refused job_organization_missing (400)', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const h = await harness([{ no: 'A-1', at: at(1) }], { source: WALLED_SOURCE });
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['VALIDATION_ERROR', 400, 'job_organization_missing']);
    });

    it('a shared source (tenancy disabled) is read whole', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const h = await harness([
            { no: 'A-1', at: at(1), org: DEFAULT_ORGANIZATION_ID },
            { no: 'B-1', at: at(2), org: 'org_other' },
        ], { source: { ...SOURCE, tenancy: { enabled: false } } });
        const result = await pullConnectorSource(h.deps, {
            mapping: MAPPING.name, context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID },
        });
        expect(result.pulled).toBe(2);
    });
});

describe('[ADR-0153 D1] the floored read path, through the pull', () => {
    /** A plugin driver that pushes nothing down and stops at the limit it is sent (`external-driver-floor.test.ts`'s double). */
    function pluginDriver(rows: Rec[]) {
        return {
            name: 'wh',
            version: '0.0.1',
            supports: { transactionsUnsupported: true },
            async connect() {},
            async disconnect() {},
            async find(_object: string, query: Rec = {}) {
                const page = rows.map((r) => ({ ...r }));
                return typeof query.limit === 'number' ? page.slice(0, query.limit) : page;
            },
            async syncSchema() {},
        };
    }
    const WH_SOURCE = { ...SOURCE, name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', columnMap: { ORDER_NO: 'id' } } };
    const WH_DEF = { name: 'wh', driver: 'com_vendor_wh', schemaMode: 'external', external: { rowCap: 4 } };

    async function floored(rows: Rec[]) {
        const h = await harness(
            [],
            { source: WH_SOURCE, mapping: { ...MAPPING, datasourceSource: { ...MAPPING.datasourceSource, object: 'wh_order' } } },
            (ql) => {
                ql.registerDriver(pluginDriver(rows) as never);
                ql.registerDatasourceDef(WH_DEF as never);
            },
        );
        h.meta.datasource.set('wh', WH_DEF);
        return h;
    }

    it('a source under the cap is read in one window through the floor and copied', async () => {
        const h = await floored([
            { id: 'W-1', updated_at: at(1), amount: 1 },
            { id: 'W-2', updated_at: at(2), amount: 2 },
        ]);
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(result.source === 'datasource' && result.readPath).toBe('floored');
        expect((await copies(h.ql)).map((r) => r.external_no)).toEqual(['W-1', 'W-2']);
    });

    it('a driver that pushes no bound, over the cap, is refused sync_bounds_not_pushed (422) through the protocol', async () => {
        const h = await floored(Array.from({ length: 6 }, (_, i) => ({ id: `W-${i}`, updated_at: at(i), amount: i })));
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['EXTERNAL_ROW_CAP_EXCEEDED', 422, 'sync_bounds_not_pushed']);
    });
});

describe('[S2] a pull reports counters, never one result per row read', () => {
    it('a multi-batch pull of refused rows keeps at most the bounded sample of them, numbered in read order', async () => {
        process.env.OS_DATA_MAX_PAGE_SIZE = '3';
        // AMOUNT holds text no number field accepts: every row is refused by the runner.
        const h = await harness([]);
        for (let i = 0; i < 25; i++) {
            await h.erp.knex.raw('insert into ERP_ORDERS values (?, ?, ?, ?)', [`R-${String(i).padStart(2, '0')}`, at(i), 'not-a-number', DEFAULT_ORGANIZATION_ID]);
        }
        let reads = 0;
        const findData = h.deps.protocol.findData.bind(h.deps.protocol);
        h.deps.protocol.findData = async (req) => { if (req.object === 'erp_order') reads++; return findData(req); };
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(reads).toBeGreaterThan(5);
        expect({ total: result.summary.total, errors: result.summary.errors, created: result.summary.created })
            .toEqual({ total: 25, errors: 25, created: 0 });
        expect(result.summary.results).toHaveLength(REFUSED_ROW_SAMPLE);
        expect(result.summary.results.every((r) => r.ok === false)).toBe(true);
        expect(result.summary.results.map((r) => r.row)).toEqual(Array.from({ length: REFUSED_ROW_SAMPLE }, (_, i) => i + 1));
    });

    it('a multi-batch pull that writes every row carries no per-row results at all', async () => {
        process.env.OS_DATA_MAX_PAGE_SIZE = '3';
        const h = await harness(Array.from({ length: 10 }, (_, i) => ({ no: `G-${i}`, at: at(i), amount: i })));
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect({ total: result.summary.total, created: result.summary.created, errors: result.summary.errors })
            .toEqual({ total: 10, created: 10, errors: 0 });
        expect(result.summary.results).toEqual([]);
    });
});

describe('[S3] through the real data door: no count beside a read, and every read names its limit', () => {
    async function overRealDoor(h: Harness) {
        const door = new ObjectStackProtocolImplementation(h.ql as never) as unknown as ConnectorPullProtocol;
        h.deps.protocol.findData = (req) => door.findData(req);
        const count = vi.spyOn(h.ql, 'count');
        const find = vi.spyOn(h.ql, 'find');
        return { count, find };
    }
    const sourceReads = (find: { mock: { calls: unknown[][] } }, object: string): Array<Record<string, unknown>> =>
        find.mock.calls.filter((c: unknown[]) => c[0] === object).map((c: unknown[]) => c[1] as Record<string, unknown>);

    it('built-in path: pages read through findData run no engine.count, and each names its own limit', async () => {
        process.env.OS_DATA_MAX_PAGE_SIZE = '3';
        const h = await harness(Array.from({ length: 7 }, (_, i) => ({ no: `P-${i}`, at: at(i), amount: i })));
        const { count, find } = await overRealDoor(h);
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(result.summary.created).toBe(7);
        const reads = sourceReads(find, 'erp_order');
        expect(reads.length).toBeGreaterThan(3);
        expect(reads.every((q) => typeof q.limit === 'number' && q.limit <= 3)).toBe(true);
        expect(count.mock.calls.filter((c: unknown[]) => c[0] === 'erp_order')).toEqual([]);
    });

    it('floored path: a window read through findData runs no engine.count, so the remote is asked once per window', async () => {
        const rows = [{ id: 'W-1', updated_at: at(1), amount: 1 }, { id: 'W-2', updated_at: at(2), amount: 2 }];
        const remoteFinds: unknown[] = [];
        const h = await harness(
            [],
            { source: { ...SOURCE, name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', columnMap: { ORDER_NO: 'id' } } },
              mapping: { ...MAPPING, datasourceSource: { ...MAPPING.datasourceSource, object: 'wh_order' } } },
            (ql) => {
                ql.registerDriver({
                    name: 'wh', version: '0.0.1', supports: { transactionsUnsupported: true },
                    async connect() {}, async disconnect() {}, async syncSchema() {},
                    async find(_object: string, query: Rec = {}) {
                        remoteFinds.push(query);
                        const page = rows.map((r) => ({ ...r }));
                        return typeof query.limit === 'number' ? page.slice(0, query.limit) : page;
                    },
                } as never);
                ql.registerDatasourceDef({ name: 'wh', driver: 'com_vendor_wh', schemaMode: 'external', external: { rowCap: 4 } } as never);
            },
        );
        h.meta.datasource.set('wh', { name: 'wh', driver: 'com_vendor_wh', schemaMode: 'external', external: { rowCap: 4 } });
        const { count, find } = await overRealDoor(h);
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(result.source === 'datasource' && result.readPath).toBe('floored');
        expect(result.summary.created).toBe(2);
        const reads = sourceReads(find, 'wh_order');
        expect(reads).toHaveLength(1);
        expect(reads[0].limit).toBe(4);
        expect(count.mock.calls.filter((c: unknown[]) => c[0] === 'wh_order')).toEqual([]);
        // One window, one remote fetch: the floor was not asked to count it a second time.
        expect(remoteFinds).toHaveLength(1);
    });
});

// ── ADR-0153 D7: the run record and the read position ──────────────────

/** A job's context in the Default Organization (single posture): the binder's shape. */
const JOB = { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID };
const START = '2026-01-01T00:00:00.000Z';
const THREE = [
    { no: 'A-1', at: at(1000), amount: 10 },
    { no: 'A-2', at: at(2000), amount: 20 },
    { no: 'A-3', at: at(3000), amount: 30 },
];

/** Every `sys_sync_run` row, oldest first. */
async function runRows(ql: ObjectQL): Promise<Rec[]> {
    return ql.find(SYNC_RUN_OBJECT, { orderBy: [{ field: 'started_at', order: 'asc' }], context: SYSTEM as never });
}

/** Wrap the protocol's `findData` for the source object: `fail` may throw instead of reading. */
function onSourceReads(h: Harness, fail?: (where: string) => boolean): string[] {
    const seen: string[] = [];
    const inner = h.deps.protocol.findData.bind(h.deps.protocol);
    h.deps.protocol.findData = (async (req: Rec) => {
        if (req.object === 'erp_order') {
            const where = JSON.stringify((req.query as Rec | undefined)?.where ?? {});
            seen.push(where);
            if (fail?.(where)) throw new Error('remote reset the connection (10.0.0.7:5432, user erp_reader)');
        }
        return inner(req as never);
    }) as never;
    return seen;
}

/** The lower bounds a window read carries on `updated_at` (a high-water read is the whole source: it carries none). */
function lowerBounds(where: string): string[] {
    return [...where.matchAll(/"updated_at":\{"\$gte":"([^"]+)"\}/g)].map((m) => m[1]);
}

describe('[ADR-0153 D7] every pull leaves one sys_sync_run row, and says how it ended in one line', () => {
    it('a completed pull: what it read, its counts, the position it committed, and the run holds that position', async () => {
        const info: string[] = [];
        const h = await harness(THREE, { runs: true, logger: { debug() {}, info: (m: string) => { info.push(m); }, warn() {}, error() {} } });
        const result = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: JOB });
        expect(result.source === 'datasource' && result.watermark).toEqual({ field: 'updated_at', from: START, committed: at(3000) });

        const rows = await runRows(h.ql);
        expect(rows).toHaveLength(1);
        const r = rows[0];
        expect({
            organization_id: r.organization_id, mapping: r.mapping, source_kind: r.source_kind, source: r.source,
            datasource: r.datasource, read_path: r.read_path, status: r.status, watermark_field: r.watermark_field,
            watermark_from: r.watermark_from, watermark_committed: r.watermark_committed, holds_position: Boolean(r.holds_position),
            counts: [r.read_count, r.created_count, r.updated_count, r.refused_count].map(Number), failure_reason: r.failure_reason ?? null,
        }).toEqual({
            organization_id: DEFAULT_ORGANIZATION_ID, mapping: MAPPING.name, source_kind: 'datasource', source: 'erp_order',
            datasource: 'erp', read_path: 'builtin', status: 'completed', watermark_field: 'updated_at',
            watermark_from: START, watermark_committed: at(3000), holds_position: true,
            counts: [3, 3, 0, 0], failure_reason: null,
        });
        expect(r.ended_at).toBeTruthy();
        expect(r.committed_at).toBeTruthy();

        expect(info.filter((m) => m.startsWith('[Automation] pull of mapping'))).toEqual([
            `[Automation] pull of mapping "${MAPPING.name}" completed: read 3, created 3, updated 0, refused 0; `
            + `read position committed at ${at(3000)} (${SYNC_RUN_OBJECT} ${String(r.id)})`,
        ]);
    });

    it('a pull refused before the mapping is read is a failed run, with the refusal\'s reason and sentence', async () => {
        const { datasourceSource: _drop, ...bare } = MAPPING;
        const warn: string[] = [];
        const h = await harness([], { mapping: bare, runs: true, logger: { debug() {}, info() {}, warn: (m: string) => { warn.push(m); }, error() {} } });
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: JOB }));
        const [r] = await runRows(h.ql);
        expect([r.status, r.failure_reason, r.failure, r.source_kind ?? null, r.watermark_committed ?? null, Boolean(r.holds_position)])
            .toEqual(['failed', 'no_connector_source', err.message, null, null, false]);
        expect(warn.filter((m) => m.startsWith('[Automation] pull of mapping'))).toHaveLength(1);
    });
});

describe('[ADR-0153 D2, D7] a pull reads on from the position the last committed run stored', () => {
    it('a second run after a committed first run reads only from the committed position on', async () => {
        const h = await harness(THREE, { runs: true });
        const first = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(first.source === 'datasource' && first.watermark.committed).toBe(at(3000));

        await h.erp.knex.raw('update ERP_ORDERS set AMOUNT = 11, UPDATED_AT = ? where ORDER_NO = ?', [at(4000), 'A-1']);
        await h.erp.knex.raw('insert into ERP_ORDERS values (?, ?, ?, ?)', ['A-4', at(5000), 40, DEFAULT_ORGANIZATION_ID]);
        const reads = onSourceReads(h);
        const second = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        if (second.source !== 'datasource') throw new Error('a datasource pull answers the datasource arm');
        expect(second.watermark).toEqual({ field: 'updated_at', from: at(3000), committed: at(5000) });
        // A-2 (2000) lies below the position and is not read again; A-3 shares it, so it is.
        expect({ pulled: second.pulled, created: second.summary.created, updated: second.summary.updated })
            .toEqual({ pulled: 3, created: 1, updated: 2 });
        // Every window read is bounded below at the committed position or above it.
        const windowReads = reads.filter((w) => lowerBounds(w).length > 0);
        expect(windowReads.length).toBeGreaterThan(0);
        expect(windowReads.flatMap(lowerBounds).every((lo) => lo >= at(3000))).toBe(true);
        expect((await copies(h.ql)).find((c) => c.external_no === 'A-1')).toEqual({ external_no: 'A-1', amount: 11, updated_at: at(4000) });

        // The newer run holds the position; the older one let it go.
        expect((await runRows(h.ql)).map((r) => [r.watermark_from, r.watermark_committed, Boolean(r.holds_position)])).toEqual([
            [START, at(3000), false],
            [at(3000), at(5000), true],
        ]);
    });

    it('a run stopped mid-window commits nothing past its last finished window, and the next run reads on from there', async () => {
        // Pages of two rows: window [0 ms, 1000 ms) is read in two pages and
        // committed at 300 ms; the remote fails on the second page of window
        // [1000 ms, 2000 ms), after K-1100 and K-1200 were written.
        process.env.OS_DATA_MAX_PAGE_SIZE = '2';
        const h = await harness([
            { no: 'K-0100', at: at(100) }, { no: 'K-0200', at: at(200) }, { no: 'K-0300', at: at(300) },
            { no: 'K-1100', at: at(1100) }, { no: 'K-1200', at: at(1200) }, { no: 'K-1300', at: at(1300) },
            { no: 'K-8000', at: at(8000) },
        ], { runs: true });
        let failing = true;
        onSourceReads(h, (where) => failing && where.includes(`"$gte":"${at(1000)}"`) && where.includes('"id":{"$gt"'));
        const stopped = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }).then(() => undefined, (e) => e);
        expect(stopped).toBeInstanceOf(Error);
        expect(stopped).not.toBeInstanceOf(ConnectorPullError);

        const [r] = await runRows(h.ql);
        expect([r.status, r.failure_reason, r.watermark_committed, Boolean(r.holds_position), Number(r.read_count), Number(r.created_count)])
            .toEqual(['failed', 'failed', at(300), true, 5, 5]);
        // The driver's own text stays off the record.
        expect(String(r.failure)).not.toContain('10.0.0.7');
        expect(String(r.failure)).not.toContain('erp_reader');
        expect((await copies(h.ql)).map((c) => c.external_no)).toEqual(['K-0100', 'K-0200', 'K-0300', 'K-1100', 'K-1200']);

        failing = false;
        const next = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        if (next.source !== 'datasource') throw new Error('a datasource pull answers the datasource arm');
        expect(next.watermark.from).toBe(at(300));
        // K-0100 and K-0200 lie below the position: not read again.
        expect({ pulled: next.pulled, created: next.summary.created, updated: next.summary.updated })
            .toEqual({ pulled: 5, created: 2, updated: 3 });
        expect((await copies(h.ql)).map((c) => c.external_no))
            .toEqual(['K-0100', 'K-0200', 'K-0300', 'K-1100', 'K-1200', 'K-1300', 'K-8000']);
    });

    it('a run a stopped server left running is closed failed (interrupted) at boot, and its position stands', async () => {
        const h = await harness(THREE, { runs: true });
        const ledger = h.deps.runs!;
        const { id, organizationId } = await ledger.open({ mapping: MAPPING.name }, new Date());
        // Under `single` the engine stamps the Default Organization on a run written with none.
        expect(organizationId).toBe(DEFAULT_ORGANIZATION_ID);
        const scope = { mapping: MAPPING.name, organizationId };
        await ledger.describe(id, {
            sourceKind: 'datasource', source: 'erp_order', datasource: 'erp', readPath: 'builtin', watermarkField: 'updated_at', from: START,
        });
        await ledger.commit(id, scope, at(2000));
        // ...and the server stops: the row still reads running.
        const info: string[] = [];
        const logger = { debug() {}, info: (m: string) => { info.push(m); }, warn() {}, error() {} };
        expect(await closeInterruptedSyncRuns(h.ql as never, logger as never)).toBe(1);
        const [r] = await runRows(h.ql);
        expect([r.status, r.failure_reason, r.watermark_committed, Boolean(r.holds_position)]).toEqual(['failed', 'interrupted', at(2000), true]);
        expect(r.ended_at).toBeTruthy();
        expect(info).toHaveLength(1);

        const next = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(next.source === 'datasource' && next.watermark.from).toBe(at(2000));
        expect(next.pulled).toBe(2);
        // The next boot finds nothing left running.
        expect(await closeInterruptedSyncRuns(h.ql as never, logger as never)).toBe(0);
    });

    it('two runs of one mapping committing in turn: the run committed last holds the position, and the next pull starts there', async () => {
        const h = await harness(THREE, { runs: true });
        const ledger = h.deps.runs!;
        const a = await ledger.open({ mapping: MAPPING.name }, new Date());
        const b = await ledger.open({ mapping: MAPPING.name }, new Date());
        const scope = { mapping: MAPPING.name, organizationId: a.organizationId };
        const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
        for (const id of [a.id, b.id]) {
            await ledger.describe(id, { sourceKind: 'datasource', source: 'erp_order', watermarkField: 'updated_at', from: START });
        }
        await ledger.commit(a.id, scope, at(1000));
        await tick();
        await ledger.commit(b.id, scope, at(1500));
        await tick();
        // A finishes another window after B's: A is now the run committed last.
        await ledger.commit(a.id, scope, at(2000));
        const held = (await runRows(h.ql)).filter((r) => Boolean(r.holds_position)).map((r) => r.id);
        expect(held).toEqual([a.id]);
        expect((await ledger.lastCommitted(scope))?.position).toBe(at(2000));
    });

    it('full: true reads from watermark.start on every run, whatever position is stored', async () => {
        const h = await harness(THREE, { runs: true, mapping: { ...MAPPING, datasourceSource: { ...MAPPING.datasourceSource, full: true } } });
        await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        const second = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(second.source === 'datasource' && second.watermark.from).toBe(START);
        expect(second.pulled).toBe(3);
    });

    it('a stored position from another watermark field is not a position of this read: the run starts at watermark.start', async () => {
        const h = await harness(THREE, { runs: true });
        await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        const [r] = await runRows(h.ql);
        await h.ql.update(SYNC_RUN_OBJECT, { watermark_field: 'created_on' }, { where: { id: r.id }, context: SYSTEM as never });
        const second = await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        expect(second.source === 'datasource' && second.watermark.from).toBe(START);
        expect(second.pulled).toBe(3);
    });
});

describe('[ADR-0153 D7] a run record that cannot be written stops the pull (run_record_unavailable)', () => {
    it('the run cannot be opened: refused 503 before anything is read', async () => {
        const h = await harness(THREE, { runs: true });
        const reads = onSourceReads(h);
        h.deps.runs!.open = async () => { throw new Error('SQLITE_ERROR: no such table: sys_sync_run'); };
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['SERVICE_UNAVAILABLE', 503, 'run_record_unavailable']);
        expect(err.message).not.toContain('SQLITE_ERROR');
        expect(reads).toEqual([]);
        expect(await copies(h.ql)).toEqual([]);
    });

    it('the position cannot be stored at a window\'s end: refused 503, the windows before stay written and committed', async () => {
        process.env.OS_DATA_MAX_PAGE_SIZE = '2';
        const h = await harness([
            { no: 'K-0100', at: at(100) }, { no: 'K-1100', at: at(1100) }, { no: 'K-8000', at: at(8000) },
        ], { runs: true });
        const ledger = h.deps.runs!;
        const commit = ledger.commit.bind(ledger);
        let commits = 0;
        ledger.commit = async (...args) => {
            commits++;
            if (commits === 2) throw new Error('SQLITE_BUSY: database is locked');
            return commit(...args);
        };
        const err = await refusalOf(pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM }));
        expect([err.code, err.status, err.reason]).toEqual(['SERVICE_UNAVAILABLE', 503, 'run_record_unavailable']);
        expect(err.message).not.toContain('SQLITE_BUSY');
        const [r] = await runRows(h.ql);
        expect([r.status, r.failure_reason, r.watermark_committed]).toEqual(['failed', 'run_record_unavailable', at(100)]);
    });
});

/** `LifecycleEngineLike` over the harness's managed SQLite driver, as the sys_session sweep test builds it. */
function sweepEngine(driver: SqlDriver, objects: LifecycleObjectLike[]): LifecycleEngineLike {
    return {
        registry: { getAllObjects: () => objects },
        getDriverForObject: () => driver,
        async find(object: string, options: any) {
            const query: DriverQuery = { where: options?.where, limit: options?.limit };
            return driver.find(object, query);
        },
        async delete(object: string, options: any) {
            const dispatch = assertEngineDeleteDispatch(options);
            if (dispatch.kind === 'by-id') {
                const id = typeof dispatch.id === 'bigint' ? dispatch.id.toString() : dispatch.id;
                return (await driver.delete(object, id)) ? 1 : 0;
            }
            return driver.deleteMany(object, { where: options?.where } as DriverQuery);
        },
    };
}

describe('[ADR-0153 D7] retention never removes the run that holds a mapping\'s read position', () => {
    it('one sweep past the window: the superseded run goes, the position holder and a running run stay', async () => {
        const h = await harness(THREE, { runs: true });
        await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        await h.erp.knex.raw('insert into ERP_ORDERS values (?, ?, ?, ?)', ['A-4', at(5000), 40, DEFAULT_ORGANIZATION_ID]);
        await pullConnectorSource(h.deps, { mapping: MAPPING.name, context: SYSTEM });
        await h.deps.runs!.open({ mapping: MAPPING.name }, new Date());
        expect((await runRows(h.ql)).map((r) => [r.status, Boolean(r.holds_position)])).toEqual([
            ['completed', false], ['completed', true], ['running', false],
        ]);

        const object: LifecycleObjectLike = {
            name: SysSyncRun.name,
            lifecycle: (SysSyncRun as any).lifecycle,
            fields: SysSyncRun.fields as any,
        };
        const silent = { info() {}, warn() {}, debug() {}, error() {} };
        const service = new LifecycleService({
            getEngine: () => sweepEngine(h.main, [object]),
            logger: silent,
            now: () => Date.now() + 31 * 86_400_000,
            initialDelayMs: 1,
            sweepIntervalMs: 10,
        } as any);
        await service.sweep();
        expect((await runRows(h.ql)).map((r) => [r.status, r.watermark_committed ?? null, Boolean(r.holds_position)])).toEqual([
            ['completed', at(5000), true], ['running', null, false],
        ]);
    });
});
