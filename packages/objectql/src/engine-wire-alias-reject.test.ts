// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4371 — a direct engine call carrying a wire-only alias spelling
 * (`sort`/`select`/`skip`/`populate`) is REJECTED, not silently dropped.
 *
 * Regression: #4346 folds `filter`→`where` and `top`→`limit` on every engine
 * entry point, but the other four pairs in `RPC_QUERY_ALIAS_SLOTS` fold at the
 * RPC/protocol layer only (their value shapes need lowering that belongs
 * there). A direct `engine.find()` never crosses that layer, so the alias key
 * rode the AST verbatim, drivers read only the canonical name, and the request
 * SUCCEEDED with the parameter discarded — `sort` + `limit` ("the latest N")
 * silently returning an arbitrary N. Three shipped instances were fixed in
 * #4370; a fourth sat in the engine's own `seedAutonumber`. The engine now
 * throws at the boundary, naming the canonical key and shape, while the
 * RPC/wire path keeps folding exactly as before — the fold must NOT move.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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

/** Memory driver that records every AST handed to find/findOne. */
function makeRecordingDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const finds: any[] = [];
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
    const run = (o: string, ast: any) => {
        let rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
        const ord = Array.isArray(ast?.orderBy) ? ast.orderBy : [];
        if (ord.length > 0) {
            rows = [...rows].sort((a: any, b: any) => {
                for (const { field, order } of ord) {
                    const cmp = String(a?.[field] ?? '').localeCompare(String(b?.[field] ?? ''));
                    if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
                }
                return 0;
            });
        }
        if (typeof ast?.offset === 'number' && ast.offset > 0) rows = rows.slice(ast.offset);
        return typeof ast?.limit === 'number' && ast.limit > 0 ? rows.slice(0, ast.limit) : rows;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { finds.push(ast); return run(o, ast); },
        async findOne(o: string, ast: any) { finds.push(ast); return run(o, ast)[0] ?? null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return run(o, ast).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores, finds };
}

describe('wire-only alias spellings are rejected on direct engine calls (#4371)', () => {
    let engine: ObjectQL;
    let finds: any[];

    beforeEach(async () => {
        engine = new ObjectQL();
        const mem = makeRecordingDriver();
        finds = mem.finds;
        engine.registerDriver(mem.driver, true);
        await engine.init();
        engine.registry.registerObject(task);
        await engine.insert('task', { title: 'B', status: 'done' });
        await engine.insert('task', { title: 'A', status: 'open' });
        await engine.insert('task', { title: 'C', status: 'done' });
        finds.length = 0; // drop insert-path reads; the pins below own this log
    });

    // ── each wire spelling throws before the driver sees anything ──────

    it.each([
        ['sort', { created_at: 'asc' }, 'orderBy'],
        ['select', ['id', 'title'], 'fields'],
        ['skip', 10, 'offset'],
        ['populate', ['owner'], 'expand'],
    ])('find({%s}) is refused, naming the canonical key', async (alias, value, canonical) => {
        await expect(engine.find('task', { [alias]: value } as any)).rejects.toThrow(
            new RegExp(`wire spelling of '${canonical}'.*Pass '${canonical}'`, 's'),
        );
        expect(finds).toHaveLength(0);
    });

    it('findOne({sort}) is refused too — "first row of THIS order" degrades the same way', async () => {
        await expect(engine.findOne('task', { sort: { title: 'asc' } } as any))
            .rejects.toThrow(/findOne\('task'\) does not accept 'sort'/);
        expect(finds).toHaveLength(0);
    });

    it('a sort already in SortNode[] shape is still refused — the KEY is the contract', async () => {
        await expect(engine.find('task', { sort: [{ field: 'title', order: 'asc' }] } as any))
            .rejects.toThrow(/wire spelling of 'orderBy'/);
    });

    it('several wire spellings at once are reported in ONE rejection', async () => {
        await expect(
            engine.find('task', { sort: { title: 'asc' }, populate: ['owner'] } as any),
        ).rejects.toThrow(/'sort'.*'populate'|'populate'.*'sort'/s);
    });

    // ── the canonical spellings all work — the migration target is real ─

    it('find({where, fields, orderBy, offset, limit}) reaches the driver canonically', async () => {
        const rows = await engine.find('task', {
            where: { status: 'done' },
            fields: ['id', 'title'],
            orderBy: [{ field: 'title', order: 'desc' }],
            offset: 0,
            limit: 10,
        });
        expect(rows.map((r: any) => r.title)).toEqual(['C', 'B']);
        expect(finds).toHaveLength(1);
        expect(finds[0].orderBy).toEqual([{ field: 'title', order: 'desc' }]);
        expect(finds[0].sort).toBeUndefined();
    });

    // ── null stays a withdrawal, exactly like the folded slots ──────────

    it('an explicit null wire spelling is a withdrawal, not a rejection', async () => {
        const rows = await engine.find('task', { sort: null } as any);
        expect(rows).toHaveLength(3);
    });

    // ── the folded pairs did not regress behind the new parameter ──────

    it('find({filter, top}) still folds (#4346) with the rejection guard in place', async () => {
        const rows = await engine.find('task', { filter: { status: 'done' }, top: 1 } as any);
        expect(rows).toHaveLength(1);
        expect(finds[0].where).toEqual({ status: 'done' });
        expect(finds[0].limit).toBe(1);
    });

    // ── the RPC/wire path still folds — the fold must NOT move (#4371 pin 3) ─

    it('wire `sort` through the protocol layer folds to orderBy and passes the guard', async () => {
        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const out: any = await protocol.findData({ object: 'task', query: { sort: '-title' } });
        expect(out.records.map((r: any) => r.title)).toEqual(['C', 'B', 'A']);
        expect(finds).toHaveLength(1);
        expect(finds[0].orderBy).toEqual([{ field: 'title', order: 'desc' }]);
        expect(finds[0].sort).toBeUndefined();
    });

    it('wire `select`/`skip`/`populate` through the protocol layer pass the guard as canonical keys', async () => {
        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const out: any = await protocol.findData({
            object: 'task',
            query: { select: 'id,title', skip: 1, sort: 'title' },
        });
        expect(out.records.map((r: any) => r.title)).toEqual(['B', 'C']);
        expect(finds[0].fields).toEqual(expect.arrayContaining(['id', 'title']));
        expect(finds[0].offset).toBe(1);
        expect(finds[0].select).toBeUndefined();
        expect(finds[0].skip).toBeUndefined();
    });
});
