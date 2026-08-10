// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5038, rescoping #5037] Where the bulk-write hook-condition diagnostic still
 * applies, and where the per-row contract retired it.
 *
 * The 2026-08-04 ruling on #4800 / #4862 settled the contract, recorded as
 * ADR-0058's bulk-write addendum: on a predicate (`multi: true`) write,
 * after-hooks and the record-change flow triggers riding them **evaluate and
 * fire per row**. #5037 shipped an rc-window stopgap for the gap — a rejection
 * that named the limitation instead of blaming the author, and promised to
 * retire when the contract landed. #5038 landed it.
 *
 * The promise is kept ASYMMETRICALLY, and that asymmetry is the point of this
 * file. Per-row dispatch is an AFTER-phase idea: a bulk write's after-hooks now
 * get one single-record-shaped context per matched row, so a transition
 * condition on `afterUpdate`/`afterDelete` evaluates as authored and never
 * reaches the diagnostic. Its `before*` hooks still fire ONCE for the whole
 * batch — not a version gap, but what the phase IS: a `before*` hook may still
 * rewrite the payload, and one `updateMany` carries one payload, so there is
 * nothing per-row to hand it. The diagnostic therefore survives, rescoped, for
 * exactly that dispatch, and its message no longer promises an expiry it would
 * now be breaking.
 *
 *   a. RETIRED (#5574): the batch dispatch itself, and with it the whole
 *      diagnostic. A `previous`-reading `beforeUpdate` condition on a bulk
 *      write now evaluates PER ROW as authored, so the write succeeds; the
 *      `limitation` discriminator and the `predicateBulkWrite` flag are gone
 *      from `HookConditionError` under ADR-0049, and the pin that matters is
 *      that no dispatch lacking `previous` is produced at all;
 *   b. the SAME hook on a single-record write → completely unchanged;
 *   c. a condition that does NOT read `previous` → unchanged, including the
 *      plain typo report;
 *   d. RETIRED with (a): the AST-based `previous` detection that decided WHICH
 *      limitation to name;
 *   e. RETIRED by #5038: the same condition on an `afterUpdate` hook, through
 *      the real engine, evaluates per row and the bulk write SUCCEEDS.
 *
 * ⚠️ (a) and (d) are kept as inverted/annotated blocks rather than deleted:
 * a reversed decision is a record (Prime Directive #13), and the diagnostic's
 * two-year arc — #5037 stopgap, #5038 half-retirement, #5574 full — is the
 * clearest available argument for fixing a producer instead of documenting a
 * limitation.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook, HookConditionError } from './hook-wrappers.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
  archived: { name: 'archived', label: 'Archived', type: 'boolean' as const },
  // Declared on purpose: a field whose NAME starts with the root's spelling, so
  // a detector matching the source text rather than the parsed AST mistakes
  // `record.previous_status` for a `previous` reference (see the pin below).
  previous_status: { name: 'previous_status', label: 'Previous status', type: 'text' as const },
};
const taskObject = { name: 'hook_task', label: 'Task', fields: TASK_FIELDS };
const qlStub = { getObject: (n: string) => (n === 'hook_task' ? taskObject : undefined) };

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeHook(condition: string, extra: Partial<Hook> = {}): Hook {
  return {
    name: 'audit_task_completion', object: 'hook_task', events: ['beforeUpdate'], priority: 100,
    condition, handler: () => {},
    ...extra,
  } as unknown as Hook;
}

/**
 * The BATCH dispatch of a predicate (`multi: true`) write: no id, no prior
 * record — exactly what the engine's bulk branch builds for `beforeUpdate` /
 * `beforeDelete`, one call standing for N matched rows.
 */
function batchCtx(data: Record<string, unknown>, event = 'beforeUpdate'): HookContext {
  return {
    object: 'hook_task',
    event,
    input: { data, options: { multi: true } },
    previous: undefined,
    ql: qlStub,
  } as unknown as HookContext;
}

/** The same write targeted at one record: prior row in hand, `previous` bound. */
function singleCtx(data: Record<string, unknown>): HookContext {
  return {
    object: 'hook_task',
    event: 'afterUpdate',
    input: { id: 't1', data },
    previous: { id: 't1', title: 'Ship it', status: 'todo', done: false },
    ql: qlStub,
  } as unknown as HookContext;
}

/* ────────────────────────────────────────────────────────────────────────────
 * a. RETIRED — the batch dispatch, and the whole diagnostic that described it
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5574] the batch dispatch is GONE, and so is its diagnostic', () => {
  const TRANSITION = 'previous.done != true && record.done == true';

  it('the bulk write #5037 and #5038 both rejected now SUCCEEDS, firing per row', async () => {
    // ⚠️ The inverse of what this block asserted until #5574. It used to pin
    // "rejects with a machine-readable `limitation`" — a legal, contract-shaped
    // transition condition on a `beforeUpdate` hook aborted every bulk write,
    // and the diagnostic's job was to explain that the platform, not the
    // author, was at fault.
    //
    // ADR-0058 Addendum II removed the fault instead of explaining it: a
    // predicate write dispatches `beforeUpdate` once per matched row, each
    // carrying that row's `previous`, so the condition evaluates as authored.
    const audited: string[] = [];
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      condition: TRANSITION,
      handler: (ctx: any) => { audited.push(String(ctx.input.id)); },
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'B', status: 'todo', done: false });

    await expect(
      engine.update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any),
    ).resolves.toBeDefined();

    // Per row, each naming its own row — the transition held for both.
    expect(audited).toHaveLength(2);
    expect(new Set(audited).size).toBe(2);
    // And the write landed: fail-loud took no exception before, and there is
    // nothing left to take an exception to now.
    const rows: any[] = await engine.find('hook_task', {} as any);
    expect(rows.every((r) => r.done === true)).toBe(true);
  });

  it('does not fire for rows the transition did not happen on', async () => {
    // The other half of "evaluates as authored": a transition is a transition,
    // per row. Under the batch dispatch this distinction could not exist —
    // there was one call and no row to judge.
    const audited: string[] = [];
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      condition: TRANSITION,
      handler: (ctx: any) => { audited.push(String((ctx.previous as any).title)); },
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'already', status: 'todo', done: true });

    await engine.update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any);

    expect(audited).toEqual(['A']);
  });

  it('never dispatches a context that lacks `previous` — the producer is gone, not just the message', async () => {
    // The load-bearing pin of the retirement. `HookConditionLimitation` was
    // removed under ADR-0049 because it had no producer; that claim is only
    // worth as much as this measurement. Every `beforeUpdate` context the
    // engine dispatches on a predicate write must carry both `input.id` and
    // `previous` — the two facts whose ABSENCE `isPredicateBulkWrite` used to
    // key on.
    const seen: HookContext[] = [];
    const engine = await bootEngine([{
      name: 'observer', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      handler: (ctx: any) => { seen.push({ id: ctx.input.id, previous: ctx.previous } as any); },
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'B', status: 'todo', done: false });

    await engine.update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any);

    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect((ctx as any).id).toBeDefined();
      expect(ctx.previous).toBeDefined();
    }
  });

  it('carries NO `limitation` / `predicateBulkWrite` even on a hand-fabricated batch context', async () => {
    // The engine cannot build this context any more — but a stale double, a
    // test helper or a future refactor could. If one ever does, the author gets
    // the plain diagnosis, not a resurrected discriminator: the fields are gone
    // from `HookConditionError` entirely, so reintroducing the branch means
    // reintroducing the type, which is a visible edit rather than a quiet one.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect((err as any).limitation).toBeUndefined();
    expect((err as any).predicateBulkWrite).toBeUndefined();
    // Still no `.code`: ADR-0112 keeps `error.code` a closed wire vocabulary,
    // and `rest-server.ts` promotes a thrown error's `.code` onto the envelope.
    expect((err as any).code).toBeUndefined();
    // Fail-loud is untouched — an unevaluable condition still aborts (#4775).
    expect(err.reason).toBe('unevaluable');
    expect(err.hook).toBe('audit_task_completion');
    // And the message is the plain one, with no batch prose left to maintain.
    expect(err.message).not.toContain('PREDICATE bulk write');
    expect(err.message).not.toContain('PER MATCHED ROW');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * b. The single-record write of the SAME hook is untouched
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] a single-record write is completely unchanged', () => {
  const TRANSITION = 'previous.done != true && record.done == true';

  it('binds `previous`, evaluates the transition, and runs the handler', async () => {
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION, { events: ['afterUpdate'] } as any),
      (async () => { ran.push('audited'); }) as any, { logger: silentLogger },
    );

    await wrapped(singleCtx({ done: true }));

    expect(ran).toEqual(['audited']);
  });

  it('skips (without throwing) when the transition did not happen', async () => {
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION, { events: ['afterUpdate'] } as any),
      (async () => { ran.push('audited'); }) as any, { logger: silentLogger },
    );
    // Already done before the write → not a transition → plain skip, no error.
    const ctx = singleCtx({ done: true });
    (ctx as any).previous = { id: 't1', title: 'Ship it', status: 'todo', done: true };

    await wrapped(ctx);

    expect(ran).toEqual([]);
  });

  it('through the real engine: the update lands and the hook fires', async () => {
    const ran: string[] = [];
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition: TRANSITION,
      handler: () => { ran.push('audited'); },
    } as unknown as Hook]);

    const row: any = await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    const updated: any = await engine.update('hook_task', { done: true }, { where: { id: row.id } } as any);

    expect(updated.done).toBe(true);
    expect(ran).toEqual(['audited']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * c. A batch dispatch whose condition does not read `previous` is untouched
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] a batch dispatch with no `previous` in the condition is unaffected', () => {
  it('evaluates over the payload and runs the handler', async () => {
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true'), (async () => { ran.push('ran'); }) as any, { logger: silentLogger },
    );

    await wrapped(batchCtx({ done: true }));

    expect(ran).toEqual(['ran']);
  });

  it('still skips quietly when the condition is FALSE', async () => {
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true'), (async () => { ran.push('ran'); }) as any, { logger: silentLogger },
    );

    await wrapped(batchCtx({ done: false }));

    expect(ran).toEqual([]);
  });

  it('reports an UNDECLARED key as the typo it is, with no batch talk', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "x"'), (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect(err.limitation).toBeUndefined();
    expect(err.predicateBulkWrite).toBeUndefined();
    expect(err.message).toContain("reads 'stauts', which this object does not declare");
    expect(err.message).not.toContain('PREDICATE bulk write');
  });

  it('a DECLARED-but-unset field reads as the ordinary unevaluable case now', async () => {
    // ⚠️ This used to pin the SECOND limitation member,
    // `bulk_write_stored_state_unavailable`: on a batch dispatch `record` was
    // the bare payload, so a condition naming a declared field this write does
    // not set was unevaluable through no fault of the author's, and the message
    // said so. Retired with its twin (#5574) — a per-row `beforeUpdate` context
    // merges the row's stored state into `record`, so the case it described no
    // longer arises from a bulk write. What remains is the plain diagnosis,
    // which is the right one for any OTHER way of reaching it.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == true'), (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect((err as any).limitation).toBeUndefined();
    expect((err as any).predicateBulkWrite).toBeUndefined();
    expect(err.reason).toBe('unevaluable');
  });

  it('is inert for a comprehension variable that happens to be named `previous`', async () => {
    // Kept from the retired section (d): this case never depended on the
    // batch-dispatch branch. `collectCelRootIdentifiers` reports comprehension
    // bind variables as roots (its documented caveat), so this condition "reads
    // previous" by that measure — and it is a non-event, because the expression
    // binds its own variable and evaluates.
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('[1, 2].exists(previous, previous > 1)'),
      (async () => { ran.push('ran'); }) as any, { logger: silentLogger },
    );

    await wrapped(batchCtx({ done: true }));

    expect(ran).toEqual(['ran']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * d. RETIRED with the branch it measured — the AST-based `previous` detection
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ⛔ Six cases stood here until #5574 and are gone with their subject. They
 * measured how the batch-dispatch diagnosis decided WHICH limitation to name:
 * off the parsed CEL AST (`collectCelRootIdentifiers`) rather than off cel-js's
 * fault prose, so a reworded upstream message could not silently turn the
 * diagnosis back into a riddle — including the case where the fault named some
 * OTHER key the same condition also read, and the deliberate non-match of
 * `record.previous_status` (a member name, not the root).
 *
 * That detection was consulted ONLY on the error path of a batch dispatch. With
 * no batch dispatch, there is no error path and nothing to decide, so keeping
 * the cases would have meant keeping `conditionReadsPrevious` alive to be
 * tested — a helper whose only caller was removed. The reasoning is preserved
 * where a future diagnosis would look for it (`hook-wrappers.ts`, the retirement
 * note), not here.
 *
 * One case did NOT depend on the branch and is kept, in section (c) above: a
 * condition that reads a comprehension bind variable named `previous`
 * evaluates fine and runs its handler.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * e. RETIRED — the after-type dispatch of the very same write now succeeds
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] the diagnostic is RETIRED for after-type hooks', () => {
  const TRANSITION = 'previous.done != true && record.done == true';

  it('the bulk write that #5037 rejected now succeeds, firing the hook per row', async () => {
    // The exact scenario `hook-condition-bulk-previous.test.ts` used to pin as a
    // rejection, verbatim except for the event. This is the contract landing.
    const audited: string[] = [];
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition: TRANSITION,
      handler: (ctx: any) => { audited.push(String(ctx.previous?.id ?? ctx.input?.id)); },
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'B', status: 'todo', done: false });

    const affected = await engine.update(
      'hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any,
    );

    // The write's own contract is untouched — a predicate update still resolves
    // the affected COUNT (#4639), not a list of rows.
    expect(affected).toBe(2);
    // …and the transition hook fired once per matched row.
    expect(audited).toHaveLength(2);
    expect(new Set(audited).size).toBe(2);
  });

  it('does not fire for rows the transition did not happen on', async () => {
    // The whole reason `previous` exists: an already-done row is not a
    // transition. Per-row evaluation is what makes that distinction possible on
    // a batch — one payload, N different prior states.
    const audited: string[] = [];
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['afterUpdate'], priority: 90,
      condition: TRANSITION,
      handler: (ctx: any) => { audited.push(String(ctx.previous?.title)); },
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'fresh', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'already', status: 'todo', done: true });

    await engine.update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any);

    // Both rows matched the predicate; only ONE of them transitioned.
    expect(audited).toEqual(['fresh']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Real-engine harness (mirrors hook-condition-fail-loud.test.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

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
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
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
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

async function bootEngine(hooks: Hook[]): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver(), true);
  await engine.init();
  engine.registry.registerObject(taskObject);
  bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  return engine;
}
