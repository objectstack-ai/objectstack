// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Guard for ADR-0034: while a transaction() callback runs, EVERY data op —
// including a write/read given no explicit transaction context — must bind to
// the active transaction (via the ambient AsyncLocalStorage store). Without
// this, internal queries during a write ask the pool for another connection
// and deadlock on the single-connection SQLite pool.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, ScopedContext } from './engine.js';

function makeRecordingDriver() {
  const stores = new Map<string, Map<string, any>>();
  const seen: {
    create: Array<{ object: string; transaction: unknown }>;
    find: Array<{ object: string; transaction: unknown }>;
    commit: unknown[];
    rollback: unknown[];
  } = {
    create: [],
    find: [],
    commit: [],
    rollback: [],
  };
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      seen.find.push({ object, transaction: options?.transaction });
      return Array.from(storeFor(object).values());
    },
    async findOne(object: string) {
      for (const r of storeFor(object).values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      seen.create.push({ object, transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit(trx: unknown) { seen.commit.push(trx); },
    async rollback(trx: unknown) { seen.rollback.push(trx); },
  };
  return { driver, seen };
}

describe('engine ambient transaction (ADR-0034)', () => {
  let engine: ObjectQL;
  let seen: ReturnType<typeof makeRecordingDriver>['seen'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeRecordingDriver();
    seen = d.seen;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } });
  });

  it('threads the active transaction into writes given NO explicit context', async () => {
    await engine.transaction(async () => {
      // No context passed — must inherit the transaction ambiently.
      await engine.insert('thing', { name: 'A' });
      await engine.insert('thing', { name: 'B' });
    });
    expect(seen.create.length).toBe(2);
    expect(seen.create[0].transaction).toBeTruthy();
    // both writes ran on the SAME transaction (no second connection)
    expect(seen.create[1].transaction).toBe(seen.create[0].transaction);
  });

  it('does not leak a transaction to ops outside the transaction() scope', async () => {
    await engine.insert('thing', { name: 'outside' });
    expect(seen.create.at(-1)!.transaction).toBeUndefined();
  });

  // ADR-0067 D2 — a nested transaction() JOINS the ambient one instead of
  // opening a second driver transaction (which would deadlock a
  // single-connection pool and escape the outer rollback). The outer call
  // owns the one-and-only commit/rollback.
  it('a nested transaction() joins the ambient transaction (no second begin)', async () => {
    let outerTrx: unknown;
    let innerTrx: unknown;
    await engine.transaction(async (ctx: any) => {
      outerTrx = ctx.transaction;
      await engine.transaction(async (innerCtx: any) => {
        innerTrx = innerCtx.transaction;
        await engine.insert('thing', { name: 'nested' });
      });
    });
    expect(innerTrx).toBe(outerTrx); // joined, not a fresh begin
    expect(seen.create[0].transaction).toBe(outerTrx);
  });

  it('a throw inside a JOINED nested transaction() rolls back the OUTER one', async () => {
    await expect(engine.transaction(async () => {
      await engine.insert('thing', { name: 'first' });
      await engine.transaction(async () => {
        throw new Error('inner boom');
      });
    })).rejects.toThrow('inner boom');
    // the recording driver saw the write, but the outer tx rolled back —
    // rollback tracking lives on the driver; assert it was invoked.
    expect(seen.rollback.length).toBe(1);
    expect(seen.commit.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #6168 — the SECOND implementation of the same primitive joins too
// ---------------------------------------------------------------------------
//
// `ScopedContext.transaction` — what a hook or action body reaches as
// `ctx.api.transaction(fn)` — had no ADR-0067 D2 join branch. Inside an
// `engine.transaction()` it opened a SECOND driver transaction: a second
// connection (the deadlock D2 exists to avoid on a single-connection pool),
// committed independently, and therefore NOT covered by the outer rollback.
//
// The driver below is deliberately ROLLBACK-HONEST where the one above is only
// rollback-RECORDING: writes carrying a handle are staged per handle, `commit`
// flushes them into the committed store and `rollback` discards them. That is
// the difference between pinning "rollback was called" and pinning the fact
// this issue is actually about — whether the inner row is still there
// afterwards. With the join removed, the inner transaction commits its own
// stage and the row SURVIVES the outer rollback; the assertion that fails is
// the one on committed state, in the shape of leftover residue.

function makeRollbackHonestDriver() {
  const committed = new Map<string, Map<string, any>>();
  const staged = new Map<unknown, Array<{ object: string; row: any }>>();
  const seen = {
    begins: [] as unknown[],
    commits: [] as unknown[],
    rollbacks: [] as unknown[],
    creates: [] as Array<{ object: string; transaction: unknown }>,
  };
  let nextId = 0;
  let nextTrx = 0;
  const committedFor = (o: string) => {
    let s = committed.get(o);
    if (!s) { s = new Map(); committed.set(o, s); }
    return s;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    // Reads see COMMITTED state only. Nothing in these cases reads back its own
    // uncommitted write, and keeping it simple keeps the durability assertion
    // unambiguous: what `find` returns at the end is what actually landed.
    async find(object: string) { return Array.from(committedFor(object).values()); },
    async findOne(object: string) {
      for (const r of committedFor(object).values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      const trx = options?.transaction;
      seen.creates.push({ object, transaction: trx });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      if (trx === undefined) committedFor(object).set(id, row);
      else staged.set(trx, [...(staged.get(trx) ?? []), { object, row }]);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = committedFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return committedFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {},
    async beginTransaction() {
      nextTrx += 1;
      const handle = { __trx: nextTrx };
      seen.begins.push(handle);
      staged.set(handle, []);
      return handle;
    },
    async commit(trx: unknown) {
      seen.commits.push(trx);
      for (const { object, row } of staged.get(trx) ?? []) committedFor(object).set(row.id, row);
      staged.delete(trx);
    },
    async rollback(trx: unknown) {
      seen.rollbacks.push(trx);
      staged.delete(trx);
    },
  };
  const committedNames = (object: string) =>
    Array.from(committedFor(object).values()).map((r) => r.name).sort();
  return { driver, seen, committedNames };
}

describe('ScopedContext.transaction joins the ambient transaction (ADR-0067 D2, #6168)', () => {
  let engine: ObjectQL;
  let seen: ReturnType<typeof makeRollbackHonestDriver>['seen'];
  let committedNames: ReturnType<typeof makeRollbackHonestDriver>['committedNames'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeRollbackHonestDriver();
    seen = d.seen;
    committedNames = d.committedNames;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } });
  });

  /**
   * A hook body's `ctx.api.transaction(fn)`, registered on `thing` and fired by
   * a write made inside `engine.transaction()`. This is the real reachability
   * path — `HookContext.api` IS a `ScopedContext` (`ObjectQL.buildHookApi`) —
   * not a `createContext` stand-in for one.
   */
  function hookThatOpensATransaction(
    body: (trxCtx: any, info: any) => Promise<void>,
    onlyFor = 'outer',
  ) {
    (engine as any).registerHook(
      'afterInsert',
      async (ctx: any) => {
        // The inner write fires this hook again; without the guard the join
        // would be measured against a recursion, not against the outer call.
        if (ctx.result?.name !== onlyFor) return;
        await ctx.api.transaction(body);
      },
      { object: 'thing' },
    );
  }

  it('joins the outer transaction — same handle, owned: false, no second begin', async () => {
    let innerHandle: unknown;
    let innerOwned: boolean | undefined;
    let outerHandle: unknown;

    hookThatOpensATransaction(async (trxCtx: any, info: any) => {
      innerHandle = trxCtx.transactionHandle;
      innerOwned = info.owned;
    });

    await engine.transaction(async (ctx: any) => {
      outerHandle = ctx.transaction;
      await engine.insert('thing', { name: 'outer' });
    });

    expect(innerOwned).toBe(false);
    expect(innerHandle).toBe(outerHandle);
    // The whole point of D2: ONE begin, so ONE connection.
    expect(seen.begins).toHaveLength(1);
    expect(seen.commits).toHaveLength(1);
  });

  it('the joined write is UNDONE by the outer rollback — the durability pin', async () => {
    hookThatOpensATransaction(async (trxCtx: any) => {
      await trxCtx.object('thing').insert({ name: 'inner' });
    });

    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'outer' });
        throw new Error('outer boom');
      }),
    ).rejects.toThrow('outer boom');

    // Before #6168 the inner transaction committed itself, so 'inner' was still
    // here after the outer rollback: a write the caller was told had been undone
    // and had not been. Nothing failed, nothing was logged.
    expect(committedNames('thing')).toEqual([]);
    expect(seen.rollbacks).toHaveLength(1);
    expect(seen.commits).toHaveLength(0);
    // Both writes rode the ONE handle the outer call owns.
    expect(seen.creates).toHaveLength(2);
    expect(seen.creates[1].transaction).toBe(seen.creates[0].transaction);
  });

  it('the joined write commits with the outer one when the outer succeeds', async () => {
    hookThatOpensATransaction(async (trxCtx: any) => {
      await trxCtx.object('thing').insert({ name: 'inner' });
    });

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'outer' });
    });

    expect(committedNames('thing')).toEqual(['inner', 'outer']);
    expect(seen.begins).toHaveLength(1);
  });

  it('with NO ambient transaction it still OPENS one — owned: true, unchanged', async () => {
    const scoped = (engine as any).createContext({ userId: 'u1' }) as ScopedContext;
    let owned: boolean | undefined;

    await scoped.transaction(async (trxCtx: any, info: any) => {
      owned = info.owned;
      await trxCtx.object('thing').insert({ name: 'standalone' });
    });

    expect(owned).toBe(true);
    expect(seen.begins).toHaveLength(1);
    expect(seen.commits).toHaveLength(1);
    expect(committedNames('thing')).toEqual(['standalone']);
  });

  /**
   * The OTHER half of ADR-0067 D2's rationale: the second `beginTransaction`
   * asks the pool for a second connection, and on a single-connection pool
   * (the knex/SQLite one D2 names) there is no second connection to give.
   *
   * The real pool BLOCKS there — that is the deadlock — and a test that
   * modelled the block faithfully would fail only by hitting vitest's timeout:
   * slow, and flaky under parallel load. So this double models a pool of size 1
   * WITH an acquire timeout, which refuses the second checkout instead of
   * queueing for it. The refusal is a stand-in for the hang; what is measured
   * honestly either way is the thing that causes both — whether a second
   * connection is asked for at all.
   */
  it('never asks for a second connection — a single-connection pool survives the nested call', async () => {
    let checkedOut = false;
    const checkouts: number[] = [];
    const d = makeRollbackHonestDriver();
    d.driver.beginTransaction = async () => {
      if (checkedOut) {
        // Where a real single-connection pool would wait forever.
        throw new Error('pool exhausted: no connection available (max=1)');
      }
      checkedOut = true;
      checkouts.push(checkouts.length + 1);
      return { __trx: 'only' };
    };
    d.driver.commit = async () => { checkedOut = false; };
    d.driver.rollback = async () => { checkedOut = false; };

    const oneConn = new ObjectQL();
    oneConn.registerDriver(d.driver, true);
    await oneConn.init();
    oneConn.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } });
    (oneConn as any).registerHook(
      'afterInsert',
      async (ctx: any) => {
        if (ctx.result?.name !== 'outer') return;
        await ctx.api.transaction(async () => { /* joins — asks for nothing */ });
      },
      { object: 'thing' },
    );

    await expect(
      oneConn.transaction(async () => { await oneConn.insert('thing', { name: 'outer' }); }),
    ).resolves.toBeUndefined();

    expect(checkouts).toHaveLength(1);
  });

  it('does not join a transaction that has already closed — the store does not leak', async () => {
    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'covered' });
    });

    const scoped = (engine as any).createContext({ userId: 'u1' }) as ScopedContext;
    let owned: boolean | undefined;
    await scoped.transaction(async (_ctx: any, info: any) => { owned = info.owned; });

    expect(owned).toBe(true);
    expect(seen.begins).toHaveLength(2); // the outer one, then a fresh one
  });
});

// ---------------------------------------------------------------------------
// #6406 — the THIRD implementation of the same primitive joins too
// ---------------------------------------------------------------------------
//
// The discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction`
// trio is the face the QuickJS sandbox drives: a VM body's
// `ctx.api.transaction(fn)` is sugar over three host leaves, precisely because
// the body runs across many host event-loop turns with no closure spanning
// begin→commit. #6168 fixed the callback face and could not reach this one, so
// the ADR-0067 D2 violation stayed open here: inside a host
// `engine.transaction()` the trio opened a SECOND driver transaction, committed
// it itself, and its writes survived the outer rollback.
//
// These cases exercise the trio directly, which IS its contract (a caller holds
// the handle and closes it later). The end-to-end path through a real QuickJS
// body lives in @objectstack/runtime's
// `sandbox/transaction-ambient-join.integration.test.ts`, where the real caller
// is the real sandbox runner.
describe('ScopedContext trio joins the ambient transaction (ADR-0067 D2, #6406)', () => {
  let engine: ObjectQL;
  let seen: ReturnType<typeof makeRollbackHonestDriver>['seen'];
  let committedNames: ReturnType<typeof makeRollbackHonestDriver>['committedNames'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeRollbackHonestDriver();
    seen = d.seen;
    committedNames = d.committedNames;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, 'test');
  });

  const scoped = () => (engine as any).createContext({ userId: 'u1' }) as ScopedContext;

  it('joins the outer transaction — same handle, owned: false, no second begin', async () => {
    let begun: any;
    let outerHandle: unknown;

    await engine.transaction(async (ctx: any) => {
      outerHandle = ctx.transaction;
      begun = await scoped().beginTransaction();
    });

    expect(begun.owned).toBe(false);
    expect(begun.handle).toBe(outerHandle);
    expect(begun.ctx.transactionHandle).toBe(outerHandle);
    // The whole point of D2: ONE begin, so ONE connection.
    expect(seen.begins).toHaveLength(1);
  });

  it('commit ABSTAINS for a joined handle — the outer owner commits, once', async () => {
    let commitsSeenInside = -1;

    await engine.transaction(async () => {
      const s = scoped();
      const begun = (await s.beginTransaction())!;
      await begun.ctx.object('thing').insert({ name: 'inner' });
      await s.commitTransaction(begun.handle);
      // Before #6406 this committed the OUTER transaction from the inside: the
      // inner writes landed early and the outer caller had nothing left to own.
      commitsSeenInside = seen.commits.length;
    });

    expect(commitsSeenInside).toBe(0);
    expect(seen.commits).toHaveLength(1); // the outer one, after its callback returned
    expect(committedNames('thing')).toEqual(['inner']);
  });

  it('rollback ABSTAINS for a joined handle — mirroring the callback faces', async () => {
    let rollbacksSeenInside = -1;

    await engine.transaction(async () => {
      const s = scoped();
      const begun = (await s.beginTransaction())!;
      await begun.ctx.object('thing').insert({ name: 'inner' });
      // An explicit rollback of a transaction this call JOINED. The callback
      // faces have no rollback of their own on the joined branch — a throw
      // propagates and the OUTER owner rolls the whole unit back — and this is
      // the same answer in the shape the trio can express it: no driver
      // rollback here, the outcome stays the outer caller's to decide.
      await s.rollbackTransaction(begun.handle);
      rollbacksSeenInside = seen.rollbacks.length;
    });

    expect(rollbacksSeenInside).toBe(0);
    expect(seen.rollbacks).toHaveLength(0);
    // The outer succeeded, so its unit of work — including the inner write —
    // commits. Exactly what a joined callback that swallowed its own error gets.
    expect(seen.commits).toHaveLength(1);
    expect(committedNames('thing')).toEqual(['inner']);
  });

  it('the joined write is UNDONE by the outer rollback — the durability pin', async () => {
    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'outer' });
        const s = scoped();
        const begun = (await s.beginTransaction())!;
        await begun.ctx.object('thing').insert({ name: 'inner' });
        await s.commitTransaction(begun.handle);
        throw new Error('outer boom');
      }),
    ).rejects.toThrow('outer boom');

    // Before #6406 the trio committed its own transaction, so 'inner' was still
    // here after the outer rollback: a write the caller was told had been undone
    // and had not been. Nothing failed, nothing was logged.
    expect(committedNames('thing')).toEqual([]);
    expect(seen.commits).toHaveLength(0);
    expect(seen.rollbacks).toHaveLength(1);
    // Both writes rode the ONE handle the outer call owns.
    expect(seen.creates).toHaveLength(2);
    expect(seen.creates[1].transaction).toBe(seen.creates[0].transaction);
  });

  it('with NO ambient transaction the trio still OPENS one — owned: true, commit lands', async () => {
    const s = scoped();
    const begun = (await s.beginTransaction())!;

    expect(begun.owned).toBe(true);
    await begun.ctx.object('thing').insert({ name: 'standalone' });
    await s.commitTransaction(begun.handle);

    expect(seen.begins).toHaveLength(1);
    expect(seen.commits).toHaveLength(1);
    expect(committedNames('thing')).toEqual(['standalone']);
  });

  it('with NO ambient transaction an explicit rollback still DISCARDS — owned, unchanged', async () => {
    const s = scoped();
    const begun = (await s.beginTransaction())!;

    await begun.ctx.object('thing').insert({ name: 'discarded' });
    await s.rollbackTransaction(begun.handle);

    expect(seen.rollbacks).toHaveLength(1);
    expect(committedNames('thing')).toEqual([]);
  });

  it('does not join a transaction that has already closed — the store does not leak', async () => {
    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'covered' });
    });

    const begun = (await scoped().beginTransaction())!;
    expect(begun.owned).toBe(true);
    expect(seen.begins).toHaveLength(2); // the outer one, then a fresh one
  });

  /**
   * The OTHER half of D2's rationale — see the #6168 block above for why a
   * refusing pool of size 1 stands in for the hang a real one would produce.
   */
  it('never asks for a second connection — a single-connection pool survives the trio begin', async () => {
    let checkedOut = false;
    const checkouts: number[] = [];
    const d = makeRollbackHonestDriver();
    d.driver.beginTransaction = async () => {
      if (checkedOut) throw new Error('pool exhausted: no connection available (max=1)');
      checkedOut = true;
      checkouts.push(checkouts.length + 1);
      return { __trx: 'only' };
    };
    d.driver.commit = async () => { checkedOut = false; };
    d.driver.rollback = async () => { checkedOut = false; };

    const oneConn = new ObjectQL();
    oneConn.registerDriver(d.driver, true);
    await oneConn.init();
    oneConn.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, 'test');

    await expect(
      oneConn.transaction(async () => {
        const s = (oneConn as any).createContext({ userId: 'u1' }) as ScopedContext;
        const begun = (await s.beginTransaction())!;
        await s.commitTransaction(begun.handle);
      }),
    ).resolves.toBeUndefined();

    expect(checkouts).toHaveLength(1);
  });
});
