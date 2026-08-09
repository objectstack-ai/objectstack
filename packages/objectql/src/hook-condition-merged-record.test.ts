// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4770] A declarative hook `condition` is evaluated against the RECORD —
 * the stored row overlaid with this write's payload, made total over the
 * object's declared fields — not against the update payload alone.
 *
 * Before this fix `pickRecordPayload` returned `ctx.input.data` and never
 * reached `ctx.previous`, so a condition could only reference a field the
 * update happened to touch. `showcase_audit_task_completion`
 * (`condition: "record.done == true"`) therefore did NOT run on the most
 * ordinary updates of all — change the status, change the assignee — because
 * `done` was not in the payload: CEL aborted with `No such key: done` and the
 * gate swallowed that into `false` plus one WARN line.
 *
 * The semantics reused here are #4649's (`validation/rule-validator.ts`, via
 * the shared `materializeDeclaredFields`): payload ⊕ prior record, `null` for a
 * DECLARED key present in neither. Declared-only is the load-bearing half — a
 * typo'd or undeclared key must stay unevaluable, so the existing
 * warn-and-treat-as-false fallback (deliberately UNCHANGED here; the failure
 * direction is tracked separately) still reports it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

/** Fields as an object declares them; `archived` is never written by any test,
 *  so it exists only as a DECLARATION — the case materialisation covers. */
const TASK_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  title: { name: 'title', label: 'Title', type: 'text' as const },
  status: { name: 'status', label: 'Status', type: 'text' as const },
  done: { name: 'done', label: 'Done', type: 'boolean' as const },
  archived: { name: 'archived', label: 'Archived', type: 'boolean' as const },
};

const taskObject = { name: 'hook_task', label: 'Task', fields: TASK_FIELDS };

/** Minimal `ctx.ql` stand-in: the condition gate only ever asks the engine for
 *  the object's declared fields, which is an in-memory registry read. */
const qlStub = {
  getObject: (name: string) => (name === 'hook_task' ? taskObject : undefined),
};

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'hook_task',
    event: 'afterUpdate',
    input: { id: 't1', data: { status: 'in_progress' } },
    previous: { id: 't1', title: 'Ship it', status: 'todo', done: true },
    ql: qlStub,
    ...overrides,
  } as unknown as HookContext;
}

function makeHook(condition: string, calls: string[]): Hook {
  return {
    name: 'audit', object: 'hook_task', events: ['afterUpdate'], priority: 100,
    condition,
    handler: () => { calls.push('ran'); },
  } as Hook;
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

describe('[#4770] hook condition evaluates against stored ⊕ payload', () => {
  it('fires on a declared field the update payload does NOT carry', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const wrapped = wrapDeclarativeHook(makeHook('record.done == true', calls), (async (ctx: any) => {
      calls.push(ctx.event);
    }) as any, { logger });

    await wrapped(makeCtx());

    // The payload is `{ status }` only; `done` comes from the stored record.
    expect(calls).toEqual(['afterUpdate']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('the payload still WINS over the stored value for a field it does carry', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true', calls),
      (async () => { calls.push('ran'); }) as any,
    );

    // stored done=true, this write flips it to false → must NOT fire.
    await wrapped(makeCtx({ input: { id: 't1', data: { done: false } } } as any));
    expect(calls).toEqual([]);

    // stored done=false, this write flips it to true → must fire.
    await wrapped(makeCtx({
      previous: { id: 't1', status: 'todo', done: false },
      input: { id: 't1', data: { done: true } },
    } as any));
    expect(calls).toEqual(['ran']);
  });

  it('materialises a DECLARED field absent from both payload and stored row', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    // `archived` is declared but the driver returned no such column — the
    // shape #4649 describes. `record.archived == null` must be answerable.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == null', calls),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await wrapped(makeCtx());
    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('an UNDECLARED key stays unevaluable — materialisation does not paper over typos', async () => {
    const calls: string[] = [];
    const { logger } = captureLogger();
    // `dnoe` is the classic transposition of `done`. Nothing declares it, so
    // it must NOT be materialised to null and quietly answered "false".
    // Since #4775 the unevaluable condition ABORTS the operation instead of
    // being swallowed into `false` — the typo is reported, not absorbed.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.dnoe == true', calls),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    await expect(wrapped(makeCtx())).rejects.toThrow(/No such key: dnoe/);
    expect(calls).toEqual([]);
  });

  it('fabricates nothing when the prior row is not in hand (context with no `previous`)', async () => {
    const calls: string[] = [];
    const { logger } = captureLogger();
    // The invariant is unchanged and is the whole point of this file: with no
    // stored row in hand, `record` is NOT made total. Defaulting `done` to null
    // would not materialise an absent value — it would contradict whatever is
    // actually stored. #4775: the condition is unevaluable, and unevaluable
    // ABORTS the operation.
    //
    // ⚠️ The message this used to match (`/PREDICATE bulk write/`) is gone with
    // #5574. This context — no id, `multi: true`, no `previous` — was the batch
    // dispatch of a predicate write, and the engine no longer builds one: a
    // predicate write dispatches `before*` per matched row with `previous`
    // bound (ADR-0058 Addendum II). So the special diagnosis had no reachable
    // input and was retired under ADR-0049; what a hand-fabricated context gets
    // now is the plain one.
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == null', calls),
      (async () => { calls.push('ran'); }) as any,
      { logger },
    );

    const err = await wrapped(makeCtx({
      previous: undefined,
      input: { data: { status: 'x' }, options: { multi: true } },
    } as any)).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe('unevaluable');
    expect(err.message).not.toContain('PREDICATE bulk write');
    // Nothing was fabricated and the handler never ran — the gate is before it.
    expect(calls).toEqual([]);
  });

  it('materialises on INSERT too — same record shape a validation predicate reads', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const meta = { ...makeHook('record.done == null', calls), events: ['beforeInsert'] } as Hook;
    const wrapped = wrapDeclarativeHook(meta, (async () => { calls.push('ran'); }) as any, { logger });

    await wrapped(makeCtx({
      event: 'beforeInsert',
      previous: undefined,
      input: { data: { title: 'fresh' } },
    } as any));

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('evaluates a delete-shaped context against the (materialised) pre-image', async () => {
    const calls: string[] = [];
    const { logger, conditionWarnings } = captureLogger();
    const meta = { ...makeHook('record.done == true', calls), events: ['beforeDelete'] } as Hook;
    const wrapped = wrapDeclarativeHook(meta, (async () => { calls.push('ran'); }) as any, { logger });

    await wrapped(makeCtx({
      event: 'beforeDelete',
      input: { id: 't1', options: {} },
    } as any));

    expect(calls).toEqual(['ran']);
    expect(conditionWarnings()).toEqual([]);
  });

  it('never mutates the engine\'s own ctx.previous / ctx.input.data', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.archived == null', calls),
      (async () => { calls.push('ran'); }) as any,
    );
    const ctx = makeCtx();
    await wrapped(ctx);

    expect(calls).toEqual(['ran']);
    // The after-hooks that run next observe these objects; a materialised
    // `archived: null` leaking into them would be a fabricated column.
    expect(Object.keys(ctx.previous as object).sort()).toEqual(['done', 'id', 'status', 'title']);
    expect(Object.keys((ctx.input as any).data)).toEqual(['status']);
  });

  it('a context with no engine still merges (no materialisation, no crash)', async () => {
    const calls: string[] = [];
    const wrapped = wrapDeclarativeHook(
      makeHook('record.done == true', calls),
      (async () => { calls.push('ran'); }) as any,
    );
    await wrapped(makeCtx({ ql: undefined } as any));
    expect(calls).toEqual(['ran']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The showcase repro, at integration level.
 *
 * `rm -rf examples/app-showcase/.objectstack && pnpm dev` printed ten
 * `condition evaluation failed` lines for `showcase_audit_task_completion`.
 * This is the same object/hook shape driven through a REAL engine over a
 * stub driver that — like a SQL driver — stores only the columns a write
 * actually touched.
 * ──────────────────────────────────────────────────────────────────────────── */

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
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      // Only the written columns are stored — a declared-but-unwritten column
      // is simply absent from every row this driver ever returns.
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
  return { driver, stores };
}

describe('[#4770] showcase repro — showcase_audit_task_completion over a real engine', () => {
  let engine: ObjectQL;
  let audited: string[];
  let warn: ReturnType<typeof vi.fn>;

  const conditionWarnings = () =>
    warn.mock.calls.filter(([msg]) => String(msg).includes('condition evaluation failed'));

  beforeEach(async () => {
    engine = new ObjectQL();
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(taskObject);

    audited = [];
    warn = vi.fn();
    bindHooksToEngine(
      engine,
      [{
        // The showcase hook, minus `async` (fire-and-forget would make the
        // assertion a race) and minus the sandboxed body (the condition gate
        // runs before either).
        name: 'showcase_audit_task_completion',
        object: 'hook_task',
        events: ['afterUpdate'],
        priority: 90,
        condition: 'record.done == true',
        handler: (ctx: any) => { audited.push(String(ctx.input?.id ?? '?')); },
      } as unknown as Hook],
      { packageId: 'app:showcase', logger: { debug: () => {}, info: () => {}, warn, error: () => {} } },
    );
  });

  it('audits a completed task on an update that never mentions `done`', async () => {
    const row: any = await engine.insert('hook_task', { title: 'Ship it', status: 'todo', done: true });

    // The most ordinary update there is: move the status, nothing else.
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(audited).toEqual([row.id]);
    // The ten-lines-per-boot symptom the issue opened on.
    expect(conditionWarnings()).toEqual([]);
  });

  it('still does not audit a task that is not done', async () => {
    const row: any = await engine.insert('hook_task', { title: 'Draft', status: 'todo', done: false });
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(audited).toEqual([]);
    expect(conditionWarnings()).toEqual([]);
  });

  it('a task whose `done` column was never written reads as null, not as a fault', async () => {
    // The driver stores only written columns, so this row carries no `done` at
    // all — the case that used to fault even WITH the prior record merged in.
    const row: any = await engine.insert('hook_task', { title: 'Untouched', status: 'todo' });
    await engine.update('hook_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    expect(audited).toEqual([]);
    expect(conditionWarnings()).toEqual([]);
  });
});
