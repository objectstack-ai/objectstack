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
 *   a. batch (`before*`) dispatch + a condition reading `previous` → the named
 *      `limitation`, the phase as the reason, and the after-type event as the
 *      first route out;
 *   b. the SAME hook on a single-record write → completely unchanged;
 *   c. a batch dispatch whose condition does NOT read `previous` → unchanged,
 *      including the plain typo report;
 *   d. the generic `No such key` / `Unknown variable` riddle is never the WHOLE
 *      story for (a) — including when the fault names some other key the same
 *      condition reads, which is what AST-based detection
 *      (`collectCelRootIdentifiers`) buys over reading cel-js's prose;
 *   e. RETIRED: the same condition on an `afterUpdate` hook, through the real
 *      engine, now evaluates per row and the bulk write SUCCEEDS.
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
 * a. The batch (`before*`) dispatch reading `previous` keeps the named limitation
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] the batch dispatch of a bulk write, whose condition reads `previous`', () => {
  const TRANSITION = 'previous.done != true && record.done == true';

  it('rejects with a machine-readable `limitation`, not just prose', async () => {
    const ran: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => { ran.push('audited'); }) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    // The discriminator a caller branches on. Deliberately NOT `code`: ADR-0112
    // makes `error.code` a closed wire vocabulary and `rest-server.ts` promotes
    // a thrown error's `.code` onto the envelope, so a `.code` here would mint
    // an unregistered wire code by side effect.
    expect(err.limitation).toBe('bulk_write_previous_unbound');
    expect((err as any).code).toBeUndefined();
    expect(err.predicateBulkWrite).toBe(true);
    expect(err.reason).toBe('unevaluable');
    expect(err.hook).toBe('audit_task_completion');
    expect(err.condition).toBe(TRANSITION);
    // …and the handler never ran (the gate is before it).
    expect(ran).toEqual([]);
  });

  it('names the batch, the missing binding, and the PHASE as the reason', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    expect(err.message).toContain("Hook 'audit_task_completion'");
    expect(err.message).toContain('PREDICATE bulk write (multi: true)');
    expect(err.message).toContain('no single prior record to bind');
    expect(err.message).toContain("'beforeUpdate'");
    // The reason is now the phase, not a missing release. A `before*` hook may
    // still rewrite the shared payload, so it cannot be per-row.
    expect(err.message).toContain('before any row is written');
    expect(err.message).toContain('ADR-0058');
  });

  it('no longer promises an expiry that has already happened', async () => {
    // #5037's message said "this rejection retires when #5038 lands". It has
    // landed. Repeating that sentence would be a promise the platform is now
    // breaking — an author would wait for a release that already shipped.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    expect(err.message).not.toContain('CURRENT-VERSION limitation');
    expect(err.message).not.toMatch(/retires when/);
  });

  it('leads with the after-type event — the route the contract just made real', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    // The first route out is the one per-row dispatch created: the same
    // condition on the matching after-type event evaluates as authored.
    expect(err.message).toContain("'afterUpdate'");
    expect(err.message).toContain('PER MATCHED ROW');
    // Single-record targeting still works and is still named.
    expect(err.message).toContain('one record (update by id)');
    // Dropping `previous` is not free and the message must not present it as
    // the fix: a transition silently becomes a state test.
    expect(err.message).toContain('becomes a state test');
  });

  it('now DOES name the record-change flow trigger — the fact it was refused over changed', async () => {
    // #5037 deliberately refused this route on measured evidence: the trigger
    // subscribes to these same lifecycle hooks, so on a bulk write it fired once
    // with the same unbound `previous` (#4862). #5038 fixed it at the producer,
    // so an after-type record-change trigger rides the per-row dispatch. The
    // message follows the fact rather than the other way round.
    const wrapped = wrapDeclarativeHook(
      makeHook(TRANSITION), (async () => {}) as any, { logger: silentLogger },
    );
    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    expect(err.message).toContain('record-change flow trigger');
    expect(err.message).not.toContain('A record-change flow trigger is NOT a way around this');
  });

  it('names `beforeDelete` for a delete-shaped batch dispatch', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook('previous.done != true', { events: ['beforeDelete'] } as any),
      (async () => {}) as any, { logger: silentLogger },
    );
    const ctx = {
      object: 'hook_task', event: 'beforeDelete',
      input: { options: { multi: true } }, previous: undefined, ql: qlStub,
    } as unknown as HookContext;

    const err = await wrapped(ctx).then(() => null, (e) => e);
    expect(err.limitation).toBe('bulk_write_previous_unbound');
    expect(err.message).toContain("'afterDelete'");
  });

  it('still ABORTS the write — the rescoping is not an exemption', async () => {
    const engine = await bootEngine([{
      name: 'audit_task_completion', object: 'hook_task', events: ['beforeUpdate'], priority: 90,
      condition: TRANSITION,
      handler: () => {},
    } as unknown as Hook]);

    await engine.insert('hook_task', { title: 'A', status: 'todo', done: false });
    await engine.insert('hook_task', { title: 'B', status: 'todo', done: false });

    const err = await engine
      .update('hook_task', { done: true }, { multi: true, where: { status: 'todo' } } as any)
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(HookConditionError);
    expect(err.limitation).toBe('bulk_write_previous_unbound');
    // Fail loud takes no exception: nothing was written.
    const rows: any[] = await engine.find('hook_task', {} as any);
    expect(rows.every((r) => r.done === false)).toBe(true);
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

  it('keeps the DECLARED-but-unset field diagnosis on its own limitation name', async () => {
    // Same root cause (no stored row in hand), different remedy, so it carries
    // its own machine-readable name rather than being folded into `previous`.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == true'), (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect(err.limitation).toBe('bulk_write_stored_state_unavailable');
    expect(err.predicateBulkWrite).toBe(true);
    expect(err.message).toContain("'archived' IS declared on this object");
    // Same rescoping: the after-type event is where `record` holds the row's
    // real state, so it is named here too.
    expect(err.message).toContain("'afterUpdate'");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * d. The riddle is never the whole story for the `previous` case
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#5038] the generic CEL fault is never the whole story on this path', () => {
  it('does not leave the author with the bare `No such key` / unbound-root sentence', async () => {
    const wrapped = wrapDeclarativeHook(
      makeHook('previous.done != true && record.done == true'),
      (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ done: true })).then(() => null, (e) => e);

    // `describeCelFault`'s generic sentences — both of which read as "you wrote
    // it wrong" — must not be what this author is left holding.
    expect(err.message).not.toMatch(/which this object does not declare/);
    expect(err.message).not.toMatch(/which is not bound for this operation/);
    // The raw fault still travels as a FACT (`fault`, and the head's summary),
    // it is simply no longer the diagnosis.
    expect(err.fault).toMatch(/Unknown variable: previous|No such key: previous/);
  });

  it('names `previous` for a condition that also reads a declared-but-unset field', async () => {
    // Both halves are unevaluable on a batch dispatch, for the same reason. The
    // `previous` half is the one the author cannot work around by writing the
    // condition differently, so it is the one the message leads with — reading
    // the answer off the parsed AST rather than off whichever fault the
    // evaluator happened to raise first is what keeps that true.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == true && previous.done != true'),
      (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect(err.limitation).toBe('bulk_write_previous_unbound');
    expect(err.message).toContain("The condition reads 'previous'");
  });

  it('does NOT mistake a declared field spelled like the root for a `previous` reference', async () => {
    // The AST reports ROOT identifiers; `previous_status` is a member name
    // under `record`, so the root set is `{record}` and this write gets the
    // declared-field diagnosis (whose remedy — reference only what this write
    // sets — is the correct one here). A detector matching the source TEXT
    // would answer `bulk_write_previous_unbound` and send the author looking
    // for a `previous` reference that is not there.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.previous_status == "todo"'),
      (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect(err.limitation).toBe('bulk_write_stored_state_unavailable');
    expect(err.message).toContain("'previous_status' IS declared on this object");
    expect(err.message).not.toContain("The condition reads 'previous'");
  });

  it('keeps the typo sentence when the condition BOTH misspells a key and reads `previous`', async () => {
    // The two halves have different owners: the typo is the author's, the batch
    // limitation is the platform's. Reporting only one would send them back for
    // a second round.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.stauts == "x" && previous.done != true'),
      (async () => {}) as any, { logger: silentLogger },
    );

    const err = await wrapped(batchCtx({ status: 'x' })).then(() => null, (e) => e);

    expect(err.limitation).toBe('bulk_write_previous_unbound');
    if (err.missingKey === 'stauts') {
      // The evaluator surfaced the typo → the author is told about BOTH.
      expect(err.message).toContain("reads 'stauts', which this object does not declare");
    }
    expect(err.message).toContain('PREDICATE bulk write (multi: true)');
  });

  it('is inert for a comprehension variable that happens to be named `previous`', async () => {
    // `collectCelRootIdentifiers` reports comprehension bind variables as roots
    // (its documented caveat), so this condition "reads previous" by that
    // measure. It is a non-event: the expression binds its own variable and
    // evaluates, so the answer is never consulted.
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
  engine.registry.registerObject(taskObject as any);
  bindHooksToEngine(engine, hooks, { packageId: 'app:test', logger: silentLogger });
  return engine;
}
