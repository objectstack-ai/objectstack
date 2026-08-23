// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#5480 — the shared update-dispatch predicate must be the REAL
// engine's answer, not a second opinion that happens to agree today.
//
// Exactly the argument `engine-delete-dispatch.test.ts` makes for `delete`,
// and it matters more here rather than less: a shared predicate that drifted
// from `ObjectQL.update` would make every fake engine pinned to it confidently,
// uniformly wrong, while the gate over them reported success. So this file does
// not test the predicate against a table of expectations written next to it. It
// drives the **real engine** with a recording driver over
// `ENGINE_UPDATE_DISPATCH_CASES` and asserts the engine's observed behaviour
// equals the predicate's verdict, case by case.
//
// If someone changes the dispatch rule in `engine.ts` without changing
// `engine-update-dispatch.ts`, this goes red here — the one place where both
// halves are in the room together.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  ENGINE_UPDATE_DISPATCH_CASES,
  ENGINE_UPDATE_REJECT_MESSAGE,
  ENGINE_UPDATE_ID_CONFLICT_CODE,
  ENGINE_UPDATE_ID_CONFLICT_STATUS,
  resolveEngineUpdateDispatch,
  assertEngineUpdateDispatch,
  scalarUpdateId,
  engineByIdUnhonouredPredicateMessage,
  engineUpdateIdConflictMessage,
  engineUpdateIdPredicateConflictMessage,
  unhonouredByIdPredicateKeys,
} from './engine-update-dispatch.js';

/** Records which driver entry point the engine chose, if any. */
function makeRecordingDriver() {
  const calls: Array<{ fn: 'update' | 'updateMany'; arg: unknown }> = [];
  const driver: any = {
    name: 'recording',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    // [#7867] Answers the row the by-id branch's not-found gate asks for.
    // This used to be `return null`, which — now that a by-id update refuses a
    // ghost id with `RECORD_NOT_FOUND` — would make every by-id case in this
    // file die at the gate and never reach the driver, i.e. a DOUBLE looser
    // than the producer hiding the very dispatch verdict the file exists to
    // observe (#4434/#4550's shape, in the file that pins against it). It
    // echoes back whatever id it was asked for, so it stays agnostic about the
    // dispatch: it can never make a `reject` case look like a `by-id` one.
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.id;
      return id === undefined || id === null ? null : { id, title: 'stored' };
    },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { calls.push({ fn: 'update', arg: id }); return { id, ...data }; },
    async updateMany(_o: string, ast: unknown) { calls.push({ fn: 'updateMany', arg: ast }); return 0; },
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
 * What the real engine actually did with this `(data, options)` pair — the
 * verdict, and for a `by-id` call the value it bound into the PRIMARY-KEY
 * position of `driver.update(object, id, …)`.
 *
 * The bound id is observed, not inferred, because #5748's fix is invisible in
 * the verdict alone on the shape that matters most: a payload carrying an
 * operator `id` beside a scalar `where.id` was `by-id` before the fix and is
 * `by-id` after it — what changed is WHICH value reaches the driver.
 */
async function observeEngine(
  data: unknown,
  options: unknown,
): Promise<{ kind: 'by-id' | 'multi' | 'reject'; boundId?: unknown; message?: string }> {
  const { engine, calls } = await makeEngine();
  // [#11009] `reject` no longer has ONE spelling: the unhonoured-predicate
  // refusal composes its message from the dropped keys. A throw counts as the
  // engine's `reject` verdict only when it is byte-identical to what the
  // PREDICATE says this exact call refuses with — anything else (validation,
  // not-found, a driver error) still rethrows, so no unrelated failure can
  // impersonate a dispatch refusal.
  const predicted = resolveEngineUpdateDispatch(
    data as Parameters<typeof resolveEngineUpdateDispatch>[0],
    options as Parameters<typeof resolveEngineUpdateDispatch>[1],
  );
  try {
    await engine.update('task', data as any, options as any);
  } catch (e) {
    const message = (e as Error).message;
    if (
      message === ENGINE_UPDATE_REJECT_MESSAGE ||
      (predicted.kind === 'reject' && message === predicted.message)
    ) {
      return { kind: 'reject', message };
    }
    throw e;
  }
  if (calls.length !== 1) {
    throw new Error(`expected exactly one driver call, saw ${JSON.stringify(calls)}`);
  }
  return calls[0].fn === 'update'
    ? { kind: 'by-id', boundId: calls[0].arg }
    : { kind: 'multi' };
}

/** Did the engine reach the driver at all? A rejected call must write nothing. */
async function observeDriverCalls(data: unknown, options: unknown): Promise<unknown[]> {
  const { engine, calls } = await makeEngine();
  await engine.update('task', data as any, options as any).catch(() => undefined);
  return calls;
}

describe('engine update dispatch — the shared predicate IS the engine (#5480)', () => {
  it('has cases on both sides of the guard (an empty or one-sided set proves nothing)', () => {
    const kinds = new Set(ENGINE_UPDATE_DISPATCH_CASES.map((c) => c.expect));
    expect(kinds).toEqual(new Set(['by-id', 'multi', 'reject']));
    expect(ENGINE_UPDATE_DISPATCH_CASES.filter((c) => c.expect === 'reject').length).toBeGreaterThan(3);
  });

  for (const c of ENGINE_UPDATE_DISPATCH_CASES) {
    it(`real engine agrees with the predicate: ${c.what} → ${c.expect}`, async () => {
      const predicted = resolveEngineUpdateDispatch(c.data, c.options);
      expect(predicted.kind, 'predicate').toBe(c.expect);
      const observed = await observeEngine(c.data, c.options);
      expect(observed.kind, 'real ObjectQL.update').toBe(c.expect);
      if (c.expect === 'reject') {
        // Both halves must refuse with the SAME words — the refusal text is
        // part of the contract a pinned double reproduces (#11009).
        expect(observed.message, 'real engine reject message').toBe(
          (predicted as { message?: string }).message,
        );
      }
      if ('expectId' in c) {
        // Both halves must bind the SAME id, and it must be the declared one —
        // see `EngineUpdateDispatchCase.expectId` for why the verdict alone is
        // not enough on #5748's shapes.
        expect(predicted.kind === 'by-id' ? predicted.id : undefined, 'predicted id').toEqual(c.expectId);
        expect(observed.boundId, 'id bound into driver.update').toEqual(c.expectId);
      }
    });
  }

  it('never binds a non-scalar into the primary-key position, on ANY case (#5748)', async () => {
    // The whole-set invariant behind #5748: whatever the verdict, the value
    // `driver.update(object, id, …)` receives is a primary key — never an
    // operator object, an array or `null`. Before the fix, every `data.id`
    // case carrying one of those broke this.
    for (const c of ENGINE_UPDATE_DISPATCH_CASES) {
      const observed = await observeEngine(c.data, c.options);
      if (observed.kind !== 'by-id') continue;
      expect(['string', 'number', 'bigint'], `${c.what}: bound ${JSON.stringify(observed.boundId)}`)
        .toContain(typeof observed.boundId);
    }
  });

  it('rejects with the exact message a fake must reproduce', () => {
    expect(() => assertEngineUpdateDispatch({ title: 'x' }, { where: { tenant: 't1' } }))
      .toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
    // …and returns the dispatch (never `reject`) when the call is legal.
    expect(assertEngineUpdateDispatch({ title: 'x' }, { where: { id: 'a' } })).toEqual({ kind: 'by-id', id: 'a' });
    expect(assertEngineUpdateDispatch({ id: 'a' }, undefined)).toEqual({ kind: 'by-id', id: 'a' });
    expect(assertEngineUpdateDispatch({ title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
  });

  it('scalarUpdateId treats operator objects and arrays as predicates, not ids', () => {
    expect(scalarUpdateId({ where: { id: 'a' } })).toBe('a');
    expect(scalarUpdateId({ where: { id: 7 } })).toBe(7);
    expect(scalarUpdateId({ where: { id: { $in: ['a'] } } })).toBeUndefined();
    expect(scalarUpdateId({ where: { id: ['a'] } })).toBeUndefined();
    expect(scalarUpdateId({ where: { id: null } })).toBeUndefined();
    expect(scalarUpdateId({ where: {} })).toBeUndefined();
    expect(scalarUpdateId(undefined)).toBeUndefined();
  });

  // ── The place `update` is NOT `delete`: it has a second id source, the
  //    payload. It is pinned here rather than left to the reader, because it
  //    is exactly what a hand-copied guard gets wrong in the OTHER direction —
  //    too strict, and the double then refuses a call the producer accepts.
  //
  //    [#11230] THE PIN THE #11230 RULING FLIPPED, name and all. It read
  //
  //      it('a SCALAR data.id still outranks where and multi (the common legal
  //          spelling, untouched by #5748)', …)
  //        expect(resolveEngineUpdateDispatch({ id: 'rec_1' },
  //                 { where: { id: { $in: ['a'] } }, multi: true }))
  //          .toEqual({ kind: 'by-id', id: 'rec_1' });
  //
  //    — the REMAINING half of the #5748 verdict after #11142 took the unequal
  //    scalar half, and the last silent arm of this family: the `$in` row set
  //    AND the declared `multi: true` were both discarded with no diagnostic.
  //    The maintainer ruling on #11230 (2026-08-23) reverses it. The assertion
  //    is INVERTED in place, never deleted and never relaxed, so the reversal
  //    is visible exactly where the old verdict stood.
  it('a SCALAR data.id outranks a `where` that declares NO id, and outranks multi — but no longer outranks a DECLARED where.id (#11142/#11230)', () => {
    // FLIPPED (#11230): this line asserted `{ kind: 'by-id', id: 'rec_1' }`.
    expect(resolveEngineUpdateDispatch({ id: 'rec_1' }, { where: { id: { $in: ['a'] } }, multi: true }))
      .toEqual({
        kind: 'reject',
        message: engineUpdateIdPredicateConflictMessage('rec_1', { $in: ['a'] }),
        code: ENGINE_UPDATE_ID_CONFLICT_CODE,
        status: ENGINE_UPDATE_ID_CONFLICT_STATUS,
      });
    // [#11142] `{ id: 'rec_1' }` beside `{ where: { id: 'rec_2' } }` used to
    // sit here as a by-id assertion; the UNEQUAL scalar pair is now refused
    // (the reversed #5748 pin — see the #11142 describe below). The EQUAL
    // pair stays the honoured spelling:
    expect(resolveEngineUpdateDispatch({ id: 'rec_1' }, { where: { id: 'rec_1' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    // What a scalar payload id STILL outranks, untouched by either reversal:
    // an explicit `multi: true` beside a `where` that declares no id.
    expect(resolveEngineUpdateDispatch({ id: 42, title: 'x' }, { multi: true }))
      .toEqual({ kind: 'by-id', id: 42 });
    expect(resolveEngineUpdateDispatch({ id: 42, title: 'x' }, { where: {}, multi: true }))
      .toEqual({ kind: 'by-id', id: 42 });
  });

  // ── #5748, both halves of the flip. FROM: `data.id` was taken verbatim
  //    whenever truthy, so an operator object parked in the payload was bound
  //    into `driver.update`'s primary-key position and a declared
  //    `multi: true` was swallowed with no diagnostic. TO: `data.id` goes
  //    through the same scalar test as `where.id`, so a non-scalar names no
  //    row and the decision falls through the normal ladder.
  it('a NON-SCALAR data.id is not an id, so it no longer outranks a declared multi:true (#5748)', async () => {
    const operatorInPayload = resolveEngineUpdateDispatch({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true });
    expect(operatorInPayload).toEqual({ kind: 'multi' });
    expect(resolveEngineUpdateDispatch({ id: ['a', 'b'], title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
    expect(resolveEngineUpdateDispatch({ id: null, title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
    // …and the real engine agrees: `driver.updateMany`, not a `driver.update`
    // with `{"$in":["a","b"]}` sitting where the primary key belongs.
    expect((await observeEngine({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true })).kind).toBe('multi');
  });

  it('a NON-SCALAR data.id falls through to where.id, which is bound instead of the operator (#5748)', async () => {
    expect(resolveEngineUpdateDispatch({ id: { $in: ['a', 'b'] }, title: 'x' }, { where: { id: 'rec_1' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    const observed = await observeEngine({ id: { $in: ['a', 'b'] }, title: 'x' }, { where: { id: 'rec_1' } });
    expect(observed.kind).toBe('by-id');
    expect(observed.boundId, 'the scalar where.id, not the payload operator').toBe('rec_1');
  });

  // ── The must-answer of the #5748 ruling. Option B's objection to option A
  //    was that an operator object in the payload is most likely a TYPO — the
  //    author meant to write it in `where` — and that A would turn that typo
  //    into a real bulk write. It does not: routing a non-scalar `data.id`
  //    through the ladder means it needs a DECLARED `multi` like every other
  //    non-identifying call. With no `multi`, it is the existing loud reject,
  //    and nothing reaches the driver.
  it('a NON-SCALAR data.id with NO multi is REJECTED, never silently promoted to a bulk write (#5748)', async () => {
    for (const data of [
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { id: { $ne: 'a' }, title: 'x' },
      { id: ['a', 'b'], title: 'x' },
      { id: null, title: 'x' },
    ]) {
      for (const options of [undefined, {}, { multi: false }, { where: { tenant: 't1' } }]) {
        expect(resolveEngineUpdateDispatch(data, options), `${JSON.stringify({ data, options })}`)
          .toEqual({ kind: 'reject', message: ENGINE_UPDATE_REJECT_MESSAGE });
        expect(() => assertEngineUpdateDispatch(data, options)).toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
      }
    }
    // The real engine throws the same message and writes NOTHING — no
    // `driver.update` with a bound operator object, and no `driver.updateMany`
    // quietly standing in for a `multi` the caller never declared.
    await expect(makeEngine().then(({ engine }) => engine.update('task', { id: { $in: ['a', 'b'] }, title: 'x' } as any)))
      .rejects.toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
    expect(await observeDriverCalls({ id: { $in: ['a', 'b'] }, title: 'x' }, undefined)).toEqual([]);
    expect(await observeDriverCalls({ id: ['a', 'b'], title: 'x' }, { multi: false })).toEqual([]);
  });

  it('the scalar test is ONE rule: the same value verdicts alike in data.id and where.id (#5748)', () => {
    // The asymmetry #5748 removed, stated as the property that replaced it.
    // `where` carries a second key so the `where`-side call is never the
    // "empty where" reject for an unrelated reason.
    //
    // [#11009] The property survives with ONE carve-out, pinned separately
    // below: a truthy scalar id beside a `multi: true` and an extra `where`
    // key. There the two doors legitimately diverge — the `where`-sourced id
    // yields to the declared bulk intent (predicate path), while the payload
    // id outranks `multi` (#5748's own ruling) and the unhonourable predicate
    // is refused. Every OTHER (value × rest) pair still verdicts alike, and
    // the shared refusal message is deliberately source-blind so even the
    // rejects agree word for word.
    for (const value of [{ $in: ['a', 'b'] }, { $ne: 'a' }, ['a', 'b'], null, 'rec_1', 42, 0, '']) {
      for (const rest of [{}, { multi: true }] as Array<Record<string, unknown>>) {
        const isDivergentPair =
          rest.multi === true && (typeof value === 'string' || typeof value === 'number') && Boolean(value);
        if (isDivergentPair) continue;
        const viaPayload = resolveEngineUpdateDispatch({ id: value, title: 'x' }, { where: { tenant: 't1' }, ...rest });
        const viaWhere = resolveEngineUpdateDispatch({ title: 'x' }, { where: { tenant: 't1', id: value }, ...rest });
        expect(viaPayload, `${JSON.stringify({ value, rest })}`).toEqual(viaWhere);
      }
    }
  });

  // ── [#11009] The carve-out from the symmetry loop above, stated positively.
  it('truthy scalar id + extra where key + multi:true — where.id takes the predicate path, data.id refuses', () => {
    // The `where` door: the caller declared a bulk/predicate intent and the id
    // is PART of the predicate — every key (id included) rides the AST.
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { tenant: 't1', id: 'rec_1' }, multi: true }))
      .toEqual({ kind: 'multi' });
    // The payload door: `data.id` outranks `multi` (#5748), so the call is a
    // single-row write whose extra predicate CANNOT be honoured — refused
    // loudly, never silently dropped (pre-#11009) or silently bulk-promoted.
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { tenant: 't1' }, multi: true }))
      .toEqual({ kind: 'reject', message: engineByIdUnhonouredPredicateMessage('Update', ['tenant']) });
  });

  // ── [#11009] The refusal itself, quoted and bounded.
  it('a by-id update carrying where keys beyond id is refused with the shared message', async () => {
    const message = engineByIdUnhonouredPredicateMessage('Update', ['status']);
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: 'p1', status: { $in: ['done'] } } }))
      .toEqual({ kind: 'reject', message });
    expect(() => assertEngineUpdateDispatch({ title: 'x' }, { where: { id: 'p1', status: { $in: ['done'] } } }))
      .toThrow(message);
    // …and nothing reached the driver: a refused compare-and-set writes NOTHING,
    // which is the entire point — the old behaviour wrote unconditionally.
    expect(await observeDriverCalls({ title: 'x' }, { where: { id: 'p1', status: { $in: ['done'] } } })).toEqual([]);
    // A `null`-valued extra key is a REAL predicate (`IS NULL`), not a
    // withdrawal — it refuses too.
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: 'p1', error: null } }).kind).toBe('reject');
    // The keys helper reports exactly the droppable keys, `id` excluded.
    expect(unhonouredByIdPredicateKeys({ id: 'p1', status: 'done', error: null })).toEqual(['status', 'error']);
    expect(unhonouredByIdPredicateKeys({ id: 'p1' })).toEqual([]);
    expect(unhonouredByIdPredicateKeys(undefined)).toEqual([]);
  });

  it('branches on TRUTHINESS, so a falsy scalar id does not identify a row', () => {
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: 0 } }).kind).toBe('reject');
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: '' } }).kind).toBe('reject');
    expect(resolveEngineUpdateDispatch({ id: 0, title: 'x' }, { multi: true }).kind).toBe('multi');
    // …while `scalarUpdateId` still reports the raw scalar it found. The two
    // answer different questions and only `resolveEngineUpdateDispatch`
    // answers the engine's.
    expect(scalarUpdateId({ where: { id: 0 } })).toBe(0);
  });

  it('reads data UNGUARDED, exactly like the producer', () => {
    // `ObjectQL.update` opens with `data.id`, so a missing payload is a
    // TypeError there. A double kinder than the producer about it would hide
    // the producer's behaviour.
    expect(() => resolveEngineUpdateDispatch(undefined as any, { multi: true })).toThrow(TypeError);
  });
});

// ── [#11142] The reversed #5748 pin: a truthy scalar `where.id` naming a
//    DIFFERENT row than the bound payload id is refused, never silently
//    dropped. Maintainer ruling 2026-08-23 — the UNEQUAL shape only; the
//    equal-ids spelling (REST folds the path id into the payload) stays
//    honoured. #11142 also left the FALSY and NON-SCALAR `where.id` boundaries
//    at their pre-existing verdicts; only the falsy one is still there —
//    #11230 reversed the non-scalar half (see the [#11230] describe below).
describe('[#11142] a conflicting scalar where.id beside the payload id is refused', () => {
  const data = { id: 'rec_1', title: 'x' };
  const options = { where: { id: 'rec_2' } };
  const message = engineUpdateIdConflictMessage('rec_1', 'rec_2');

  it('the predicate refuses with the declared message, code and status', () => {
    expect(resolveEngineUpdateDispatch(data, options)).toEqual({
      kind: 'reject',
      message,
      code: ENGINE_UPDATE_ID_CONFLICT_CODE,
      status: ENGINE_UPDATE_ID_CONFLICT_STATUS,
    });
    // The envelope halves are contract (ADR-0112): `code` is registered in the
    // spec ledger, `status` rides the REST boundary's declared-status
    // passthrough. Pinned by value so a rename or a demotion to 500 is a
    // deliberate act here, never drift.
    expect(ENGINE_UPDATE_ID_CONFLICT_CODE).toBe('UPDATE_ID_MISMATCH');
    expect(ENGINE_UPDATE_ID_CONFLICT_STATUS).toBe(400);
  });

  it('assertEngineUpdateDispatch throws it carrying code + status (every pinned fake inherits this)', () => {
    let caught: any;
    try {
      assertEngineUpdateDispatch(data, options);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected the conflicting-id refusal, but the call resolved').toBeDefined();
    expect(caught.code).toBe(ENGINE_UPDATE_ID_CONFLICT_CODE);
    expect(caught.status).toBe(ENGINE_UPDATE_ID_CONFLICT_STATUS);
    expect(caught.message).toBe(message);
  });

  it('the REAL engine throws the same envelope and NOTHING reaches the driver', async () => {
    const { engine, calls } = await makeEngine();
    let caught: any;
    try {
      await engine.update('task', data as any, options as any);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected the conflicting-id refusal, but the call resolved').toBeDefined();
    expect(caught.code).toBe(ENGINE_UPDATE_ID_CONFLICT_CODE);
    expect(caught.status).toBe(ENGINE_UPDATE_ID_CONFLICT_STATUS);
    expect(caught.message).toBe(message);
    // The refused write wrote NOTHING — the entire point: the pre-#11142
    // behaviour wrote rec_1 with the rec_2 condition silently ignored.
    expect(calls).toEqual([]);
  });

  it('multi:true cannot rescue the conflict — the payload id outranks multi (#5748), so the contradiction stands', () => {
    const verdict = resolveEngineUpdateDispatch(data, { where: { id: 'rec_2' }, multi: true });
    expect(verdict.kind).toBe('reject');
    expect((verdict as { message?: string }).message).toBe(message);
  });

  it('EQUAL ids stay by-id — the REST spelling (path id folded into the payload) is untouched', async () => {
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: 'rec_1' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    const observed = await observeEngine({ id: 'rec_1', title: 'x' }, { where: { id: 'rec_1' } });
    expect(observed.kind).toBe('by-id');
    expect(observed.boundId).toBe('rec_1');
  });

  it('identity is STRICT — a string id and a number id are two ids, and the message shows the type difference', () => {
    const verdict = resolveEngineUpdateDispatch({ id: 42, title: 'x' }, { where: { id: '42' } });
    expect(verdict.kind).toBe('reject');
    // `'42'` (quoted) vs `42` (bare) — the reader can see the mismatch is one
    // of type, not of row name. A coercing comparison here would be the
    // lenient-consumer move Prime Directive #12 forbids.
    expect((verdict as { message?: string }).message).toBe(engineUpdateIdConflictMessage(42, '42'));
    expect((verdict as { message?: string }).message).toContain("'42'");
  });

  it('a FALSY scalar where.id conflicts with nothing — a falsy id identifies no row on this ladder (out of the #11142 ruled scope)', () => {
    // NOT part of the reversal: `0` / `''` never identify a row (header
    // point 3), so there is no second row address to contradict. Pinned so
    // the refusal cannot creep over the truthiness boundary without a ruling.
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: 0 } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: '' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
  });

  it('a NON-SCALAR where.id is REFUSED TOO since #11230 — the boundary #11142 left standing did not survive its own ruling', () => {
    // FLIPPED (#11230, maintainer ruling 2026-08-23). This pin read "a
    // NON-SCALAR where.id keeps its #5748 verdict — the payload id wins (out
    // of the #11142 ruled scope)" and asserted `{ kind: 'by-id', id: 'rec_1' }`
    // for both shapes below, restating #11142's own boundary: "widening the
    // refusal over operator-object / array / null `where.id` beside a scalar
    // payload id is a separate decision, not a rider here." #11230 IS that
    // separate decision, and it went the other way. Inverted in place, not
    // deleted; the full envelope and the boundaries that DID survive are
    // pinned in the [#11230] describe below.
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: { $in: ['a'] } }, multi: true }).kind)
      .toBe('reject');
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: null } }).kind)
      .toBe('reject');
  });

  it('the #11009 refusal keeps PRIORITY on a where that also carries extra keys (its message names them, unchanged)', () => {
    // Both defects at once: `where` carries a conflicting id AND extra keys.
    // The #11009 unhonoured-keys refusal fires first, byte-identical to
    // before this change — no existing #11009 pin moves.
    expect(resolveEngineUpdateDispatch({ id: 'rec_1', title: 'x' }, { where: { id: 'rec_2', tenant: 't1' } }))
      .toEqual({ kind: 'reject', message: engineByIdUnhonouredPredicateMessage('Update', ['tenant']) });
  });
});

// ── [#11230] The OTHER reversed half of the #5748 pin, and the last silent arm
//    of the #5748 / #11009 / #11142 family: a DECLARED but non-scalar
//    `where.id` — an operator object, an array, `null` — beside a bound scalar
//    payload id. The by-id path evaluates no predicate, so the declared row SET
//    and any declared `multi: true` were BOTH discarded with no diagnostic.
//    Maintainer ruling 2026-08-23, on the same terms as #11142 and sharing its
//    error code: one defect class, one remedy, two messages.
describe('[#11230] a DECLARED non-scalar where.id beside the payload id is refused', () => {
  const data = { id: 'rec_1', title: 'x' };
  const options = { where: { id: { $in: ['a', 'b'] } }, multi: true };
  const message = engineUpdateIdPredicateConflictMessage('rec_1', { $in: ['a', 'b'] });

  it('the predicate refuses with the declared message, code and status', () => {
    expect(resolveEngineUpdateDispatch(data, options)).toEqual({
      kind: 'reject',
      message,
      code: ENGINE_UPDATE_ID_CONFLICT_CODE,
      status: ENGINE_UPDATE_ID_CONFLICT_STATUS,
    });
    // Deliberately the SAME ADR-0112 envelope #11142 declares — see the
    // constant's own note in `engine-update-dispatch.ts`. Pinned by value here
    // too, so a future split into a second ledger code is a deliberate act.
    expect(ENGINE_UPDATE_ID_CONFLICT_CODE).toBe('UPDATE_ID_MISMATCH');
    expect(ENGINE_UPDATE_ID_CONFLICT_STATUS).toBe(400);
  });

  it('assertEngineUpdateDispatch throws it carrying code + status (every pinned fake inherits this)', () => {
    let caught: any;
    try {
      assertEngineUpdateDispatch(data, options);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected the non-scalar predicate refusal, but the call resolved').toBeDefined();
    expect(caught.code).toBe(ENGINE_UPDATE_ID_CONFLICT_CODE);
    expect(caught.status).toBe(ENGINE_UPDATE_ID_CONFLICT_STATUS);
    expect(caught.message).toBe(message);
  });

  it('the REAL engine throws the same envelope and NOTHING reaches the driver', async () => {
    const { engine, calls } = await makeEngine();
    let caught: any;
    try {
      await engine.update('task', data as any, options as any);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected the non-scalar predicate refusal, but the call resolved').toBeDefined();
    expect(caught.code).toBe(ENGINE_UPDATE_ID_CONFLICT_CODE);
    expect(caught.status).toBe(ENGINE_UPDATE_ID_CONFLICT_STATUS);
    expect(caught.message).toBe(message);
    // The entire point: the pre-#11230 behaviour wrote rec_1 — one row, by id
    // — with the `$in` row set and the declared `multi: true` both ignored.
    expect(calls).toEqual([]);
  });

  // ⚠️ CONTROL for the three pins above. A refusal assertion passes trivially
  //    if the fixture never constructs the contradictory pair (a typo in
  //    `options`, a `where` the engine never reads). These two calls are the
  //    SAME call minus one half of the contradiction, and each must still
  //    reach the driver — so the refusals above are the branch firing, not the
  //    fixture missing it.
  it('CONTROL — the same call without the payload id still succeeds, as the bulk write it declared', async () => {
    const observed = await observeEngine({ title: 'x' }, options);
    expect(observed.kind).toBe('multi');
  });

  it('CONTROL — the same call without the where.id predicate still succeeds, as a by-id write on the payload id', async () => {
    const observed = await observeEngine(data, { multi: true });
    expect(observed.kind).toBe('by-id');
    expect(observed.boundId).toBe('rec_1');
  });

  it('every non-scalar spelling is refused, and the message names the kind the caller wrote', () => {
    const operator = resolveEngineUpdateDispatch(data, { where: { id: { $in: ['a'] } } });
    expect(operator.kind).toBe('reject');
    expect((operator as { message?: string }).message).toContain("an operator object ('$in')");

    const array = resolveEngineUpdateDispatch(data, { where: { id: ['a', 'b'] } });
    expect(array.kind).toBe('reject');
    expect((array as { message?: string }).message).toBe(engineUpdateIdPredicateConflictMessage('rec_1', ['a', 'b']));
    expect((array as { message?: string }).message).toContain('an array of 2 values');

    const nul = resolveEngineUpdateDispatch(data, { where: { id: null } });
    expect(nul.kind).toBe('reject');
    expect((nul as { message?: string }).message).toContain('declares null');

    // An explicitly-`undefined` `id` key is a DECLARED key (`'id' in where`),
    // and this repo already reads an explicitly-undefined `where` key as a
    // real declaration one clause over: `{ where: { tenant: undefined } }`
    // beside a payload id is a #11009 refusal today. Same answer here, so the
    // two clauses cannot disagree about what "declared" means.
    const undef = resolveEngineUpdateDispatch(data, { where: { id: undefined } });
    expect(undef.kind).toBe('reject');
    expect((undef as { message?: string }).message).toContain('declares undefined');
  });

  it('the message prescribes BOTH call-site fixes, and says the bulk intent was dropped too', () => {
    expect(message).toContain('multi:true');
    expect(message).toContain('drop id from the payload');
    expect(message).toContain('drop where.id');
    expect(message).toContain('#11230');
  });

  it('a FALSY scalar where.id is a SCALAR, so #11230 does not reach it — the #11142 boundary is untouched', () => {
    // The truthiness rule (module header point 3): `0` / `''` are scalars that
    // identify no row, so there is neither a second row address (#11142) nor a
    // predicate over a set (#11230). Pinned so the reversal cannot creep.
    expect(resolveEngineUpdateDispatch(data, { where: { id: 0 } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch(data, { where: { id: '' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
  });

  it('a where that DECLARES no id at all is untouched — the refusal is about a declaration, not about `where`', () => {
    expect(resolveEngineUpdateDispatch(data, { where: {} })).toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch(data, {})).toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch(data, undefined)).toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch(data, { where: 'not-an-object' as unknown })).toEqual({ kind: 'by-id', id: 'rec_1' });
  });

  it('with NO scalar payload id the ladder is exactly as #5748 left it — a non-scalar where.id never reached this arm', () => {
    // The refusal lives on the PAYLOAD-sourced by-id arm only. Without a
    // payload id these calls fall down the ordinary ladder, and #11230 changes
    // neither verdict.
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: { $in: ['a'] } }, multi: true }))
      .toEqual({ kind: 'multi' });
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: { $in: ['a'] } } }))
      .toEqual({ kind: 'reject', message: ENGINE_UPDATE_REJECT_MESSAGE });
    // …and a NON-scalar payload id is not an id either, so it does not open
    // this arm: the decision still falls through to `multi` (#5748).
    expect(resolveEngineUpdateDispatch({ id: { $in: ['x'] }, title: 'x' }, { where: { id: { $in: ['a'] } }, multi: true }))
      .toEqual({ kind: 'multi' });
  });

  it('the #11009 refusal keeps PRIORITY when `where` also carries extra keys (its message names them, unchanged)', () => {
    // Both defects at once. The unhonoured-keys check runs first and is
    // byte-identical to before this change — no existing #11009 pin moves.
    expect(resolveEngineUpdateDispatch(data, { where: { id: { $in: ['a'] }, tenant: 't1' } }))
      .toEqual({ kind: 'reject', message: engineByIdUnhonouredPredicateMessage('Update', ['tenant']) });
  });

  it('the #11142 message is NOT reused for this shape — the two refusals stay distinguishable', () => {
    // One code, two messages (ADR-0112: the code classifies, the message
    // locates). A future edit that collapses them would tell a caller who
    // wrote `{ $in: [...] }` that they named "a DIFFERENT row".
    expect(message).not.toBe(engineUpdateIdConflictMessage('rec_1', 'rec_2'));
    expect(message).not.toContain('names a DIFFERENT row');
  });
});
