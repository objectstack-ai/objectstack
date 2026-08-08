// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6479] One row per PATCH: the row the URL named.
 *
 * `PATCH /data/task/rec_1` with a body of `{"id":"rec_2","title":"x"}` used to
 * make `updateData` disagree with itself three ways in one call:
 *
 *   probe   → rec_1   (`probeRecord(object, request.id)`, #4435)
 *   OCC     → rec_1   (`assertVersionOf(…, request.id, …)`, If-Match)
 *   WRITE   → rec_2   (the engine's dispatch reads the PAYLOAD first)
 *   receipt → `{ id: 'rec_1', record: <rec_2's readback> }`
 *
 * rec_2 was never probed and never version-checked, so the shape every client
 * writes — GET a record, edit a field, PUT the whole body back — silently wrote
 * a DIFFERENT row past its own `If-Match` whenever the body's `id` came from a
 * mis-clicked list row or a stale refresh.
 *
 * ## What these tests pin, and why here
 *
 * This repo has TWO ingresses answering "which row does a single write bind":
 * this one, and the batch `update` op in `packages/rest/src/rest-server.ts`
 * (`ql.update(op.object, { ...data, id }, …)` — the operation's id AFTER the
 * spread, so it wins). The bulk one has always been right. So the invariant
 * asserted below is deliberately not "the fix line is present" but the
 * ingress-level fact a future fork would break:
 *
 *   **the probed row, the OCC-checked row, the written row and the receipt's
 *   `id`/`record` are the SAME row — the PATH row.**
 *
 * ## What is deliberately NOT re-litigated here
 *
 * The engine's payload-first dispatch (`a SCALAR data.id still wins over a
 * scalar where.id`, `ENGINE_UPDATE_DISPATCH_CASES`) is correct and merged
 * (#5748 / PR #5919) for a caller who hands ObjectQL a payload and nothing
 * else, and #6435 / PR #6475's by-id payload strip is likewise untouched —
 * both are driven against the REAL engine in `packages/objectql`. The fake
 * below therefore does not re-implement either: its `update` asks the
 * producer's own `assertEngineUpdateDispatch` which row a call binds and obeys
 * the answer, so it cannot be kinder — or stricter — than a running server.
 */

import { describe, it, expect, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), from `@objectstack/metadata-core` and never from
// `@objectstack/objectql` — objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    resolveEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'task',
    fields: {
        title: { name: 'title', type: 'text' },
        updated_at: { name: 'updated_at', type: 'datetime' },
    },
};

type Row = Record<string, unknown> & { id: string };

/**
 * A fake engine whose `update` **binds the row the real engine would bind**.
 *
 * The bound row is not re-derived here: `assertEngineUpdateDispatch` is the
 * predicate `ObjectQL.update` itself dispatches on, so this double answers
 * "payload id or `where` id?" with the producer's answer, including for the
 * shapes that look like an id and are not (`{ $in: […] }`, arrays, `null`).
 * A hand-mirrored `if (opts?.where?.id)` here would have written rec_1 in every
 * test below and reported the fix as already shipped — the #4434 / #4550
 * failure this family of doubles exists to prevent.
 *
 * The stored `id` is the BOUND key rather than whatever sat in the payload,
 * which is what a by-id write does on every driver after #6435: a scalar
 * payload `id` IS the bound key (`SET id = 'rec_1' WHERE id = 'rec_1'`), and a
 * payload `id` the dispatch has ruled is not a primary key is stripped before
 * the driver sees it.
 */
function makeProtocol(rows: Row[]) {
    const store = new Map<string, Row>(rows.map((r) => [r.id, { ...r }]));
    const findOne = vi.fn(async (_object: string, opts: any) => {
        const row = store.get(String(opts?.where?.id));
        return row ? { ...row } : null;
    });
    const update = vi.fn(async (_object: string, data: any, opts?: any) => {
        const dispatch = assertEngineUpdateDispatch(data, opts);
        // Every call these tests make identifies one row; a `multi` verdict here
        // would mean the ingress stopped naming a row at all, which is a failure
        // and not a branch to implement.
        if (dispatch.kind !== 'by-id') {
            throw new Error(`fixture drives by-id updates only, got '${dispatch.kind}'`);
        }
        const boundId = String(dispatch.id);
        const existing = store.get(boundId);
        // The engine's post-write READBACK is `null` when the bound row is not
        // there — the very shape #4435 refused to let this ingress report as a
        // 200 for the PATH row.
        if (!existing) return null;
        const fields = { ...(data as Record<string, unknown>) };
        delete fields.id;
        const next = { ...existing, ...fields, id: boundId } as Row;
        store.set(boundId, next);
        return { ...next };
    });
    const del = vi.fn(async (_object: string, opts?: any) => {
        assertEngineDeleteDispatch(opts);
        return store.delete(String(opts?.where?.id));
    });
    const engine = {
        registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
        findOne,
        update,
        delete: del,
    };
    return { p: new ObjectStackProtocolImplementation(engine as any) as any, findOne, update, del, store };
}

/** Two rows, distinct bodies and distinct OCC versions, so a cross-row write cannot hide. */
const TWO_ROWS: Row[] = [
    { id: 'rec_1', title: 'one', updated_at: '2026-08-08T00:00:01.000Z' },
    { id: 'rec_2', title: 'two', updated_at: '2026-08-08T00:00:02.000Z' },
];

/** Which row did the ENGINE bind for call `n`? Asked of the producer's predicate. */
function boundRowOfCall(update: any, n = 0): unknown {
    const [, data, opts] = update.mock.calls[n] as [string, any, any];
    const dispatch = resolveEngineUpdateDispatch(data, opts);
    return dispatch.kind === 'by-id' ? dispatch.id : dispatch.kind;
}

describe('[#6479] the PATH row is the row — probe, OCC, write and receipt agree', () => {
    it('(a) body id === path id — the common GET/edit/PUT-back shape still succeeds on the path row', async () => {
        const { p, findOne, update, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({ object: 'task', id: 'rec_1', data: { id: 'rec_1', title: 'x' } });

        expect(findOne.mock.calls[0][1]).toMatchObject({ where: { id: 'rec_1' } });
        expect(boundRowOfCall(update)).toBe('rec_1');
        expect(res).toMatchObject({ object: 'task', id: 'rec_1', record: { id: 'rec_1', title: 'x' } });
        expect(store.get('rec_1')).toMatchObject({ id: 'rec_1', title: 'x' });
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });

    it('(b) body id !== path id — the write lands on the PATH row and the other row is untouched', async () => {
        const { p, findOne, update, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({ object: 'task', id: 'rec_1', data: { id: 'rec_2', title: 'x' } });

        // The four gates, one row.
        expect(findOne.mock.calls[0][1]).toMatchObject({ where: { id: 'rec_1' } });
        expect(boundRowOfCall(update)).toBe('rec_1');
        expect(res.id).toBe('rec_1');
        expect(res.record).toMatchObject({ id: 'rec_1', title: 'x' });

        // The STORED body of the other row, not just the return value: the defect
        // was a real write to rec_2, so only its persisted state can refute it.
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
        expect(store.get('rec_1')).toMatchObject({ id: 'rec_1', title: 'x' });
    });

    it('(b2) the receipt can no longer contradict itself — `id` and `record.id` name one row', async () => {
        const { p } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({ object: 'task', id: 'rec_1', data: { id: 'rec_2', title: 'x' } });
        expect((res.record as Row).id).toBe(res.id);
    });

    it('(b3) a body id naming a row that does NOT exist still writes the path row', async () => {
        // Before the fix this was the loudest shape: the engine bound
        // `no_such_row`, its readback was `null`, and the receipt answered
        // `{ id: 'rec_1', record: null }` — a 200 whose record was missing for a
        // row that was never touched.
        const { p, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({ object: 'task', id: 'rec_1', data: { id: 'no_such_row', title: 'x' } });
        expect(res.record).toMatchObject({ id: 'rec_1', title: 'x' });
        expect(store.get('rec_1')).toMatchObject({ title: 'x' });
        expect(store.has('no_such_row')).toBe(false);
    });

    it('(d1) a path id that names no row is still 404, and the body id cannot rescue it', async () => {
        // Unchanged by this fix and pinned as such: the probe has always asked the
        // PATH id (#4435). What it adds here is that an existing row named by the
        // BODY does not make the call succeed — and is not written.
        const { p, update, store } = makeProtocol(TWO_ROWS);
        let caught: any;
        try {
            await p.updateData({ object: 'task', id: 'ghost', data: { id: 'rec_2', title: 'x' } });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'expected a RECORD_NOT_FOUND rejection, but the call resolved').toBeDefined();
        expect(caught.code).toBe('RECORD_NOT_FOUND');
        expect(caught.status).toBe(404);
        expect(caught.message).toContain('ghost');
        expect(update).not.toHaveBeenCalled();
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });
});

describe('[#6479] (c) OCC now guards the row that is actually written', () => {
    it('a matching If-Match on the PATH row admits the write — to the PATH row', async () => {
        // The hole, stated as a test: OCC compared rec_1's `updated_at` and then
        // let the write land on rec_2, whose version nobody had looked at.
        const { p, update, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({
            object: 'task',
            id: 'rec_1',
            data: { id: 'rec_2', title: 'x' },
            expectedVersion: '2026-08-08T00:00:01.000Z',
        });
        expect(boundRowOfCall(update)).toBe('rec_1');
        expect(res.record).toMatchObject({ id: 'rec_1', title: 'x' });
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });

    it('a stale If-Match on the path row is 409 CONCURRENT_UPDATE and writes nothing at all', async () => {
        const { p, update, store } = makeProtocol(TWO_ROWS);
        let caught: any;
        try {
            await p.updateData({
                object: 'task',
                id: 'rec_1',
                data: { id: 'rec_2', title: 'x' },
                expectedVersion: '2026-01-01T00:00:00.000Z',
            });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'expected a CONCURRENT_UPDATE rejection, but the call resolved').toBeDefined();
        expect(caught.code).toBe('CONCURRENT_UPDATE');
        expect(caught.status).toBe(409);
        expect(update).not.toHaveBeenCalled();
        expect(store.get('rec_1')).toEqual(TWO_ROWS[0]);
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });

    it('the BODY id cannot redirect OCC — sending the other row\'s version is refused', async () => {
        // `2026-08-08T00:00:02.000Z` is rec_2's version, and rec_2 is what the body
        // names. OCC judges the PATH row, so this is a conflict, not a licence.
        const { p, update, store } = makeProtocol(TWO_ROWS);
        let caught: any;
        try {
            await p.updateData({
                object: 'task',
                id: 'rec_1',
                data: { id: 'rec_2', title: 'x' },
                expectedVersion: '2026-08-08T00:00:02.000Z',
            });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'expected a CONCURRENT_UPDATE rejection, but the call resolved').toBeDefined();
        expect(caught.code).toBe('CONCURRENT_UPDATE');
        expect(caught.status).toBe(409);
        expect(caught.currentVersion).toBe('2026-08-08T00:00:01.000Z');
        expect(update).not.toHaveBeenCalled();
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });
});

describe('[#6479] (d) the payload shapes this ingress must not start treating differently', () => {
    it('a plain PATCH with no `id` in the body binds the path row, as it always did', async () => {
        const { p, update, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({ object: 'task', id: 'rec_1', data: { title: 'x' } });
        expect(boundRowOfCall(update)).toBe('rec_1');
        expect(res.record).toMatchObject({ id: 'rec_1', title: 'x' });
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
    });

    it.each([
        ['an operator object', { $in: ['rec_2', 'rec_3'] }],
        ['an array', ['rec_2', 'rec_3']],
        ['null', null],
        ['a falsy scalar', 0],
    ])('a NON-SCALAR / falsy body id (%s) also binds the path row', async (_what, payloadId) => {
        // The #6435 / PR #6475 family, seen from this ingress. Those shapes are
        // ruled "not a primary key" by the engine and fall through to `where.id`
        // — which is the path id, so they bound the right row even before this
        // change. Pinned so a future edit here cannot quietly re-route them, and
        // deliberately NOT a re-test of #6475's payload strip: that runs against
        // the real engine in `packages/objectql` and is untouched.
        const { p, update, store } = makeProtocol(TWO_ROWS);
        const res = await p.updateData({
            object: 'task',
            id: 'rec_1',
            data: { id: payloadId, title: 'x' },
        });
        expect(boundRowOfCall(update)).toBe('rec_1');
        expect(res.record).toMatchObject({ id: 'rec_1', title: 'x' });
        expect(store.get('rec_2')).toEqual(TWO_ROWS[1]);
        expect(store.get('rec_3')).toBeUndefined();
    });

    it('an ARRAY payload is passed through untouched and still binds the path row via `where`', async () => {
        // Not a record, so nothing is merged into it — the invariant holds through
        // `opts.where.id` alone, exactly as before.
        const { p, update } = makeProtocol(TWO_ROWS);
        await p.updateData({ object: 'task', id: 'rec_1', data: ['x'] });
        expect(Array.isArray(update.mock.calls[0][1])).toBe(true);
        expect(boundRowOfCall(update)).toBe('rec_1');
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
    ])('a %s payload still surfaces the ENGINE\'s own TypeError — this ingress is not kinder than the producer', async (_what, payload) => {
        // Deliberately NOT an ADR-0112 envelope assertion, and the difference is
        // the point: this is not a refusal this ingress installs, it is
        // `ObjectQL.update` reading `data.id` unguarded on a missing payload — a
        // caller programming error that `engine-update-dispatch.ts` keeps as a
        // `TypeError` on purpose. Merging `{ id }` into it here would have
        // answered a broken call with a successful no-op write.
        const { p, store } = makeProtocol(TWO_ROWS);
        await expect(
            p.updateData({ object: 'task', id: 'rec_1', data: payload }),
        ).rejects.toBeInstanceOf(TypeError);
        expect(store.get('rec_1')).toEqual(TWO_ROWS[0]);
    });
});
