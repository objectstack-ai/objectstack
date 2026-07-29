// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3897] `deleteManyData` used to spread the caller-supplied `options` OVER
// the id predicate it had just built, so a request body could replace `where`
// outright and widen "delete these ids" into "delete everything this caller is
// allowed to delete". The same spread could also smuggle in `context` (a forged
// principal) and `multi`. These tests pin the three properties that make that
// impossible now: the id set is authoritative, caller `options` never reaches
// the engine, and the happy path actually deletes (it used to throw
// `'Delete requires an ID or options.multi=true'` because `multi` was never set).

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'invoice', fields: { title: { name: 'title', type: 'text' } } };

function makeProtocol(deleteImpl?: (object: string, options: any) => Promise<any>) {
  const del = vi.fn(deleteImpl ?? (async () => ({ deleted: true })));
  const engine = {
    registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
    delete: del,
  };
  return { p: new ObjectStackProtocolImplementation(engine as any), del };
}

describe('deleteManyData — the id set is the contract (#3897)', () => {
  it('deletes exactly the supplied ids and reports a BatchUpdateResponse', async () => {
    const { p, del } = makeProtocol();
    const res: any = await p.deleteManyData({ object: 'invoice', ids: ['a', 'b', 'c'] } as any);

    expect(del).toHaveBeenCalledTimes(3);
    expect(del.mock.calls.map((c) => c[1].where)).toEqual([
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ]);
    expect(res).toMatchObject({
      success: true, operation: 'delete', total: 3, succeeded: 3, failed: 0,
    });
    expect(res.results).toEqual([
      { id: 'a', success: true }, { id: 'b', success: true }, { id: 'c', success: true },
    ]);
  });

  it('the happy path no longer trips the engine\'s "ID or options.multi=true" guard', async () => {
    // Stand in for engine.delete's real dispatch: a scalar `where.id` is a
    // by-id delete; anything else needs `options.multi` or it throws. The
    // pre-#3897 implementation produced `{ id: { $in: [...] } }` with no
    // `multi`, so a well-formed request could only ever hit the throw.
    const { p } = makeProtocol(async (_object, options) => {
      const id = options?.where?.id;
      const scalar = typeof id === 'string' || typeof id === 'number';
      if (!scalar && !options?.multi) throw new Error('Delete requires an ID or options.multi=true');
      return { id };
    });

    const res: any = await p.deleteManyData({ object: 'invoice', ids: ['a'] } as any);
    expect(res.success).toBe(true);
    expect(res.failed).toBe(0);
  });

  it('a body-supplied options.where cannot replace the id predicate', async () => {
    const { p, del } = makeProtocol();
    // The exploit payload from the issue, verbatim.
    await p.deleteManyData({
      object: 'invoice',
      ids: ['a'],
      options: { multi: true, where: {} },
    } as any);

    expect(del).toHaveBeenCalledTimes(1);
    const opts = del.mock.calls[0][1];
    expect(opts.where).toEqual({ id: 'a' });
    expect(opts.multi).toBeUndefined();
  });

  it('a body-supplied options.context cannot forge the caller principal', async () => {
    const { p, del } = makeProtocol();
    await p.deleteManyData({
      object: 'invoice',
      ids: ['a'],
      options: { context: { userId: 'root', roles: ['admin'] } },
    } as any);

    expect(del.mock.calls[0][1].context).toBeUndefined();
  });

  it('threads the resolved execution context to every engine delete', async () => {
    const { p, del } = makeProtocol();
    const ctx = { userId: 'u1' };
    await p.deleteManyData({ object: 'invoice', ids: ['a', 'b'], context: ctx } as any);

    expect(del.mock.calls[0][1].context).toBe(ctx);
    expect(del.mock.calls[1][1].context).toBe(ctx);
  });

  it('rejects non-scalar ids instead of letting an operator object reach where.id', async () => {
    const { p, del } = makeProtocol();
    await expect(
      p.deleteManyData({ object: 'invoice', ids: [{ $ne: null }] } as any),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects a missing / non-array ids rather than deleting unscoped', async () => {
    const { p, del } = makeProtocol();
    await expect(
      p.deleteManyData({ object: 'invoice', options: { multi: true } } as any),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(del).not.toHaveBeenCalled();
  });

  it('an empty id list deletes nothing', async () => {
    const { p, del } = makeProtocol();
    const res: any = await p.deleteManyData({ object: 'invoice', ids: [] } as any);
    expect(del).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: true, total: 0, succeeded: 0, failed: 0, results: [] });
  });
});

describe('deleteManyData — partial-failure semantics (#3897)', () => {
  function failOn(badId: string) {
    return makeProtocol(async (_object, options) => {
      if (options.where.id === badId) throw new Error('RLS: not visible');
      return { id: options.where.id };
    });
  }

  it('stops at the first failure by default and reports it per row', async () => {
    const { p, del } = failOn('b');
    const res: any = await p.deleteManyData({ object: 'invoice', ids: ['a', 'b', 'c'] } as any);

    expect(del).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ success: false, total: 3, succeeded: 1, failed: 1 });
    expect(res.results[1]).toEqual({ id: 'b', success: false, error: 'RLS: not visible' });
  });

  it('continueOnError keeps going and still marks the batch unsuccessful', async () => {
    const { p, del } = failOn('b');
    const res: any = await p.deleteManyData({
      object: 'invoice',
      ids: ['a', 'b', 'c'],
      options: { atomic: false, continueOnError: true },
    } as any);

    expect(del).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ success: false, total: 3, succeeded: 2, failed: 1 });
  });

  it('atomic aborts the remaining ids on the first failure', async () => {
    const { p, del } = failOn('b');
    const res: any = await p.deleteManyData({
      object: 'invoice',
      ids: ['a', 'b', 'c'],
      options: { atomic: true, continueOnError: true },
    } as any);

    expect(del).toHaveBeenCalledTimes(2);
    expect(res.succeeded).toBe(1);
  });
});
