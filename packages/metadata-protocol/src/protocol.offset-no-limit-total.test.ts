// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28547 — a list's `total` is the filtered count whatever the offset, also
 * when no limit is given.
 *
 * ## What was wrong
 *
 * `findData` decided "is this a paged request?" from the limit alone. Without
 * one it kept `total = records.length` on the reasoning that "the full result
 * set is returned". With an offset that reasoning is false: the read returns
 * every match AFTER the offset, so the total short-counted by exactly the
 * offset. Measured on the stock showcase (`showcase_account`, 14 rows):
 *
 *   GET  ?$skip=3&$count=true             11 rows, total 11   ← the defect
 *   GET  ?$skip=3&$top=100&$count=true    11 rows, total 14
 *   POST {"offset":3,"count":true}        total 11            ← the defect
 *   POST {"offset":999,"count":true}      total 0             ← the defect
 *
 * ## What this suite pins
 *
 *  1. An offset with no limit reports the filtered count, on both the GET
 *     dialect (`$skip`) and the POST body form (`offset`), and an offset past
 *     the end still reports it (so "add the offset back" is not a fix: it
 *     would answer 999 there).
 *  2. CONTROL — a filter and a search move the count like any other paged
 *     request (#22790: the COUNT carries what the rows were read with).
 *  3. The neighbouring arms keep their meaning: no offset and no limit issues
 *     no COUNT; a limit is unchanged; `$count=false` with an offset issues no
 *     COUNT and omits `total` (#10757).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'mz_account',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        tier: { name: 'tier', type: 'text' },
    },
};

// 14 rows, like the showcase's seeded `showcase_account`; 4 of them in tier `b`.
const ROWS = Array.from({ length: 14 }, (_, i) => ({
    id: `a${i}`,
    name: `a${i}`,
    tier: i % 4 === 3 || i === 0 ? 'b' : 'a',
}));
const TIER_B = ROWS.filter((r) => r.tier === 'b').length;

/**
 * Equality-only `where`, the shape the implicit field filter `?tier=b` lowers
 * to. Anything else is REFUSED rather than answered silently wrong.
 */
function matches(row: Record<string, unknown>, where: unknown): boolean {
    if (where == null) return true;
    if (typeof where !== 'object' || Array.isArray(where)) {
        throw new Error(`test double: unexpected where shape ${JSON.stringify(where)}`);
    }
    return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`test double: combinator '${k}' is not implemented`);
        if (v !== null && typeof v === 'object') throw new Error(`test double: operator on '${k}' is not implemented`);
        return row[k] === v;
    });
}

/**
 * An engine double that honours `offset` and `limit` as written, and counts
 * over the same `where`.
 */
function makeProtocol() {
    const find = vi.fn(async (_object: string, opts: any = {}) => {
        const hits = ROWS.filter((r) => matches(r, opts.where));
        const offset = typeof opts.offset === 'number' ? opts.offset : 0;
        const sliced = hits.slice(offset);
        return opts.limit !== undefined ? sliced.slice(0, opts.limit) : sliced;
    });
    const count = vi.fn(async (_object: string, opts: any = {}) => ROWS.filter((r) => matches(r, opts.where)).length);
    const engine = {
        registry: { getObject: (n: string) => (n === SCHEMA.name ? SCHEMA : undefined) },
        find,
        count,
        aggregate: vi.fn(async () => [] as unknown[]),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, count };
}

async function list(query: Record<string, unknown>) {
    const h = makeProtocol();
    const result: any = await h.p.findData({ object: SCHEMA.name, query } as never);
    return { result, ...h };
}

describe('[#28547] an offset with no limit reports the filtered total', () => {
    it('GET ?$skip=3&$count=true answers the match count, not the count after the offset', async () => {
        const { result, count } = await list({ $skip: '3', $count: 'true' });

        expect(result.records).toHaveLength(11);
        expect(result.total).toBe(14);
        expect(result.hasMore).toBe(false);
        expect(count).toHaveBeenCalledTimes(1);
    });

    it('POST {"offset":3,"count":true} answers the same', async () => {
        const { result } = await list({ offset: 3, count: true });

        expect(result.records).toHaveLength(11);
        expect(result.total).toBe(14);
        expect(result.hasMore).toBe(false);
    });

    it('an offset past the end returns no rows and still reports the match count', async () => {
        const { result } = await list({ offset: 999, count: true });

        expect(result.records).toEqual([]);
        expect(result.total).toBe(14);
        expect(result.hasMore).toBe(false);
    });

    it('agrees with the same offset under a limit', async () => {
        const withoutLimit = await list({ $skip: '3', $count: 'true' });
        const withLimit = await list({ $skip: '3', $top: '100', $count: 'true' });

        expect(withoutLimit.result.total).toBe(withLimit.result.total);
        expect(withoutLimit.result.records).toEqual(withLimit.result.records);
    });

    it('an absent $count reports the same total as $count=true', async () => {
        const { result } = await list({ skip: '3' });

        expect(result.total).toBe(14);
    });
});

describe('[#28547] CONTROL — the count is the filtered count', () => {
    it('a filter moves the total, and the rows are read past the offset', async () => {
        const { result, count } = await list({ $skip: '1', tier: 'b' });

        expect(result.records).toHaveLength(TIER_B - 1);
        expect(result.total).toBe(TIER_B);
        expect((count.mock.calls[0] as unknown[])[1]).toMatchObject({ where: { tier: 'b' } });
    });

    it('a search is counted with the search the rows were read with (#22790)', async () => {
        const { count, find } = await list({ $skip: '2', $search: 'a1' });

        expect(count).toHaveBeenCalledTimes(1);
        expect((count.mock.calls[0] as unknown[])[1]).toMatchObject({ search: 'a1' });
        expect((find.mock.calls[0] as unknown[])[1]).toMatchObject({ search: 'a1' });
    });
});

describe('[#28547] the neighbouring arms keep their meaning', () => {
    it('no offset and no limit: no COUNT, total is the set length', async () => {
        const { result, count } = await list({ $count: 'true' });

        expect(count).not.toHaveBeenCalled();
        expect(result.total).toBe(14);
        expect(result.hasMore).toBe(false);
    });

    it('an explicit offset of 0 is no offset: no COUNT', async () => {
        const { result, count } = await list({ offset: 0, count: true });

        expect(count).not.toHaveBeenCalled();
        expect(result.total).toBe(14);
    });

    it('a limit is unchanged: one COUNT, total is the match count, hasMore from the page', async () => {
        const { result, count } = await list({ offset: 3, limit: 5, count: true });

        expect(count).toHaveBeenCalledTimes(1);
        expect(result.records).toHaveLength(5);
        expect(result.total).toBe(14);
        expect(result.hasMore).toBe(true);
    });

    it('$count=false with an offset issues no COUNT and omits total (#10757)', async () => {
        for (const query of [{ $skip: '3', $count: 'false' }, { offset: 3, count: false }]) {
            const { result, count } = await list(query);

            expect(count, JSON.stringify(query)).not.toHaveBeenCalled();
            expect('total' in result, JSON.stringify(query)).toBe(false);
            expect(result.records, JSON.stringify(query)).toHaveLength(11);
            expect(result.hasMore, JSON.stringify(query)).toBe(false);
        }
    });
});
