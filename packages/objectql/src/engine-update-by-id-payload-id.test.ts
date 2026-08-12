// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#6435 — the BY-ID half of #6262. A single-row update must not hand
// the driver a SET payload whose `id` the dispatch has already ruled is not a
// primary key.
//
// ## The shape
//
// `update(o, { id: { $in: ['a','b'] }, title: 'x' }, { where: { id: 'rec_1' } })`
// dispatches correctly and has since #5748 / PR #5919: the operator object is
// not an id, so it stops shadowing the ladder, the decision falls through to
// `where.id`, and `rec_1` is bound. `ENGINE_UPDATE_DISPATCH_CASES` states that
// row verbatim (`expect: 'by-id'`, `expectId: 'rec_1'`). What #5748 did NOT do
// — and what PR #6433 fixed for the `multi` arm only — is clean the PAYLOAD.
// Measured on `origin/main` with a recording driver, this branch:
//
// ```
// driver.update('task', 'rec_1', { id: { $in: ['a','b'] }, title: 'x' })
//                                  ^^^^^^^^^^^^^^^^^^^^^^ the SET clause
// ```
//
// `packages/drivers/driver-sql/src/sql-driver.ts`'s `update()` formats the
// WHOLE payload (`applyWriteColumnMap(formatInput(object, data))`; `id` is on
// no skip list), so the row lands as
// `UPDATE task SET id = '{"$in":["a","b"]}', title = 'x' WHERE id = 'rec_1'` —
// rec_1's identity overwritten with a serialized operator object, irreversibly,
// on any backend that accepts the write.
//
// ## Why a strip, and why exactly this wide
//
// Route A, the same answer #6262 gave one arm over: a value the engine has
// ALREADY RULED is not a primary key does not get to sit in the primary-key
// column either. It changes NO verdict — every case in
// `ENGINE_UPDATE_DISPATCH_CASES` still resolves as it did, which is why every
// test below asserts the dispatch alongside the payload
// (`assertEngineUpdateDispatch`, the producer's own decision).
//
// A TRUTHY SCALAR `data.id` is deliberately left alone. There the payload's
// `id` IS the bound key (a scalar `data.id` outranks `where` and `multi`
// alike), so the write is `SET id = 'rec_1' WHERE id = 'rec_1'` — a same-value
// no-op, redundant rather than damaging, and long-standing behaviour. Widening
// the strip over it is a separate decision and is NOT taken here; the contrast
// pins below record that it stayed put.
//
// Route B (reject a non-scalar `data.id` outright) would reverse the
// `expect: 'by-id'` verdict the case-set states today — a partial rollback of
// #5748's ruling A, i.e. a maintainer decision, not this fix. Route C
// (per-driver skip lists) is the #5240 / #4434 shape of five backends giving
// one question five answers.
//
// ## The membership rule, asked and never re-derived
//
// "Is this payload `id` a primary key?" is asked by CALLING the dispatch on the
// payload with no options — `resolveEngineUpdateDispatch(data, undefined)` is
// `by-id` exactly when `data.id` is a truthy scalar. The scalar test itself
// (`asScalarId`) is deliberately unexported: "adding a third public spelling of
// the same question is how a rule with one definition grows a second one"
// (`engine-update-dispatch.ts`). So the strip set is defined by the producer,
// not mirrored beside it, and the table below is a MEASUREMENT of that set
// rather than a second statement of it.

import { describe, it, expect } from 'vitest';
import type { EngineUpdateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

interface RecordedCall {
  readonly fn: 'update' | 'updateMany';
  readonly id?: unknown;
  readonly ast?: unknown;
  /** A COPY — the engine may keep mutating its own payload after the call. */
  readonly data: Record<string, unknown>;
}

/**
 * Records the exact SET payload each driver entry point received.
 *
 * Same double as `engine-update-multi-payload-id.test.ts` uses, on purpose:
 * the two halves of one defect are measured with one instrument.
 */
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

/**
 * Drive the REAL engine and return the one driver call it made — after
 * asserting, through the producer's own decision function, that this call
 * dispatches where the test says it does. Both halves matter: the whole point
 * of #6435 is that the DISPATCH was already right and only the PAYLOAD was not,
 * so a test that only looked at the payload could not tell a fixed strip from a
 * silently re-routed call.
 */
async function observeWrite(
  data: Record<string, unknown>,
  options: EngineUpdateOptions | undefined,
  expect_: { fn: 'update' | 'updateMany'; boundId?: unknown },
): Promise<RecordedCall> {
  const dispatch = assertEngineUpdateDispatch(data, options);
  expect(dispatch.kind, 'dispatch verdict').toBe(expect_.fn === 'update' ? 'by-id' : 'multi');
  if (dispatch.kind === 'by-id') expect(dispatch.id, 'bound primary key').toEqual(expect_.boundId);

  const { engine, calls } = await makeEngine();
  await engine.update('task', data, options);
  expect(calls.map((c) => c.fn), 'driver entry points reached').toEqual([expect_.fn]);
  if (expect_.fn === 'update') expect(calls[0].id, 'id argument').toEqual(expect_.boundId);
  return calls[0];
}

/** Own-property, never `in`: `Object.prototype` has no `id`, but say what we mean. */
function hasIdKey(payload: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(payload, 'id');
}

describe('#6435 — a by-id update strips a ruled-not-an-id `data.id` from the SET payload', () => {
  it('the PROBE shape: operator-object data.id + scalar where.id — dispatch still binds rec_1, the payload no longer carries the operator', async () => {
    const call = await observeWrite(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { where: { id: 'rec_1' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    // The regression itself: before the fix this payload was
    // `{ id: { $in: ['a','b'] }, title: 'x' }` and driver-sql wrote the
    // serialized operator object into rec_1's primary-key column.
    expect(hasIdKey(call.data), `SET payload was ${JSON.stringify(call.data)}`).toBe(false);
    // ...and the strip takes ONLY `id` — the column the caller actually meant
    // to write still lands, unchanged.
    expect(call.data).toEqual({ title: 'x' });
  });

  it('array data.id + scalar where.id — same strip, same surviving columns', async () => {
    const call = await observeWrite(
      { id: ['a', 'b'], title: 'x' },
      { where: { id: 'rec_1' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    expect(hasIdKey(call.data)).toBe(false);
    expect(call.data).toEqual({ title: 'x' });
  });

  it('null data.id + scalar where.id — stripped, not written as a NULL primary key', async () => {
    // The entry point #6435's body names as the more common one, and the
    // dispatch ladder puts it squarely in the strip set: `asScalarId(null)` is
    // `undefined`, so the decision falls through to `where.id` and binds THAT —
    // the payload's `null` is a ruled-not-an-id value like any other.
    //
    // Reachability, read from source rather than asserted: the REST PATCH route
    // (`packages/rest/src/rest-server.ts`, `PATCH /data/:object/:id`) strips
    // only `expectedVersion` from the body, and `UpdateDataRequestSchema`
    // types `data` as `z.record(z.string(), z.unknown())`, which admits `null`;
    // the protocol's `updateData` (`packages/metadata-protocol/src/protocol.ts`)
    // then calls `engine.update(object, request.data, { where: { id } })` with
    // the body VERBATIM. So a client that GETs a row, edits two fields and PUTs
    // the whole document back — with `id` serialized as `null` — lands exactly
    // here. That read is a static one; no end-to-end HTTP repro was run.
    const call = await observeWrite(
      { id: null, title: 'x' },
      { where: { id: 'rec_1' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    expect(hasIdKey(call.data)).toBe(false);
    expect(call.data).toEqual({ title: 'x' });
  });

  it('a by-id update that never carried an id is untouched', async () => {
    const call = await observeWrite(
      { title: 'x' },
      { where: { id: 'rec_1' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    expect(call.data).toEqual({ title: 'x' });
  });

  it('does not mutate the payload object the CALLER handed in', async () => {
    // The strip copies, like every other strip on this path (#5591 / #6343).
    // A caller that reuses its payload object across a loop must see what it
    // wrote — and `Object.is` says so too: the engine's payload is a DIFFERENT
    // object, not the caller's with a key deleted out from under it.
    const { engine } = await makeEngine();
    const callerPayload: Record<string, unknown> = { id: { $in: ['a', 'b'] }, title: 'x' };
    const snapshot = callerPayload;
    await engine.update('task', callerPayload, { where: { id: 'rec_1' } });
    expect(Object.is(callerPayload, snapshot), 'caller kept its own object').toBe(true);
    expect(callerPayload).toEqual({ id: { $in: ['a', 'b'] }, title: 'x' });
  });
});

describe('#6435 — the falsy scalars keep the #5747 / #5748 dispatch semantics', () => {
  // NOT a new verdict. `0` and `''` are scalars, so they take the scalar branch
  // of the id test and then fail its TRUTHINESS half — the engine branches on
  // `if (hookContext.input.id)` and always has (the dispatch module's header
  // point 3). So `data: { id: 0 }` beside `where: { id: 'rec_1' }` falls
  // through to `where` and binds `rec_1`, before this change and after it.
  //
  // What DOES change is the payload, on the same argument as the operator
  // object: the dispatch has ruled this value is not the primary key of the row
  // being written, so `SET id = 0` would replace rec_1's key with `0`. Leaving
  // falsy scalars in while stripping operator objects would be a SECOND rule
  // about one fact — the shape #4550 / #4434 exist to prevent, and the same
  // call PR #6433 made for the multi arm.
  for (const falsy of [0, ''] as const) {
    it(`data.id = ${JSON.stringify(falsy)} beside a scalar where.id still binds rec_1 (verdict unchanged) and is stripped`, async () => {
      const call = await observeWrite(
        { id: falsy, title: 'x' },
        { where: { id: 'rec_1' } },
        { fn: 'update', boundId: 'rec_1' },
      );
      expect(hasIdKey(call.data)).toBe(false);
      expect(call.data).toEqual({ title: 'x' });
    });
  }
});

describe('#6435 — the contrast pins: what this change deliberately does NOT touch', () => {
  it('a TRUTHY SCALAR data.id is still handed to the driver as sent', async () => {
    // Route A's boundary, pinned. Here the payload's `id` IS the bound key, so
    // the write is a same-value no-op rather than an identity rewrite. If a
    // later change decides to strip this too, THIS is the assertion that must
    // flip — deliberately, with its own reasoning.
    const call = await observeWrite(
      { id: 'rec_1', title: 'x' },
      { where: { id: 'rec_1' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    expect(call.data).toEqual({ id: 'rec_1', title: 'x' });
  });

  it('a truthy scalar data.id that DISAGREES with where.id still wins, payload as sent', async () => {
    // `ENGINE_UPDATE_DISPATCH_CASES`: "a SCALAR data.id still wins over a
    // scalar where.id" ⇒ bound id `rec_1`, not `rec_2`. Unchanged here.
    const call = await observeWrite(
      { id: 'rec_1', title: 'x' },
      { where: { id: 'rec_2' } },
      { fn: 'update', boundId: 'rec_1' },
    );
    expect(call.data).toEqual({ id: 'rec_1', title: 'x' });
  });

  it('the MULTI arm is exactly as PR #6433 left it', async () => {
    // The sibling half, re-measured from this file so a regression in either
    // arm shows up next to the other. #6433's own suite is the primary pin.
    const call = await observeWrite(
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { multi: true },
      { fn: 'updateMany' },
    );
    expect(hasIdKey(call.data)).toBe(false);
    expect(call.data).toEqual({ title: 'x' });
    expect(call.ast).toEqual({ object: 'task' });
  });

  it('a multi update selecting rows by an id SET keeps its predicate and its payload', async () => {
    const call = await observeWrite(
      { title: 'x' },
      { where: { id: { $in: ['a', 'b'] } }, multi: true },
      { fn: 'updateMany' },
    );
    expect(call.data).toEqual({ title: 'x' });
    expect(call.ast).toEqual({ object: 'task', where: { id: { $in: ['a', 'b'] } } });
  });
});
