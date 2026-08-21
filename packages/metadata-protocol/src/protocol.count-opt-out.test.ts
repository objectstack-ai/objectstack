// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10757 — `$count=false` skips the COUNT query.
 *
 * ## What was wrong
 *
 * `$count` has been a fully-plumbed parameter for a long time: declared in the
 * spec (`ODataQuerySchema.$count`, `packages/spec/src/api/odata.zod.ts`),
 * aliased on the wire (`$count` → `count`, `WIRE_DOLLAR_ALIASES`), reserved out
 * of the implicit-field-filter bucket (`RESERVED_LIST_QUERY_PARAMS`),
 * arity-checked (`protocol.query-param-arity.test.ts`) and boolean-coerced —
 * and then DELETED unread by the protocol-key strip in `findData`. So every
 * paginated list issued `engine.count()` whether or not the caller wanted a
 * `total`, which on a remote database is a whole round trip per request. The
 * measured trace on a real stack put it at query 24 of 24 for one
 * `GET /data/:object?$top=1`.
 *
 * ## The two directions this suite pins, and why both are needed
 *
 *  1. **The OPT-OUT works** — an explicit `false` (either spelling) means no
 *     `engine.count()` call and no `total` key. `expect(count).not.toHaveBeenCalled()`
 *     is the load-bearing assertion; asserting only the absent `total` would
 *     stay green if a future edit ran the query and merely dropped the number,
 *     which is the whole cost with none of the saving.
 *
 *  2. **Nothing else changed** — absent `$count`, and explicit `$count=true`,
 *     both still count and still report `total`. This is the direction that
 *     makes the opt-out safe to ship: OData reads an ABSENT `$count` as "omit
 *     the count", and taking that reading here would silently strip `total`
 *     from every existing caller (none of them send the parameter, all of them
 *     read the number). The asymmetry is deliberate, so it is pinned rather
 *     than left to be "tidied up" later.
 *
 * `total` is OMITTED rather than estimated — `FindDataResponseSchema` declares
 * it optional ("if requested"), and a page-local guess handed back to a caller
 * who declined the real number is how an estimate ends up rendered as a record
 * count. `hasMore` is still answered from the page alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
    },
};

function makeProtocol(pageSize: number) {
    const find = vi.fn(async () => Array.from({ length: pageSize }, (_, i) => ({ id: `r${i}` })));
    const count = vi.fn(async () => 3125);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        count,
        aggregate: vi.fn(async () => [] as unknown[]),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, count };
}

describe('[#10757] findData honours $count=false', () => {
    describe('opt-out — the COUNT query is not issued', () => {
        // Both wire spellings reach the same normalized `count` slot; a fix that
        // read only one of them would leave the other paying for the query.
        for (const spelling of ['$count', 'count'] as const) {
            it(`?${spelling}=false skips engine.count() and omits total`, async () => {
                const { p, count } = makeProtocol(1);

                const result = await p.findData({
                    object: 'invoice',
                    query: { $top: 1, [spelling]: 'false' },
                } as never);

                expect(count).not.toHaveBeenCalled();
                expect('total' in (result as object)).toBe(false);
            });
        }

        it('accepts the already-boolean form a POST body carries', async () => {
            const { p, count } = makeProtocol(1);

            const result = await p.findData({
                object: 'invoice',
                query: { $top: 1, count: false },
            } as never);

            expect(count).not.toHaveBeenCalled();
            expect('total' in (result as object)).toBe(false);
        });

        it('still answers hasMore from the page: a FULL page means there may be more', async () => {
            const { p } = makeProtocol(10);

            const result = await p.findData({
                object: 'invoice',
                query: { $top: 10, $count: 'false' },
            } as never);

            expect(result.hasMore).toBe(true);
        });

        it('…and a SHORT page means there are not', async () => {
            const { p } = makeProtocol(3);

            const result = await p.findData({
                object: 'invoice',
                query: { $top: 10, $count: 'false' },
            } as never);

            expect(result.hasMore).toBe(false);
        });

        it('leaves `count` off the engine option bag (it is a protocol-layer flag)', async () => {
            const { p, find } = makeProtocol(1);

            await p.findData({ object: 'invoice', query: { $top: 1, $count: 'false' } } as never);

            const bag = (find.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
            expect('count' in bag).toBe(false);
            expect('$count' in bag).toBe(false);
        });
    });

    describe('unchanged for every caller that does not opt out', () => {
        it('an ABSENT $count still counts and still reports total', async () => {
            const { p, count } = makeProtocol(1);

            const result = await p.findData({ object: 'invoice', query: { $top: 1 } } as never);

            expect(count).toHaveBeenCalledTimes(1);
            expect(result.total).toBe(3125);
            expect(result.hasMore).toBe(true);
        });

        it('an explicit $count=true still counts and still reports total', async () => {
            const { p, count } = makeProtocol(1);

            const result = await p.findData({
                object: 'invoice',
                query: { $top: 1, $count: 'true' },
            } as never);

            expect(count).toHaveBeenCalledTimes(1);
            expect(result.total).toBe(3125);
        });

        it('$count=false without a limit is a no-op — the full set is already the total', async () => {
            // No `limit` ⇒ the whole result set came back, so `records.length` IS
            // the total and `engine.count()` was never called even before #10757.
            // Pinned so the opt-out cannot accidentally start suppressing a total
            // that costs nothing.
            const { p, count } = makeProtocol(4);

            const result = await p.findData({
                object: 'invoice',
                query: { $count: 'false' },
            } as never);

            expect(count).not.toHaveBeenCalled();
            expect(result.total).toBe(4);
            expect(result.hasMore).toBe(false);
        });
    });
});
