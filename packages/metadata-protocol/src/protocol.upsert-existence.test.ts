// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5099] `batchData`'s upsert fork asks EXISTENCE, not visibility.
 *
 * The fork used to ask `findOne` under the CALLER's context — the read that
 * RLS/sharing narrows (#3455). An existing row outside the caller's read scope
 * therefore answered `null` and took the INSERT arm: on a store with a unique
 * id constraint the insert duplicate-keyed (an authorization/update scenario
 * reported as a key collision — the same misdirection class as #5088), and on
 * a store without one it wrote a second row. `probeRecord`'s own comment
 * (#4435) calls the distinction load-bearing; #5088 put it on the update and
 * delete faces of this file; the upsert fork was the one branch still reading
 * it backwards (#4620: one reading per file, not three that happen to agree).
 *
 * So the fork now uses the same existence probe as every other by-id face, and
 * whether the caller may WRITE the row it proves stays #1994's decision inside
 * `engine.update` — the fake engine below models that pre-image check masking
 * an out-of-scope by-id write as the same 404 the read path answers.
 *
 * The old fallback (update threw → blind insert) goes with it, on BOTH arms:
 * existence is now decided before the fork, so a fallback insert could only
 * bury a real update failure under the duplicate-key error of inserting a row
 * just proven to exist — the exact masking ADR-0119 D4 already forbade inside
 * the atomic arm.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'showcase_task',
    fields: {
        progress: { name: 'progress', type: 'number' },
        owner_id: { name: 'owner_id', type: 'text' },
    },
};

/**
 * In-memory store with a caller-scoped read path and a #1994-style by-id
 * write policy: reads under a non-system context only see the caller's own
 * rows, and a by-id write to a row outside the caller's scope is masked as
 * the same 404 the read path answers. Snapshot/rollback transaction semantics
 * as in the #4620 / #5088 harnesses.
 */
function makeRlsEngine() {
    const rows = new Map<string, any>([
        ['mine_1', { id: 'mine_1', owner_id: 'u1', progress: 0 }],
        ['theirs_1', { id: 'theirs_1', owner_id: 'u2', progress: 0 }],
    ]);
    const handle = { id: 'trx-1' };

    const visible = (row: any, context: any) =>
        context?.isSystem === true || row.owner_id === context?.userId;

    const findOne = vi.fn(async (_object: string, options?: any) => {
        const row = rows.get(options?.where?.id) ?? null;
        if (!row) return null;
        return visible(row, options?.context) ? row : null;
    });
    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        const id = options?.where?.id;
        const row = rows.get(id);
        if (!row || !visible(row, options?.context)) {
            // #1994's pre-image check: an unwritable/unknown row masks as the
            // read path's 404 — THIS answer must reach the response row.
            throw Object.assign(new Error(`Record ${id} not found in showcase_task`), {
                code: 'RECORD_NOT_FOUND', status: 404,
            });
        }
        const next = { ...row, ...data };
        rows.set(id, next);
        return next;
    });
    const insert = vi.fn(async (_object: string, data: any) => {
        if (data.id && rows.has(data.id)) {
            // Unclassified, as a driver throws it → `toRowApiError` renders
            // INTERNAL_ERROR: the misdirection the probe exists to prevent.
            throw new Error('duplicate key value violates unique constraint "showcase_task_pkey"');
        }
        const rec = { id: data.id ?? `new-${rows.size + 1}`, ...data };
        rows.set(rec.id, rec);
        return rec;
    });

    const engine: any = {
        registry: { getObject: (n: string) => (n === 'showcase_task' ? SCHEMA : undefined) },
        findOne,
        update,
        insert,
        delete: vi.fn(),
        getDefaultDriverName: () => 'default',
        getDriverByName: () => ({ beginTransaction: async () => handle }),
        transaction: vi.fn(async (callback: (ctx: any) => Promise<any>, baseContext?: any) => {
            const snapshot = new Map(rows);
            try {
                return await callback({ ...(baseContext ?? {}), transaction: handle });
            } catch (err) {
                rows.clear();
                for (const [k, v] of snapshot) rows.set(k, v);
                throw err;
            }
        }),
    };
    return { engine, rows, findOne, update, insert };
}

const upsert = (p: any, records: any[], options?: any) =>
    p.batchData({
        object: 'showcase_task',
        request: { operation: 'upsert', records, ...(options ? { options } : {}) },
        context: { userId: 'u1' },
    } as any);

describe('[#5099] batchData upsert — the fork asks EXISTENCE, not visibility', () => {
    it('an existing row outside the caller`s read scope takes the UPDATE arm — never a duplicate insert', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'theirs_1', data: { progress: 5 } }], { continueOnError: true });

        // THE CRUX. The row EXISTS, so the fork must not try to create it —
        // under the old visibility read this row inserted, duplicate-keyed,
        // and the non-atomic fallback inserted AGAIN.
        expect(t.insert).not.toHaveBeenCalled();
        expect(t.update).toHaveBeenCalledTimes(1);
        expect(t.update.mock.calls[0][2].where.id).toBe('theirs_1');

        // What the caller sees is the WRITE POLICY's answer (#1994), not a
        // primary-key collision.
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(1);
        expect(res.results[0].errors?.[0]?.code).toBe('RECORD_NOT_FOUND');
        expect(res.results[0].errors?.[0]?.httpStatus).toBe(404);
        expect(res.results[0].errors?.[0]?.message).not.toContain('duplicate key');

        // And the store is untouched — no second row, no clobbered value.
        expect(t.rows.get('theirs_1')).toMatchObject({ progress: 0, owner_id: 'u2' });
        expect(t.rows.size).toBe(2);
    });

    it('the probe asks with SYSTEM context — visibility stays the write policy`s decision', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'theirs_1', data: { progress: 5 } },
            { id: 'brand_new', data: { progress: 7 } },
        ], { continueOnError: true });

        expect(t.findOne).toHaveBeenCalledTimes(3);
        expect(t.findOne.mock.calls.every((c: any[]) => c[1]?.context?.isSystem === true)).toBe(true);
    });

    it('a real update failure surfaces ITSELF — no fallback insert to mask it (non-atomic)', async () => {
        const t = makeRlsEngine();
        const explodingUpdate = vi.fn(async () => { throw new Error('update exploded'); });
        t.engine.update = explodingUpdate;
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'mine_1', data: { progress: 1 } }], { continueOnError: true });

        // The old non-atomic fallback inserted here, buried 'update exploded'
        // under a duplicate-key error, and reported THAT to the caller.
        // [#8502] The message no longer discriminates: `update exploded` is a
        // bare `Error`, so its sentence is withheld, and the fallback insert's
        // duplicate-key text would be withheld too. `.not.toContain('duplicate
        // key')` alone would therefore pass for the WRONG reason — it would
        // pass even if the fallback had run. So the claim is carried by the
        // structural pair, which is strictly stronger than the string ever
        // was: the update WAS attempted, and no insert followed it.
        expect(explodingUpdate).toHaveBeenCalledTimes(1);
        expect(t.insert).not.toHaveBeenCalled();
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].errors?.[0]?.message).toBe('The upsert of this record failed. The reason is in the server log.');
        expect(res.results[0].errors?.[0]?.message).not.toContain('duplicate key');
    });

    it('a missing id still INSERTS — the #5088 pin is unchanged', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'brand_new', data: { progress: 7 } }]);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.get('brand_new')).toMatchObject({ progress: 7 });
        expect(t.update).not.toHaveBeenCalled();
    });

    it('a visible existing id still UPDATES, with the CALLER`s context on the write (#3455)', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'mine_1', data: { progress: 9 } }]);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'mine_1', success: true });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 9 });
        expect(t.insert).not.toHaveBeenCalled();
        // Only the PROBE is system — the write still runs as the caller.
        expect(t.update.mock.calls[0][2].context?.userId).toBe('u1');
        expect(t.update.mock.calls[0][2].context?.isSystem).not.toBe(true);
    });

    it('atomic: the out-of-scope row is CAUSAL, no fallback fires, the earlier write rolls back', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'theirs_1', data: { progress: 5 } },
        ], { atomic: true });

        expect(res.results.map((r: any) => r.errors?.[0]?.code)).toEqual([
            'ROLLED_BACK', 'RECORD_NOT_FOUND',
        ]);
        expect(t.insert).not.toHaveBeenCalled();
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 0 });
    });

    it('mixed batch, continueOnError: update / policy-denied / insert each answer for themselves', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'theirs_1', data: { progress: 5 } },
            { id: 'brand_new', data: { progress: 7 } },
        ], { continueOnError: true });

        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'mine_1', success: true });
        expect(res.results[1].errors?.[0]?.code).toBe('RECORD_NOT_FOUND');
        expect(res.results[2]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 1 });
        expect(t.rows.get('theirs_1')).toMatchObject({ progress: 0 });
        expect(t.rows.get('brand_new')).toMatchObject({ progress: 7 });
        expect(t.insert).toHaveBeenCalledTimes(1);
    });
});
