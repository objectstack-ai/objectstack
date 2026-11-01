// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `batchData`'s by-id upsert forks on what the CALLER can read.
 *
 * On the write doors a row the caller cannot read is a row that does not exist
 * (ruling 5985885287 on #21771). So the fork asks the caller's own read — the
 * object-level admission, then `findOne` by id under the caller's context — and
 * a row that read does not return takes the INSERT arm, exactly as a create
 * naming the same id does. That insert meets the deployment-global primary key
 * and answers what a plain create answers: the 2026-11-01 maintainer ruling
 * ratified that collision as the accepted cost of a global key (extending
 * ruling 5934879010 on #21185, rule 2). A row the caller CAN read keeps the
 * UPDATE arm, where the engine still judges the write.
 *
 * ⚠️ The file name is historical: it pinned #5099's EXISTENCE fork, which this
 * ruling reverses (the fork's own note in `protocol-batch-data.ts` records
 * why). What #5099 established and is kept — no fallback insert after an
 * update failure, on either arm — is still pinned here.
 *
 * The double: a caller-scoped read path, a #1994-style by-id write policy (an
 * out-of-scope by-id write masks as the read path's 404), and a primary key
 * that refuses a colliding insert the way the engine does (`UNIQUE_VIOLATION`,
 * 409), so the upsert's insert arm and a plain create meet the SAME refusal and
 * their rows can be compared whole.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'showcase_task',
    fields: {
        progress: { name: 'progress', type: 'number' },
        owner_id: { name: 'owner_id', type: 'text' },
    },
};

const CALLER = { userId: 'u1' };

/**
 * In-memory store with a caller-scoped read path and a #1994-style by-id
 * write policy: reads under a non-system context only see the caller's own
 * rows, and a by-id write to a row outside the caller's scope is masked as
 * the same 404 the read path answers. Inserting an id that is already stored
 * is refused as the engine refuses it — a classified `UNIQUE_VIOLATION` (409)
 * that names the column and nothing about the stored row. Snapshot/rollback
 * transaction semantics as in the #4620 / #5088 harnesses.
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
        assertEngineFindOnePredicate(_object, options);
        const row = rows.get(options?.where?.id) ?? null;
        if (!row) return null;
        return visible(row, options?.context) ? row : null;
    });
    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        assertEngineUpdateDispatch(data, options);
        const id = options?.where?.id;
        const row = rows.get(id);
        if (!row || !visible(row, options?.context)) {
            // #1994's pre-image check: an unwritable/unknown row masks as the
            // read path's 404.
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
            // The primary key's refusal, as the engine classifies a driver's
            // duplicate: the registered code and status, the column, no row.
            throw Object.assign(
                new Error("Duplicate record refused on 'Task': a unique constraint on 'id' already holds this value. No record was written."),
                { code: 'UNIQUE_VIOLATION', status: 409 },
            );
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

/** A services registry carrying a `security` service whose object-level read admission answers `readable`. */
function securityRegistry(readable: boolean | (() => Promise<boolean>)) {
    const canReadObject = vi.fn(async (_object: string, _context?: unknown) =>
        typeof readable === 'function' ? readable() : readable);
    const services = new Map<string, any>([['security', { canReadObject }]]);
    return { getServicesRegistry: () => services, canReadObject };
}

const batch = (p: any, operation: string, records: any[], options?: any) =>
    p.batchData({
        object: 'showcase_task',
        request: { operation, records, ...(options ? { options } : {}) },
        context: CALLER,
    } as any);

const upsert = (p: any, records: any[], options?: any) => batch(p, 'upsert', records, options);

describe('batchData upsert — the fork asks what the CALLER can read', () => {
    it('a row outside the caller`s read scope takes the INSERT arm and answers what a create naming that id answers', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);
        const before = JSON.stringify(t.rows.get('theirs_1'));

        const ups: any = await upsert(p, [{ id: 'theirs_1', data: { progress: 5 } }], { continueOnError: true });
        const create: any = await batch(p, 'create', [{ data: { id: 'theirs_1', progress: 5 } }], { continueOnError: true });

        // THE CRUX. The update arm is never reached for a row the caller
        // cannot read, and the insert the fork chose meets the primary key.
        expect(t.update).not.toHaveBeenCalled();
        expect(t.insert).toHaveBeenCalledTimes(2);
        expect(t.insert.mock.calls[0][1]).toMatchObject({ id: 'theirs_1' });

        expect(ups.succeeded).toBe(0);
        expect(ups.failed).toBe(1);
        expect(ups.results[0].errors?.[0]).toMatchObject({ code: 'UNIQUE_VIOLATION', httpStatus: 409 });
        // ⭐ The row's refusal IS the create's refusal — byte for byte, no
        // field, code or sentence of its own.
        expect(ups.results[0].errors).toEqual(create.results[0].errors);

        // And the stored row is untouched.
        expect(JSON.stringify(t.rows.get('theirs_1'))).toBe(before);
        expect(t.rows.size).toBe(2);
    });

    it('the fork reads with the CALLER`s context — never the system`s', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'theirs_1', data: { progress: 5 } },
            { id: 'brand_new', data: { progress: 7 } },
        ], { continueOnError: true });

        expect(t.findOne).toHaveBeenCalledTimes(3);
        for (const [, options] of t.findOne.mock.calls as any[]) {
            expect(options?.context?.userId).toBe('u1');
            expect(options?.context?.isSystem).not.toBe(true);
        }
    });

    it('a caller the security service refuses the OBJECT to takes the insert arm for every row — the create`s answer each time', async () => {
        const t = makeRlsEngine();
        const sec = securityRegistry(false);
        const p = new ObjectStackProtocolImplementation(t.engine, sec.getServicesRegistry);

        const ups: any = await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'brand_new', data: { progress: 7 } },
        ], { continueOnError: true });
        const create: any = await batch(p, 'create', [{ data: { id: 'mine_1', progress: 1 } }], { continueOnError: true });

        // No row read is attempted: the caller can read no row of the object,
        // and the middleware would refuse that read outright.
        expect(t.findOne).not.toHaveBeenCalled();
        expect(t.update).not.toHaveBeenCalled();
        // Asked once for the whole loop, with the caller's context.
        expect(sec.canReadObject).toHaveBeenCalledTimes(1);
        expect(sec.canReadObject.mock.calls[0]).toEqual(['showcase_task', CALLER]);

        expect(ups.results[0].errors).toEqual(create.results[0].errors);
        expect(ups.results[1]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 0 });
        expect(t.rows.get('brand_new')).toMatchObject({ progress: 7 });
    });

    it('an object the security service admits still forks on the caller`s row read', async () => {
        const t = makeRlsEngine();
        const sec = securityRegistry(true);
        const p = new ObjectStackProtocolImplementation(t.engine, sec.getServicesRegistry);

        const ups: any = await upsert(p, [
            { id: 'mine_1', data: { progress: 3 } },
            { id: 'theirs_1', data: { progress: 5 } },
        ], { continueOnError: true });

        expect(ups.results[0]).toMatchObject({ id: 'mine_1', success: true });
        expect(ups.results[1].errors?.[0]).toMatchObject({ code: 'UNIQUE_VIOLATION', httpStatus: 409 });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 3 });
        expect(t.rows.get('theirs_1')).toMatchObject({ progress: 0 });
        expect(sec.canReadObject).toHaveBeenCalledTimes(1);
    });

    it('an object-level admission that throws fails the row — no arm is chosen, nothing is written', async () => {
        const t = makeRlsEngine();
        const sec = securityRegistry(async () => { throw new Error('permission resolution exploded'); });
        const p = new ObjectStackProtocolImplementation(t.engine, sec.getServicesRegistry);

        const ups: any = await upsert(p, [{ id: 'brand_new', data: { progress: 7 } }], { continueOnError: true });

        expect(ups.results[0].success).toBe(false);
        expect(t.insert).not.toHaveBeenCalled();
        expect(t.update).not.toHaveBeenCalled();
        expect(t.rows.has('brand_new')).toBe(false);
    });

    it('a context-less call is not asked about — its read runs as its write does, without a context', async () => {
        const t = makeRlsEngine();
        const sec = securityRegistry(false);
        const p = new ObjectStackProtocolImplementation(t.engine, sec.getServicesRegistry);

        await p.batchData({
            object: 'showcase_task',
            request: { operation: 'upsert', records: [{ id: 'brand_new', data: { progress: 7 } }] },
        } as any);

        expect(sec.canReadObject).not.toHaveBeenCalled();
        expect(t.findOne).toHaveBeenCalledTimes(1);
        expect(t.findOne.mock.calls[0][1]).not.toHaveProperty('context');
    });

    it('a real update failure surfaces ITSELF — no fallback insert to mask it (non-atomic)', async () => {
        const t = makeRlsEngine();
        const explodingUpdate = vi.fn(async () => { throw new Error('update exploded'); });
        t.engine.update = explodingUpdate;
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'mine_1', data: { progress: 1 } }], { continueOnError: true });

        // [#8502] `update exploded` is a bare `Error`, so its sentence is
        // withheld, and a fallback insert's duplicate refusal would be
        // classified rather than withheld. The claim is carried by the
        // structural pair: the update WAS attempted, and no insert followed.
        expect(explodingUpdate).toHaveBeenCalledTimes(1);
        expect(t.insert).not.toHaveBeenCalled();
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].errors?.[0]?.message).toBe('The upsert of this record failed. The reason is in the server log.');
    });

    it('a missing id still INSERTS', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'brand_new', data: { progress: 7 } }]);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.get('brand_new')).toMatchObject({ progress: 7 });
        expect(t.update).not.toHaveBeenCalled();
    });

    it('a readable existing id still UPDATES, with the CALLER`s context on the write (#3455)', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [{ id: 'mine_1', data: { progress: 9 } }]);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'mine_1', success: true });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 9 });
        expect(t.insert).not.toHaveBeenCalled();
        expect(t.update.mock.calls[0][2].context?.userId).toBe('u1');
        expect(t.update.mock.calls[0][2].context?.isSystem).not.toBe(true);
    });

    it('atomic: the unreadable row is CAUSAL with the create`s refusal, the read rides the transaction, the earlier write rolls back', async () => {
        const t = makeRlsEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await upsert(p, [
            { id: 'mine_1', data: { progress: 1 } },
            { id: 'theirs_1', data: { progress: 5 } },
        ], { atomic: true });

        expect(res.results.map((r: any) => r.errors?.[0]?.code)).toEqual([
            'ROLLED_BACK', 'UNIQUE_VIOLATION',
        ]);
        expect(t.update).toHaveBeenCalledTimes(1);
        expect(t.update.mock.calls[0][2].where.id).toBe('mine_1');
        // Both reads carry the transaction handle beside the caller.
        expect(t.findOne.mock.calls.map((c: any[]) => c[1]?.context?.transaction?.id)).toEqual(['trx-1', 'trx-1']);
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 0 });
        expect(t.rows.get('theirs_1')).toMatchObject({ progress: 0 });
    });

    it('mixed batch, continueOnError: update / unreadable / insert each answer for themselves', async () => {
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
        expect(res.results[1].errors?.[0]?.code).toBe('UNIQUE_VIOLATION');
        expect(res.results[2]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.get('mine_1')).toMatchObject({ progress: 1 });
        expect(t.rows.get('theirs_1')).toMatchObject({ progress: 0 });
        expect(t.rows.get('brand_new')).toMatchObject({ progress: 7 });
        expect(t.update).toHaveBeenCalledTimes(1);
    });
});
