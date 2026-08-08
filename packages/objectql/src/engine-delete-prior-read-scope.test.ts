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
  it('object A pays NO prior read while only object B has an afterDelete hook', async () => {
    const { engine, reads } = await boot([observer('audits_b', 'del_scope_b', 'afterDelete', [])]);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(0);
    // The row really went — a skipped read must not have skipped the write.
    expect(await engine.count('del_scope_a', {})).toBe(0);
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

  it('`needsPriorRecord` is NOT a term — a readonlyWhen object still skips the read', async () => {
    // Stated as a case because it is the one asymmetry with `update()`'s twin
    // gate, and an honest gate is exactly where someone would reflexively add
    // it back. `delete()` evaluates no validation rules and no field
    // predicates, so the term would buy a read with no reader.
    const { engine, reads } = await boot([], [lockedTask]);

    const row: any = await engine.insert('del_scope_locked', { title: 'Ship it', status: 'done', done: true });
    const before = reads.findOneOn['del_scope_locked'] ?? 0;
    await engine.delete('del_scope_locked', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_locked'] ?? 0) - before).toBe(0);
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

  it('an EXCLUDED object skips the prior read, and the hook does not fire on it', async () => {
    const fired: unknown[] = [];
    const { engine, reads } = await boot();
    registerGlobalDeleteHook(engine, 'beforeDelete', fired, ['del_scope_a']);

    const row: any = await engine.insert('del_scope_a', { title: 'A', status: 'todo', done: false });
    const before = reads.findOneOn['del_scope_a'] ?? 0;
    await engine.delete('del_scope_a', { where: { id: row.id } } as any);

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(0);
    // The read count and the dispatch agree — which is the property, not a
    // coincidence: both ask `hookMatchesObject`.
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

    expect((reads.findOneOn['del_scope_a'] ?? 0) - before).toBe(0);
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

  it('a single-id delete on a hook-free object performs NO prior-row read', async () => {
    // ⚠️ THE pin. This read count was 1 for every object on every kernel-hosted
    // engine that has ever run, because `sys_fetch_previous_delete` held term 1
    // of the gate open — and then never used the row it forced the engine to
    // fetch.
    const { kernel, engine, reads } = await bootKernel([kernelTask]);
    try {
      const row: any = await engine.insert('del_kernel_task', { title: 'A', status: 'todo', done: false });
      const beforeFindOne = reads.findOneOn['del_kernel_task'] ?? 0;
      const beforeFind = reads.findOn['del_kernel_task'] ?? 0;

      await engine.delete('del_kernel_task', { where: { id: row.id } });

      expect((reads.findOneOn['del_kernel_task'] ?? 0) - beforeFindOne).toBe(0);
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

  it('the residual shape — engine read found nothing — leaves `previous` UNBOUND, not fabricated', async () => {
    // The one shape in which the retired guard could still have been TRUE: the
    // row is already gone, so the engine's read binds nothing. The builtin's
    // read would have found nothing either (same row, same scope), so retiring
    // it changes no binding here — and `bindPreImage` must still refuse to
    // fabricate `{}`/`null` for a record nobody read (#4649/#4775).
    const seen: Array<unknown> = [];
    const { engine } = await boot([observer('pre_a', 'del_scope_a', 'beforeDelete', seen)]);

    await engine.delete('del_scope_a', { where: { id: 'never_existed' } } as any);

    expect(seen).toEqual([undefined]);
  });
});
