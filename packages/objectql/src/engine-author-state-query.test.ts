// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6300 — `find`/`findOne` take the AUTHOR state (`z.input`), and the engine
 * fills the defaults the schemas declare before the AST leaves it.
 *
 * ADR-0122's core argument is "the first key an author writes must default
 * correctly". `engine.find(obj, { orderBy: [{ field: 'updated_at' }] })` is
 * the natural spelling of "newest-ish first" — and until this card it did not
 * compile: #6083 pinned `find`/`findOne` back to `EngineQueryOptionsParsed`
 * (`z.infer`) because the engine built its `QueryAST` by bare spread and
 * filled no default, so admitting the author state would have sent
 * `order: undefined` to the driver.
 *
 * The measured driver-side status quo (part of #6300's own premise): every
 * driver coalesces a missing `order` to `'asc'` — `sql-driver.ts`
 * (`s.order || 'asc'`), `memory-driver.ts`, `mongodb-driver.ts`,
 * `mongodb-aggregation.ts`, `remote-transport.ts`. So the filled `'asc'`
 * changes no query's answer; what changes is that the AST now SAYS it, which
 * is what these pins hold:
 *
 *  1. the author-state calls in this file COMPILE WITHOUT A CAST — that is
 *     the contract flip itself, pinned by `tsc`;
 *  2. the driver receives `order: 'asc'`, not `undefined` — the engine fills
 *     the default rather than delegating it to per-driver tolerance;
 *  3. direction is right: defaulted ≡ explicit `'asc'`, ≢ explicit `'desc'`;
 *  4. the strictness the schema declares comes with its defaulting parse: a
 *     type-bypassing malformed sort node is refused with the schema's own
 *     prescription instead of being silently dropped-or-honored per driver
 *     (#4721's defect class, already refused on the wire path).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const account = {
    name: 'crm_account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
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

interface SeenRead { object: string; ast: any }

/** Memory driver recording the AST of every read (same shape as the #4419 suite's). */
function makeRecordingDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const reads: SeenRead[] = [];
    let nextId = 0;
    const matches = (row: any, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and') return (v as any[]).every((w) => matches(row, w));
            if (k === '$or') return (v as any[]).some((w) => matches(row, w));
            if (k.startsWith('$')) continue;
            if (v && typeof v === 'object' && '$in' in (v as any)) {
                if (!(v as any).$in.map(String).includes(String(row[k]))) return false;
                continue;
            }
            if (v && typeof v === 'object' && '$contains' in (v as any)) {
                const needle = String((v as any).$contains).toLowerCase();
                if (!String(row[k] ?? '').toLowerCase().includes(needle)) return false;
                continue;
            }
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
        return typeof ast?.limit === 'number' && ast.limit > 0 ? rows.slice(0, ast.limit) : rows;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { reads.push({ object: o, ast }); return run(o, ast); },
        async findOne(o: string, ast: any) { reads.push({ object: o, ast }); return run(o, ast)[0] ?? null; },
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
    return { driver, reads };
}

describe('find/findOne accept the author state and the engine fills the declared defaults (#6300)', () => {
    let engine: ObjectQL;
    let reads: SeenRead[];

    beforeEach(async () => {
        engine = new ObjectQL();
        const mem = makeRecordingDriver();
        reads = mem.reads;
        engine.registerDriver(mem.driver, true);
        await engine.init();
        engine.registry.registerObject(account);
        engine.registry.registerObject(person);
        const alice = await engine.insert('person', { name: 'Alice' });
        const bob = await engine.insert('person', { name: 'Bob' });
        // Names chosen so ascending ≠ descending ≠ insertion order.
        await engine.insert('crm_account', { name: 'Beta', owner: bob.id });
        await engine.insert('crm_account', { name: 'Alpha', owner: alice.id });
        await engine.insert('crm_account', { name: 'Gamma', owner: alice.id });
        reads.length = 0;
    });

    // ── (1) The contract flip, pinned by the compiler ────────────────────────
    // Every call in this block is UNCAST. Under #6083's `...Parsed` parameter
    // none of them compiled — `orderBy[].order` was required to write. The
    // `IDataEngine`-typed alias pins the spec contract, not just the class.

    it('an orderBy without `order` compiles against IDataEngine and sorts ascending', async () => {
        const dataEngine: IDataEngine = engine;
        const rows = await dataEngine.find('crm_account', { orderBy: [{ field: 'name' }] });
        expect(rows.map((r: any) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('an object-form `search` without the flag keys compiles uncast and matches', async () => {
        // `EngineQueryOptionsParsed['search']` required `fuzzy`/`operator`/
        // `highlight` (parse-time defaults); the author state makes them
        // optional — which is the truth, since no executor reads them (#4286).
        const dataEngine: IDataEngine = engine;
        const rows = await dataEngine.find('crm_account', { search: { query: 'Beta' } });
        expect(rows.map((r: any) => r.name)).toEqual(['Beta']);
    });

    // ── (2) The engine fills the default — `undefined` stops reaching drivers ─

    it("the driver receives order: 'asc', not undefined", async () => {
        await engine.find('crm_account', { orderBy: [{ field: 'name' }] });
        const { ast } = reads.at(-1)!;
        expect(ast.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
    });

    it('a nested expand query is the same authoring surface, filled on its own read', async () => {
        await engine.find('crm_account', {
            where: { name: 'Alpha' },
            expand: { owner: { object: 'person', orderBy: [{ field: 'name' }] } },
        });
        const personRead = reads.find((r) => r.object === 'person');
        expect(personRead).toBeTruthy();
        expect(personRead!.ast.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
    });

    // ── (3) Direction, predicted first ───────────────────────────────────────
    // Prediction (written before execution): the defaulted spelling behaves as
    // the schema's declared `'asc'` — identical to explicit-asc, and the exact
    // reverse of explicit-desc on this tie-free fixture.

    it("defaulted ≡ explicit 'asc', ≢ explicit 'desc'", async () => {
        const defaulted = await engine.find('crm_account', { orderBy: [{ field: 'name' }] });
        const explicitAsc = await engine.find('crm_account', { orderBy: [{ field: 'name', order: 'asc' }] });
        const explicitDesc = await engine.find('crm_account', { orderBy: [{ field: 'name', order: 'desc' }] });
        expect(defaulted.map((r: any) => r.name)).toEqual(explicitAsc.map((r: any) => r.name));
        expect(defaulted.map((r: any) => r.name)).toEqual([...explicitDesc.map((r: any) => r.name)].reverse());
        expect(explicitDesc.map((r: any) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    });

    it('findOne: an order-less orderBy is a legal #4419 predicate and answers the FIRST-ascending row', async () => {
        const dataEngine: IDataEngine = engine;
        const row = await dataEngine.findOne('crm_account', { orderBy: [{ field: 'name' }] });
        expect(row?.name).toBe('Alpha');
        const { ast } = reads.at(-1)!;
        expect(ast.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
        expect(ast.limit).toBe(1);
    });

    // ── (4) The schema's strictness rides with its defaulting parse ──────────
    // These callers bypass the type (`as unknown as EngineQueryOptions` — the
    // #4918 spelling for a DELIBERATELY off-contract probe), which is the only
    // way these shapes can occur. Before #6300 the engine forwarded them
    // verbatim and each driver decided alone: memory honored `direction`,
    // SQL/Mongo silently dropped it and sorted ascending — one query, two
    // orders (#4721's class).

    it("the retired `direction` spelling is refused with the schema's rename prescription", async () => {
        const offContract = { orderBy: [{ field: 'name', direction: 'desc' }] } as unknown as EngineQueryOptions;
        await expect(engine.find('crm_account', offContract)).rejects.toThrow(/order/);
    });

    it('an unknown sort-node key is refused by name, not silently dropped', async () => {
        const offContract = { orderBy: [{ field: 'name', frobnicate: true }] } as unknown as EngineQueryOptions;
        await expect(engine.find('crm_account', offContract)).rejects.toThrow(/frobnicate/);
    });

    it('an explicit `order` is never clobbered by the fill', async () => {
        const rows = await engine.find('crm_account', { orderBy: [{ field: 'name', order: 'desc' }] });
        expect(rows.map((r: any) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
        const { ast } = reads.at(-1)!;
        expect(ast.orderBy).toEqual([{ field: 'name', order: 'desc' }]);
    });
});
