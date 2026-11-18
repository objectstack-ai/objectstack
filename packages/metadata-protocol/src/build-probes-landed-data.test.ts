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

/** Fixed tables; honours `where` and then `limit` (`check:objectql-double-limit`). */
const engineOver = (tables: Record<string, Row[]>): ProbeEngine => ({
    find: async (object, query) => {
        const q = query as { where?: Record<string, unknown>; limit?: unknown } | undefined;
        const rows = (tables[object] ?? []).filter((r) => matches(r, q?.where));
        return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
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
    'seed deal_seed': { object: 'deal', records: [] },
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
                deal: [{ id: 'd1', acct_ref: 'a1', owner: 'Jane Smith' }, { id: 'd2', acct_ref: 'a_gone' }],
                acct: [{ id: 'a1' }],
                sys_user: [{ id: 'u1' }],
            }),
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
            engine: engineOver({ deal: [{ id: 'd1', acct_ref: 'a1', owner: 'u1' }, { id: 'd2', acct_ref: null }], acct: [{ id: 'a1' }], sys_user: [{ id: 'u1' }] }),
            published,
        });
        expect(report.issues).toEqual([]);
    });

    it('a target read that throws judges nothing', async () => {
        const report = await run({
            engine: {
                find: async (object) => {
                    if (object === 'deal') return [{ id: 'd1', acct_ref: 'a_gone' }];
                    throw new Error('no such table');
                },
            },
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
