// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4784] A declarative hook `condition` evaluates against `record` AND
 * `previous` — the same two bindings a validation predicate reads.
 *
 * Before this fix the scope carried a single root (`{ record }`), so the
 * `previous.*` form BOTH published skill docs teach — `skills/objectstack-formula`
 * §5 and its `ISCHANGED(x)` → `previous.x != record.x` migration row — faulted
 * with `No such key: previous` and was swallowed into `false`.
 *
 * It matters more since #4770: `record` now means the record's STATE, so
 * `record.done == true` is true on EVERY update of an already-done row. The
 * transition ("just became done"), which is what an audit hook actually means,
 * is expressible only by comparing against `previous`.
 *
 * Semantics copied verbatim from `validation/rule-validator.ts`:
 *   - total over the object's DECLARED fields (shared `materializeDeclaredFields`),
 *     so a column the driver never returned reads as `null` rather than faulting;
 *   - an UNDECLARED key stays unevaluable, so typos remain reportable;
 *   - copied, never mutated in place — the after-hooks that run next observe
 *     the engine's own `ctx.previous`;
 *   - absent (unbound identifier) whenever the prior state is not in hand:
 *     insert, and a predicate bulk update.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

/** `archived` is declared but never written by any test here — the
 *  declared-but-absent column materialisation exists for. */
const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
  archived: { name: 'archived', label: 'Archived', type: 'boolean' as const },
};

const taskObject = { name: 'hook_task', label: 'Task', fields: TASK_FIELDS };

const qlStub = {
  getObject: (name: string) => (name === 'hook_task' ? taskObject : undefined),
};

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'hook_task',
    event: 'afterUpdate',
    input: { id: 't1', data: { done: true } },
    previous: { id: 't1', title: 'Ship it', status: 'todo', done: false },
    ql: qlStub,
    ...overrides,
  } as unknown as HookContext;
}

function makeHook(condition: string, events: string[] = ['afterUpdate']): Hook {
  return {
    name: 'audit', object: 'hook_task', events, priority: 100,
    condition,
    handler: () => {},
  } as unknown as Hook;
}

function captureLogger() {
  const warn = vi.fn();
  return {
    warn,
    logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    conditionWarnings: () =>
      warn.mock.calls.filter(([msg]) => String(msg).includes('condition evaluation failed')),
  };
}

/** The transition form the skill docs teach, and #4784's headline shape. */
const TRANSITION = 'previous.done != true && record.done == true';

describe('[#4784] hook condition binds `previous` alongside `record`', () => {
  it('fires on the update that FLIPS the field, not on later updates of a done record', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    // The flip: stored done=false, this write sets done=true.
    await wrapped(makeCtx());
    expect(calls).toEqual(['ran']);

    // A later, unrelated update of the (already done) record.
    await wrapped(makeCtx({
      previous: { id: 't1', title: 'Ship it', status: 'in_progress', done: true },
      input: { id: 't1', data: { status: 'review' } },
    } as any));
    expect(calls).toEqual(['ran']);

    expect(conditionWarnings()).toEqual([]);
  });

  it('is TOTAL over declared fields — a column the driver never returned reads as null', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    // `archived` is declared; this driver's prior row simply has no such key.
    // Guarded with `!= null`, never `has()` — a materialised null is a PRESENT
    // key, so `has(previous.archived)` is uniformly true (#4649/#4770).
    const wrapped = wrapDeclarativeHook(
      makeHook('previous.archived == null && record.done == true'),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await wrapped(makeCtx());

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('an UNDECLARED key on `previous` stays unevaluable — typos stay reportable', async () => {
    const calls: string[] = [];
    const { logger } = captureLogger();
    const wrapped = wrapDeclarativeHook(
      makeHook('previous.dnoe != true'),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    // #4775: "reportable" is now "rejects the operation", not "logs a warn".
    await expect(wrapped(makeCtx())).rejects.toThrow(/No such key: dnoe/);
    expect(calls).toEqual([]);
  });

  it('never leaks materialised nulls back into the engine\'s ctx.previous', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('previous.archived == null'),
      (async () => { calls.push('ran'); }) as any,
    );
    const ctx = makeCtx();
    await wrapped(ctx);

    expect(calls).toEqual(['ran']);
    // The after-hooks that run next observe THIS object. A fabricated
    // `archived: null` here would be a column the row never had.
    expect(Object.keys(ctx.previous as object).sort()).toEqual(['done', 'id', 'status', 'title']);
    expect((ctx.previous as any).archived).toBeUndefined();
  });

  it('leaves `previous` UNBOUND on insert — verbatim the validation side', async () => {
    const calls: string[] = [];
    const { logger } = captureLogger();
    // `rule-validator.ts` binds `previous` only for `mode: 'update'` with a
    // prior record in hand; on insert it passes `undefined`, which omits the
    // identifier from the CEL scope. Referencing it on an insert event is
    // therefore an author error, reported — not silently answered.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION, ['beforeInsert']),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    // #4775: an unbound `previous` is unevaluable, and unevaluable rejects the
    // insert rather than being swallowed into `false`.
    await expect(wrapped(makeCtx({
      event: 'beforeInsert',
      previous: undefined,
      input: { data: { done: true } },
    } as any))).rejects.toThrow(/Unknown variable: previous/);

    expect(calls).toEqual([]);
  });

  it('a `record`-only condition on insert is unaffected by the added binding', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true', ['beforeInsert']),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await wrapped(makeCtx({
      event: 'beforeInsert',
      previous: undefined,
      input: { data: { done: true } },
    } as any));

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('fabricates nothing on the BATCH dispatch of a bulk update — `previous` stays unbound', async () => {
    const calls: string[] = [];
    const { logger } = captureLogger();
    // The `beforeUpdate` of a `multi: true` update fires ONCE for N matched
    // rows; there is no single prior record. Binding `{}` or `null` would make
    // `previous.done != true` answer for rows nobody read. #4775/B1: it stays
    // unbound AND the write is rejected — with a diagnosis, not `No such key`.
    //
    // [#5038] The AFTER dispatch of that same write is per row and DOES bind
    // `previous` — the case below.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION, ['beforeUpdate']),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await expect(wrapped(makeCtx({
      event: 'beforeUpdate',
      previous: undefined,
      input: { data: { done: true }, options: { multi: true } },
    } as any))).rejects.toThrow(/PREDICATE bulk write/);

    expect(calls).toEqual([]);
  });

  it('binds `previous` on the PER-ROW dispatch of a bulk update (#5038)', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    // What the engine now hands an after-hook for each matched row of a
    // predicate write: the single-record shape, carrying the row's id and its
    // own pre-image. The transition condition evaluates exactly as it does on a
    // single-record write — which is the contract ADR-0058's addendum records.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await wrapped(makeCtx({
      input: { id: 't1', data: { done: true }, options: { multi: true } },
      previous: { id: 't1', title: 'Ship it', status: 'todo', done: false },
    } as any));

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  // [#5272] The delete-shaped case that used to live here hand-built
  // `previous` on the context and asserted the wrapper read it. It passed
  // against an engine that never produced one — `delete()` assigned
  // `hookContext.previous` nowhere, so the pin was a green light for behaviour
  // that did not exist, and the real failure (every single-record delete with
  // a `previous.*` condition rejected under #4775) sat behind it. Its
  // replacement drives a real `engine.delete()` end to end — see
  // '[#5272] a single-record delete binds `previous` through the real engine'
  // at the bottom of this file. Nothing about the wrapper needed fixing; the
  // producer did, so that is where the test now looks.

  it('a context with no engine still binds `previous` (merge only, no materialisation)', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await wrapped(makeCtx({ ql: undefined } as any));

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Through a REAL engine, over an in-memory driver that — like a SQL driver —
 * stores only the columns a write actually touched.
 * ──────────────────────────────────────────────────────────────────────────── */

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  /** Every read the engine performs, so "no extra fetch" is measurable. */
  const reads = { findOne: 0, find: 0 };
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
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
    async find(object: string, ast: any) {
      reads.find += 1;
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      reads.findOne += 1;
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      // Only written columns are stored: a declared-but-unwritten column is
      // absent from every row this driver ever returns.
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
  return { driver, stores, reads };
}

describe('[#4784] transition condition over a real engine', () => {
  let engine: ObjectQL;
  let audited: string[];
  let warn: ReturnType<typeof vi.fn>;
  let reads: { findOne: number; find: number };

  const conditionWarnings = () =>
    warn.mock.calls.filter(([msg]) => String(msg).includes('condition evaluation failed'));

  async function boot(hooks: Hook[]) {
    engine = new ObjectQL();
    const mem = makeMemoryDriver();
    reads = mem.reads;
    engine.registerDriver(mem.driver, true);
    await engine.init();
    engine.registry.registerObject(taskObject as any);

    audited = [];
    warn = vi.fn();
    bindHooksToEngine(engine, hooks, {
      packageId: 'app:showcase',
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });
  }

  beforeEach(async () => {
    await boot([{
      // `showcase_audit_task_completion`'s own description says "after a task
      // transitions to done". Since #4770 `record.done == true` says "IS done";
      // only this shape says "just BECAME done".
      name: 'showcase_audit_task_completion',
      object: 'hook_task',
      events: ['afterUpdate'],
      priority: 90,
      condition: TRANSITION,
      handler: (ctx: any) => { audited.push(String(ctx.input?.id ?? '?')); },
    } as unknown as Hook]);
  });

  it('audits exactly the update that completes the task', async () => {
    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'todo', done: false });

    await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);
    expect(audited).toEqual([row.id]);

    // Two further updates of a record that is ALREADY done — the transition
    // happened once, so the audit happens once.
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);
    await engine.update('hook_task', { title: 'Ship it (v2)' }, { where: { id: row.id } } as any);

    expect(audited).toEqual([row.id]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('does not audit an update that leaves the task incomplete', async () => {
    const row: any = await engine.insert('hook_task', { title: 'Draft', status: 'todo', done: false });
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(audited).toEqual([]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('completes a task whose `done` column was never written — no fault', async () => {
    // The driver stored no `done` column at all; `previous.done` must read as
    // the materialised null, not abort the expression.
    const row: any = await engine.insert('hook_task', { title: 'Untouched', status: 'todo' });
    await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);

    expect(audited).toEqual([row.id]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('does not leak materialised nulls into what the after-hook observes', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await boot([{
      name: 'observe_previous',
      object: 'hook_task',
      events: ['afterUpdate'],
      priority: 90,
      condition: 'previous.archived == null && record.done == true',
      handler: (ctx: any) => { seen.push(ctx.previous); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'todo' });
    await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);

    expect(seen).toHaveLength(1);
    // `archived` is DECLARED and was materialised for the condition. The
    // hook's own view of `previous` must not have gained it.
    expect(Object.keys(seen[0]!).sort()).toEqual(['id', 'status', 'title']);
  });
});

describe('[#4784] a condition that never mentions `previous` costs zero extra fetches', () => {
  /**
   * The demand-driven prior fetch (`engine.ts`, the `needsPriorRecord(...) ||
   * afterUpdate hooks exist` gate) is the ONE mechanism that decides whether a
   * prior row is read; #4784 adds no second one. These two pins are what a
   * future narrowing of that gate has to keep true.
   */
  async function bootWith(hooks: Hook[]) {
    const engine = new ObjectQL();
    const mem = makeMemoryDriver();
    engine.registerDriver(mem.driver, true);
    await engine.init();
    engine.registry.registerObject(taskObject as any);
    bindHooksToEngine(engine, hooks, {
      packageId: 'app:pin',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    return { engine, reads: mem.reads };
  }

  it('reads no prior row at all for a before-hook condition over `record` only', async () => {
    const { engine, reads } = await bootWith([{
      name: 'record_only_guard',
      object: 'hook_task',
      events: ['beforeUpdate'],
      priority: 100,
      condition: 'record.status == "todo"',
      handler: () => {},
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const before = reads.findOne;
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    // No afterUpdate hook, no prior-needing validation rule → nothing to fetch.
    expect(reads.findOne - before).toBe(0);
  });

  it('reads the SAME number of rows whether or not the condition mentions `previous`', async () => {
    const mkHook = (condition: string): Hook => ({
      name: 'audit', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition, handler: () => {},
    } as unknown as Hook);

    const plain = await bootWith([mkHook('record.done == true')]);
    const plainRow: any = await plain.engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const plainBefore = plain.reads.findOne;
    await plain.engine.update('hook_task', { done: true }, { where: { id: plainRow.id } } as any);
    const plainCost = plain.reads.findOne - plainBefore;

    const withPrev = await bootWith([mkHook(TRANSITION)]);
    const prevRow: any = await withPrev.engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const prevBefore = withPrev.reads.findOne;
    await withPrev.engine.update('hook_task', { done: true }, { where: { id: prevRow.id } } as any);
    const prevCost = withPrev.reads.findOne - prevBefore;

    // Both pay the one fetch the afterUpdate gate already made; `previous`
    // rides along on it.
    expect(plainCost).toBe(1);
    expect(prevCost).toBe(plainCost);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [#5272] The DELETE side of the same contract, through a real engine.
 *
 * `HookContext.previous` is documented "for update/delete", and #5038 made a
 * predicate bulk delete bind each doomed row's pre-image on its per-row
 * `afterDelete`. The single-record path bound nothing at all, so it was
 * strictly worse than the bulk one and every delete-side `previous.*`
 * condition was rejected by #4775's fail-loud — through the generic branch,
 * which reads like an author typo.
 *
 * Every case below goes insert → real `engine.delete()` → assert what the hook
 * was handed. A hand-built context cannot answer any of these questions: it
 * asserts what the test author already wrote down.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5272] a single-record delete binds `previous` through the real engine', () => {
  async function bootDelete(hooks: Hook[]) {
    const engine = new ObjectQL();
    const mem = makeMemoryDriver();
    engine.registerDriver(mem.driver, true);
    await engine.init();
    engine.registry.registerObject(taskObject as any);
    const warn = vi.fn();
    bindHooksToEngine(engine, hooks, {
      packageId: 'app:showcase',
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });
    return {
      engine,
      reads: mem.reads,
      conditionWarnings: () =>
        warn.mock.calls.filter(([msg]) => String(msg).includes('condition evaluation failed')),
    };
  }

  const observer = (event: string, sink: Array<Record<string, unknown> | undefined>): Hook => ({
    name: `observe_${event}`,
    object: 'hook_task',
    events: [event],
    priority: 90,
    handler: (ctx: any) => { sink.push(ctx.previous); },
  } as unknown as Hook);

  it('hands `beforeDelete` the stored pre-image', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const { engine } = await bootDelete([observer('beforeDelete', seen)]);

    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'done', done: true });
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    expect(seen).toHaveLength(1);
    // The row as the database held it — not `undefined`, and not the bare
    // `{ id }` the delete's `input` carries.
    expect(seen[0]).toEqual({ id: row.id, title: 'Ship it', status: 'done', done: true });
  });

  it('hands `afterDelete` the same pre-image — by then the row is gone', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const { engine } = await bootDelete([observer('afterDelete', seen)]);

    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'done', done: true });
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    // The pre-image is taken BEFORE the delete precisely because this is the
    // only moment it exists: the row is unreadable now.
    expect(await engine.findOne('hook_task', { where: { id: row.id } })).toBeFalsy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: row.id, title: 'Ship it', status: 'done', done: true });
  });

  it('evaluates a `previous.*` delete-side condition instead of rejecting the delete (#4775)', async () => {
    // The issue's own example: a legal, contract-shaped transition hook. Before
    // the fix `previous` was unbound on every single-record delete, so this
    // condition was unevaluable and #4775 failed the whole operation — with the
    // generic `Unknown variable: previous`, which reads as a misspelling.
    const audited: string[] = [];
    const { engine, conditionWarnings } = await bootDelete([{
      name: 'audit_completed_task_deletion',
      object: 'hook_task',
      events: ['afterDelete'],
      priority: 90,
      condition: "previous.status == 'done'",
      handler: (ctx: any) => { audited.push(String(ctx.input?.id ?? '?')); },
    } as unknown as Hook]);

    const done: any = await engine.insert('hook_task', { title: 'Shipped', status: 'done', done: true });
    const open: any = await engine.insert('hook_task', { title: 'Draft', status: 'todo', done: false });

    // Neither delete is rejected, and the condition SELECTS: it fires for the
    // completed task and not for the open one.
    await expect(engine.delete('hook_task', { where: { id: done.id } } as any)).resolves.toBeDefined();
    await expect(engine.delete('hook_task', { where: { id: open.id } } as any)).resolves.toBeDefined();

    expect(audited).toEqual([done.id]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('is TOTAL over declared fields on a delete too — an unwritten column reads as null', async () => {
    // Same materialisation the update side gets: `done` was never written, so
    // the driver's row has no such key. `previous.done` must read as the
    // materialised null rather than aborting the condition.
    const audited: string[] = [];
    const { engine, conditionWarnings } = await bootDelete([{
      name: 'audit_incomplete_deletion',
      object: 'hook_task',
      events: ['beforeDelete'],
      priority: 90,
      condition: 'previous.done != true',
      handler: (ctx: any) => { audited.push(String(ctx.input?.id ?? '?')); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'Untouched', status: 'todo' });
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    expect(audited).toEqual([row.id]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('does not leak materialised nulls into what the delete hook observes', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const { engine } = await bootDelete([{
      name: 'observe_previous_on_delete',
      object: 'hook_task',
      events: ['afterDelete'],
      priority: 90,
      condition: 'previous.archived == null',
      handler: (ctx: any) => { seen.push(ctx.previous); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'todo' });
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    expect(seen).toHaveLength(1);
    // `archived` is declared and was materialised for the condition; the
    // engine's own pre-image must not have gained a column the row never had.
    expect(Object.keys(seen[0] as object).sort()).toEqual(['id', 'status', 'title']);
  });

  it('reads the pre-image ONCE for both phases', async () => {
    // The cost guardrail: `beforeDelete` and `afterDelete` share one read, and
    // it is the SAME read the roll-up summary path used to make separately.
    const before: Array<Record<string, unknown> | undefined> = [];
    const after: Array<Record<string, unknown> | undefined> = [];
    const { engine, reads } = await bootDelete([
      observer('beforeDelete', before),
      observer('afterDelete', after),
    ]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const baseline = reads.findOne;
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    expect(reads.findOne - baseline).toBe(1);
    expect(before[0]).toEqual(after[0]);
  });

  it('reads nothing at all when the object has no delete-side hook', async () => {
    // Demand-driven, exactly like update()'s prior-row gate: an object nobody
    // observes on delete pays for no pre-image.
    const { engine, reads } = await bootDelete([{
      name: 'update_only_guard',
      object: 'hook_task',
      events: ['afterUpdate'],
      priority: 100,
      condition: 'record.status == "todo"',
      handler: () => {},
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const baseline = reads.findOne;
    await engine.delete('hook_task', { where: { id: row.id } } as any);

    expect(reads.findOne - baseline).toBe(0);
  });

  it('leaves `previous` UNBOUND when the row is not there — nothing is fabricated', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const { engine } = await bootDelete([observer('beforeDelete', seen)]);

    await engine.delete('hook_task', { where: { id: 'never_existed' } } as any);

    // `{}` or `null` here would let `previous.status == "done"` answer for a
    // record nobody read. Absent stays absent (#4649/#4775).
    expect(seen).toEqual([undefined]);
  });
});
