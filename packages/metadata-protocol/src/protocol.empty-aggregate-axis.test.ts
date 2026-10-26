// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25819] An aggregate axis sent as an EMPTY list, with no non-empty axis
 * beside it, is refused `INVALID_QUERY` / 400 by `findData`, naming the empty
 * key, before the engine is asked.
 *
 * Measured on `origin/main` `cb0a2fcf4f` through `findData` over the real
 * engine: `{ aggregations: [] }` (with or without a `where`), `{ groupBy: [] }`
 * and both together routed to `engine.find`, which refuses an option it does
 * not execute with an uncoded error ("find('acct') does not recognise option
 * 'aggregations'…"); the REST door's unknown-object heuristic reads the quoted
 * object name in it as `404 OBJECT_NOT_FOUND`, "Object 'acct' is not
 * registered". The wire half is pinned over the real engine in
 * `@objectstack/objectql`'s `engine-aggregate-query-shape-door.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'acct',
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
    },
};

function makeProtocol() {
    const find = vi.fn(async () => [] as unknown[]);
    const aggregate = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: (n: string) => (n === 'acct' ? SCHEMA : undefined) },
        find,
        aggregate,
        count: vi.fn(async () => 0),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, aggregate };
}

describe('[#25819] findData — an empty aggregate axis is refused for what it is', () => {
    const REFUSED: ReadonlyArray<readonly [Record<string, unknown>, string, string]> = [
        [{ aggregations: [] }, 'aggregations', "'query.aggregations' is an empty list"],
        [{ aggregations: [], where: { status: 'open' } }, 'aggregations', "'query.aggregations' is an empty list"],
        [{ groupBy: [] }, 'groupBy', "'query.groupBy' is an empty list"],
        [{ groupBy: [], aggregations: [] }, 'aggregations', "'query.groupBy' and 'query.aggregations' are empty lists"],
    ];

    for (const [query, param, words] of REFUSED) {
        it(`refuses ${JSON.stringify(query)} with INVALID_QUERY / 400 — the engine is never asked`, async () => {
            const { p, find, aggregate } = makeProtocol();
            const err: any = await p.findData({ object: 'acct', query } as never).then(() => null, (e) => e);
            expect({ code: err?.code, status: err?.status, param: err?.param, object: err?.object })
                .toEqual({ code: 'INVALID_QUERY', status: 400, param, object: 'acct' });
            expect(err.message).toContain(words);
            expect(find).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
        });
    }

    it('CONTROL an empty list beside a non-empty axis is served as before, through engine.aggregate', async () => {
        const { p, find, aggregate } = makeProtocol();
        await p.findData({ object: 'acct', query: { groupBy: ['status'], aggregations: [] } } as never);
        await p.findData({ object: 'acct', query: { groupBy: [], aggregations: [{ function: 'count', alias: 'n' }] } } as never);
        expect(aggregate).toHaveBeenCalledTimes(2);
        expect(find).not.toHaveBeenCalled();
    });

    it('CONTROL a query with neither axis is the plain row read', async () => {
        const { p, find, aggregate } = makeProtocol();
        await p.findData({ object: 'acct', query: { where: { status: 'open' } } } as never);
        expect(find).toHaveBeenCalledTimes(1);
        expect(aggregate).not.toHaveBeenCalled();
    });
});
