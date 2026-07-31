// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4386 — the `callData('query')` ObjectQL fallback serves the caller's query
 * instead of dropping it.
 *
 * Regression: when the protocol service is unavailable (lean assemblies, MCP
 * multi-env with a raw driver), the fallback passed only `{ context }` to
 * `ql.find` — no `where`, no `orderBy`, no `limit` — and answered with an
 * ordinary-looking `{ records, total }` of the ENTIRE table. The sibling
 * `get`/`update`/`delete` fallbacks all built a proper `where`; `query` was
 * the only verb whose fallback forgot the request.
 *
 * The fallback now forwards the canonical QueryAST keys both possible
 * recipients execute (engine option bag / raw-driver QueryAST are aligned by
 * design), and REFUSES (501) anything it cannot reproduce without the
 * protocol layer — wire spellings needing fold/lowering (`sort`, `select`),
 * and capabilities a raw driver would silently drop (`search`, `expand`).
 * A fallback that cannot reproduce the query's semantics must not pretend to.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { callData, type ActionExecutionDeps } from './action-execution.js';

const EC = { userId: 'u1', isSystem: false, positions: [], permissions: [] } as any;

function makeHarness(opts: { withProtocol?: boolean } = {}) {
    const finds: any[] = [];
    const findData: any[] = [];
    const ql = {
        find: async (_o: string, bag: any) => { finds.push(bag); return [{ id: 'r1' }, { id: 'r2' }]; },
    };
    const protocol = opts.withProtocol
        ? { findData: async (req: any) => { findData.push(req); return { object: req.object, records: [], total: 0, hasMore: false }; } }
        : undefined;
    const services: Record<string, any> = {
        metadata: { getObject: async () => ({ name: 'task', fields: {} }) },
        objectql: ql,
        ...(protocol ? { protocol } : {}),
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (name: string) => services[name]) as any,
        getObjectQL: async () => ql,
    };
    return { deps, finds, findData };
}

describe("callData('query') fallback serves the query it was given (#4386)", () => {
    let h: ReturnType<typeof makeHarness>;

    beforeEach(() => { h = makeHarness(); });

    it('forwards where/orderBy/limit/offset/fields to ql.find, with the server context', async () => {
        const query = {
            where: { status: 'open' },
            orderBy: [{ field: 'created_at', order: 'desc' }],
            limit: 5,
            offset: 10,
            fields: ['id', 'title'],
        };
        const out = await callData(h.deps, 'query', { object: 'task', query }, undefined, undefined, EC);
        expect(h.finds).toHaveLength(1);
        expect(h.finds[0]).toMatchObject({ ...query, context: EC });
        expect(out.records).toHaveLength(2);
    });

    it('extracts query fields from bare params when params.query is absent — same source as the protocol path', async () => {
        await callData(h.deps, 'query', { object: 'task', where: { status: 'open' }, limit: 3 }, undefined, undefined, EC);
        expect(h.finds[0]).toMatchObject({ where: { status: 'open' }, limit: 3 });
    });

    it('a caller-supplied context is dropped, never honoured — server-derived only, matching findData', async () => {
        await callData(h.deps, 'query', { object: 'task', query: { where: { a: 1 }, context: { isSystem: true } } }, undefined, undefined, EC);
        expect(h.finds[0].context).toBe(EC);
    });

    it.each(['sort', 'select', 'skip', 'populate', 'search', 'expand', '$filter'])(
        'refuses %s with 501 instead of part-serving — nothing reaches ql.find',
        async (key) => {
            await expect(
                callData(h.deps, 'query', { object: 'task', query: { where: { a: 1 }, [key]: 'x' } }, undefined, undefined, EC),
            ).rejects.toMatchObject({ statusCode: 501 });
            expect(h.finds).toHaveLength(0);
        },
    );

    it('names the unservable keys and the served set in the refusal', async () => {
        await expect(
            callData(h.deps, 'query', { object: 'task', query: { sort: '-x', select: 'id' } }, undefined, undefined, EC),
        ).rejects.toMatchObject({ message: expect.stringMatching(/'sort', 'select'.*where, fields, orderBy, limit, offset/s) });
    });

    it('an empty query still lists (the protocol path lists too) — no refusal, no predicate', async () => {
        const out = await callData(h.deps, 'query', { object: 'task' }, undefined, undefined, EC);
        expect(h.finds[0]).toMatchObject({ context: EC });
        expect(out.total).toBe(2);
    });

    it('null-valued keys are withdrawals, not unservable', async () => {
        await callData(h.deps, 'query', { object: 'task', query: { sort: null, where: { a: 1 } } }, undefined, undefined, EC);
        expect(h.finds[0]).toMatchObject({ where: { a: 1 } });
    });

    it('with the protocol service present the fallback never runs — findData gets the query verbatim, wire spellings included', async () => {
        const withP = makeHarness({ withProtocol: true });
        await callData(withP.deps, 'query', { object: 'task', query: { sort: '-title', top: 5 } }, undefined, undefined, EC);
        expect(withP.findData).toHaveLength(1);
        expect(withP.findData[0].query).toEqual({ sort: '-title', top: 5 });
        expect(withP.finds).toHaveLength(0);
    });
});
