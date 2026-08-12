// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5284] `update()`'s single-id prior-row read is demanded PER OBJECT.
 *
 * The gate used to ask `this.hooks.get('afterUpdate').length > 0` — the pooled
 * registration list of EVERY object — so one plugin registering `afterUpdate`
 * on one object (plugin-audit does exactly that) made every single-id update on
 * every OTHER object pay an extra `driver.findOne`. The bulk paths in the same
 * file already asked it per object (`hasHooksFor`, #5038).
 *
 * These cases pin the three demands that survive the narrowing, and the one
 * that is deliberately absent:
 *
 *   1. `needsPriorRecord(schema)` — validation rules + the `readonlyWhen` /
 *      `requiredWhen` / option-visibility field predicates it subsumes;
 *   2. an `afterUpdate` hook on THIS object (handler and declarative
 *      `condition` both read `previous`), `'*'`/global registrations included;
 *   3. a roll-up `summary` aggregating this object — `previous` carries the OLD
 *      parent id, so a repointed child recomputes both parents. Before #5284
 *      that read was only incidental: a deployment with no `afterUpdate` hook
 *      anywhere left the old parent silently stale.
 *
 *   4. [#5574 / #5846] a `beforeUpdate` hook on THIS object. This term was
 *      deliberately ABSENT until ADR-0058 Addendum II, and the reason it was
 *      absent is worth keeping: `update()` used to dispatch `beforeUpdate`
 *      FIRST and bind `hookContext.previous` only after the write, so a
 *      before-hook observed `previous === undefined` whatever this gate
 *      decided, and counting the event would have bought a read with no
 *      reader. The ruling reversed that ordering — the before phase is now a
 *      per-row reader of this very row set — so the reader exists and the term
 *      joins the gate. `update()` and `delete()` (#5272) finally agree.
 *
 * The cases below that used to measure the ABSENCE now measure the presence,
 * and say so in place: the "count before-hooks too" reflex was answered with
 * evidence before, and is answered with evidence now that the evidence changed.
 *
 * ## ⚠️ AMENDED BY #7867 — the by-id SKIP is retired; the per-object question is not
 *
 * A by-id update now reads its prior row UNCONDITIONALLY, so the gate no longer
 * decides whether the engine LOOKS. A fifth demand joined the list and it is
 * not expressible as a registration:
 *
 *   5. EXISTENCE. A by-id update whose id names no row must answer
 *      `RECORD_NOT_FOUND` rather than run on into validation, the driver and
 *      the hook chain and die on whichever complains first. Every by-id update
 *      has this demand, and no cheaper question answers it — so demands 1–4 can
 *      no longer gate the read, only explain who else consumes it.
 *
 * What survives intact, and is still pinned below: the demand is asked PER
 * OBJECT for DISPATCH (`hasHooksFor` mirroring `triggerHooks`' own filter),
 * `previous` is bound from ONE read, the never-fabricate rule, and the
 * PREDICATE path's gate — a `multi: true` update matching zero rows is
 * legitimately "0 rows affected", not a missing record.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
};

/** Two plain objects, neither declaring anything that needs a prior row. */
const taskA = { name: 'scope_task_a', label: 'A', fields: TASK_FIELDS };
const taskB = { name: 'scope_task_b', label: 'B', fields: TASK_FIELDS };

/** Declares a `readonlyWhen` field, so `needsPriorRecord` is true for it. */
const lockedTask = {
  name: 'scope_locked_task',
  label: 'Locked',
  fields: {
    ...TASK_FIELDS,
    title: {
      name: 'title', label: 'Title', type: 'text' as const,
      // Once the task is done its title is frozen — a predicate over the
      // record's STORED state, which is exactly what the prior row is for.
      readonlyWhen: 'record.done == true',
    },
  },
};

/** Parent/child pair for the roll-up demand. */
const invoice = {
  name: 'scope_invoice',
  label: 'Invoice',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    line_total: {
      name: 'line_total', label: 'Total', type: 'summary' as const,
      summaryOperations: { object: 'scope_invoice_line', field: 'amount', function: 'sum' },
    },
  },
};
const invoiceLine = {
  name: 'scope_invoice_line',
  label: 'Line',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    invoice: { name: 'invoice', label: 'Invoice', type: 'master_detail' as const, reference: 'scope_invoice' },
  },
};

/**
 * A driver that counts every read, so "pays no extra read" is a measurement
 * rather than an assertion about the code that was written.
 */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  /**
   * `findOneOn` is per object because a write can legitimately read a DIFFERENT
   * object: repointing a master_detail FK makes `assertReferencesResolve` check
   * the new parent exists (#4441). Counting only the total would conflate that
   * with the prior-row read this file is about.
   */
  const reads = { findOne: 0, find: 0, findOneOn: {} as Record<string, number> };
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
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      reads.find += 1;
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
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
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
  for (const o of objects) engine.registry.registerObject(o);
  const warn = vi.fn();
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, {
      packageId: 'app:scope',
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });
  }
  return { engine, reads: stub.reads, storeFor: stub.storeFor, warn };
}

const observer = (name: string, object: string, event: string, sink: Array<unknown>): Hook => ({
  name, object, events: [event], priority: 90,
  handler: (ctx: any) => { sink.push(ctx.previous); },
} as unknown as Hook);

describe('[#5284] the prior-row demand is asked per object', () => {
  it('[#7867] object A pays exactly ONE prior read — the by-id read is no longer the gate\'s to skip', async () => {
    // ⚠️ Asserted 0 between #5284 and #7867. The delta this file exists to hold
    // down was never "is it 0" but "does ONE object's registration tax the
    // others": before #5284 it was 1 HERE and 1 on B, growing with every
    // plugin's registration list. It is 1 here now for a demand that belongs to
    // THIS call and nobody else's registration — the not-found gate — and it
    // does not grow when another object gains a hook. The per-object property
    // is intact; only the skip is gone.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([
      observer('audits_b', 'scope_task_b', 'afterUpdate', seen),
    ]);

    const row: any = await engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOne;
    await engine.update('scope_task_a', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(reads.findOne - before).toBe(1);
    // B's hook still did not fire for A's update — the DISPATCH half of the
    // per-object question, which is what #5284 was about, is untouched.
    expect(seen).toEqual([]);
  });

  it('[#7867] a by-id update against an id that names no row is refused — RECORD_NOT_FOUND', async () => {
    // Demand 5, stated as behaviour. This is the defect #7867 fixed: nothing on
    // the action-body write path ever asked whether the row existed, so a ghost
    // id was a silent no-op that resolved `null` and the write then died on
    // whatever the pipeline complained about first. The 400 class varied with
    // the object's declarations; the missing 404 was the constant.
    const seen: Array<unknown> = [];
    const { engine } = await boot([
      observer('pre_a', 'scope_task_a', 'beforeUpdate', seen),
    ]);

    const err: any = await engine
      .update('scope_task_a', { status: 'in_progress' }, { where: { id: 'never_existed' } } as any)
      .then(() => null, (e) => e);

    expect(err, 'a ghost id must be refused, not silently resolved').not.toBeNull();
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    // Refused BEFORE the before phase, so no handler is handed a context for a
    // record nobody read — the producer is removed, not the message
    // specialized (#5574's ruled remedy for this family).
    expect(seen, 'beforeUpdate must not dispatch for a row that is not there').toEqual([]);
  });

  it('the object that DOES have the hook still pays it, and `previous` is the stored row', async () => {
    // The other half of the same measurement: narrowing must not cost the
    // objects that are actually observed anything at all.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([
      observer('audits_b', 'scope_task_b', 'afterUpdate', seen),
    ]);

    const row: any = await engine.insert('scope_task_b', { title: 'B', status: 'todo', done: false });
    const before = reads.findOne;
    await engine.update('scope_task_b', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(reads.findOne - before).toBe(1);
    expect(seen).toEqual([{ id: row.id, title: 'B', status: 'todo', done: false }]);
  });

  it('a hook registered for `*` still demands the read on every object', async () => {
    // `hasHooksFor` mirrors `triggerHooks`' own filter: an entry that targets
    // `'*'` DOES reach this object, so narrowing per object must not narrow it
    // away. Getting this looser costs a query; getting it tighter would drop
    // hooks that were going to fire.
    const seen: Array<unknown> = [];
    const { engine, reads } = await boot([{
      name: 'audits_everything', object: '*', events: ['afterUpdate'], priority: 90,
      handler: (ctx: any) => { seen.push(ctx.previous); },
    } as unknown as Hook]);

    const row: any = await engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOne;
    await engine.update('scope_task_a', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(reads.findOne - before).toBe(1);
    expect(seen).toEqual([{ id: row.id, title: 'A', status: 'todo', done: false }]);
  });

  it('`needsPriorRecord` alone still forces the read — no hook registered anywhere', async () => {
    const { engine, reads, storeFor } = await boot([], [lockedTask]);

    const row: any = await engine.insert('scope_locked_task', { title: 'Ship it', status: 'done', done: true });
    const before = reads.findOne;
    // `readonlyWhen: record.done == true` is TRUE for the STORED row, so the
    // incoming title change is dropped — which is only decidable with the prior
    // record in hand. The count and the effect are asserted together: a read
    // that happened but was not used would pass the first and fail the second.
    await engine.update('scope_locked_task', { title: 'Renamed' }, { where: { id: row.id } } as any);

    expect(reads.findOne - before).toBe(1);
    expect(storeFor('scope_locked_task').get(row.id)?.title).toBe('Ship it');
  });

  it('a roll-up summary keeps its OLD-parent recompute with no hooks registered anywhere', async () => {
    // The demand the narrowing would otherwise have dropped on the floor:
    // `recomputeSummaries` reads `previous[fk]` to find the parent a repointed
    // child LEFT. Before #5284 this only worked when some object happened to
    // have an afterUpdate hook; now the roll-up asks for itself.
    const { engine, reads, storeFor } = await boot([], [invoice, invoiceLine]);

    const p1: any = await engine.insert('scope_invoice', { name: 'INV-1' });
    const p2: any = await engine.insert('scope_invoice', { name: 'INV-2' });
    const line: any = await engine.insert('scope_invoice_line', { invoice: p1.id, amount: 40 });
    expect(storeFor('scope_invoice').get(p1.id)?.line_total).toBe(40);

    const before = reads.findOneOn['scope_invoice_line'] ?? 0;
    await engine.update('scope_invoice_line', { invoice: p2.id }, { where: { id: line.id } } as any);

    // Exactly one read OF THE CHILD — the prior row. (The write also reads the
    // new PARENT once, for the #4441 dangling-reference check; that is a
    // different object and a different demand.)
    expect((reads.findOneOn['scope_invoice_line'] ?? 0) - before).toBe(1);
    // BOTH parents: the one it joined, and the one it left.
    expect(storeFor('scope_invoice').get(p2.id)?.line_total).toBe(40);
    expect(storeFor('scope_invoice').get(p1.id)?.line_total).toBe(0);
  });
});

/**
 * Why these run on a BARE engine, and what that does and does not prove.
 *
 * `new ObjectQL()` carries no `ObjectQLPlugin` builtins, so the only producer
 * of `hookContext.previous` here is `update()` itself. That is exactly the
 * subject: whether THIS gate's read reaches the before phase.
 *
 * ⚠️ This block asserted the INVERSE until #5574 — it was titled "`beforeUpdate`
 * is not a reader of THIS read" and measured a before-hook seeing
 * `previous === undefined` even with the row in hand. What made that true was
 * dispatch ORDER, not any property of the gate, and ADR-0058 Addendum II
 * reversed the order. The cases are kept in place, inverted, rather than
 * deleted: the old readings are the receipts for why the gate was narrower than
 * `delete()`'s for as long as it was (Prime Directive #13 — a reversed decision
 * is a record).
 *
 * A kernel-hosted engine used to have a SECOND producer,
 * `sys_fetch_previous_update` (`plugin.ts`, `object: '*'`, priority 5), which
 * made its own `findOne` before any authored before-hook ran. #5846 retired it:
 * with the engine binding `previous` first, its `!ctx.previous` guard can no
 * longer be true. The last case below drives that exact shape and pins the
 * consequence — the hook-supplied fetch is now the redundant one.
 */
describe('[#5284, inverted by #5574] `beforeUpdate` IS a reader of THIS read', () => {
  it('observes the engine read — the row IS in hand, and now the before phase sees it', async () => {
    // Measured, not assumed. This used to read `expect(beforeSeen).toEqual(
    // [undefined])`: the prior row was fetched (this object has an afterUpdate
    // hook) and the before-hook still saw nothing, because the dispatch
    // preceded the read. Both phases now see the same pre-image from the same
    // single read.
    const beforeSeen: Array<unknown> = [];
    const afterSeen: Array<unknown> = [];
    const { engine } = await boot([
      observer('pre', 'scope_task_a', 'beforeUpdate', beforeSeen),
      observer('post', 'scope_task_a', 'afterUpdate', afterSeen),
    ]);

    const row: any = await engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    await engine.update('scope_task_a', { status: 'in_progress' }, { where: { id: row.id } } as any);

    const stored = { id: row.id, title: 'A', status: 'todo', done: false };
    expect(beforeSeen).toEqual([stored]);
    expect(afterSeen).toEqual([stored]);
  });

  it('EVALUATES a `previous.*` beforeUpdate condition instead of rejecting it', async () => {
    // The inverse of what this case pinned before, and the measured harm #5574
    // is about, one path over: a legal, contract-shaped transition condition on
    // a `beforeUpdate` hook used to REJECT the write (unevaluable ⇒ abort,
    // #4775) on a bare engine, because nothing bound `previous` in the before
    // phase. The gate now counts the event, so the read happens for the
    // condition's sake and the condition evaluates as authored.
    const withAfterHook = await boot([
      { name: 'pre_cond', object: 'scope_task_a', events: ['beforeUpdate'], priority: 90,
        condition: 'previous.done != true && record.done == true', handler: () => {} } as unknown as Hook,
      observer('post', 'scope_task_a', 'afterUpdate', []),
    ]);
    const rowA: any = await withAfterHook.engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    await expect(
      withAfterHook.engine.update('scope_task_a', { done: true }, { where: { id: rowA.id } } as any),
    ).resolves.toBeDefined();

    // …and with NO after-hook anywhere, so the before-hook is the sole term
    // holding the gate open. Same verdict — which is the whole point of adding
    // the term rather than relying on some neighbouring consumer.
    const beforeHookOnly = await boot([
      { name: 'pre_cond', object: 'scope_task_a', events: ['beforeUpdate'], priority: 90,
        condition: 'previous.done != true && record.done == true', handler: () => {} } as unknown as Hook,
    ]);
    const rowB: any = await beforeHookOnly.engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    await expect(
      beforeHookOnly.engine.update('scope_task_a', { done: true }, { where: { id: rowB.id } } as any),
    ).resolves.toBeDefined();
  });

  it('makes the retired builtin\'s own fetch the redundant one (#5846)', async () => {
    // The kernel's `sys_fetch_previous_update` shape, replayed as an authored
    // hook: a low-priority (= earlier) `beforeUpdate` hook that fetches the row
    // itself behind `if (input.id && !ctx.previous)`. The engine now binds
    // `previous` BEFORE any before-hook runs, so that guard is false and the
    // hook's `findOne` never happens — which is exactly the argument for
    // deleting the builtin rather than leaving it behind a guard that can no
    // longer be true. Measured here as a read count, because "the guard is
    // false now" is the kind of claim that rots silently.
    const supplied: Array<unknown> = [];
    const { engine, reads } = await boot([
      { name: 'fetch_previous', object: 'scope_task_a', events: ['beforeUpdate'], priority: 5,
        handler: async (ctx: any) => {
          // Verbatim the builtin's shape, through the engine the context
          // carries — `ctx.ql` is what `plugin.ts` reaches for as `this.ql`.
          if (ctx.input?.id && !ctx.previous) {
            const prev = await ctx.ql.findOne(ctx.object, {
              where: { id: ctx.input.id }, context: { isSystem: true },
            });
            if (prev) ctx.previous = prev;
          }
        } } as unknown as Hook,
      { name: 'reads_previous', object: 'scope_task_a', events: ['beforeUpdate'], priority: 90,
        condition: 'previous.done != true && record.done == true',
        handler: (ctx: any) => { supplied.push(ctx.previous); } } as unknown as Hook,
    ]);

    const row: any = await engine.insert('scope_task_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOne;
    await engine.update('scope_task_a', { done: true }, { where: { id: row.id } } as any);

    // The condition evaluated (the handler ran) against the ENGINE-supplied row…
    expect(supplied).toEqual([{ id: row.id, title: 'A', status: 'todo', done: false }]);
    // …and there was exactly ONE read for it: the engine's. The builtin-shaped
    // hook's guard short-circuited, so it issued none — where before this
    // change the count was one EACH.
    expect(reads.findOne - before).toBe(1);
  });
});
