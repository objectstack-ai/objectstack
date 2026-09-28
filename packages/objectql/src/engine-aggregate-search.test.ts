// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `aggregate` honours ADR-0061 `search` / `searchFields` — through the ONE
 * expander `find` runs.
 *
 * `QuerySchema.search` (ADR-0061 D1) is declared on the query beside `groupBy`
 * / `aggregations` with no carve-out. `find` expanded it; `aggregate` refused
 * it as an unknown option, and the one wire path to `aggregate` (`findData`'s
 * grouped branch) left it out of the bag — so a grouped read under a search
 * answered the UNSEARCHED groups. `EngineAggregateOptionsSchema` now declares
 * the two keys exactly as the query options do, and `aggregate` runs
 * `expandSearchOnAst` on them.
 *
 * Two engine read verbs now honour one declared key, which makes this a
 * two-implementation surface in waiting. The pins below are placed so that a
 * future divergence goes red HERE rather than in a grouped list view:
 *
 *  1. the predicate `aggregate` hands the driver is the predicate `find` hands
 *     it, for the same `where` / `search` / `searchFields` — on both aggregate
 *     tiers (native `driver.aggregate` and the in-memory lowering);
 *  2. the aggregate over a search equals the aggregate over the same filter
 *     written as `where`, and equals the grouping of `find`'s searched rows;
 *  3. the drift pin at the bottom walks `ENGINE_OPTION_KEY_SETS.aggregate` and
 *     requires each legal key to have an observable effect — the question
 *     `findOne`'s own drift pin asks (engine-findone-contract.test.ts), asked
 *     of this verb too, so a key declared here and never executed cannot ship.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL, ENGINE_OPTION_KEY_SETS } from './engine.js';

const account = {
    name: 'crm_account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        region: { name: 'region', type: 'text' as const },
        status: { name: 'status', type: 'text' as const },
        city: { name: 'city', type: 'text' as const },
        amount: { name: 'amount', type: 'number' as const },
        opened_on: { name: 'opened_on', type: 'date' as const },
    },
};

/**
 * Five rows. `harbour` hits `name` on rows 1–2 and `city` on row 3, so the
 * default search set and a `searchFields: ['name']` narrowing answer different
 * groups — the narrowing is observable, not assumed.
 */
const ROWS: ReadonlyArray<Record<string, unknown>> = [
    { id: 'a1', name: 'Harbour Freight', region: 'east', status: 'open', city: 'Boston', amount: 100, opened_on: '2026-01-01' },
    { id: 'a2', name: 'Harbour Lights', region: 'west', status: 'closed', city: 'Seattle', amount: 200, opened_on: '2026-01-02' },
    { id: 'a3', name: 'Northgate Mills', region: 'east', status: 'open', city: 'Harbourton', amount: 300, opened_on: '2026-01-02' },
    { id: 'a4', name: 'Riverside Co', region: 'west', status: 'open', city: 'Portland', amount: 400, opened_on: '2026-01-03' },
    { id: 'a5', name: 'Northgate Depot', region: 'east', status: 'closed', city: 'Denver', amount: 500, opened_on: '2026-01-03' },
];

/** The filter operators this suite's rows can meet — the ones `$search` compiles to, plus `where`'s. */
function matches(row: Record<string, unknown>, where: unknown): boolean {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
        if (k === '$and') { if (!(v as unknown[]).every((w) => matches(row, w))) return false; continue; }
        if (k === '$or') { if (!(v as unknown[]).some((w) => matches(row, w))) return false; continue; }
        const cell = row[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const [op, arg] of Object.entries(v as Record<string, unknown>)) {
                if (op === '$icontains') {
                    if (!String(cell ?? '').toLowerCase().includes(String(arg).toLowerCase())) return false;
                } else if (op === '$eq') {
                    if (cell !== arg) return false;
                } else if (op === '$in') {
                    if (!(arg as unknown[]).includes(cell)) return false;
                } else {
                    throw new Error(`test driver: unsupported operator ${op}`);
                }
            }
            continue;
        }
        if (cell !== v) return false;
    }
    return true;
}

interface SeenRead { via: 'find' | 'aggregate'; ast: any; opts: any }

/**
 * A driver whose `find` evaluates `where`, and — on the native tier — whose
 * `aggregate` evaluates `where` and groups by plain-string `groupBy` with
 * `count` / `sum`. Records every read's AST and driver options.
 */
function makeDriver(native: boolean) {
    const reads: SeenRead[] = [];
    const driver: any = {
        name: native ? 'native-agg' : 'rows-only',
        version: '0.0.0',
        supports: { queryDateGranularity: { day: true } },
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(_o: string, ast: any, opts: any) {
            reads.push({ via: 'find', ast: { ...ast }, opts });
            const matched = ROWS.filter((r) => matches(r, ast?.where));
            const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
            return page.map((r) => ({ ...r }));
        },
        async findOne() { return null; },
        async create(_o: string, d: any) { return d; },
        async update(_o: string, _id: string, d: any) { return d; },
        async delete() { return true; },
        async count() { return ROWS.length; },
        async bulkCreate(_o: string, r: any[]) { return r; },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    if (native) {
        driver.aggregate = async (_o: string, ast: any, opts: any) => {
            reads.push({ via: 'aggregate', ast: { ...ast }, opts });
            const rows = ROWS.filter((r) => matches(r, ast?.where));
            const keys: string[] = (ast.groupBy ?? []).map((g: unknown) => (typeof g === 'string' ? g : (g as { field: string }).field));
            const groups = new Map<string, Array<Record<string, unknown>>>();
            for (const row of rows) {
                const key = JSON.stringify(keys.map((k) => row[k]));
                groups.set(key, [...(groups.get(key) ?? []), row]);
            }
            if (keys.length === 0 && groups.size === 0) groups.set('[]', []);
            return [...groups.values()].map((members) => {
                const out: Record<string, unknown> = {};
                for (const k of keys) out[k] = members[0]?.[k];
                for (const agg of ast.aggregations ?? []) {
                    if (agg.function === 'count') out[agg.alias] = members.length;
                    if (agg.function === 'sum') out[agg.alias] = members.reduce((n, r) => n + (r[agg.field] as number), 0);
                }
                return out;
            });
        };
    }
    return { driver, reads };
}

type Tier = 'native' | 'in-memory';
const TIERS: readonly Tier[] = ['native', 'in-memory'];

async function makeEngine(tier: Tier) {
    const { driver, reads } = makeDriver(tier === 'native');
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    (engine.registry as any).registerObject(account);
    return { engine, reads };
}

const COUNT: NonNullable<EngineAggregateOptions['aggregations']> = [{ function: 'count', alias: 'n' }];

/** Group rows → `{ region: n }`, order-independent. */
const byRegion = (rows: any[]): Record<string, number> =>
    Object.fromEntries(rows.map((r) => [String(r.region), r.n as number]));

/** Rows → `{ region: count }` — the grouping of a flat read. */
const tally = (rows: any[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.region)] = (out[String(r.region)] ?? 0) + 1;
    return out;
};

/** The DATA read an aggregate made — the native call, or the in-memory tier's rows read. */
const aggregateRead = (reads: SeenRead[], tier: Tier): SeenRead => {
    const own = reads.filter((r) => r.via === (tier === 'native' ? 'aggregate' : 'find'));
    expect(own.length, `the ${tier} tier made no data read`).toBeGreaterThan(0);
    return own[own.length - 1];
};

describe.each(TIERS)('aggregate honours `search` — %s tier', (tier) => {
    let engine: ObjectQL;
    let reads: SeenRead[];

    beforeEach(async () => {
        ({ engine, reads } = await makeEngine(tier));
    });

    it('groups the SEARCHED rows — and the unsearched control answers every row', async () => {
        const searched = await engine.aggregate('crm_account', { groupBy: ['region'], aggregations: COUNT, search: 'harbour' });
        expect(byRegion(searched)).toEqual({ east: 2, west: 1 });
        const unsearched = await engine.aggregate('crm_account', { groupBy: ['region'], aggregations: COUNT });
        expect(byRegion(unsearched)).toEqual({ east: 3, west: 2 });
    });

    it('the grouped answer IS the grouping of find()\'s searched rows — default fields, narrowed, and AND-ed with where', async () => {
        const cases: Array<Pick<EngineAggregateOptions, 'where' | 'search' | 'searchFields'>> = [
            { search: 'harbour' },
            { search: 'harbour', searchFields: ['name'] },
            { search: { query: 'harbour', fields: ['city'] } },
            { search: 'harbour', where: { status: 'open' } },
            { search: 'northgate harbour' },
        ];
        const answers: string[] = [];
        for (const c of cases) {
            const flat = await engine.find('crm_account', { ...c });
            const grouped = await engine.aggregate('crm_account', { ...c, groupBy: ['region'], aggregations: COUNT });
            expect(byRegion(grouped), JSON.stringify(c)).toEqual(tally(flat));
            answers.push(JSON.stringify(byRegion(grouped)));
        }
        // The five cases are not five spellings of one answer: the narrowing,
        // the structured form and the `where` each move the numbers.
        expect(new Set(answers).size).toBe(4);
        expect(answers[0]).toBe(JSON.stringify({ east: 2, west: 1 }));
        expect(answers[1]).toBe(JSON.stringify({ east: 1, west: 1 }));
        expect(answers[2]).toBe(JSON.stringify({ east: 1 }));
        expect(answers[3]).toBe(JSON.stringify({ east: 2 }));
        expect(answers[4]).toBe(JSON.stringify({ east: 1 }));
    });

    it('ONE expander: the predicate the driver receives is the one find() sends, and no search key rides down', async () => {
        const bags: Array<Pick<EngineAggregateOptions, 'where' | 'search' | 'searchFields'>> = [
            { search: 'harbour' },
            { search: 'harbour', searchFields: ['name', 'city'] },
            { search: { query: 'harbour', fields: ['city'] } },
            { search: 'harbour', where: { status: 'open' } },
        ];
        for (const bag of bags) {
            reads.length = 0;
            await engine.find('crm_account', { ...bag });
            const found = reads.find((r) => r.via === 'find')!;
            reads.length = 0;
            await engine.aggregate('crm_account', { ...bag, groupBy: ['region'], aggregations: COUNT });
            const aggregated = aggregateRead(reads, tier);
            expect(aggregated.ast.where, JSON.stringify(bag)).toEqual(found.ast.where);
            expect(JSON.stringify(aggregated.ast.where ?? null)).toContain('$icontains');
            for (const key of ['search', 'searchFields']) {
                expect(found.ast, `find: ${key}`).not.toHaveProperty(key);
                expect(aggregated.ast, `aggregate: ${key}`).not.toHaveProperty(key);
            }
        }
    });

    it('the aggregate over a search equals the aggregate over the same filter written as `where`', async () => {
        reads.length = 0;
        await engine.find('crm_account', { search: 'harbour', where: { status: 'open' } });
        const expanded = reads.find((r) => r.via === 'find')!.ast.where;

        const viaSearch = await engine.aggregate('crm_account', {
            where: { status: 'open' }, search: 'harbour', groupBy: ['region'], aggregations: COUNT,
        });
        const viaWhere = await engine.aggregate('crm_account', {
            where: expanded, groupBy: ['region'], aggregations: COUNT,
        });
        expect(viaSearch).toEqual(viaWhere);
        expect(byRegion(viaSearch)).toEqual({ east: 2 });
    });

    it('`aggregations` with no `groupBy` — the one whole-set row is over the searched rows', async () => {
        const rows = await engine.aggregate('crm_account', {
            aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'amount', alias: 'total' }],
            search: 'harbour',
        });
        expect(rows).toEqual([{ n: 3, total: 600 }]);
    });

    it('`search` and `having` both apply — search picks the rows, having picks the groups', async () => {
        const rows = await engine.aggregate('crm_account', {
            groupBy: ['region'], aggregations: COUNT, search: 'harbour', having: { n: { $gt: 1 } },
        });
        expect(byRegion(rows)).toEqual({ east: 2 });
    });

    it('the caller\'s bag is not written through — view metadata and flow config are reused', async () => {
        const bag = Object.freeze({
            where: Object.freeze({ status: 'open' }),
            search: 'harbour',
            searchFields: Object.freeze(['name']) as unknown as string[],
            groupBy: ['region'],
            aggregations: COUNT,
        });
        await engine.aggregate('crm_account', bag as EngineAggregateOptions);
        expect(bag.where).toEqual({ status: 'open' });
        expect(bag.search).toBe('harbour');
    });
});

describe('aggregate still refuses what it does not execute', () => {
    it.each(['$search', '$searchFields'])('the OData spelling %s is an unknown option on aggregate, as on find', async (key) => {
        const { engine, reads } = await makeEngine('native');
        await expect(engine.aggregate('crm_account', { aggregations: COUNT, [key]: 'harbour' } as unknown as EngineAggregateOptions))
            .rejects.toThrow(new RegExp(`aggregate\\('crm_account'\\) does not recognise option '\\${key}'.*Legal keys for aggregate: .*search, searchFields`, 's'));
        expect(reads).toHaveLength(0);
    });
});

// ── drift pin: every declared aggregate option is executed ──────────────────

describe('every option aggregate declares is one it executes', () => {
    /**
     * One proof per key in `ENGINE_OPTION_KEY_SETS.aggregate`: the call to make
     * and what must be observable afterwards (the driver read it caused, and
     * the answer). The table is asserted to cover the legal set EXACTLY, so a
     * key added to `EngineAggregateOptionsSchema` must be given a proof before
     * it can ship — `search` sat declared on the query and unexecuted on this
     * verb because nothing asked that question here.
     */
    interface Proof {
        call: Record<string, unknown>;
        expect: (seen: SeenRead, result: any[]) => void;
    }
    const PROOFS: Record<string, Proof> = {
        where: {
            call: { where: { region: 'west' }, aggregations: COUNT },
            expect: ({ ast }, result) => {
                expect(ast.where).toMatchObject({ region: 'west' });
                expect(result).toEqual([{ n: 2 }]);
            },
        },
        groupBy: {
            call: { groupBy: ['region'], aggregations: COUNT },
            expect: ({ ast }, result) => {
                expect(ast.groupBy).toEqual(['region']);
                expect(byRegion(result)).toEqual({ east: 3, west: 2 });
            },
        },
        aggregations: {
            call: { aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] },
            expect: ({ ast }, result) => {
                expect(ast.aggregations).toEqual([{ function: 'sum', field: 'amount', alias: 'total' }]);
                expect(result).toEqual([{ total: 1500 }]);
            },
        },
        having: {
            call: { groupBy: ['region'], aggregations: COUNT, having: { n: { $gt: 2 } } },
            // Engine-owned, applied after the driver's grouping.
            expect: (_seen, result) => expect(byRegion(result)).toEqual({ east: 3 }),
        },
        timezone: {
            call: {
                groupBy: [{ field: 'opened_on', dateGranularity: 'day' }],
                aggregations: COUNT,
                timezone: 'Asia/Shanghai',
            },
            // A non-UTC zone on a date bucket forces the in-memory lowering even
            // though this driver advertises native day bucketing (ADR-0053).
            expect: ({ via }, result) => {
                expect(via).toBe('find');
                expect(result.reduce((n: number, r: any) => n + r.n, 0)).toBe(ROWS.length);
            },
        },
        context: {
            call: { aggregations: COUNT, context: { tenantId: 't-1' } },
            expect: ({ ast, opts }) => {
                expect(ast.context).toBeUndefined(); // not a driver concern
                expect(opts).toMatchObject({ tenantId: 't-1' });
            },
        },
        search: {
            call: { groupBy: ['region'], aggregations: COUNT, search: 'harbour' },
            expect: ({ ast }, result) => {
                expect(ast.search).toBeUndefined();
                expect(JSON.stringify(ast.where ?? null)).toContain('$icontains');
                expect(byRegion(result)).toEqual({ east: 2, west: 1 });
            },
        },
        searchFields: {
            call: { groupBy: ['region'], aggregations: COUNT, search: 'harbour', searchFields: ['city'] },
            expect: ({ ast }, result) => {
                expect(ast.searchFields).toBeUndefined();
                // Narrowed to the one requested column, not the default set.
                expect(JSON.stringify(ast.where ?? null)).toContain('city');
                expect(JSON.stringify(ast.where ?? null)).not.toContain('"name"');
                expect(byRegion(result)).toEqual({ east: 1 });
            },
        },
    };

    it('covers the legal set exactly, and each proof holds on the native tier', async () => {
        expect(new Set(Object.keys(PROOFS)), 'PROOFS must cover the legal set exactly')
            .toEqual(new Set(ENGINE_OPTION_KEY_SETS.aggregate));

        const { engine, reads } = await makeEngine('native');
        for (const [key, proof] of Object.entries(PROOFS)) {
            reads.length = 0;
            const result = await engine.aggregate('crm_account', proof.call as unknown as EngineAggregateOptions);
            expect(reads.length, `aggregate({${key}}) must reach the driver`).toBeGreaterThan(0);
            proof.expect(reads[reads.length - 1], result);
        }
    });
});
