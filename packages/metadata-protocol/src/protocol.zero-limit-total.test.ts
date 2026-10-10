// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22588 item 2 — a list's `total` is the filtered count whatever the page size,
 * `$top=0` included.
 *
 * ## What was wrong
 *
 * `findData` decided "is this a paged request?" with `limit > 0`. `limit: 0`
 * asks for NO rows (objectstack#6485 — every driver's pagination conformance
 * pins it), so the gate sent a zero-row request into the "no limit, the whole
 * result set came back, so its length IS the total" arm — the one arm that is
 * false for exactly this limit. Measured over HTTP on a booted stack at
 * `3d0eeefa` (five rows, two of them in stage `b`):
 *
 *   GET /data/mz_task?top=0              total 0   ← the defect
 *   GET /data/mz_task?top=1              total 5
 *   GET /data/mz_task?top=0&stage=b      total 0   ← the defect
 *   GET /data/mz_task?top=1&stage=b      total 2
 *   GET /data/mz_task?top=0&$count=false total 0   ← the opt-out ignored too
 *
 * The Console's list footer sends exactly `$top: 0` to read the total and
 * nothing else, so every list page showed a record count of `0`.
 *
 * ## What this suite pins
 *
 *  1. `top=0` and `top=1` report the SAME `total`, and `top=0` still returns no
 *     rows — the engine is asked for `limit: 0`, never for the whole set.
 *  2. CONTROL — a filter moves both alike. A fix that reported the UNFILTERED
 *     count for a zero-row page would pass (1) and fail here.
 *  3. The two neighbouring arms keep their meaning for a zero-row page:
 *     `$count=false` still issues no COUNT and omits `total` (it no longer
 *     reports the page's `0` as if it were a count), and `search` still issues
 *     no COUNT — `engine.count()` cannot reproduce a search, which is why that
 *     arm reports a page-local estimate at every page size.
 *  4. Absent a limit nothing moves: no COUNT, `total` is the set's length.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'mz_task',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        stage: { name: 'stage', type: 'text' },
    },
};

const ROWS = [
    { id: 't0', name: 't0', stage: 'a' },
    { id: 't1', name: 't1', stage: 'a' },
    { id: 't2', name: 't2', stage: 'a' },
    { id: 't3', name: 't3', stage: 'b' },
    { id: 't4', name: 't4', stage: 'b' },
];

/**
 * Equality-only `where` — the implicit field filter `?stage=b` lowers to.
 * Anything else (a combinator, an operator object) is REFUSED rather than
 * answered silently wrong.
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
 * An engine double that honours `limit` AS WRITTEN — `limit: 0` is no rows,
 * the drivers' declared contract — and counts over the same `where`.
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

describe('[#22588] a zero-row page reports the filtered total', () => {
    it('top=0 and top=1 report the same total, and top=0 returns no rows', async () => {
        const zero = await list({ top: '0' });
        const one = await list({ top: '1' });

        expect(zero.result.total).toBe(5);
        expect(zero.result.total).toBe(one.result.total);
        expect(zero.result.records).toEqual([]);
        // The engine was asked for NO rows — the fix counts, it never widens
        // the read to the whole set to measure it.
        expect((zero.find.mock.calls[0] as unknown[])[1]).toMatchObject({ limit: 0 });
        expect(zero.result.hasMore).toBe(true);
    });

    it('every spelling of the zero window reaches the same answer', async () => {
        for (const query of [{ $top: '0' }, { limit: '0' }, { top: 0 }]) {
            const { result, count } = await list(query);
            expect(result.total, JSON.stringify(query)).toBe(5);
            expect(count, JSON.stringify(query)).toHaveBeenCalledTimes(1);
        }
    });

    it('CONTROL — a filter changes both alike', async () => {
        const zero = await list({ top: '0', stage: 'b' });
        const one = await list({ top: '1', stage: 'b' });

        expect(zero.result.total).toBe(2);
        expect(one.result.total).toBe(2);
        expect(zero.result.records).toEqual([]);
        expect(one.result.records).toHaveLength(1);
    });

    it('a zero-row page past an offset still reports the whole filtered total', async () => {
        const { result } = await list({ top: '0', skip: '2' });

        expect(result.total).toBe(5);
        expect(result.records).toEqual([]);
        expect(result.hasMore).toBe(true);
    });
});

describe('[#22588] the neighbouring arms keep their meaning for a zero-row page', () => {
    it('$count=false still issues no COUNT — and omits total instead of reporting the page\'s 0', async () => {
        const { result, count } = await list({ $top: '0', $count: 'false' });

        expect(count).not.toHaveBeenCalled();
        expect('total' in result).toBe(false);
    });

    it('search still issues no COUNT — engine.count() cannot reproduce a search', async () => {
        const { result, count } = await list({ $top: '0', $search: 't' });

        expect(count).not.toHaveBeenCalled();
        expect(result.records).toEqual([]);
    });

    it('absent a limit nothing moves: no COUNT, total is the set\'s length', async () => {
        const { result, count } = await list({ stage: 'b' });

        expect(count).not.toHaveBeenCalled();
        expect(result.total).toBe(2);
        expect(result.hasMore).toBe(false);
    });
});
