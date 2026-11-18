// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [latest per group] `findData` carrying the in-process one-row-per-group
 * request (the `Symbol.for('objectstack.objectql.latestPer')` member an
 * in-process door sets — never a wire key).
 *
 * Pinned: the request rides to `engine.find` on the engine's read option, not
 * in the query; the read takes one row more than the limit and serves the
 * limit, answering `hasMore` from the probe and never a `total` (no COUNT is
 * issued — rows are not groups); an engine that did not serve the window is a
 * coded server fault, never an ordinary list; a partition or order field the
 * object does not declare is refused before the engine is asked; and the
 * request does not combine with `groupBy`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const LATEST_PER = Symbol.for('objectstack.objectql.latestPer');
const SCHEMA = {
    name: 'deal',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        account: { name: 'account', type: 'text' },
        close_date: { name: 'close_date', type: 'date' },
    },
};
const request = () => ({ by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' as const }] }) as {
    by: string[];
    orderBy: Array<{ field: string; order: 'asc' | 'desc' }>;
    outcome?: { kind: string };
};

function makeProtocol(rows: Array<Record<string, unknown>>, served: boolean) {
    const find = vi.fn(async (_object: string, _query: any, options: any) => {
        const req = options?.[LATEST_PER];
        if (served && req) req.outcome = { kind: 'served' };
        return rows;
    });
    const count = vi.fn(async () => 999);
    const engine = {
        registry: { getObject: (n: string) => (n === 'deal' ? SCHEMA : undefined) },
        find,
        count,
        aggregate: vi.fn(async () => [] as unknown[]),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, count };
}

describe('[latest per group] findData with the in-process request', () => {
    it('reads limit + 1 on the engine option, serves limit, says hasMore; no total, no COUNT', async () => {
        const { p, find, count } = makeProtocol([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }], true);
        const latestPer = request();
        const result: any = await p.findData({ object: 'deal', query: { limit: 2 }, [LATEST_PER]: latestPer } as never);
        expect(result.records.map((r: any) => r.id)).toEqual(['d1', 'd2']);
        expect(result.hasMore).toBe(true);
        expect('total' in result).toBe(false);
        expect(count).not.toHaveBeenCalled();
        const [, query, options] = find.mock.calls[0]!;
        expect(query.limit).toBe(3);
        expect(Object.getOwnPropertySymbols(query)).toEqual([]);
        expect('latestPer' in query).toBe(false);
        expect(options[LATEST_PER]).toBe(latestPer);
        expect(latestPer.outcome).toEqual({ kind: 'served' });
    });

    it('an engine that did not serve the window is a coded server fault, never an ordinary list', async () => {
        const { p } = makeProtocol([{ id: 'd1' }], false);
        const err: any = await p.findData({ object: 'deal', query: { limit: 2 }, [LATEST_PER]: request() } as never)
            .then(() => null, (e: unknown) => e);
        expect({ code: err?.code, status: err?.status ?? err?.statusCode }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    });

    it('a partition field the object does not declare is refused before the engine is asked', async () => {
        const { p, find } = makeProtocol([], true);
        const latestPer = { ...request(), by: ['no_such_field'] };
        const err: any = await p.findData({ object: 'deal', query: { limit: 2 }, [LATEST_PER]: latestPer } as never)
            .then(() => null, (e: unknown) => e);
        expect(err?.status ?? err?.statusCode).toBe(400);
        expect(find).not.toHaveBeenCalled();
    });

    it('does not combine with groupBy: INVALID_QUERY / 400, nothing read', async () => {
        const { p, find } = makeProtocol([], true);
        const err: any = await p.findData({
            object: 'deal',
            query: { limit: 2, groupBy: ['account'] },
            [LATEST_PER]: request(),
        } as never).then(() => null, (e: unknown) => e);
        expect({ code: err?.code, status: err?.status ?? err?.statusCode }).toEqual({ code: 'INVALID_QUERY', status: 400 });
        expect(find).not.toHaveBeenCalled();
    });

    it('control: without the request, an ordinary list with its total', async () => {
        const { p, find } = makeProtocol([{ id: 'd1' }], true);
        const result: any = await p.findData({ object: 'deal', query: { limit: 2 } } as never);
        expect(result.total).toBe(999);
        expect(LATEST_PER in (find.mock.calls[0]![2] ?? {})).toBe(false);
    });
});
