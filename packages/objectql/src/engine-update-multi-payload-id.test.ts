// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#6262 — a `multi: true` update must not hand the driver an `id`
// in the SET payload.
//
// ## The shape
//
// `update(o, { id: { $in: ['a','b'] }, title: 'x' }, { multi: true })` has
// dispatched correctly since objectstack#5748 / PR #5919: an operator object is
// not a primary key, so it stops shadowing the ladder and the declared bulk
// intent is honoured — `driver.updateMany`. What #5748 did NOT do is clean the
// PAYLOAD. The measured probe on `origin/main` (#6262's issue body):
//
// ```
// updateMany(
//   { object: 'probe_task' },
//   { id: { $in: ['a','b'] }, title: 'x' },   <-- the SET clause
// )
// ```
//
// i.e. the driver is asked to write a serialized operator object into the
// PRIMARY-KEY column of every matched row. Five backends would each answer that
// differently (the #5240 / #4434 family), and on the ones that accept it every
// matched row loses its identity.
//
// ## Why the fix is a strip and not a rejection
//
// Route B ("reject the whole call") would reverse a verdict
// `ENGINE_UPDATE_DISPATCH_CASES` states today —
// `operator object in data.id WITH multi:true` expects `'multi'` — i.e. a
// partial rollback of #5748's ruling A, which needs a fresh decision. Route A
// changes NO verdict: the dispatch already answered "this `data.id` is not a
// primary key", and the strip is nothing more than that same answer applied to
// the payload — a value the engine has ruled is not an id has no business
// sitting in the id column either. One question, one answer (#4550 / #4434).
//
// ## The rule, stated once
//
// Reaching the `multi` branch AT ALL means `resolveEngineUpdateDispatch`
// returned `{ kind: 'multi' }`, which means it found no scalar truthy id in
// EITHER source. So every `id` a payload can carry into this branch — an
// operator object, an array, `null`, a falsy scalar — is a value the dispatch
// has already ruled is not a primary key. There is no reachable shape where a
// bulk SET clause legitimately carries `id`: a truthy scalar `data.id` outranks
// both `where` and `multi` and never gets here (pinned below), and N rows
// cannot share one primary key anyway. Hence one rule with no exceptions,
// rather than a second rule for each shape.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { resolveEngineUpdateDispatch } from './engine-update-dispatch.js';

interface RecordedCall {
  readonly fn: 'update' | 'updateMany';
  readonly id?: unknown;
  readonly ast?: unknown;
  /** A COPY — the engine may keep mutating its own payload after the call. */
  readonly data: Record<string, unknown>;
}

/** Records the exact SET payload each driver entry point received. */
function makeRecordingDriver() {
  const calls: RecordedCall[] = [];
  const driver: any = {
    name: 'recording',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    // [#7867] Answers the row the by-id branch's not-found gate asks for.
    // This used to be `return null`, which — now that a by-id update/delete
    // refuses a ghost id with `RECORD_NOT_FOUND` — would make every by-id case
    // in this file die at the gate and never reach the driver: a DOUBLE looser
    // than the producer, hiding the very behaviour the file exists to observe
    // (#4434/#4550's shape). It echoes back whatever id it was asked for, so it
    // stays agnostic about the dispatch and can never make a `reject` case look
    // like a `by-id` one.
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.id;
      return id === undefined || id === null ? null : { id, title: 'stored' };
    },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', id, data: { ...data } });
      return { id, ...data };
    },
    async updateMany(_o: string, ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', ast, data: { ...data } });
      return 2;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

async function makeEngine() {
  const engine = new ObjectQL();
  const { driver, calls } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'task',
    fields: { title: { type: 'text' }, tenant: { type: 'text' } },
  } as any);
  return { engine, calls };
}

/** The one driver call the engine made, asserted to be the expected entry point. */
async function observeWrite(
  data: unknown,
  options: unknown,
  expectFn: 'update' | 'updateMany',
): Promise<RecordedCall> {
  const { engine, calls } = await makeEngine();
  await engine.update('task', data as any, options as any);
  expect(calls.map((c) => c.fn), 'driver entry points reached').toEqual([expectFn]);
  return calls[0];
}

/** Own-property, never `in`: `Object.prototype` has no `id`, but say what we mean. */
function hasIdKey(payload: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(payload, 'id');
}

describe('#6262 — a multi update strips a non-id `data.id` from the SET payload', () => {
  it('the PROBE shape: operator-object data.id + multi:true reaches updateMany with NO id in the payload', async () => {
    const call = await observeWrite({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true }, 'updateMany');
    // The regression itself: before the fix this payload was
    // `{ id: { $in: ['a','b'] }, title: 'x' }` and the driver was asked to
    // write the operator object into the primary-key column.
    expect(hasIdKey(call.data), `SET payload was ${JSON.stringify(call.data)}`).toBe(false);
    // ...and the strip takes ONLY `id` — the column the caller actually meant
    // to write still lands, unchanged.
    expect(call.data).toEqual({ title: 'x' });
  });

  it('array data.id + multi:true — same strip, same surviving columns', async () => {
    const call = await observeWrite({ id: ['a', 'b'], title: 'x' }, { multi: true }, 'updateMany');
    expect(hasIdKey(call.data)).toBe(false);
    expect(call.data).toEqual({ title: 'x' });
  });

  it('null data.id + multi:true — stripped, not written as a NULL primary key', async () => {
    const call = await observeWrite({ id: null, title: 'x' }, { multi: true }, 'updateMany');
    expect(hasIdKey(call.data)).toBe(false);
    expect(call.data).toEqual({ title: 'x' });
  });

  it('a multi update that never carried an id is untouched', async () => {
    const call = await observeWrite({ title: 'x' }, { where: { tenant: 't1' }, multi: true }, 'updateMany');
    expect(call.data).toEqual({ title: 'x' });
    // The row-scoping AST is what targets the rows, and it is unaffected.
    expect(call.ast).toEqual({ object: 'task', where: { tenant: 't1' } });
  });

  it('an $in over `where.id` still targets rows through the AST, with the payload unchanged', async () => {
    const call = await observeWrite(
      { title: 'x' },
      { where: { id: { $in: ['a', 'b'] } }, multi: true },
      'updateMany',
    );
    expect(call.data).toEqual({ title: 'x' });
    expect(call.ast).toEqual({ object: 'task', where: { id: { $in: ['a', 'b'] } } });
  });

  it('does not mutate the payload object the CALLER handed in', async () => {
    const { engine } = await makeEngine();
    const callerPayload: Record<string, unknown> = { id: { $in: ['a', 'b'] }, title: 'x' };
    await engine.update('task', callerPayload as any, { multi: true } as any);
    // The strip copies, like every other strip on this path. A caller that
    // reuses its payload object (a loop over tenants) must see what it wrote.
    expect(callerPayload).toEqual({ id: { $in: ['a', 'b'] }, title: 'x' });
  });
});

describe('#6262 — the falsy scalars keep the #5747 / #5748 dispatch semantics', () => {
  // These are NOT a new verdict. `0` and `''` are scalars, so they take the
  // scalar branch of the id test and then fail its TRUTHINESS half — the engine
  // branches on `if (hookContext.input.id)` and always has (the dispatch
  // module's header point 3, and objectstack#5747 on the delete twin, whose
  // option B — "make `{ id: 0 }` really delete by id" — was explicitly not
  // taken). So the verdict here is `multi`, before this change and after it,
  // and `ENGINE_UPDATE_DISPATCH_CASES` says so in its own row.
  //
  // What DOES change is the payload, on exactly the argument above: the
  // dispatch has ruled this value is not a primary key, so writing it into the
  // primary-key column of N rows is the same defect as the operator object,
  // only quieter — a driver that accepts `id = 0` collapses every matched row
  // onto one key instead of erroring. Leaving falsy scalars in while stripping
  // operator objects would be a SECOND rule about the same fact, which is the
  // shape #4550 / #4434 exist to prevent.
  for (const falsy of [0, ''] as const) {
    it(`data.id = ${JSON.stringify(falsy)} with multi:true still dispatches multi (verdict unchanged)`, async () => {
      expect(resolveEngineUpdateDispatch({ id: falsy, title: 'x' }, { multi: true }).kind).toBe('multi');
      const call = await observeWrite({ id: falsy, title: 'x' }, { multi: true }, 'updateMany');
      expect(hasIdKey(call.data)).toBe(false);
      expect(call.data).toEqual({ title: 'x' });
    });
  }
});

describe('#6262 — the by-id path, as this file left it and as #6435 changed it', () => {
  // These three pins were written by #6262 (PR #6433) to record the by-id
  // arm's behaviour AT THAT TIME, "so a future widening of the strip is a
  // deliberate act". #6435 is that deliberate act, and it is a widening of
  // exactly ONE of the three: the last one, whose payload `id` the dispatch
  // had already ruled is not a primary key. The first two are unchanged and
  // stay here as the contrast — a SCALAR `data.id` is still handed to the
  // driver as sent. Full by-id coverage lives in its own file next door,
  // `engine-update-by-id-payload-id.test.ts`.

  it('a scalar data.id outranks multi:true and reaches driver.update with the payload AS SENT', async () => {
    const call = await observeWrite({ id: 'rec_1', title: 'x' }, { multi: true }, 'update');
    expect(call.id).toBe('rec_1');
    // UNCHANGED by #6435, and deliberately so: here the payload's `id` IS the
    // bound primary key (a scalar `data.id` outranks `where` and `multi`
    // alike), so the write is `SET id = 'rec_1' WHERE id = 'rec_1'` — a
    // same-value no-op, redundant rather than damaging. Widening the strip
    // over this shape is a separate decision (#6435's scope note).
    expect(call.data).toEqual({ id: 'rec_1', title: 'x' });
  });

  it('a scalar where.id reaches driver.update with the payload AS SENT', async () => {
    const call = await observeWrite({ title: 'x' }, { where: { id: 'rec_1' } }, 'update');
    expect(call.id).toBe('rec_1');
    expect(call.data).toEqual({ title: 'x' });
  });

  it('[#6435] operator data.id BESIDE a scalar where.id: the where id wins, and the operator no longer reaches the SET clause', async () => {
    // #5748's headline shape — verdict `by-id`, bound id `rec_1`. This pin
    // FLIPPED at #6435, by design: the assertion used to read
    // `toEqual({ id: { $in: ['a','b'] }, title: 'x' })`, recording that the
    // by-id arm handed the operator object straight to `driver.update`'s data
    // argument. `driver-sql` formats that whole payload into the SET clause,
    // so `rec_1`'s primary key was rewritten to `'{"$in":["a","b"]}'`.
    //
    // The dispatch is untouched — same verdict, same bound id — and only the
    // payload changed, which is why the two assertions below sit side by side.
    const call = await observeWrite(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { where: { id: 'rec_1' } },
      'update',
    );
    expect(call.id).toBe('rec_1');
    expect(call.data).toEqual({ title: 'x' });
  });
});
