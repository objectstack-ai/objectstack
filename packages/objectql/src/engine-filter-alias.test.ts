// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4346 — the `filter` → `where` alias folds on EVERY engine entry point, not
 * just `find()`, with a REAL {@link ObjectQL} engine + stub driver.
 *
 * Regression: the DataEngine contract (`DataEngine*OptionsSchema`) declares
 * `filter` as a legitimate option on every read and write method, but only
 * `find()` folded it into the `where` key the driver AST understands.
 * `findOne`/`count`/`update`/`delete`/`aggregate` passed the bag through with
 * `ast.where === undefined`, which every driver reads as "no predicate" — so a
 * caller filtering with `{ filter }` silently matched EVERY row: an over-grant
 * on the reads, an unbounded write on `update`/`delete`. The spec's own hook
 * documentation taught exactly this call (`users.findOne({ filter: … })`).
 *
 * The fold now runs once per entry point via the spec's #3795 slot table
 * (`RPC_QUERY_ALIAS_SLOTS` + `foldQueryAliasSlots`), under the #4181 rule:
 * alias alone folds, identical duplicates collapse, conflicting values are
 * refused. Same table also folds `top` → `limit` (canonical wins — the pair
 * the #3795 sweep scoped out).
 *
 * The write-path pins matter most: a regression there is silent and
 * destructive, and this whole class went unnoticed because `find` was the only
 * method anyone thought to check.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const task = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        status: { name: 'status', type: 'text' as const },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) {
            const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
            return typeof ast?.limit === 'number' && ast.limit > 0 ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async updateMany(o: string, ast: any, data: Record<string, unknown>) {
            let n = 0;
            for (const [id, row] of storeFor(o)) {
                if (!matches(row, ast?.where)) continue;
                storeFor(o).set(id, { ...row, ...data, id }); n += 1;
            }
            return n;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async deleteMany(o: string, ast: any) {
            let n = 0;
            for (const [id, row] of [...storeFor(o)]) {
                if (!matches(row, ast?.where)) continue;
                storeFor(o).delete(id); n += 1;
            }
            return n;
        },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

describe('filter → where folds on every engine method (#4346)', () => {
    let engine: ObjectQL;
    let stores: Map<string, Map<string, Record<string, unknown>>>;
    let a: any, b: any, c: any;

    const titles = () => new Set(Array.from(stores.get('task')?.values() ?? []).map((r) => r.title));
    const ids = () => new Set(Array.from(stores.get('task')?.keys() ?? []));

    beforeEach(async () => {
        engine = new ObjectQL();
        const stub = makeStubDriver();
        stores = stub.stores;
        engine.registerDriver(stub.driver, true);
        await engine.init();
        engine.registry.registerObject(task);
        // The issue's repro set: one open row, two done rows.
        a = await engine.insert('task', { title: 'A', status: 'open' });
        b = await engine.insert('task', { title: 'B', status: 'done' });
        c = await engine.insert('task', { title: 'C', status: 'done' });
    });

    // ── {filter} alone applies the predicate ───────────────────────────

    it('find({filter}) applies the predicate (the one method that already folded)', async () => {
        const rows = await engine.find('task', { filter: { status: 'done' } } as any);
        expect(new Set(rows.map((r: any) => r.id))).toEqual(new Set([b.id, c.id]));
    });

    it('findOne({filter}) returns a MATCHING row, not the first row of the table', async () => {
        const row = await engine.findOne('task', { filter: { status: 'done' } } as any);
        expect(row.status).toBe('done');
        expect(row.id).not.toBe(a.id);
    });

    it('count({filter}) counts the matching rows, not the whole table', async () => {
        expect(await engine.count('task', { filter: { status: 'done' } } as any)).toBe(2);
    });

    it('update(data, {filter, multi}) rewrites ONLY the matching rows', async () => {
        await engine.update('task', { title: 'ZAP' }, { filter: { status: 'done' }, multi: true } as any);
        expect(stores.get('task')!.get(a.id)!.title).toBe('A');
        expect(stores.get('task')!.get(b.id)!.title).toBe('ZAP');
        expect(stores.get('task')!.get(c.id)!.title).toBe('ZAP');
    });

    it('delete({filter, multi}) deletes ONLY the matching rows — the table survives', async () => {
        await engine.delete('task', { filter: { status: 'done' }, multi: true } as any);
        expect(ids()).toEqual(new Set([a.id]));
    });

    it('aggregate({filter}) aggregates over the matching rows only', async () => {
        const out = await engine.aggregate('task', {
            filter: { status: 'done' },
            aggregations: [{ function: 'count', alias: 'n' }],
        } as any);
        expect(out).toEqual([{ n: 2 }]);
    });

    it('a scalar id inside {filter} reaches the by-id fast path, same as {where}', async () => {
        await engine.update('task', { title: 'ONLY-B' }, { filter: { id: b.id } } as any);
        expect(stores.get('task')!.get(b.id)!.title).toBe('ONLY-B');
        expect(stores.get('task')!.get(c.id)!.title).toBe('C');

        await engine.delete('task', { filter: { id: c.id } } as any);
        expect(ids()).toEqual(new Set([a.id, b.id]));
    });

    // ── {filter, where} conflicting is refused; identical collapses ────

    it.each([
        ['find', () => engine.find('task', { filter: { status: 'done' }, where: { status: 'open' } } as any)],
        ['findOne', () => engine.findOne('task', { filter: { status: 'done' }, where: { status: 'open' } } as any)],
        ['count', () => engine.count('task', { filter: { status: 'done' }, where: { status: 'open' } } as any)],
        ['update', () => engine.update('task', { title: 'ZAP' }, { filter: { status: 'done' }, where: { status: 'open' }, multi: true } as any)],
        ['delete', () => engine.delete('task', { filter: { status: 'done' }, where: { status: 'open' }, multi: true } as any)],
        ['aggregate', () => engine.aggregate('task', { filter: { status: 'done' }, where: { status: 'open' }, aggregations: [{ function: 'count', alias: 'n' }] } as any)],
    ])('%s refuses {filter, where} carrying different values', async (_method, call) => {
        await expect(call()).rejects.toThrow(/spellings of the same parameter.*Send exactly one/s);
        // No write happened before the refusal.
        expect(titles()).toEqual(new Set(['A', 'B', 'C']));
    });

    it('redundant IDENTICAL {filter, where} collapses instead of conflicting', async () => {
        const rows = await engine.find('task', { filter: { status: 'done' }, where: { status: 'done' } } as any);
        expect(rows).toHaveLength(2);
        expect(await engine.count('task', { filter: { status: 'done' }, where: { status: 'done' } } as any)).toBe(2);
    });

    it('an explicit null filter is a withdrawal, not a predicate and not a conflict', async () => {
        const rows = await engine.find('task', { filter: null } as any);
        expect(rows).toHaveLength(3);
    });

    // ── the sixth pair: top → limit (canonical wins, conflicts refused) ─

    it('find({top}) alone still limits', async () => {
        const rows = await engine.find('task', { top: 1 } as any);
        expect(rows).toHaveLength(1);
    });

    it('find({top, limit}) conflicting is refused — HTTP and in-process now agree', async () => {
        await expect(engine.find('task', { top: 1, limit: 3 } as any))
            .rejects.toThrow(/spellings of the same parameter \(canonical 'limit'\)/);
    });

    it('find({top, limit}) identical collapses', async () => {
        const rows = await engine.find('task', { top: 2, limit: 2 } as any);
        expect(rows).toHaveLength(2);
    });

    it('findOne({top}) stays single-row — the forced limit: 1 wins over the folded alias', async () => {
        const row = await engine.findOne('task', { top: 5, filter: { status: 'done' } } as any);
        expect(row.status).toBe('done');
    });

    // ── the documented hook call path (ScopedContext / ObjectRepository) ─

    it('the hook-docs call `ctx.object(...).findOne({ where })` and its legacy {filter} spelling agree', async () => {
        const ctx = engine.createContext({ userId: 'usr_1' });
        const repo = ctx.object('task');
        const viaWhere = await repo.findOne({ where: { status: 'done' } });
        const viaFilter = await repo.findOne({ filter: { status: 'done' } });
        expect(viaFilter.status).toBe('done');
        expect(viaWhere.status).toBe('done');
    });

    it('a cleanup hook calling repo.delete({filter, multi}) no longer empties the object', async () => {
        const repo = engine.createContext({ userId: 'usr_1' }).object('task');
        await repo.delete({ filter: { status: 'done' }, multi: true });
        expect(ids()).toEqual(new Set([a.id]));
    });
});
