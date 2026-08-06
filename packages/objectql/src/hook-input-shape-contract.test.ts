// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5273] The `HookContext.input` shape table in `packages/spec` is TRUE of
 * this engine.
 *
 * `packages/spec/src/data/hook.zod.ts` documents, per operation, the exact
 * `input` a handler receives. That table is the whole contract: `input` itself
 * is `z.record(z.string(), z.unknown())` — an open shape by design, so Zod
 * validates NOTHING about which keys are present, and the prose is the only
 * thing an author (human or AI) can read to learn what to reach for. Which is
 * why it drifted silently: three keys it named had no producer left.
 *
 *   - `update (bulk)` / `delete (bulk)` were documented as carrying
 *     `{ ast: QueryAST, ... }`, with the table repeating below it that "the
 *     row-scoping predicate is carried in `input.ast`". The engine has never
 *     put an AST on a WRITE context: the bulk predicate lives on the internal
 *     `OperationContext.ast` (#2982) precisely so middleware-composed row
 *     filters bind the driver call where no handler can widen them. So the one
 *     field the docs pointed at resolved `undefined`.
 *   - `insert` was documented as `{ doc: Record, ... }`; the engine builds
 *     `{ data: row, ... }`. (`trigger-record-change` still carries a defensive
 *     `input.doc` alias read for that reason — filed separately, not fixed
 *     here.)
 *
 * The table was also silent about #5038: since ADR-0058's bulk-write addendum
 * the `after*` events on a bulk write fire PER MATCHED ROW on a
 * single-record-shaped context, so `input.id` — documented as absent on bulk
 * writes — is in fact bound on every after-event a bulk write dispatches.
 *
 * ## Why this file lives in objectql
 *
 * The defect is in spec's prose, but prose is unassertable and `packages/spec`
 * cannot execute a hook dispatch: objectql depends on spec, so a spec-side
 * test importing the engine would invert the dependency. The FACTS the prose
 * claims are pinned here instead, next to the engine that produces them and
 * next to #5038's own `bulk-write-per-row-hooks.test.ts`.
 *
 * ## Reading the assertions
 *
 * Hooks are registered with `engine.registerHook` — the RAW context, so what
 * is asserted is what the engine constructs, not a view of it. The declarative
 * (metadata `Hook`) path additionally wraps `ctx.input` in the flat-input
 * proxy of `hook-wrappers.ts`; the last describe pins that an author on THAT
 * path sees the same answer, since the false `input.ast` sentence was aimed at
 * exactly those authors.
 *
 * `beforeFind` is the POSITIVE CONTROL (#4865): it really does carry
 * `input.ast`, so "no `ast` on the write paths" is a measurement, not an
 * assertion that would pass against an engine that had stopped setting `ast`
 * anywhere at all.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
};
const taskObject = { name: 'task', label: 'Task', fields: TASK_FIELDS };

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The row-scoping predicate is NOT on `input` (the deleted claim)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5273] a bulk write carries no `ast` on `input`', () => {
  it('POSITIVE CONTROL — a read DOES carry `input.ast`', async () => {
    // Without this, every "no ast" assertion below would also pass against an
    // engine that had stopped building read contexts correctly.
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeFind', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    // No `as any` on the options: `find(object, query?: EngineQueryOptions)`
    // already infers an empty query, and erasing it would add a site to the
    // #4918 query-options ratchet (`check:query-options-erasure`) for no gain —
    // this call is in-contract, not a deliberate off-contract probe.
    await engine.find('task', {});

    expect(seen).toHaveLength(1);
    expect('ast' in seen[0]!).toBe(true);
    expect(seen[0]!.ast).toBeDefined();
  });

  it('`beforeUpdate` on a bulk write has no `ast` key', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeUpdate', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(1); // before* fires ONCE for the whole batch
    expect('ast' in seen[0]!).toBe(false);
    expect(seen[0]!.ast).toBeUndefined();
  });

  it('`beforeDelete` on a bulk write has no `ast` key', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeDelete', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.delete('task', { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(1);
    expect('ast' in seen[0]!).toBe(false);
    expect(seen[0]!.ast).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. `input.id` — present-but-undefined on the batch, bound per row after
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5273] `input.id` on a bulk write', () => {
  it('`beforeUpdate` leaves `id` undefined (the key exists; nothing binds it)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeUpdate', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    // The engine builds `{ id, data, options }` with the shorthand `id`, so the
    // KEY is there while the value is not. Documented as `{ id: undefined, … }`
    // rather than "no id" because `'id' in input` answers true.
    expect('id' in seen[0]!).toBe(true);
    expect(seen[0]!.id).toBeUndefined();
    expect(seen[0]!.data).toEqual({ status: 'done' });
    expect(seen[0]!.options).toBeDefined();
  });

  it('`afterUpdate` fires per matched row, each naming its own `id`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('afterUpdate', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    const rows = await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(2);
    expect(seen.map((i) => i.id).sort()).toEqual(rows.map((r) => r.id).sort());
    // Single-record shape: the payload rides along, exactly as on a single-id
    // write, so a handler needs no bulk-aware branch.
    for (const input of seen) expect(input.data).toEqual({ status: 'done' });
  });

  it('`afterDelete` fires per matched row, each naming its own `id`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('afterDelete', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    const rows = await seedTasks(engine, [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }]);
    await engine.delete('task', { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(2);
    expect(seen.map((i) => i.id).sort()).toEqual(rows.map((r) => r.id).sort());
    // A delete has no post-state, so no payload rides along.
    for (const input of seen) expect('data' in input).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The rest of the table, so the whole thing is measured and not just the
 *    two rows #5273 named
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5273] the single-record rows of the table', () => {
  it('insert carries `data` — never `doc`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeInsert', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    await engine.insert('task', { title: 'a', status: 'todo' } as any);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.data).toMatchObject({ title: 'a', status: 'todo' });
    expect('doc' in seen[0]!).toBe(false);
  });

  it('a batch insert builds ONE context per row (#2922)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeInsert', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    await engine.insert('task', [{ title: 'a' }, { title: 'b' }] as any);

    expect(seen).toHaveLength(2);
    expect(seen.map((i) => (i.data as any).title)).toEqual(['a', 'b']);
  });

  it('a single-id update binds `id` and `data`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeUpdate', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    const [row] = await seedTasks(engine, [{ title: 'a', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { where: { id: row.id } } as any);

    expect(seen[0]!.id).toBe(row.id);
    expect(seen[0]!.data).toEqual({ status: 'done' });
    expect('ast' in seen[0]!).toBe(false);
  });

  it('a single-id delete binds `id` and carries no `data`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { engine } = await boot();
    engine.registerHook('beforeDelete', async (ctx: any) => { seen.push(ctx.input); }, { object: 'task' });

    const [row] = await seedTasks(engine, [{ title: 'a', status: 'todo' }]);
    await engine.delete('task', { where: { id: row.id } } as any);

    expect(seen[0]!.id).toBe(row.id);
    expect('data' in seen[0]!).toBe(false);
    expect('ast' in seen[0]!).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The declarative path sees the same answer
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5273] a metadata-declared hook reads the same shape', () => {
  it('`ctx.input.ast` is undefined on a bulk update through the flat-input proxy', async () => {
    // The deleted sentence told THIS author to read `input.ast`. The proxy
    // passes `ast` through to the wrapper rather than folding it into `data`,
    // so the read is faithful — there is simply nothing behind it on a write.
    const seen: unknown[] = [];
    const { engine } = await boot();
    bindHooksToEngine(
      engine,
      [{
        name: 'reads_ast', object: 'task', events: ['beforeUpdate'], priority: 100,
        handler: (ctx: HookContext) => { seen.push((ctx.input as any).ast); },
      } as unknown as Hook],
      { packageId: 'app:test', logger: silentLogger },
    );

    await seedTasks(engine, [{ title: 'a', status: 'todo' }]);
    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toEqual([undefined]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Harness — a stub driver just wide enough for the dispatch paths above.
 * ──────────────────────────────────────────────────────────────────────────── */

async function seedTasks(engine: ObjectQL, rows: Record<string, unknown>[]): Promise<any[]> {
  const written = await engine.insert('task', rows as any);
  return Array.isArray(written) ? written : [written];
}

function makeStubDriver(): any {
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
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; s.set(id, u); return u;
    },
    async upsert(o: string, data: any) { const id = data.id; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

async function boot(): Promise<{ engine: ObjectQL; driver: any }> {
  const engine = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(taskObject as any);
  return { engine, driver };
}
