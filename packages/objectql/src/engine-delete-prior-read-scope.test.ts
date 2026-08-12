// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5929] `delete()`'s prior-row read is demanded PER OBJECT — and on a
 * kernel-hosted engine that demand is finally answerable.
 *
 * ## The defect
 *
 * The gate has asked per object since #5272:
 *
 *   `hasHooksFor('beforeDelete', object) || hasHooksFor('afterDelete', object)
 *    || getSummaryDescriptors(object).length > 0`
 *
 * and on any kernel it was CONSTANT TRUE, because `ObjectQLPlugin` registered a
 * builtin of its own — `sys_fetch_previous_delete`, `object: '*'`, priority 5,
 * `beforeDelete` — which made the first term true for every object that has
 * ever existed. The per-object skip the gate exists to perform therefore never
 * happened on a real deployment, only on the bare `new ObjectQL()` engines the
 * unit tests boot.
 *
 * The builtin could not even use what it held open. #5272 made the engine read
 * the pre-image and bind `previous` BEFORE dispatching `beforeDelete` (#6697
 * extended the same ordering to the predicate path, per matched row), so the
 * builtin's own `if (input.id && !ctx.previous)` guard was permanently false and
 * it issued no read. Circular: its only remaining effect was holding open the
 * gate that made it redundant. Retired under ADR-0049 enforce-or-remove.
 *
 * ## What this file pins, and why it needed a KERNEL to pin it
 *
 * Sections 1–3 run on a bare engine and pin the gate's three terms, the
 * `excludeObjects` subtraction, and the direction the gate is allowed to be
 * wrong in (looser, never tighter). They would have passed before the
 * retirement too — a bare engine never carried the builtin.
 *
 * Section 4 is the regression pin proper, and it boots a real `ObjectKernel`
 * with `ObjectQLPlugin`, because that is the only configuration in which the
 * defect was ever observable. `expect(reads).toBe(0)` there was `1` before this
 * change.
 *
 * Section 5 replays the retired builtin's own shape as an authored hook and
 * measures its guard short-circuiting, so "the guard can no longer be true"
 * stays a measurement rather than a claim that rots. It is the delete-side twin
 * of the case #5846 left in `engine-update-prior-read-scope.test.ts`.
 *
 * ## ⚠️ AMENDED BY #7867 — the by-id READ-SKIP half is retired
 *
 * This card's subject splits in two, and only one half survives:
 *
 *   - **The DISPATCH half stands, untouched.** `hasHooksFor` still answers per
 *     object, `hookMatchesObject` still subtracts `excludeObjects`, an excluded
 *     object still dispatches nothing, and `sys_fetch_previous_delete` is still
 *     retired and must not come back. Those are what #5929 was actually about,
 *     and every case pinning them is unchanged below.
 *
 *   - **The by-id READ-SKIP half is gone.** A by-id delete now reads its
 *     pre-image UNCONDITIONALLY, because #7867 added the not-found gate the
 *     path never had — a delete against an id naming no row must answer
 *     `RECORD_NOT_FOUND` instead of reporting success for a row that was never
 *     there (#5138's record names `delete` as the worst of the three when this
 *     gate was missing). Existence is a consumer the three-term demand never
 *     enumerated and the one consumer EVERY by-id delete has, and no cheaper
 *     question answers it — so the skip and the gate are mutually exclusive.
 *
 * The cases below that measured the SKIP now measure the READ, each saying so
 * at its own site. What that costs is small for the reason section 4's own
 * prose gives from the other side: on any kernel loading the global delete-side
 * registrants (plugin-sharing, service-storage, plugin-auth), term 1 or 2 was
 * true for every object anyway. The PREDICATE path (section 3) keeps its gate
 * in full — a bulk delete matching zero rows is legitimately "0 rows affected",
 * not a missing record.
 */

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook, ObjectSchema } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
};

/** Two plain objects, neither declaring anything that needs a prior row. */
const taskA = { name: 'del_scope_a', label: 'A', fields: TASK_FIELDS };
const taskB = { name: 'del_scope_b', label: 'B', fields: TASK_FIELDS };

/**
 * Declares a `readonlyWhen` field, so `needsPriorRecord(schema)` is true for it
 * — the term this gate deliberately does NOT carry (section 1's last case).
 */
const lockedTask = {
  name: 'del_scope_locked',
  label: 'Locked',
  fields: {
    ...TASK_FIELDS,
    title: {
      name: 'title', label: 'Title', type: 'text' as const,
      readonlyWhen: 'record.done == true',
    },
  },
};

/** Parent/child pair for the roll-up demand. */
const invoice = {
  name: 'del_scope_invoice',
  label: 'Invoice',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    line_total: {
      name: 'line_total', label: 'Total', type: 'summary' as const,
      summaryOperations: { object: 'del_scope_invoice_line', field: 'amount', function: 'sum' },
    },
  },
};
const invoiceLine = {
  name: 'del_scope_invoice_line',
  label: 'Line',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    invoice: { name: 'invoice', label: 'Invoice', type: 'master_detail' as const, reference: 'del_scope_invoice' },
  },
};

/**
 * A driver that counts every read PER OBJECT, so "pays no prior read" is a
 * measurement rather than an assertion about the code that was written.
 *
 * Per object because a delete legitimately reads OTHER objects — the roll-up
 * recompute aggregates the child set, `cascadeDeleteRelations` looks for
 * dependants. Counting only the total would conflate those with the pre-image
 * read this file is about.
 */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const reads = { findOne: 0, find: 0, findOneOn: {} as Record<string, number>, findOn: {} as Record<string, number> };
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matchesWhere(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'del-counting', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(object: string, ast: any) {
      reads.find += 1;
      reads.findOn[object] = (reads.findOn[object] ?? 0) + 1;
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      reads.findOne += 1;
      reads.findOneOn[object] = (reads.findOneOn[object] ?? 0) + 1;
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
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
      // Same reason as the bulk verbs below: a test's own `count()` assertion
      // must not inflate the read counters it is asserting alongside.
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    // ⚠️ The bulk verbs resolve their own row set WITHOUT going through
    // `find()`. Routing them through it would charge the engine for a read the
    // engine never issued — and this file's whole subject is read COUNTS, so a
    // driver-internal read masquerading as an engine one would make every
    // predicate-path number one too high.
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      for (const r of rows) storeFor(object).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, storeFor };
}

async function boot(hooks: Hook[] = [], objects: unknown[] = [taskA, taskB]) {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as any);
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, {
      packageId: 'app:del-scope',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
  }
  return { engine, reads: stub.reads, storeFor: stub.storeFor };
}

const observer = (
  name: string, object: string, event: string, sink: Array<unknown>, extra: Record<string, unknown> = {},
): Hook => ({
  name, object, events: [event], priority: 90,
  handler: (ctx: any) => { sink.push(ctx.previous); },
  ...extra,
} as unknown as Hook);

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The three terms, asked PER OBJECT
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5929] the delete-side prior-row demand is asked per object', () => {
  it('[#7867] object A pays the prior read too — the by-id read is no longer the gate\'s to skip', async () => {
    // ⚠️ Asserted 0 until #7867. The DISPATCH question this file is about is
    // unchanged (nothing fires on A), but the by-id READ is now unconditional:
    // the not-found gate has to know whether the row is there, and that is the
    // one demand no hook registration can express. The dispatch half is pinned
    // by the `previous`-observing cases below, which are untouched.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([observer('audits_b', 'del_scope_b', 'afterDelete', seen)]);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
    // …and B's hook still did not fire for A's delete — the per-object dispatch
    // question, which is what #5929 was actually about, is intact.
    expect(seen).toEqual([]);
    // The row really went — the added read must not have cost the write.
    expect(await engine.count('del_scope_a', {})).toBe(0);
  });

  it('[#7867] a by-id delete against an id that names no row is refused — RECORD_NOT_FOUND', async () => {
    // What the unconditional read buys. #5138's own record: with no gate "the
    // delete ran and the answer was 200 { deleted: true } for any string in the
    // path, so a typo'd id, an already-deleted row and a real deletion were
    // indistinguishable". That was still live on this path — the one an action
    // body's `.delete()` takes — until this card.
    const fired: Array<unknown> = [];
    const { engine } = await boot([observer('pre_a', 'del_scope_a', 'beforeDelete', fired)]);

    const err: any = await engine
      .delete('del_scope_a', { where: { id: 'never_existed' } } as any)
      .then(() => null, (e) => e);

    expect(err, 'a ghost id must be refused, not reported as a deletion').not.toBeNull();
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    // Refused before the before phase — no handler runs for a row that is not
    // there, and no cascade touches a dependent of a parent that never existed.
    expect(fired).toEqual([]);
  });

  it('the object that DOES have the afterDelete hook pays it, and `previous` is the stored row', async () => {
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([observer('audits_b', 'del_scope_b', 'afterDelete', seen)]);

    const row: any = await engine.insert('del_scope_b', { title: 'B', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_b'] ?? 0;
    await engine.delete('del_scope_b', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_b'] ?? 0) - before).toBe(1);
    expect(seen).toEqual([{ id: row.id, title: 'B', status: 'todo', done: false }]);
  });

  it('a `beforeDelete` hook holds the gate open ALONE, and reads the row it opened it for', async () => {
    // Term 1 on its own, with nothing hooking the after phase. This is the term
    // the retired builtin used to satisfy for every object at once; it has to
    // still work when a REAL hook satisfies it, or the retirement would have
    // taken a live demand with it.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([observer('pre_a', 'del_scope_a', 'beforeDelete', seen)]);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
    expect(seen).toEqual([{ id: row.id, title: 'A', status: 'todo', done: false }]);
  });

  it('a hook registered for `*` still demands the read on every object', async () => {
    // The direction that matters: `hasHooksFor` mirrors `triggerHooks`' own
    // filter, so an entry targeting `'*'` DOES reach this object. Getting the
    // gate looser than dispatch costs a query; getting it TIGHTER would drop
    // hooks that were going to fire. The retirement removed a `'*'` entry from
    // the KERNEL — it did not narrow what `'*'` means.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([{
      name: 'audits_everything', object: '*', events: ['beforeDelete'], priority: 90,
      handler: (ctx: any) => { seen.push(ctx.previous); },
    } as unknown as Hook]);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
    expect(seen).toEqual([{ id: row.id, title: 'A', status: 'todo', done: false }]);
  });

  it('a roll-up summary alone forces the read, with no hooks registered anywhere', async () => {
    // Term 3. `recomputeSummaries` reads the doomed row's FK to find the parent
    // to recompute, so a deployment with no delete hook at all still owes this
    // read — and the parent must actually come back down.
    const { engine, reads, storeFor } = await boot([], [invoice, invoiceLine]);

    const parent: any = await engine.insert('del_scope_invoice', { name: 'INV-1' });
    const line: any = await engine.insert('del_scope_invoice_line', { invoice: parent.id, amount: 40 });
    expect(storeFor('del_scope_invoice').get(parent.id)?.line_total).toBe(40);

    const before = reads.findOneOn['del_scope_invoice_line'] ?? 0;
    await engine.delete('del_scope_invoice_line', { where: { id: line.id } } as any);

    expect((reads.findOneOn['del_scope_invoice_line'] ?? 0) - before).toBe(1);
    expect(storeFor('del_scope_invoice').get(parent.id)?.line_total).toBe(0);
  });

  it('`needsPriorRecord` is still NOT a term — a readonlyWhen object owes the read for EXISTENCE, not for rules', async () => {
    // The asymmetry with `update()`'s twin gate survives #7867 and is worth
    // keeping stated, because the read count no longer distinguishes it: this
    // object now pays 1 like every other by-id delete. What is pinned here is
    // the REASON — `delete()` evaluates no validation rules and no field
    // predicates, so `needsPriorRecord` would still buy nothing if it were
    // added; the read is owed to the not-found gate alone. Adding the term back
    // would be adding a second, redundant justification for a read that already
    // happens, which is how a gate acquires a term nobody can retire.
    const { engine, reads } = await boot([], [lockedTask]);

    const row: any = await engine.insert('del_scope_locked', { title: 'Ship it', status: 'done', done: true });
    const before = reads.findOneOn['del_scope_locked'] ?? 0;
    await engine.delete('del_scope_locked', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_locked'] ?? 0) - before).toBe(1);
    expect(await engine.count('del_scope_locked', {})).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. `excludeObjects` — the registration face that actually narrows the gate
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5929 / #5860] the gate honours `excludeObjects` on both delete phases', () => {
  /**
   * plugin-audit's delivered registration face (#5860), replayed here rather
   * than imported: `@objectstack/objectql` cannot depend on a plugin that
   * depends on it. What is pinned is the ENGINE's half — `hookMatchesObject`'s
   * subtract step reaching `hasHooksFor`, hence reaching this read.
   *
   * ⚠️ `registerHook` directly, NOT `bindHooksToEngine`: the binder refuses a
   * hook whose `object` is absent or empty rather than widening it to `'*'`
   * (#4001), so the global-minus-exclusions face is only expressible on the
   * engine's own registration API — which is exactly the API plugin-audit uses.
   */
  const registerGlobalDeleteHook = (
    engine: ObjectQL, event: string, sink: unknown[], excludeObjects: string[],
  ): void => {
    (engine as any).registerHook(event, (ctx: any) => { sink.push(ctx.object); }, {
      excludeObjects, packageId: 'app:del-audit-face', priority: 90,
    });
  };

  it('[#7867] an EXCLUDED object does not DISPATCH — it still pays the by-id existence read', async () => {
    // ⚠️ The read half of this case asserted 0 until #7867; the DISPATCH half
    // is the one #5860/#5929 are about and it is unchanged. They no longer move
    // together on the by-id path, and that is the point rather than a
    // regression: `hookMatchesObject` still decides who fires, but it no longer
    // decides whether the engine looks — the not-found gate does, for every
    // by-id delete, excluded or not.
    const fired: unknown[] = [];
    const { engine, reads } = await boot();
    registerGlobalDeleteHook(engine, 'beforeDelete', fired, ['del_scope_a']);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
    expect(fired).toEqual([]);
  });

  it('a NON-excluded object still pays it and still dispatches', async () => {
    const fired: unknown[] = [];
    const { engine, reads } = await boot();
    registerGlobalDeleteHook(engine, 'beforeDelete', fired, ['del_scope_a']);

    const row: any = await engine.insert('del_scope_b', { title: 'B', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_b'] ?? 0;
    await engine.delete('del_scope_b', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_b'] ?? 0) - before).toBe(1);
    expect(fired).toEqual(['del_scope_b']);
  });

  it('the after phase subtracts the same way', async () => {
    const fired: unknown[] = [];
    const { engine, reads } = await boot();
    registerGlobalDeleteHook(engine, 'afterDelete', fired, ['del_scope_a']);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    // [#7867] The dispatch subtraction is the assertion; the read is the
    // unconditional by-id existence read, same as the before-phase case above.
    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
    expect(fired).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The bulk path is gated the same way (unchanged by this card, pinned so
 *    the two halves cannot drift apart unnoticed)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5929] the predicate delete path asks the same per-object question', () => {
  it('a bulk delete on a hook-free object reads no matched row set', async () => {
    const { engine, reads } = await boot([observer('elsewhere', 'del_scope_b', 'beforeDelete', [])]);
    await engine.insert('del_scope_a', { title: 'A', status: 'stale', done: false });

    const before = reads.findOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { multi: true, where: { status: 'stale' } } as any);

    expect((reads.findOn['del_scope_a'] ?? 0) - before).toBe(0);
    expect(await engine.count('del_scope_a', {})).toBe(0);
  });

  it('…and reads it exactly once when the object IS hooked', async () => {
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([observer('pre_a', 'del_scope_a', 'beforeDelete', seen)]);
    await engine.insert('del_scope_a', { title: 'A', status: 'stale', done: false });

    const before = reads.findOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { multi: true, where: { status: 'stale' } } as any);

    expect((reads.findOn['del_scope_a'] ?? 0) - before).toBe(1);
    expect(seen).toHaveLength(1);
    expect((seen[0] as any).title).toBe('A');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. THE REGRESSION PIN — a real kernel, where the defect actually lived
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5929] on a KERNEL-hosted engine the per-object skip finally happens', () => {
  /**
   * `logger.level: 'silent'` and `gracefulShutdown: false` for the reasons
   * `plugin.integration.test.ts` records: a test kernel must not log its whole
   * bootstrap, and must not install process-wide signal handlers that vitest's
   * SIGTERM worker recycling then races with.
   */
  async function bootKernel(objects: ObjectSchema[]) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as any);
    const stub = makeCountingDriver();
    await kernel.use({
      name: 'del-counting-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.del-counting', stub.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    // `getService<ObjectQL>` — the slot's real contract, not `as any`. The
    // erasure would switch off checking for every `engine.*` call below while
    // looking identical to code that keeps it (#4168/#4176/#4251), and the
    // calls below are the measurement.
    const engine = kernel.getService<ObjectQL>('objectql');
    for (const o of objects) engine.registry.registerObject(o, 'test', 'test');
    return { kernel, engine, reads: stub.reads };
  }

  const kernelTask: ObjectSchema = {
    name: 'del_kernel_task', label: 'Kernel Task', datasource: 'del-counting',
    fields: TASK_FIELDS,
  } as unknown as ObjectSchema;

  it('registers NO `beforeDelete` hook of its own — the builtin is gone', async () => {
    // The retirement stated as a fact about the booted engine rather than about
    // `plugin.ts`'s source, so re-adding the hook under any name fails here.
    const { kernel, engine } = await bootKernel([kernelTask]);
    try {
      expect((engine as any).hasHooksFor('beforeDelete', 'del_kernel_task')).toBe(false);
      expect((engine as any).hasHooksFor('afterDelete', 'del_kernel_task')).toBe(false);
      // The stamp builtins that DO survive are still bound — this asserts the
      // absence of one hook, not of the builtin set.
      expect((engine as any).hasHooksFor('beforeInsert', 'del_kernel_task')).toBe(true);
      expect((engine as any).hasHooksFor('beforeUpdate', 'del_kernel_task')).toBe(true);
    } finally {
      if (kernel.getState() === 'running') await kernel.shutdown();
    }
  });

  it('[#7867] a single-id delete on a hook-free object performs EXACTLY ONE prior-row read', async () => {
    // ⚠️ THE pin, amended. It asserted 0 between #5929 and #7867. The number it
    // exists to hold down is "how many reads does ONE by-id delete cost" —
    // #5929 drove it from 1 to 0 by retiring a builtin that forced a read it
    // never used, and #7867 puts it back to 1 for a reader that does use it:
    // the not-found gate, without which this delete would report success for a
    // row that was never there.
    //
    // What must NOT come back is the builtin. The `hasHooksFor` case above
    // still asserts its absence directly, and the number here is 1 — not 2,
    // which is what a reintroduced `sys_fetch_previous_delete` would cost.
    const { kernel, engine, reads } = await bootKernel([kernelTask]);
    try {
      const row: any = await engine.insert('del_kernel_task', { title: 'A', status: 'todo', done: false });
      const beforeFindOne = reads.findOneOn['del_kernel_task'] ?? 0;
      const beforeFind = reads.findOn['del_kernel_task'] ?? 0;

      await engine.delete('del_kernel_task', { where: { id: row.id } });

      expect((reads.findOneOn['del_kernel_task'] ?? 0) - beforeFindOne).toBe(1);
      // The PREDICATE path's gate is untouched by #7867 — no matched-row-set
      // read on a hook-free object.
      expect((reads.findOn['del_kernel_task'] ?? 0) - beforeFind).toBe(0);
      expect(await engine.count('del_kernel_task', {})).toBe(0);
    } finally {
      if (kernel.getState() === 'running') await kernel.shutdown();
    }
  });

  it('an object WITH a real user `beforeDelete` still gets `previous` bound, from ONE read', async () => {
    // The other half. The retirement must not cost a single binding: the row
    // still arrives, and it arrives from the ENGINE's #5272/#6697 read — the
    // count says there was only one, so nothing else supplied it.
    const { kernel, engine, reads } = await bootKernel([kernelTask]);
    try {
      const seen: Array<unknown> = [];
      bindHooksToEngine(engine, [observer('user_pre', 'del_kernel_task', 'beforeDelete', seen)], {
        packageId: 'app:del-kernel',
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      });

      const row: any = await engine.insert('del_kernel_task', { title: 'A', status: 'todo', done: false });
      const before = reads.findOneOn['del_kernel_task'] ?? 0;
      await engine.delete('del_kernel_task', { where: { id: row.id } });

      expect((reads.findOneOn['del_kernel_task'] ?? 0) - before).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: row.id, title: 'A', status: 'todo' });
    } finally {
      if (kernel.getState() === 'running') await kernel.shutdown();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. The retired builtin's own shape, replayed — its guard cannot be true
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5929] a fetch-previous `beforeDelete` hook is now dead weight', () => {
  it('its `!ctx.previous` guard short-circuits, so it issues no read of its own', async () => {
    // Verbatim the retired builtin's shape — priority 5 (so it runs FIRST),
    // `beforeDelete`, guard `if (input.id && !ctx.previous)`, fetching through
    // `ctx.ql` exactly as `plugin.ts` reached for `this.ql`. Measured as a read
    // count, because "the guard is false now" is the kind of claim that rots
    // silently: if the engine ever stopped binding `previous` ahead of the
    // before phase, this count would go to 2 and say so.
    const supplied: Array<unknown> = [];
    const { engine, reads } = await boot([
      {
        name: 'fetch_previous_delete_replay', object: '*', events: ['beforeDelete'], priority: 5,
        handler: async (ctx: any) => {
          if (ctx.input?.id && !ctx.previous) {
            const existing = await ctx.ql.findOne(ctx.object, {
              where: { id: ctx.input.id }, context: { isSystem: true },
            });
            if (existing) ctx.previous = existing;
          }
        },
      } as unknown as Hook,
      observer('reads_previous', 'del_scope_a', 'beforeDelete', supplied),
    ]);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    // The consumer saw the row…
    expect(supplied).toEqual([{ id: row.id, title: 'A', status: 'todo', done: false }]);
    // …and exactly ONE read produced it: the engine's. The replayed builtin
    // added none — which is the whole argument for deleting it rather than
    // leaving it behind a guard that can no longer be true.
    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(1);
  });

  it('[#7867] the residual shape is now UNREACHABLE — the delete is refused before any hook runs', async () => {
    // ⚠️ This case used to assert `seen == [undefined]`: the row was already
    // gone, the engine's read bound nothing, and `beforeDelete` dispatched
    // anyway with `previous` UNBOUND (never fabricated — #4649/#4775).
    //
    // The never-fabricate rule is untouched and still governs `bindPreImage`.
    // What #7867 changed is that this dispatch no longer happens at all: a
    // by-id delete whose id names no row is refused with RECORD_NOT_FOUND
    // BEFORE the before phase, so no handler is ever handed a context for a
    // record nobody read. That is the same remedy #5574 chose one path over —
    // kill the producer, do not specialize what it produced — and it is why
    // #5571's six rounds of blaming the binding site were measuring the wrong
    // thing: the binding was correct on a path that should never have been
    // entered.
    const seen: Array<unknown> = [];
    const { engine } = await boot([observer('pre_a', 'del_scope_a', 'beforeDelete', seen)]);

    const err: any = await engine
      .delete('del_scope_a', { where: { id: 'never_existed' } } as any)
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(seen, 'no handler may be dispatched for a row that is not there').toEqual([]);
  });
});
