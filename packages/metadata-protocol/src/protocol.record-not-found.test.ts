// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4435] A write that touched zero rows must not report success.
 *
 * The READ path has always been honest — `getData` on an unknown id answers
 * `404 RECORD_NOT_FOUND`. Both single-record WRITE paths disagreed:
 *
 *   PATCH  /data/showcase_task/definitely_not_a_row  → 200 { record: null }
 *   DELETE /data/showcase_task/definitely_not_a_row  → 200 { success: true }
 *
 * The REST layer is a pass-through (`res.json(await p.deleteData(...))`), so
 * these are the protocol's answers, and this is where they are fixed.
 *
 * Why it matters beyond symmetry: a client PATCHing a record another session
 * just deleted was told the write landed, and had to null-check a SUCCESS
 * payload to find out otherwise. `DELETE` said `success: true` for any string in
 * the path, so a typo'd id, an already-deleted row and a real deletion were
 * indistinguishable — including on the bulk path, where a batch of typo'd ids
 * reported every one of them deleted.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'task', fields: { title: { name: 'title', type: 'text' } } };

/**
 * An engine whose `delete` honours the driver contract
 * (`IDataDriver.delete` — "True if deleted, false if not found") and whose
 * `findOne` answers from the same row set, so existence means one thing here.
 */
function makeProtocol(rows: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(rows));
  const findOne = vi.fn(async (_object: string, opts: any) => { assertEngineFindOnePredicate(_object, opts); return store.get(String(opts?.where?.id)) ?? null; });
  const update = vi.fn(async (_object: string, data: any, opts: any) => {
    assertEngineUpdateDispatch(data, opts);
    const id = String(opts?.where?.id);
    if (!store.has(id)) return null;
    const next = { ...store.get(id), ...data };
    store.set(id, next);
    return next;
  });
  const del = vi.fn(async (_object: string, opts: any) => {
    assertEngineDeleteDispatch(opts);
    return store.delete(String(opts?.where?.id));
  });
  const engine = {
    registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
    findOne, update, delete: del,
  };
  return { p: new ObjectStackProtocolImplementation(engine as any), findOne, update, del, store };
}

/** Assert the thrown value is the 404 envelope `getData` already produced. */
async function expectRecordNotFound(run: () => Promise<unknown>, id: string) {
  let caught: any;
  try {
    await run();
  } catch (e) {
    caught = e;
  }
  expect(caught, 'expected a RECORD_NOT_FOUND rejection, but the call resolved').toBeDefined();
  expect(caught.code).toBe('RECORD_NOT_FOUND');
  expect(caught.status).toBe(404);
  expect(caught.object).toBe('task');
  expect(caught.message).toContain(id);
  return caught;
}

describe('[#4435] updateData refuses an id that names no row', () => {
  it('PATCH of a nonexistent id is 404 RECORD_NOT_FOUND, not 200 { record: null }', async () => {
    const { p, update } = makeProtocol({ real: { id: 'real', title: 'x' } });
    await expectRecordNotFound(
      () => p.updateData({ object: 'task', id: 'definitely_not_a_row', data: { title: 'y' } } as any),
      'definitely_not_a_row',
    );
    // …and the engine was never asked to write. A refused PATCH must not fire
    // hooks, automation or an audit row for a record that does not exist.
    expect(update).not.toHaveBeenCalled();
  });

  it('the SAME id answers 404 on the read path — the two verbs agree now', async () => {
    const { p } = makeProtocol({ real: { id: 'real' } });
    await expectRecordNotFound(
      () => p.getData({ object: 'task', id: 'definitely_not_a_row' } as any),
      'definitely_not_a_row',
    );
  });

  it('an existing record still updates and returns the row', async () => {
    const { p, update } = makeProtocol({ real: { id: 'real', title: 'x' } });
    const res: any = await p.updateData({ object: 'task', id: 'real', data: { title: 'y' } } as any);
    expect(update).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ object: 'task', id: 'real', record: { title: 'y' } });
  });

  it('the existence probe asks EXISTENCE, not the caller\'s visibility', async () => {
    // Load-bearing, and the first cut of this fix got it backwards. Probing
    // with the CALLER's context turns the existence gate into an authorization
    // gate: a row the caller cannot read comes back null and the PATCH 404s.
    // That would (a) move an RLS decision out of the write policy where #1994
    // put it, and (b) disarm `@proof: rls-by-id-write` — the dogfood fixture
    // whose RED half asserts that a member who cannot READ a row but has no
    // write policy still mutates it by id. A caller-scoped probe makes that
    // proof go green, so the gate could no longer prove it can go red, and a
    // future revert of #1994 would be masked by this probe.
    //
    // So the probe runs as system: "does this row exist", nothing more.
    // Authorization stays inside engine.update, exactly where it was.
    const { p, findOne } = makeProtocol({ real: { id: 'real' } });
    await p.updateData({ object: 'task', id: 'real', data: {}, context: { userId: 'u1' } } as any);
    expect(findOne.mock.calls[0][1]).toMatchObject({
      where: { id: 'real' },
      context: { isSystem: true },
    });
  });

  it('a PATCH the caller may not see is still decided by RLS, not by the probe', async () => {
    // The row exists, so the probe passes it through to the engine — where the
    // write policy answers, as it always has. The probe must not pre-empt it.
    const { p, update } = makeProtocol({ hidden: { id: 'hidden' } });
    await p.updateData({ object: 'task', id: 'hidden', data: { title: 'x' }, context: { userId: 'nobody' } } as any);
    expect(update).toHaveBeenCalledOnce();
  });
});

describe('[#4435] deleteData reports what actually happened', () => {
  it('DELETE of a nonexistent id is 404, not 200 { success: true }', async () => {
    const { p } = makeProtocol({ real: { id: 'real' } });
    await expectRecordNotFound(
      () => p.deleteData({ object: 'task', id: 'definitely_not_a_row' } as any),
      'definitely_not_a_row',
    );
  });

  it('a real deletion still answers success, and is no longer indistinguishable', async () => {
    const { p, store } = makeProtocol({ real: { id: 'real' } });
    const res: any = await p.deleteData({ object: 'task', id: 'real' } as any);
    expect(res).toEqual({ object: 'task', id: 'real', success: true });
    expect(store.has('real')).toBe(false);
  });

  it('deleting the same id twice: first 200, second 404', async () => {
    const { p } = makeProtocol({ real: { id: 'real' } });
    await p.deleteData({ object: 'task', id: 'real' } as any);
    await expectRecordNotFound(() => p.deleteData({ object: 'task', id: 'real' } as any), 'real');
  });

  it('a driver return that is not the contract\'s `false` is NOT read as not-found', async () => {
    // `=== false` on purpose. A driver that returns the deleted row, or an
    // off-contract `undefined`, gives no POSITIVE not-found signal — inventing
    // a 404 from a falsy return would break deletes against third-party
    // drivers instead of reporting honestly.
    const engine = {
      registry: { getObject: () => SCHEMA },
      delete: vi.fn(async () => undefined),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    await expect(p.deleteData({ object: 'task', id: 'whatever' } as any))
      .resolves.toMatchObject({ success: true });
  });
});

describe('[#4435] deleteManyData reports per id, not per request', () => {
  it('a batch of typo\'d ids no longer reports every one of them deleted', async () => {
    const { p } = makeProtocol({ real: { id: 'real' } });
    const res: any = await p.deleteManyData({
      object: 'task',
      ids: ['nonexistent_1'],
      options: { continueOnError: true },
    } as any);

    // Pre-#4435: { succeeded: 1, failed: 0, results: [{ success: true }] }.
    expect(res).toMatchObject({ success: false, total: 1, succeeded: 0, failed: 1 });
    expect(res.results[0]).toMatchObject({ id: 'nonexistent_1', success: false });
    expect(res.results[0].errors[0].message).toContain('nonexistent_1');
    expect(res.results[0].errors[0].code).toBe('RECORD_NOT_FOUND');
  });

  it('mixed ids are reported individually', async () => {
    const { p } = makeProtocol({ a: { id: 'a' }, c: { id: 'c' } });
    const res: any = await p.deleteManyData({
      object: 'task',
      ids: ['a', 'b', 'c'],
      options: { continueOnError: true },
    } as any);

    expect(res).toMatchObject({ success: false, total: 3, succeeded: 2, failed: 1 });
    expect(res.results.map((r: any) => [r.id, r.success])).toEqual([
      ['a', true], ['b', false], ['c', true],
    ]);
  });

  it('an all-real batch is unchanged', async () => {
    const { p } = makeProtocol({ a: { id: 'a' }, b: { id: 'b' } });
    const res: any = await p.deleteManyData({ object: 'task', ids: ['a', 'b'] } as any);
    expect(res).toMatchObject({ success: true, succeeded: 2, failed: 0 });
  });

  it('a missing id stops the run without continueOnError, as a failure always has', async () => {
    const { p, del } = makeProtocol({ b: { id: 'b' } });
    const res: any = await p.deleteManyData({ object: 'task', ids: ['a', 'b'] } as any);
    // [#7539] Still stops after `a` (one delete attempted) — but `b` is now
    // reported NOT_ATTEMPTED rather than silently dropped, so `succeeded +
    // failed === total` instead of the old `0 + 1 != 2`.
    expect(res).toMatchObject({ success: false, succeeded: 0, failed: 2, total: 2 });
    expect(res.results).toHaveLength(2);
    expect(res.results[1].errors[0].code).toBe('NOT_ATTEMPTED');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('a row that MATCHED and was deliberately NOT removed is not reported as a deletion', async () => {
    // [#19412] The SECOND half of this site. The comment beside the loop
    // records the first: `success` used to be pushed unconditionally, so a
    // batch of typo'd ids reported every one of them deleted — fixed by the
    // `deleted === false` throw above, which reads the driver contract's
    // POSITIVE not-found value. This is the other ending: the row was there,
    // the write ran, and the record deliberately SURVIVED. `success` stayed a
    // LITERAL for every answer that was not `false`, so that row was reported
    // as deleted too.
    //
    // `IDataEngine.delete` declares `Promise<boolean | number>` — the driver
    // boolean for a by-id write, a COUNT of rows removed otherwise — so a
    // numeric zero is the one value that positively says "it is still there".
    // ⛔ Not the `false` arm: that is "no row matched", which becomes the 404
    // above, about a record this caller can still GET.
    const engine = {
      registry: { getObject: () => SCHEMA },
      delete: vi.fn(async (_object: string, opts: any) => { assertEngineDeleteDispatch(opts); return 0; }),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.deleteManyData({ object: 'task', ids: ['still_there'] } as any);

    // Pre-#19412: { success: true, succeeded: 1, failed: 0, results: [{ success: true }] }.
    expect(res).toMatchObject({ success: false, total: 1, succeeded: 0, failed: 1 });
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ id: 'still_there', success: false, index: 0 });
    // ⛔ And NOT the not-found row. A caller branching on `errors[0].code`
    // must not read a surviving record as one that was never there — the two
    // are opposite facts about the same id.
    expect(res.results[0].errors).toBeUndefined();
    expect(engine.delete).toHaveBeenCalledTimes(1);
  });

  it('the count arm still reports a deletion when rows DID go', async () => {
    // The control leg for the pin above: `deleted !== 0` must not collapse
    // into "a number is never a deletion". A predicate-shaped engine that
    // removed the row answers with a POSITIVE count, and that is a success.
    const engine = {
      registry: { getObject: () => SCHEMA },
      delete: vi.fn(async (_object: string, opts: any) => { assertEngineDeleteDispatch(opts); return 1; }),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.deleteManyData({ object: 'task', ids: ['gone'] } as any);
    expect(res).toMatchObject({ success: true, total: 1, succeeded: 1, failed: 0 });
    expect(res.results[0]).toMatchObject({ id: 'gone', success: true });
  });

  it('a mixed batch separates the rows that went from the row that stayed', async () => {
    // Both directions in ONE run, so neither a blanket `true` nor a blanket
    // `false` can pass: `kept` survives, its two neighbours do not, and the
    // counters still partition the results (#7539).
    const engine = {
      registry: { getObject: () => SCHEMA },
      delete: vi.fn(async (_object: string, opts: any) => {
        assertEngineDeleteDispatch(opts);
        return String(opts?.where?.id) === 'kept' ? 0 : 1;
      }),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.deleteManyData({
      object: 'task',
      ids: ['a', 'kept', 'b'],
    } as any);

    expect(res.results.map((r: any) => [r.id, r.success])).toEqual([
      ['a', true], ['kept', false], ['b', true],
    ]);
    expect(res).toMatchObject({ success: false, total: 3, succeeded: 2, failed: 1 });
    // A surviving row is not an ERROR, so it does not stop the run the way a
    // throw does — `b` was attempted and really went, without `continueOnError`.
    expect(engine.delete).toHaveBeenCalledTimes(3);
    expect(res.succeeded + res.failed).toBe(res.total);
  });
});
