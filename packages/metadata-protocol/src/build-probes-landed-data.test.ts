// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35146] The four probes that read what LANDED: a dashboard card that reads
 * only zeros, a roll-up never computed, a seed reference naming no row, and a
 * flow step naming a connector action the runtime does not serve. Each is a
 * warning: the publish stands, and the receipt says what the person will see.
 * Each has its finding pinned beside the shape that must stay silent.
 * The sentences themselves are pinned in `build-probes-user-message.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import './lint-root-preload.testkit.js';
import { runBuildProbes, type ProbeAutomation, type ProbeEngine, type RunBuildProbesOptions } from './build-probes.js';
import { buildProbeUserMessage } from './build-probes.user-text.js';

type Row = Record<string, unknown>;

/** One `where` on one row: equality and `{ $in: [...] }`; any other operator or combinator is refused. */
const matches = (row: Row, where: Record<string, unknown> | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, want]) => {
        if (key.startsWith('$')) throw new Error(`double: combinator ${key} not implemented`);
        if (!want || typeof want !== 'object') return row[key] === want;
        const ops = Object.keys(want);
        const $in = (want as { $in?: unknown }).$in;
        if (ops.length !== 1 || !Array.isArray($in)) throw new Error(`double: operator ${ops.join(',')} not implemented`);
        return $in.includes(row[key]);
    });

/**
 * Fixed tables; honours `where`, the context's organization, then `limit`
 * (`check:objectql-double-limit`), and the `fields` projection. A table whose
 * rows carry `organization_id` is tenant-scoped, as the engine reads it: a
 * read with a `tenantId` sees that organization's rows only, and `getSchema`
 * names the column. A table whose rows carry none (`sys_user`) is not scoped.
 */
const engineOver = (tables: Record<string, Row[]>): ProbeEngine => ({
    find: async (object, query) => {
        const q = query as
            | { where?: Record<string, unknown>; limit?: unknown; fields?: unknown; context?: { tenantId?: unknown } }
            | undefined;
        const tenant = q?.context?.tenantId;
        const rows = (tables[object] ?? [])
            .filter((r) => matches(r, q?.where))
            .filter((r) => tenant === undefined || !('organization_id' in r) || r.organization_id === tenant);
        const limited = typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        const fields = Array.isArray(q?.fields) ? (q.fields as string[]) : undefined;
        return fields ? limited.map((r) => Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]]))) : limited;
    },
    getSchema: (object) =>
        (tables[object] ?? []).some((r) => 'organization_id' in r)
            ? { name: object, fields: { organization_id: { type: 'lookup', reference: 'sys_organization' } } }
            : { name: object, fields: {} },
});

const ITEMS: Record<string, unknown> = {
    'object acct': {
        name: 'acct',
        fields: {
            deal_count: { type: 'summary', summaryOperations: { object: 'deal', function: 'count' } },
            deal_total: { type: 'summary', summaryOperations: { object: 'deal', function: 'sum', field: 'amount' } },
            won_total: {
                type: 'summary',
                summaryOperations: { object: 'deal', function: 'sum', field: 'amount', filter: { stage: 'won' } },
            },
        },
    },
    'object deal': {
        name: 'deal',
        fields: {
            acct_ref: { type: 'master_detail', reference: 'acct' },
            amount: { type: 'number' },
            owner: { type: 'user' },
        },
    },
    'seed deal_seed': { object: 'deal', records: [{ name: 'D1' }, { name: 'D2' }] },
    'seed deal_seed_upsert': { object: 'deal', mode: 'upsert', records: [{ name: 'D1', acct_ref: 'a_gone' }, { name: 'D2', acct_ref: 'a1' }] },
    'dashboard board': {
        name: 'board',
        widgets: [{ id: 'w1', dataset: 'deal_totals', values: ['total'] }],
    },
    'dataset deal_totals': { name: 'deal_totals', object: 'deal', measures: [{ name: 'total', aggregate: 'count' }] },
    'flow sync': {
        name: 'sync',
        nodes: [
            { id: 'start', type: 'start' },
            { id: 'push', type: 'connector_action', connectorConfig: { connectorId: 'erp', actionId: 'push_order' } },
        ],
        edges: [{ id: 'e', source: 'start', target: 'push' }],
    },
};

const run = (opts: Partial<RunBuildProbesOptions> & Pick<RunBuildProbesOptions, 'published'>) =>
    runBuildProbes({ engine: engineOver({}), getItem: async (t, n) => ITEMS[`${t} ${n}`], ...opts });

const codes = (report: Awaited<ReturnType<typeof run>>) => report.issues.map((i) => [i.code, i.severity, i.ref?.member]);

/** `seedApplied.landed` for one object: the ids the loader created and the ids a seed key matched. */
const landedOn = (object: string, inserted: string[], matched: string[] = []) =>
    [{ object, inserted: { ids: inserted }, matched: { ids: matched } }];

describe('widget_empty_result: a card whose real query reads only zeros', () => {
    const analytics = (rows: Row[]) => ({ queryDataset: async () => ({ rows }) });
    const deals = engineOver({ deal: [{ id: 'd1' }] });

    it('only zeros and nulls on every row: a warning naming the widget', async () => {
        const report = await run({
            engine: deals,
            analytics: analytics([{ total: 0 }, { total: null }]),
            published: [{ type: 'dashboard', name: 'board' }],
        });
        expect(codes(report)).toEqual([['widget_empty_result', 'warning', 'w1']]);
        expect(report.issues[0]!.artifact).toEqual({ type: 'dashboard', name: 'board' });
    });

    it('one non-zero value, or no asked measure in the result: silent', async () => {
        for (const rows of [[{ total: 0 }, { total: 3 }], [{ other: 0 }]]) {
            const report = await run({ engine: deals, analytics: analytics(rows), published: [{ type: 'dashboard', name: 'board' }] });
            expect(report.issues).toEqual([]);
        }
    });

    it('no rows over an object with rows stays `empty_query`, not a second finding', async () => {
        const report = await run({ engine: deals, analytics: analytics([]), published: [{ type: 'dashboard', name: 'board' }] });
        expect(codes(report)).toEqual([['empty_query', 'error', 'w1']]);
    });
});

describe('rollup_never_computed: a roll-up blank on every parent that has children', () => {
    const published = [{ type: 'object', name: 'acct' }];

    it('blank on every parent a child points at: one warning per roll-up, the filtered one unjudged', async () => {
        const report = await run({
            engine: engineOver({
                deal: [{ id: 'd1', acct_ref: 'a1', amount: 5 }, { id: 'd2', acct_ref: 'a2', amount: 7 }],
                acct: [{ id: 'a1', deal_count: null, deal_total: null }, { id: 'a2' }],
            }),
            published,
        });
        expect(codes(report)).toEqual([
            ['rollup_never_computed', 'warning', 'deal_count'],
            ['rollup_never_computed', 'warning', 'deal_total'],
        ]);
    });

    it('computed on one parent (a zero counts), or no parent with children: silent', async () => {
        for (const engine of [
            engineOver({ deal: [{ id: 'd1', acct_ref: 'a1', amount: 0 }], acct: [{ id: 'a1', deal_count: 1, deal_total: 0 }] }),
            engineOver({ deal: [{ id: 'd1', acct_ref: null }], acct: [{ id: 'a1', deal_count: null, deal_total: null }] }),
        ]) {
            expect((await run({ engine, published })).issues).toEqual([]);
        }
    });

    it('a sum whose children carry no value in its field is not judged', async () => {
        const report = await run({
            engine: engineOver({ deal: [{ id: 'd1', acct_ref: 'a1' }], acct: [{ id: 'a1', deal_count: 1, deal_total: null }] }),
            published,
        });
        expect(report.issues).toEqual([]);
    });
});

describe('seed_reference_unresolved: a landed reference naming no row', () => {
    const published = [{ type: 'seed', name: 'deal_seed' }];

    it('a value no target row has: a warning on the seed, naming the column', async () => {
        const report = await run({
            engine: engineOver({
                deal: [{ id: 'd1', name: 'D1', acct_ref: 'a1', owner: 'Jane Smith' }, { id: 'd2', name: 'D2', acct_ref: 'a_gone' }],
                acct: [{ id: 'a1' }],
                sys_user: [{ id: 'u1' }],
            }),
            seedLanded: landedOn('deal', ['d1', 'd2']),
            published,
        });
        expect(codes(report)).toEqual([
            ['seed_reference_unresolved', 'warning', 'acct_ref'],
            ['seed_reference_unresolved', 'warning', 'owner'],
        ]);
        expect(report.issues[0]!.artifact).toEqual({ type: 'seed', name: 'deal_seed' });
        expect(report.issues[0]!.message).toContain('"a_gone"');
        expect(report.issues[1]!.message).toContain('"Jane Smith"');
    });

    it('every value resolves, or the column is blank: silent', async () => {
        const report = await run({
            engine: engineOver({
                deal: [{ id: 'd1', name: 'D1', acct_ref: 'a1', owner: 'u1' }, { id: 'd2', name: 'D2', acct_ref: null }],
                acct: [{ id: 'a1' }],
                sys_user: [{ id: 'u1' }],
            }),
            seedLanded: landedOn('deal', ['d1', 'd2']),
            published,
        });
        expect(report.issues).toEqual([]);
    });

    it('a row the loader did not land is not judged as the seed\'s, though it shares a seed key', async () => {
        const report = await run({
            engine: engineOver({
                deal: [{ id: 'd1', name: 'D1', acct_ref: 'a1' }, { id: 'd9', name: 'D2', acct_ref: 'a_typed_by_a_person' }],
                acct: [{ id: 'a1' }],
            }),
            seedLanded: landedOn('deal', ['d1']),
            published,
        });
        expect(report.issues).toEqual([]);
    });

    it('a row a seed key matched is the seed\'s only when the seed\'s mode wrote it', async () => {
        const engine = engineOver({ deal: [{ id: 'd9', name: 'D1', acct_ref: 'a_gone' }], acct: [] });
        const seedLanded = landedOn('deal', [], ['d9']);
        // `ignore` (the default) left the matched row as its writer left it.
        expect((await run({ engine, seedLanded, published })).issues).toEqual([]);
        // `upsert` wrote it.
        const upsert = await run({ engine, seedLanded, published: [{ type: 'seed', name: 'deal_seed_upsert' }] });
        expect(codes(upsert)).toEqual([['seed_reference_unresolved', 'warning', 'acct_ref']]);
    });

    it('no `seedApplied.landed` for the object: not judged', async () => {
        const report = await run({
            engine: engineOver({ deal: [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }], acct: [] }),
            published,
        });
        expect(report.issues).toEqual([]);
    });

    it('a target read that throws judges nothing', async () => {
        const report = await run({
            engine: {
                find: async (object) => {
                    if (object === 'deal') return [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }];
                    throw new Error('no such table');
                },
            },
            seedLanded: landedOn('deal', ['d1']),
            published,
        });
        expect(report.issues).toEqual([]);
    });
});

describe('flow_connector_action_unresolved: a connector step the runtime cannot dispatch', () => {
    const published = [{ type: 'flow', name: 'sync' }];
    const automation = (over: Partial<ProbeAutomation>): ProbeAutomation => ({
        resolveConnectorInstanceFor: () => ({ status: 'instance', packageId: 'com.acme.app' }),
        resolveConnectorAction: () => undefined,
        getConnectorDegradedReason: () => undefined,
        ...over,
    });

    it('no handler for the action: a warning on the flow, naming connector and action', async () => {
        const report = await run({ automation: automation({}), published, packageId: 'com.acme.app' });
        expect(codes(report)).toEqual([['flow_connector_action_unresolved', 'warning', 'push_order']]);
        expect(report.issues[0]!.artifact).toEqual({ type: 'flow', name: 'sync' });
        expect(report.issues[0]!.ref).toEqual({ type: 'connector', name: 'erp', member: 'push_order' });
    });

    it('the action resolves for the flow\'s package: silent, and the lookups were asked for that package', async () => {
        const asked: Array<[string, string | null | undefined]> = [];
        const report = await run({
            automation: automation({
                resolveConnectorInstanceFor: (id, pkg) => {
                    asked.push([id, pkg]);
                    return { status: 'instance', packageId: pkg };
                },
                resolveConnectorAction: () => async () => ({}),
            }),
            published,
            packageId: 'com.acme.app',
        });
        expect(report.issues).toEqual([]);
        expect(asked).toEqual([['erp', 'com.acme.app']]);
    });

    it('an engine without the connector lookup is not probed', async () => {
        const report = await run({ automation: {}, published });
        expect(report.issues).toEqual([]);
    });
});

describe('the landed-data reads are scoped like the engine\'s reference audit, and projected', () => {
    type Read = { object: string; where?: Record<string, unknown>; fields?: unknown; context?: Record<string, unknown> };
    /** Records every read, over the same fixed tables. */
    const recording = (tables: Record<string, Row[]>) => {
        const reads: Read[] = [];
        const inner = engineOver(tables);
        const engine: ProbeEngine = {
            find: async (object, query) => {
                const q = query as Omit<Read, 'object'>;
                reads.push({ object, where: q.where, fields: q.fields, context: q.context });
                return inner.find(object, query);
            },
            getSchema: inner.getSchema,
        };
        return { engine, reads };
    };
    const seedRowsRead = (r: Read) => r.object === 'deal' && r.where?.id !== undefined;

    it('seed_reference_unresolved: a target row of another organization does not resolve the reference', async () => {
        const { engine, reads } = recording({
            deal: [{ id: 'd1', name: 'D1', organization_id: 'o1', acct_ref: 'a9' }],
            acct: [{ id: 'a9', organization_id: 'o2' }],
        });
        const report = await run({
            engine, organizationId: 'o1', seedLanded: landedOn('deal', ['d1']), published: [{ type: 'seed', name: 'deal_seed' }],
        });
        expect(codes(report)).toEqual([['seed_reference_unresolved', 'warning', 'acct_ref']]);
        expect(reads.filter((r) => r.object === 'acct')).toEqual([
            { object: 'acct', where: { id: { $in: ['a9'] } }, fields: ['id'], context: { isSystem: true, tenantId: 'o1' } },
        ]);
        // The seed's own rows, by the loader's ids, projected to what is judged.
        // (The first `deal` read is `seed_not_applied`'s row count.)
        expect(reads.find(seedRowsRead)).toEqual({
            object: 'deal',
            where: { id: { $in: ['d1'] } },
            fields: ['id', 'acct_ref', 'owner'],
            context: { isSystem: true, tenantId: 'o1' },
        });
    });

    it('seed_reference_unresolved: a row of another organization with the seed\'s key is not matched, counted or quoted', async () => {
        const { engine, reads } = recording({
            deal: [
                { id: 'd1', name: 'D1', organization_id: 'o1', acct_ref: 'a1', owner: 'u1' },
                { id: 'd7', name: 'D1', organization_id: 'o2', acct_ref: 'a_other_org_value', owner: 'u1' },
            ],
            acct: [{ id: 'a1', organization_id: 'o1' }],
            sys_user: [{ id: 'u1' }],
        });
        const report = await run({ engine, seedLanded: landedOn('deal', ['d1']), published: [{ type: 'seed', name: 'deal_seed' }] });
        expect(report.issues).toEqual([]);
        expect(JSON.stringify(reads)).not.toContain('a_other_org_value');
        expect(reads.filter((r) => r.object === 'acct').map((r) => r.where)).toEqual([{ id: { $in: ['a1'] } }]);
    });

    it('seed_reference_unresolved with no publishing organization: each value is judged in its row\'s own organization', async () => {
        const { engine, reads } = recording({
            deal: [
                { id: 'd1', name: 'D1', organization_id: 'o1', acct_ref: 'a1', owner: 'u1' },
                { id: 'd2', name: 'D2', organization_id: 'o2', acct_ref: 'a1', owner: 'u1' },
            ],
            acct: [{ id: 'a1', organization_id: 'o1' }],
            sys_user: [{ id: 'u1' }],
        });
        const report = await run({ engine, seedLanded: landedOn('deal', ['d1', 'd2']), published: [{ type: 'seed', name: 'deal_seed' }] });
        // `a1` resolves for the o1 row and not for the o2 one; `sys_user` has no
        // tenant column, so `u1` resolves in both.
        expect(codes(report)).toEqual([['seed_reference_unresolved', 'warning', 'acct_ref']]);
        expect(report.issues[0]!.message).toContain('1 value(s)');
        expect(reads.filter((r) => r.object === 'acct').map((r) => r.context)).toEqual([
            { isSystem: true, tenantId: 'o1' },
            { isSystem: true, tenantId: 'o2' },
        ]);
        expect(reads.find(seedRowsRead)!.fields).toEqual(['id', 'acct_ref', 'owner', 'organization_id']);
    });

    it('rollup_never_computed: a parent row of another organization is not judged', async () => {
        const { engine, reads } = recording({
            deal: [{ id: 'd1', organization_id: 'o1', acct_ref: 'a1', amount: 5 }],
            acct: [{ id: 'a1', organization_id: 'o2', deal_count: null, deal_total: null }],
        });
        const report = await run({ engine, organizationId: 'o1', published: [{ type: 'object', name: 'acct' }] });
        expect(report.issues).toEqual([]);
        const parents = reads.filter((r) => r.object === 'acct');
        expect(parents.map((r) => [r.where, r.fields, r.context])).toEqual([
            [{ id: { $in: ['a1'] } }, ['id', 'deal_count'], { isSystem: true, tenantId: 'o1' }],
            [{ id: { $in: ['a1'] } }, ['id', 'deal_total'], { isSystem: true, tenantId: 'o1' }],
        ]);
        expect(reads.filter((r) => r.object === 'deal').map((r) => [r.fields, r.context])).toEqual([
            [['id', 'acct_ref'], { isSystem: true, tenantId: 'o1' }],
            [['id', 'acct_ref', 'amount'], { isSystem: true, tenantId: 'o1' }],
        ]);
    });

    it('rollup_never_computed with no publishing organization: a child of another organization is not counted', async () => {
        const { engine, reads } = recording({
            deal: [
                { id: 'd1', organization_id: 'o1', acct_ref: 'a1', amount: 5 },
                { id: 'd2', organization_id: 'o2', acct_ref: 'b1', amount: 5 },
                { id: 'd3', organization_id: 'o2', acct_ref: 'b2', amount: 5 },
            ],
            acct: [
                { id: 'a1', organization_id: 'o1', deal_count: 1, deal_total: 5 },
                { id: 'b1', organization_id: 'o2', deal_count: null, deal_total: null },
                { id: 'b2', organization_id: 'o2', deal_count: null, deal_total: null },
            ],
        });
        const report = await run({ engine, published: [{ type: 'object', name: 'acct' }] });
        // o1 computed its roll-ups; o2 never did. The verdict and the count are o2's alone.
        expect(codes(report)).toEqual([
            ['rollup_never_computed', 'warning', 'deal_count'],
            ['rollup_never_computed', 'warning', 'deal_total'],
        ]);
        expect(report.issues[0]!.message).toContain('all 2 sampled parent row(s) of one organization');
        const samples = reads.filter((r) => r.object === 'deal' && r.context?.tenantId !== undefined);
        expect(samples.map((r) => r.context!.tenantId)).toEqual(['o1', 'o2', 'o1', 'o2']);
        // The organizations come from a read projected to the tenant column alone.
        expect(reads.filter((r) => r.object === 'deal' && r.context?.tenantId === undefined).map((r) => r.fields))
            .toEqual([['organization_id'], ['organization_id']]);
        for (const r of reads.filter((x) => x.object === 'acct')) expect(r.context!.tenantId).toBeDefined();
    });
});

describe('rollup_never_computed names the repair that fills the function', () => {
    const items: Record<string, unknown> = {
        ...ITEMS,
        'object acct': {
            name: 'acct',
            fields: {
                deal_total: { type: 'summary', summaryOperations: { object: 'deal', function: 'sum', field: 'amount' } },
                deal_max: { type: 'summary', summaryOperations: { object: 'deal', function: 'max', field: 'amount' } },
            },
        },
    };
    it('`sum` names the plain run; `max` names `--recompute-undefined-on-empty object.field`', async () => {
        const report = await run({
            engine: engineOver({ deal: [{ id: 'd1', acct_ref: 'a1', amount: 5 }], acct: [{ id: 'a1' }] }),
            getItem: async (t, n) => items[`${t} ${n}`],
            published: [{ type: 'object', name: 'acct' }],
        });
        expect(codes(report)).toEqual([
            ['rollup_never_computed', 'warning', 'deal_total'],
            ['rollup_never_computed', 'warning', 'deal_max'],
        ]);
        expect(report.issues[0]!.fix).toContain('`os migrate summary-nulls --apply` computes');
        expect(report.issues[0]!.fix).not.toContain('--recompute-undefined-on-empty');
        expect(report.issues[1]!.fix).toContain('`os migrate summary-nulls --apply --recompute-undefined-on-empty acct.deal_max`');
        expect(report.issues[1]!.userMessage).toContain('--recompute-undefined-on-empty');
        expect(report.issues[0]!.userMessage).not.toContain('--recompute-undefined-on-empty');
    });
});

describe('rollup_never_computed: the message says "of one organization" only on a pass split by organization', () => {
    it('an object with no tenant column is judged in one unscoped pass, and the message claims no organization', async () => {
        const report = await run({
            engine: { find: engineOver({ deal: [{ id: 'd1', acct_ref: 'a1', amount: 5 }], acct: [{ id: 'a1' }] }).find },
            published: [{ type: 'object', name: 'acct' }],
        });
        expect(codes(report)[0]).toEqual(['rollup_never_computed', 'warning', 'deal_count']);
        expect(report.issues[0]!.message).toContain('all 1 sampled parent row(s) that have "deal" children');
        expect(report.issues[0]!.message).not.toContain('organization');
    });

    it('a publishing organization over a child object with no tenant column is still one unscoped pass', async () => {
        const report = await run({
            engine: engineOver({ deal: [{ id: 'd1', acct_ref: 'a1', amount: 5 }], acct: [{ id: 'a1' }] }),
            organizationId: 'o1',
            published: [{ type: 'object', name: 'acct' }],
        });
        expect(codes(report)[0]).toEqual(['rollup_never_computed', 'warning', 'deal_count']);
        expect(report.issues[0]!.message).not.toContain('organization');
    });
});

describe('seed_reference_unresolved is judged per object, and names the repair a republish reaches', () => {
    // `seedApplied.landed` is one entry per object for every seed of it
    // (`seedAppliedLanded`), so the judgement is per object and column. A
    // republish rewrites a stored value only under a writing mode, for a
    // column every record carries and none keeps for create (`seed-loader.ts`
    // `writeRecord`, `createOnlySeedColumns`); any other repair is the stored row's.
    const items: Record<string, unknown> = {
        ...ITEMS,
        'seed deals_ignore': { object: 'deal', records: [{ name: 'D1', acct_ref: 'a_gone' }] },
        'seed deals_upsert': { object: 'deal', mode: 'upsert', records: [{ name: 'D1', acct_ref: 'a_gone' }] },
        'seed deals_upsert_too': { object: 'deal', mode: 'upsert', records: [{ name: 'D2', acct_ref: 'a_lost' }] },
        'seed deals_kept_for_create': {
            object: 'deal', mode: 'upsert', columns: { acct_ref: { applyOn: 'create' } }, records: [{ name: 'D1', acct_ref: 'a_gone' }],
        },
        'seed deals_without_column': { object: 'deal', mode: 'upsert', records: [{ name: 'D1' }] },
    };
    const getItem: RunBuildProbesOptions['getItem'] = async (t, n) => items[`${t} ${n}`];
    const seeds = (...names: string[]) => names.map((name) => ({ type: 'seed', name }));
    const sentence = (cause: string, count = '1') =>
        buildProbeUserMessage('seed_reference_unresolved', { object: 'deal', field: 'acct_ref', target: 'acct', count, cause }, ['en']);
    const only = (report: Awaited<ReturnType<typeof run>>) => {
        expect(codes(report)).toEqual([['seed_reference_unresolved', 'warning', 'acct_ref']]);
        return report.issues[0]!;
    };

    it('under `ignore`, the repair named reaches the stored row; a republish of the seed as it is does not', async () => {
        const dangling = engineOver({ deal: [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }], acct: [{ id: 'a1' }] });
        // The first publish created the row: judged, and the repair is the stored row's, or `upsert`.
        const first = only(await run({ engine: dangling, getItem, seedLanded: landedOn('deal', ['d1']), published: seeds('deals_ignore') }));
        expect(first.fix).toContain("Republishing the seed as it is does not change those rows: under `mode: 'ignore'`");
        expect(first.fix).toContain('correct or clear "deal.acct_ref" on those stored rows, or delete them');
        expect(first.fix).toContain("declare `mode: 'upsert'` on those seed(s)");
        expect(first.fix).toContain('the next receipt carries no finding for those rows');
        expect(first.userMessage).toBe(sentence('mode'));
        // A republish under `ignore` matched the row and left it: not the seed's to judge.
        expect((await run({ engine: dangling, getItem, seedLanded: landedOn('deal', [], ['d1']), published: seeds('deals_ignore') })).issues)
            .toEqual([]);
        // The repair it named, `upsert`: the matched row is the seed's now, and keeps being reported until it resolves.
        const kept = only(await run({ engine: dangling, getItem, seedLanded: landedOn('deal', [], ['d1']), published: seeds('deals_upsert') }));
        expect(kept.fix).toContain('in the seed (by a value the loader resolves), or clear it there, then republish the seed');
        expect(kept.userMessage).toBe(sentence('seed'));
        const repaired = engineOver({ deal: [{ id: 'd1', name: 'D1', acct_ref: 'a1' }], acct: [{ id: 'a1' }] });
        expect((await run({ engine: repaired, getItem, seedLanded: landedOn('deal', [], ['d1']), published: seeds('deals_upsert') })).issues)
            .toEqual([]);
    });

    it('two seeds of one object, one `ignore` and one `upsert`: one finding per column, over the rows this publish created', async () => {
        const engine = engineOver({
            deal: [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }, { id: 'd2', name: 'D2', acct_ref: 'a_matched_by_ignore' }],
            acct: [],
        });
        const issue = only(await run({
            engine, getItem, seedLanded: landedOn('deal', ['d1'], ['d2']), published: seeds('deals_ignore', 'deals_upsert'),
        }));
        // The matched row is not judged: no seed of the object can be said to have written it.
        expect(issue.message).toContain('1 value(s)');
        expect(issue.message).toContain('seed(s) "deals_ignore", "deals_upsert" landed');
        expect(issue.message).not.toContain('a_matched_by_ignore');
        expect(issue.artifact).toEqual({ type: 'seed', name: 'deals_ignore' });
        // Both seeds carry D1: a stored correction alone is written over by `deals_upsert`'s next replay,
        // so the repair names the writing seed too, and claims no republish leaves every row alone.
        expect(issue.fix).toContain('seed(s) "deals_upsert" write "deal.acct_ref" back onto every row they find again');
        expect(issue.fix).toContain("seed(s) \"deals_ignore\" use `mode: 'ignore'` (the default)");
        expect(issue.fix).toContain('in every seed of the object');
        expect(issue.fix).toContain("or declare `mode: 'upsert'` on seed(s) \"deals_ignore\"");
        expect(issue.fix).not.toContain('does not change those rows');
        expect(issue.fix).toContain('the next receipt carries no finding for those rows');
        expect(issue.userMessage).toBe(sentence('mixed'));
        expect(issue.userMessage).not.toContain('does not change');
    });

    it('two writing seeds of one object: their matched rows are judged together, in one finding', async () => {
        const engine = engineOver({
            deal: [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }, { id: 'd2', name: 'D2', acct_ref: 'a_lost' }],
            acct: [],
        });
        const issue = only(await run({
            engine, getItem, seedLanded: landedOn('deal', [], ['d1', 'd2']), published: seeds('deals_upsert', 'deals_upsert_too'),
        }));
        expect(issue.message).toContain('2 value(s)');
        expect(issue.userMessage).toBe(sentence('seed', '2'));
    });

    it('a column the seed does not write on a matched row is not judged there; on a row it created, the repair is the stored row', async () => {
        const engine = engineOver({
            deal: [{ id: 'd1', name: 'D1', acct_ref: 'a_gone' }, { id: 'd2', name: 'D2', acct_ref: 'a_customer_value' }],
            acct: [],
        });
        for (const seed of ['deals_kept_for_create', 'deals_without_column']) {
            // Matched only: the column is its writer's, so nothing is judged.
            expect((await run({ engine, getItem, seedLanded: landedOn('deal', [], ['d2']), published: seeds(seed) })).issues).toEqual([]);
            // Created by this publish: judged, and the seed cannot repair it on a replay.
            const issue = only(await run({ engine, getItem, seedLanded: landedOn('deal', ['d1'], ['d2']), published: seeds(seed) }));
            expect(issue.message).toContain('1 value(s)');
            expect(issue.message).not.toContain('a_customer_value');
            expect(issue.fix).toContain('Republishing the seed does not change "deal.acct_ref" on those rows');
            expect(issue.fix).toContain(
                seed === 'deals_kept_for_create'
                    ? "declare `columns.acct_ref.applyOn: 'create'`"
                    : 'have a record that does not carry "acct_ref"',
            );
            expect(issue.fix).not.toContain("declare `mode: 'upsert'`");
            expect(issue.fix).toContain('the next receipt carries no finding for those rows');
            expect(issue.userMessage).toBe(sentence('stored'));
        }
    });
});
