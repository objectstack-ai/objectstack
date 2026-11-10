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

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { pullConnectorSource, type ConnectorPullDeps, type ConnectorPullProtocol } from './connector-pull.js';
import { ConnectorPullError } from './pull-refusal.js';
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
        updated_at: { name: 'updated_at', label: 'Updated at', type: 'datetime' },
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
        { source: 'updated_at', target: 'updated_at' },
    ],
    datasourceSource: { object: 'erp_order', watermark: { field: 'updated_at', start: '2026-01-01' } },
};

const ERP_DEF = { name: 'erp', driver: 'sqlite', schemaMode: 'external' };

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

interface Harness {
    ql: ObjectQL;
    erp: any;
    meta: { object: Map<string, Rec>; mapping: Map<string, Rec>; datasource: Map<string, Rec> };
    deps: ConnectorPullDeps;
}

let open: Harness | undefined;
afterEach(async () => {
    await open?.erp?.disconnect?.();
    open = undefined;
    delete process.env.OS_TENANCY_POSTURE;
});

/** The engine's own protocol, adapted as the connector pull's integration test adapts it; metadata from `meta`. */
function protocolOver(ql: ObjectQL, meta: Harness['meta']): ConnectorPullProtocol {
    return {
        async getMetaItem({ type, name }) {
            const item = (meta as Record<string, Map<string, Rec>>)[type]?.get(name);
            return item ? { type, name, item } : undefined;
        },
        async findData({ object, query, context }) {
            const { object: _omit, ...rest } = (query ?? {}) as EngineQueryOptions & { object?: string };
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
    over: { source?: Rec; target?: Rec; mapping?: Rec } = {},
    setup?: (ql: ObjectQL) => void,
): Promise<Harness> {
    const ql = new ObjectQL();
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
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
        logger: silent as never,
    };
    open = { ql, erp, meta, deps };
    return open;
}

async function refusalOf(p: Promise<unknown>): Promise<ConnectorPullError> {
    const err = await p.then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ConnectorPullError);
    return err as ConnectorPullError;
}

async function copies(ql: ObjectQL): Promise<Rec[]> {
    const rows = await ql.find('order_copy', { orderBy: [{ field: 'external_no', order: 'asc' }], context: SYSTEM as never });
    return rows.map((r: Rec) => ({ external_no: r.external_no, amount: r.amount, updated_at: r.updated_at }));
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
