// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20148] The KEYS inside a per-aggregation `filter`, at the read door.
 *
 * `findData` judged a `where`'s keys against the object's field set (#7534,
 * {@link ObjectStackProtocolImplementation} `assertFilterFieldsExist`) and an
 * aggregation's `function` / `alias` / `field` (#4254), but never the keys of
 * the filter an aggregation carries. Measured on the base through
 * `POST /api/v1/data/:object/query` on driver-memory and driver-sql:
 *
 * ```
 * aggregations: [{ …, filter: { nope: 1 } }]     -> 200, that count 0
 * aggregations: [{ …, filter: { nope: { $ne: 1 } } }] -> 200, EVERY row counted
 * where: { nope: 1 }                              -> 400 INVALID_FIELD
 * ```
 *
 * Now each aggregation's filter goes through the `where` gate itself: the same
 * field set, the same `unknown` > `dotted` > virtual ladder, the same
 * `INVALID_FIELD` / 400, the caller's position (`aggregations[1].filter`) as
 * the parameter — and the engine is never reached. Every pin below asserts
 * `code` AND `status` AND that `engine.aggregate` was not called; the
 * preservation half asserts what the engine received.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        doubled: { name: 'doubled', type: 'formula', expression: 'amount * 2' },
        owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    },
};

function makeProtocol() {
    const find = vi.fn(async () => [] as unknown[]);
    const aggregate = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        aggregate,
        count: vi.fn(async () => 0),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, aggregate };
}

/** The second of two aggregations carries `filter`, so the position must name WHICH one. */
function withFilter(filter: unknown) {
    return {
        aggregations: [
            { function: 'count', alias: 'n' },
            { function: 'count', alias: 'm', filter },
        ],
    };
}

async function refusalFor(query: Record<string, unknown>) {
    const { p, find, aggregate } = makeProtocol();
    let answered: unknown;
    try {
        answered = await p.findData({ object: 'invoice', query } as never);
    } catch (e) {
        expect(find, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        expect(aggregate, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        return e as Error & { status?: number; code?: string; param?: string; field?: string; fields?: string[] };
    }
    throw new Error(`${JSON.stringify(query)} was ACCEPTED (answered ${JSON.stringify(answered)}) instead of refused`);
}

describe('[#20148] findData — the keys inside a per-aggregation filter meet the where gate', () => {
    const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
        ['an unknown key (the card\'s row 4)', { nope: 1 }, 'nope'],
        ['an unknown key under $ne', { nope: { $ne: 1 } }, 'nope'],
        ['an unknown key under $and', { $and: [{ amount: { $gt: 0 } }, { nope: 1 }] }, 'nope'],
        ['an unknown key behind a $or branch that holds', { $or: [{ amount: { $gt: 0 } }, { nope: 1 }] }, 'nope'],
        ['an unknown key under $not', { $not: { nope: 1 } }, 'nope'],
        ['an unknown key beside an unknown operator', { nope: { $median: 1 } }, 'nope'],
    ];

    for (const [name, filter, key] of REFUSED) {
        it(`${name}: 400 INVALID_FIELD at the aggregation's position, as the same key in where is`, async () => {
            const err = await refusalFor(withFilter(filter));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe(key);
            expect(err.param).toBe('aggregations[1].filter');
            // The twin: the same condition as the call's `where`.
            const twin = await refusalFor({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });
            expect(twin.code).toBe('INVALID_FIELD');
            expect(twin.status).toBe(400);
            expect(twin.field).toBe(key);
        });
    }

    it('the gate\'s other two verdicts come with it — a dotted path and a virtual field, each as in where', async () => {
        for (const [filter, field] of [[{ 'status.name': 'x' }, 'status.name'], [{ doubled: { $gt: 10 } }, 'doubled']] as const) {
            const err = await refusalFor(withFilter(filter));
            const twin = await refusalFor({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });
            for (const e of [err, twin]) {
                expect(e.code).toBe('INVALID_FIELD');
                expect(e.status).toBe(400);
                expect(e.field).toBe(field);
            }
            expect(err.param).toBe('aggregations[1].filter');
        }
    });

    it('an unknown aggregated field keeps its own verdict ahead of a filter key', async () => {
        const err = await refusalFor({
            aggregations: [{ function: 'sum', field: 'amout', alias: 't', filter: { nope: 1 } }],
        });
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.param).toBe('aggregations');
        expect(err.field).toBe('amout');
    });

    const ADMITTED: ReadonlyArray<readonly [string, unknown]> = [
        ['declared keys, composed', { $or: [{ amount: { $gt: 100 } }, { status: 'paid' }] }],
        ['the columns every row carries', { id: 'i1', created_at: { $ne: null }, updated_at: { $ne: null } }],
        ['a relation head in the nested-object form', { owner_id: { $ne: null } }],
        ['a filter that is not an object (left to the engine\'s shape gate)', 'status = paid'],
        ['an array filter (left to the engine\'s shape gate)', [['amount', '>', 1]]],
    ];

    for (const [name, filter] of ADMITTED) {
        it(`${name}: reaches engine.aggregate with the filter untouched`, async () => {
            const { p, aggregate } = makeProtocol();
            await p.findData({ object: 'invoice', query: withFilter(filter) } as never);
            expect(aggregate).toHaveBeenCalledTimes(1);
            const opts = (aggregate.mock.calls[0] as unknown[])[1] as { aggregations: Array<{ filter?: unknown }> };
            expect(opts.aggregations[1].filter).toEqual(filter);
        });
    }
});
