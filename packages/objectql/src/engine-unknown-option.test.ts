// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4371 option (2) — an engine option-bag key the engine does not execute is
 * REJECTED at the entry point instead of silently ignored.
 *
 * The engine declares a query contract (`Engine*OptionsSchema`) but never
 * parses it at runtime, so before this gate ANY key outside the contract —
 * a typo (`orderby`), a retired key (`cursor`), a wire-protocol leftover
 * (`object`, `count`), a key that only works on OTHER methods (`tenantId` on
 * `count`) — rode along and was dropped without a trace. The per-method legal
 * sets mirror the schemas plus the documented extras (`searchFields`,
 * `onFieldsDropped`, the driver pass-through keys); the drift pin at the
 * bottom keeps them from falling out of step with the spec.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    EngineQueryOptionsSchema,
    EngineUpdateOptionsSchema,
    EngineDeleteOptionsSchema,
    EngineCountOptionsSchema,
    EngineAggregateOptionsSchema,
} from '@objectstack/spec/data';
import { ObjectQL, ENGINE_OPTION_KEY_SETS } from './engine.js';

const task = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        status: { name: 'status', type: 'text' as const },
        owner: { name: 'owner', type: 'lookup' as const, reference: 'person' },
    },
};
const person = {
    name: 'person',
    label: 'Person',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};

function makeDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const finds: any[] = [];
    let nextId = 0;
    const matches = (row: any, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and') return (v as any[]).every((w) => matches(row, w));
            if (k.startsWith('$')) continue;
            const exp = (v && typeof v === 'object' && '$in' in (v as any)) ? (v as any).$in : v;
            if (Array.isArray(exp)) { if (!exp.includes(row[k])) return false; }
            else if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const run = (o: string, ast: any) => {
        let rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
        if (Array.isArray(ast?.orderBy) && ast.orderBy.length > 0) {
            rows = [...rows].sort((a: any, b: any) => {
                for (const { field, order } of ast.orderBy) {
                    const cmp = String(a?.[field] ?? '').localeCompare(String(b?.[field] ?? ''));
                    if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
                }
                return 0;
            });
        }
        return typeof ast?.limit === 'number' && ast.limit > 0 ? rows.slice(0, ast.limit) : rows;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { finds.push(ast); return run(o, ast); },
        async findOne(o: string, ast: any) { finds.push(ast); return run(o, ast)[0] ?? null; },
        async create(o: string, data: any) { nextId += 1; const id = data.id ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row; },
        async update(o: string, id: string, data: any) { const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error('nf'); const up = { ...cur, ...data, id }; s.set(id, up); return up; },
        async updateMany(o: string, ast: any, data: any) { let n = 0; for (const [id, row] of storeFor(o)) { if (!matches(row, ast?.where)) continue; storeFor(o).set(id, { ...row, ...data, id }); n += 1; } return n; },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async deleteMany(o: string, ast: any) { let n = 0; for (const [id, row] of [...storeFor(o)]) { if (!matches(row, ast?.where)) continue; storeFor(o).delete(id); n += 1; } return n; },
        async count(o: string, ast: any) { return run(o, ast).length; },
        async aggregate(o: string, ast: any) { return [{ n: run(o, ast).length }]; },
        async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores, finds };
}

describe('unknown engine option keys are rejected (#4371 option 2)', () => {
    let engine: ObjectQL;
    let finds: any[];
    let a: any;

    beforeEach(async () => {
        engine = new ObjectQL();
        const mem = makeDriver();
        finds = mem.finds;
        engine.registerDriver(mem.driver, true);
        await engine.init();
        engine.registry.registerObject(task);
        engine.registry.registerObject(person);
        await engine.insert('person', { id: 'p1', name: 'P' });
        a = await engine.insert('task', { title: 'A', status: 'open', owner: 'p1' });
        await engine.insert('task', { title: 'B', status: 'done', owner: 'p1' });
        finds.length = 0;
    });

    // ── each method refuses a key it does not execute ───────────────────

    it.each([
        ['find', () => engine.find('task', { bogus: 1 } as any)],
        ['findOne', () => engine.findOne('task', { bogus: 1 } as any)],
        ['update', () => engine.update('task', { title: 'Z' }, { where: { id: 'x' }, bogus: 1 } as any)],
        ['delete', () => engine.delete('task', { where: { id: 'x' }, bogus: 1 } as any)],
        ['count', () => engine.count('task', { bogus: 1 } as any)],
        ['aggregate', () => engine.aggregate('task', { aggregations: [{ function: 'count', alias: 'n' }], bogus: 1 } as any)],
    ])('%s rejects an unknown option, naming the legal set', async (method, call) => {
        await expect(call()).rejects.toThrow(
            new RegExp(`${method}\\('task'\\) does not recognise option 'bogus'.*Legal keys for ${method}:`, 's'),
        );
    });

    it('a typo like `orderby` is caught, not silently unsorted', async () => {
        await expect(engine.find('task', { orderby: [{ field: 'title', order: 'asc' }] } as any))
            .rejects.toThrow(/'orderby'/);
        expect(finds).toHaveLength(0);
    });

    it('several unknown keys are reported in ONE rejection', async () => {
        await expect(engine.find('task', { bogus: 1, extra: 2 } as any))
            .rejects.toThrow(/options 'bogus'; 'extra'/);
    });

    // ── retired keys quote their tombstone ──────────────────────────────

    it.each(['cursor', 'distinct'])('%s is rejected with its #4286 tombstone', async (key) => {
        await expect(engine.find('task', { [key]: 'x' } as any))
            .rejects.toThrow(/#4286, ADR-0049/);
    });

    // ── null stays a withdrawal ─────────────────────────────────────────

    it('a null-valued unknown key is a withdrawal, not a rejection', async () => {
        const rows = await engine.find('task', { bogus: null } as any);
        expect(rows).toHaveLength(2);
    });

    // ── the documented extras stay legal where they work ────────────────

    it('driver pass-through keys (tenantId, bypassTenantAudit) pass on find/update/delete', async () => {
        await engine.find('task', { tenantId: 't1', bypassTenantAudit: true } as any);
        await engine.update('task', { title: 'A2' }, { where: { id: a.id }, tenantId: 't1' } as any);
        await engine.delete('task', { where: { id: a.id }, bypassTenantAudit: true } as any);
    });

    it.each([
        ['count', () => engine.count('task', { tenantId: 't1' } as any)],
        ['aggregate', () => engine.aggregate('task', { aggregations: [{ function: 'count', alias: 'n' }], tenantId: 't1' } as any)],
    ])('%s rejects driver pass-through keys — its bag never reaches the driver options', async (_m, call) => {
        await expect(call()).rejects.toThrow(/'tenantId'/);
    });

    it('onFieldsDropped passes on update (contract-declared write observability)', async () => {
        await engine.update('task', { title: 'A3' }, { where: { id: a.id }, onFieldsDropped: () => {} } as any);
    });

    it('searchFields passes on find (read by the $search expansion)', async () => {
        // Legality pin only — the $or/$contains expansion itself is covered by
        // the search-filter tests; this mock driver does not evaluate it.
        await expect(engine.find('task', { search: 'A', searchFields: ['title'] } as any))
            .resolves.toBeDefined();
    });

    it('the OData spellings $search/$searchFields are unknown keys — wire-only, protocol folds them', async () => {
        await expect(engine.find('task', { $search: 'A' } as any)).rejects.toThrow(/'\$search'/);
    });

    it('a stray `object` key is refused — it used to OVERRIDE the resolved object on the AST', async () => {
        await expect(engine.find('task', { object: 'person' } as any)).rejects.toThrow(/'object'/);
        expect(finds).toHaveLength(0);
    });

    // ── expand nested ASTs reject wire spellings too ────────────────────

    it("expand: { owner: { sort } } is refused — nested wire spellings were silently dropped", async () => {
        await expect(
            engine.find('task', { expand: { owner: { object: 'person', sort: { name: 'asc' } } } } as any),
        ).rejects.toThrow(/expand\['owner'\] on 'task' does not accept 'sort'.*Pass 'orderBy'/s);
    });

    it('expand with canonical nested keys works', async () => {
        const rows = await engine.find('task', {
            where: { id: a.id },
            expand: { owner: { object: 'person', fields: ['id', 'name'] } },
        } as any);
        expect(rows[0].owner).toMatchObject({ id: 'p1', name: 'P' });
    });

    // ── drift pin: legal sets stay glued to the spec schemas ────────────

    it('each legal set covers its schema shape (minus tombstones) and only the documented extras', () => {
        const TOMBSTONES = new Set(['cursor', 'distinct']);
        const PASSTHROUGH = ['transaction', 'tenantId', 'tenantIds', 'timezone', 'bypassTenantAudit', 'preserveAudit'];
        const expectSetMatches = (
            setName: string,
            schema: { shape: Record<string, unknown> },
            extras: string[],
        ) => {
            const legal = ENGINE_OPTION_KEY_SETS[setName];
            const schemaKeys = Object.keys(schema.shape).filter((k) => !TOMBSTONES.has(k));
            for (const k of schemaKeys) {
                // `top` folds into `limit` before the gate and never reaches it.
                if (k === 'top') continue;
                expect(legal.has(k), `${setName} must accept schema key '${k}'`).toBe(true);
            }
            const documented = new Set([...schemaKeys, ...extras]);
            for (const k of legal) {
                expect(documented.has(k), `${setName} accepts '${k}' which neither the schema nor the documented extras declare`).toBe(true);
            }
        };
        expectSetMatches('find', EngineQueryOptionsSchema as any, PASSTHROUGH);
        expectSetMatches('findOne', EngineQueryOptionsSchema as any, PASSTHROUGH);
        // [#5126] `strictReadonlyWrites` joins `onFieldsDropped` as a
        // documented extra for the same structural reason — both are
        // `WriteObservabilityOptions` members that deliberately do NOT appear
        // in the serializable bag, so the schema cannot vouch for them and
        // this list must. Spelling it here is what keeps the engine from
        // rejecting a key the TS contract declares.
        expectSetMatches('update', EngineUpdateOptionsSchema as any, ['onFieldsDropped', 'strictReadonlyWrites', ...PASSTHROUGH]);
        expectSetMatches('delete', EngineDeleteOptionsSchema as any, PASSTHROUGH);
        expectSetMatches('count', EngineCountOptionsSchema as any, []);
        expectSetMatches('aggregate', EngineAggregateOptionsSchema as any, []);
    });
});
