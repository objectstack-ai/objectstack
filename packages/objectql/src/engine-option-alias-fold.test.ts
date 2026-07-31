// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4346 — the `filter` → `where` fold existed in `find()` ONLY.
 *
 * The driver AST understands `where`; it has no idea what `filter` is. So an
 * unfolded `filter` is not a narrower query, it is NO query — and the five
 * sibling methods that never got `find()`'s fold each turned a caller's
 * predicate into "every row":
 *
 * | call (predicate passed as `filter`) | before |
 * |---|---|
 * | `findOne` | returned a row that does not match |
 * | `count`   | counted the whole object |
 * | `update`  | **rewrote every row** |
 * | `delete`  | **emptied the object** |
 *
 * Reachable from the documented authoring surface, not just from internals:
 * `ScopedContext` (`ctx.api.object('x')` in an L2 hook) forwards its argument
 * bag verbatim, and the spec's own hook TSDoc taught
 * `findOne({ filter: … })` — corrected in the same change.
 *
 * The sixth alias pair rides along: `top` is declared as "Alias for limit",
 * yet the protocol layer let it OVERWRITE `limit` while the engine kept
 * `limit`, so one query resolved two ways depending on the path (#3795's
 * divergence, on the pair its scope note excluded).
 *
 * These tests drive a REAL {@link ObjectQL} engine with an in-memory driver
 * that applies `ast.where` exactly as a production driver does — an engine
 * double cannot show "the predicate never reached the driver", which is the
 * entire failure.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const taskObject = {
    name: 'alias_task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        status: { name: 'status', label: 'Status', type: 'text' as const },
    },
};

/** A driver that honours `ast.where` — and, like every real one, treats its absence as "all rows". */
function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (expected ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(o: string, ast: any) {
            const all = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
            const off = ast?.offset ?? 0;
            return typeof ast?.limit === 'number' ? all.slice(off, off + ast.limit) : all.slice(off);
        },
        findStream() { throw new Error('not implemented'); },
        async findOne(o: string, ast: any) {
            for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
            return null;
        },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(o).set(id, row);
            return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(o).has(id)) return this.update(o, id, data);
            return this.create(o, data);
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async aggregate(o: string, ast: any) { return [{ count: (await this.find(o, ast)).length }]; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async updateMany(o: string, ast: any, data: Record<string, unknown>) {
            const s = storeFor(o); let n = 0;
            for (const [id, row] of s) {
                if (!matches(row, ast?.where)) continue;
                s.set(id, { ...row, ...data, id }); n += 1;
            }
            return n;
        },
        async deleteMany(o: string, ast: any) {
            const s = storeFor(o); let n = 0;
            for (const [id, row] of Array.from(s)) {
                if (!matches(row, ast?.where)) continue;
                s.delete(id); n += 1;
            }
            return n;
        },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

const CONFLICT = { status: 400, code: 'INVALID_REQUEST' };

describe('#4346 — every engine verb folds `filter` → `where`, not just find()', () => {
    let engine: ObjectQL;
    let rows: Map<string, Record<string, unknown>>;

    beforeEach(async () => {
        engine = new ObjectQL();
        const made = makeMemoryDriver();
        engine.registerDriver(made.driver, true);
        await engine.init();
        engine.registry.registerObject(taskObject as any);
        rows = new Map<string, Record<string, unknown>>([
            ['a', { id: 'a', title: 'A', status: 'open' }],
            ['b', { id: 'b', title: 'B', status: 'done' }],
            ['c', { id: 'c', title: 'C', status: 'done' }],
        ]);
        made.stores.set('alias_task', rows);
    });

    const DONE = { status: 'done' };

    // ── reads ────────────────────────────────────────────────────────

    it('find applies a `filter` predicate (the one verb that always did)', async () => {
        const got = await engine.find('alias_task', { filter: DONE } as any);
        expect(got.map((r: any) => r.id)).toEqual(['b', 'c']);
    });

    it('findOne returns a MATCHING row, not the first row of the object', async () => {
        // Before: `a` — status 'open'. The predicate never reached the driver,
        // so "first match" was "first row".
        const got: any = await engine.findOne('alias_task', { filter: DONE } as any);
        expect(got?.id).toBe('b');
        expect(got?.status).toBe('done');
    });

    it('count counts the MATCHES, not the whole object', async () => {
        expect(await engine.count('alias_task', { filter: DONE } as any)).toBe(2);
    });

    it('aggregate runs on the filtered set', async () => {
        const got = await engine.aggregate('alias_task', {
            filter: DONE, aggregations: [{ function: 'count', field: 'id', alias: 'count' }],
        } as any);
        expect(got[0].count).toBe(2);
    });

    // ── writes: the destructive half ─────────────────────────────────

    it('update rewrites ONLY the matched rows', async () => {
        // Before: all three rows were rewritten — `updateMany` received an AST
        // with no `where` at all.
        await engine.update('alias_task', { title: 'ZAP' }, { filter: DONE, multi: true } as any);
        expect(Array.from(rows.values()).map((r: any) => `${r.id}:${r.title}`))
            .toEqual(['a:A', 'b:ZAP', 'c:ZAP']);
    });

    it('delete removes ONLY the matched rows', async () => {
        // Before: the object was emptied.
        await engine.delete('alias_task', { filter: DONE, multi: true } as any);
        expect(Array.from(rows.keys())).toEqual(['a']);
    });

    // ── one slot, one value ──────────────────────────────────────────

    it.each(['find', 'findOne', 'count'] as const)(
        '%s refuses `filter` and `where` carrying different values',
        async (method) => {
            await expect(
                (engine as any)[method]('alias_task', { filter: DONE, where: { status: 'open' } }),
            ).rejects.toMatchObject(CONFLICT);
        },
    );

    it('delete refuses a conflicting pair rather than guessing which predicate to run', async () => {
        await expect(
            engine.delete('alias_task', { filter: DONE, where: { status: 'open' }, multi: true } as any),
        ).rejects.toMatchObject(CONFLICT);
        expect(Array.from(rows.keys())).toEqual(['a', 'b', 'c']);
    });

    it('accepts redundant IDENTICAL spellings — only a conflict is ambiguous', async () => {
        const got = await engine.find('alias_task', { filter: DONE, where: { ...DONE } } as any);
        expect(got.map((r: any) => r.id)).toEqual(['b', 'c']);
    });

    it('leaves the caller\'s own options object untouched', async () => {
        // The fold copies: a caller reusing its bag must not find `filter`
        // silently renamed underneath it.
        const opts = { filter: DONE };
        await engine.find('alias_task', opts as any);
        expect(opts).toEqual({ filter: DONE });
    });

    // ── the sixth pair: top / limit ──────────────────────────────────

    it('`top` alone still limits the page (OData compatibility)', async () => {
        expect((await engine.find('alias_task', { top: 2 } as any)).length).toBe(2);
    });

    it('refuses `top` and `limit` carrying different values, on every path', async () => {
        // Before: the engine kept `limit` (3) while the protocol overwrote it
        // with `top` (1) — the same query, two answers.
        await expect(
            engine.find('alias_task', { top: 1, limit: 3 } as any),
        ).rejects.toMatchObject(CONFLICT);
    });

    it('findOne ignores `top` instead of colliding with its forced limit of 1', async () => {
        // `findOne` sets `limit: 1` itself, so a caller's `top` is discarded —
        // folding it would manufacture a conflict out of a request that has no
        // ambiguity in it.
        const got: any = await engine.findOne('alias_task', { top: 5, where: DONE } as any);
        expect(got?.id).toBe('b');
    });
});
