// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4134 — the REST list path read ANY unrecognised query parameter as a field
 * filter, so `?pageSize=5` became `where.pageSize = '5'`: a predicate no row
 * can satisfy. The response was `200` + `total: 0` — structurally valid, and
 * indistinguishable from "this object really is empty". It cost a real
 * investigation, where an empty list was read as an RLS/org-scope visibility
 * bug rather than a misspelled parameter.
 *
 * The asymmetry is the point: the WRITE path already rejects the same unknown
 * name loudly (`400 INVALID_FIELD`). One piece of knowledge — does this field
 * exist — was enforced on one side and silently zeroed on the other.
 *
 * These tests drive a REAL {@link ObjectQL} engine (same harness shape as
 * `protocol-unregistered-object.test.ts`) rather than an engine double,
 * because the gate's authority is the registry's field map — and that map is
 * not what the author declared: `applySystemFields` injects the audit / tenant
 * / owner columns at registration. Only a real registry can show that
 * `?owner_id=…` still filters while `?pageSize=…` is refused.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

/** The issue's repro object: 10 rows, 2 of them `status: 'done'`. */
const taskObject = {
    name: 'showcase_task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const, required: true },
        status: { name: 'status', label: 'Status', type: 'text' as const },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            // `$and` must be honored, not skipped — #4164 composes the explicit
            // filter and the implicit field predicates through it, so a matcher
            // that ignores `$and` would green-light a merge that does nothing.
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((arm) => matchesWhere(row, arm))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const all = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            const from = typeof ast?.offset === 'number' ? ast.offset : 0;
            return typeof ast?.limit === 'number' ? all.slice(from, from + ast.limit) : all.slice(from);
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where)).length;
        },
        async aggregate(object: string, ast: any) { return [{ count: await this.count(object, ast) }]; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

describe('#4134 — unknown list query params (real ObjectQL engine)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver, stores } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(taskObject, 'test-package');
        protocol = new ObjectStackProtocolImplementation(engine);

        const rows = new Map<string, Record<string, unknown>>();
        for (let i = 1; i <= 10; i++) {
            rows.set(`t${i}`, {
                id: `t${i}`,
                title: `Task ${i}`,
                status: i <= 2 ? 'done' : 'open',
                owner_id: 'usr_1',
                created_at: '2026-07-30T00:00:00.000Z',
            });
        }
        stores.set('showcase_task', rows);
    });

    // ─────────────────────────────────────────────────────────────
    // The issue's own transcript, line for line
    // ─────────────────────────────────────────────────────────────

    it('baseline — no params returns every row', async () => {
        await expect(protocol.findData({ object: 'showcase_task' }))
            .resolves.toMatchObject({ total: 10 });
    });

    it('a real field still filters, and a real field with no match is still a legitimate 0', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { status: 'done' } }))
            .resolves.toMatchObject({ total: 2 });
        // The one empty list that MUST stay a 200: the predicate was applied
        // and genuinely matched nothing.
        await expect(protocol.findData({ object: 'showcase_task', query: { status: 'zzz' } }))
            .resolves.toMatchObject({ total: 0 });
    });

    it.each(['zzzz', 'pageSize', 'page_size', 'perPage'])(
        '?%s no longer returns 200 + an empty list — it is a 400',
        async (param) => {
            await expect(
                protocol.findData({ object: 'showcase_task', query: { [param]: '5' } }),
            ).rejects.toMatchObject({
                status: 400,
                code: 'INVALID_FIELD',
                field: param,
                object: 'showcase_task',
            });
        },
    );

    it('the real pagination spellings all still work', async () => {
        for (const query of [{ $top: 5 }, { top: 5 }, { limit: 5 }]) {
            const r: any = await protocol.findData({ object: 'showcase_task', query });
            expect(r.records).toHaveLength(5);
            expect(r.total).toBe(10);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // The registry — not the author's declaration — is the authority
    // ─────────────────────────────────────────────────────────────

    it('filters on the system fields the registry injected, which the author never declared', async () => {
        // `applySystemFields` adds these at registration; a gate reading only
        // the authored field map would 400 on every one of them.
        expect(taskObject.fields).not.toHaveProperty('owner_id');
        for (const [field, value] of [
            ['owner_id', 'usr_1'],
            ['created_at', '2026-07-30T00:00:00.000Z'],
        ] as const) {
            await expect(
                protocol.findData({ object: 'showcase_task', query: { [field]: value } }),
            ).resolves.toMatchObject({ total: 10 });
        }
        await expect(protocol.findData({ object: 'showcase_task', query: { id: 't1' } }))
            .resolves.toMatchObject({ total: 1 });
    });

    it('suggests the parameter that works instead of the one that was guessed', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { pageSize: '5' } }))
            .rejects.toThrow(/Did you mean the 'top' query parameter/);
        await expect(protocol.findData({ object: 'showcase_task', query: { stauts: 'done' } }))
            .rejects.toThrow(/Did you mean the field 'status'/);
    });

    it('an unknown object stays a 404 — the field gate must not turn it into a 400', async () => {
        await expect(
            protocol.findData({ object: 'no_such_object', query: { pageSize: '5' } }),
        ).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' });
    });

    // ─────────────────────────────────────────────────────────────
    // #4164 — implicit predicates compose with an explicit filter
    // ─────────────────────────────────────────────────────────────

    it('a bare field param NARROWS an explicit filter instead of vanishing (#4164)', async () => {
        // Pre-#4164 the `title` predicate was dropped and this returned all 8
        // open tasks — over-returning, the mirror of #4134's zeroing.
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: { filter: JSON.stringify({ status: 'open' }), title: 'Task 3' },
        });
        expect(r.total).toBe(1);
        expect(r.records.map((x: any) => x.id)).toEqual(['t3']);
    });

    it('contradictory sides intersect to an honest zero — both filters ran', async () => {
        // 'Task 3' is open, so requiring status=done alongside it matches
        // nothing. Unlike the #4134 zero, every written predicate was applied.
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: { filter: JSON.stringify({ status: 'done' }), title: 'Task 3' },
        });
        expect(r.total).toBe(0);
    });

    // ─────────────────────────────────────────────────────────────
    // #4181 — an unappliable filter must not answer like a satisfied one
    // ─────────────────────────────────────────────────────────────

    it('an unparseable filter 400s instead of returning the UNFILTERED page (#4181)', async () => {
        // The exact repro: one missing quote. Pre-#4181 this returned
        // `total: 10` — identical to the no-filter baseline, so a caller whose
        // filter never ran could not tell from the response.
        const baseline: any = await protocol.findData({ object: 'showcase_task' });
        expect(baseline.total).toBe(10);

        await expect(
            protocol.findData({ object: 'showcase_task', query: { filter: '{status:done' } }),
        ).rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    });

    it('the same garbage filter cannot hide behind pagination either', async () => {
        // Pre-#4181: `total: 10` + 2 records — a perfectly normal-looking page
        // of an unfiltered set.
        await expect(
            protocol.findData({ object: 'showcase_task', query: { filter: '{status:done', top: 2 } }),
        ).rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    });

    it('a VALID filter still applies — the guard rejects only what it cannot run', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: { filter: '{"status":"done"}' },
        });
        expect(r.total).toBe(2);
    });

    it('pagination totals are computed over the MERGED predicate', async () => {
        // 8 open rows share created_at; page of 3 → total must be 8 (the
        // merged match count), not 10 (unfiltered) nor 3 (page-local).
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                filter: JSON.stringify({ status: 'open' }),
                created_at: '2026-07-30T00:00:00.000Z',
                top: 3,
            },
        });
        expect(r.records).toHaveLength(3);
        expect(r.total).toBe(8);
        expect(r.hasMore).toBe(true);
    });
});
