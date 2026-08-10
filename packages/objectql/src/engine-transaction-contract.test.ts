// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5696 (the tightening half of #4619) — points 1 and 3 of the contract
// revision, pinned against the engine that implements them:
//
//   1. `opts.require: true` — the ADR-0119 D1 degrade (driver with no
//      `beginTransaction` runs the callback with no transaction and no
//      rollback) becomes a THROW for callers that cannot tolerate it. Fail
//      closed, BEFORE anything is written, generalizing `batchData`'s atomic
//      gate (ADR-0119 D4).
//   3. `owned` — the callback is told whether it OPENED the transaction or
//      JOINED an outer one (ADR-0067 D2). The join is correct and stays; what
//      was missing is that the callback could not tell, so it could not know
//      whether its own "this all rolls back together" promise held.
//
// Point 2 (cross-driver business writes refused) is NOT here: it is coupled by
// the 2026-08-06 ruling to #5351's system-write carve-out and lands with it, in
// `engine-transaction-same-origin.test.ts`. Landing the refusal alone would be
// "loud but not fixed" — the audit hook's try/catch eats the refusal and the
// compliance row is lost exactly as before.

import { describe, it, expect } from 'vitest';
import { ObjectQL, ScopedContext } from './engine.js';
import { TransactionUnsupportedError } from './transaction-errors.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args: unknown[];
}

/**
 * The error a call rejected with, typed as `E`.
 *
 * `promise.catch((e) => e as E)` types the result as `E | <resolved type>`, so
 * every property read on it is a type error. This narrows to the rejection and
 * fails loudly if the call did NOT reject — which a bare `.catch()` would
 * silently let through as a passing test.
 */
async function rejection<E>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/**
 * `transactional: false` makes a driver WITHOUT `beginTransaction` — the shape
 * the degrade path exists for (test doubles, foreign engines; every in-tree
 * driver implements it).
 */
function makeDriver(name: string, opts: { transactional?: boolean } = {}) {
  const writes: Array<{ object: string; op: 'create' | 'update' | 'delete'; transaction: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    writes,
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return Array.from(rows.values()); },
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.find?.((c: any) => c?.field === 'id')?.value;
      if (id !== undefined) return rows.get(String(id)) ?? null;
      for (const r of rows.values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'create', transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `${name}_${nextId}`;
      const row = { ...data, id };
      rows.set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'update', transaction: options?.transaction });
      const row = { ...rows.get(String(id)), ...data, id };
      rows.set(String(id), row);
      return row;
    },
    async delete(object: string, id: string, options: any) {
      writes.push({ object, op: 'delete', transaction: options?.transaction });
      return rows.delete(String(id));
    },
    async count() { return 0; },
    async bulkCreate(object: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {},
  };
  if (opts.transactional !== false) {
    driver.beginTransaction = async () => ({ __trx: name });
    driver.commit = async () => {};
    driver.rollback = async () => {};
  }
  return driver;
}

async function engineWith(opts: { transactional: boolean }) {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  const driver = makeDriver('primary', { transactional: opts.transactional });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');
  return { rec, engine, driver };
}

// ---------------------------------------------------------------------------
// 1. `opts.require: true` — fail closed instead of degrading
// ---------------------------------------------------------------------------

describe('transaction({ require: true }) refuses a driver that cannot roll back (#5696)', () => {
  it('throws TransactionUnsupportedError instead of running the callback', async () => {
    const { engine } = await engineWith({ transactional: false });
    let ran = false;

    await expect(
      engine.transaction(async () => { ran = true; }, undefined, { require: true }),
    ).rejects.toBeInstanceOf(TransactionUnsupportedError);

    // Refused BEFORE the callback — the whole point of failing closed is that
    // nothing has been written when the caller finds out.
    expect(ran).toBe(false);
  });

  it('carries the boundary-crossing code, the datasource, and the fix', async () => {
    const { engine } = await engineWith({ transactional: false });

    const err = await rejection<TransactionUnsupportedError>(
      engine.transaction(async () => 'unreachable', undefined, { require: true }),
    );

    expect(err.code).toBe('ERR_TRANSACTION_UNSUPPORTED');
    expect(err.datasource).toBe('primary');
    expect(err.message).toContain("driver 'primary' has no beginTransaction");
    expect(err.message).toContain('nothing has been written');
    // An error that refuses owes the reader the remedy, both halves of it.
    expect(err.message).toContain('Register a driver that implements beginTransaction');
    expect(err.message).toContain('drop `require`');
  });

  it('writes nothing — the refusal is not a rollback, it is a non-start', async () => {
    const { engine, driver } = await engineWith({ transactional: false });

    await engine
      .transaction(async () => { await engine.insert('thing', { name: 'x' }); }, undefined, { require: true })
      .catch(() => undefined);

    expect(driver.writes).toHaveLength(0);
  });

  it('is silent about the degrade it refused — the throw IS the report', async () => {
    const { engine, rec } = await engineWith({ transactional: false });

    await engine.transaction(async () => 1, undefined, { require: true }).catch(() => undefined);

    // The warn-once budget exists for callers who KEEP GOING without a
    // transaction. This caller did not: it was told by rejection, which is
    // louder than any log line, so emitting the warn too would be noise.
    expect(rec.at('warn')).toHaveLength(0);
  });

  it('does nothing at all when the driver CAN transact', async () => {
    const { engine, driver, rec } = await engineWith({ transactional: true });

    const out = await engine.transaction(
      async () => { await engine.insert('thing', { name: 'ok' }); return 'done'; },
      undefined,
      { require: true },
    );

    expect(out).toBe('done');
    expect(driver.writes).toHaveLength(1);
    expect(driver.writes[0].transaction).toEqual({ __trx: 'primary' });
    expect(rec.at('warn')).toHaveLength(0);
  });

  it('leaves the DEFAULT unchanged — no `require` still degrades and warns (ADR-0119 D1)', async () => {
    const { engine, rec } = await engineWith({ transactional: false });
    let ran = false;

    // Regression guard: `require` is opt-in. Making the degrade throw for
    // everyone would fail-close every deployment whose driver cannot transact,
    // which is the change this option exists to AVOID making globally.
    await engine.transaction(async () => { ran = true; });

    expect(ran).toBe(true);
    expect(rec.at('warn').filter((r) => r.message.includes('has no beginTransaction'))).toHaveLength(1);
  });

  it('honours `require: false` as the default, not as a second spelling of true', async () => {
    const { engine } = await engineWith({ transactional: false });
    await expect(engine.transaction(async () => 'ran', undefined, { require: false })).resolves.toBe('ran');
  });
});

// ---------------------------------------------------------------------------
// 3. `owned` — opened by me, or joined from an outer owner?
// ---------------------------------------------------------------------------

describe('transaction() tells its callback whether it OWNS the transaction (#5696, ADR-0067 D2)', () => {
  it('owned: true for the call that opened it', async () => {
    const { engine } = await engineWith({ transactional: true });
    const seen: boolean[] = [];

    await engine.transaction(async (_ctx, info) => { seen.push(info.owned); });

    expect(seen).toEqual([true]);
  });

  it('owned: false for a nested call that JOINED it', async () => {
    const { engine, driver } = await engineWith({ transactional: true });
    const seen: boolean[] = [];

    await engine.transaction(async (_outerCtx, outer) => {
      seen.push(outer.owned);
      await engine.transaction(async (_innerCtx, inner) => {
        seen.push(inner.owned);
        await engine.insert('thing', { name: 'nested' });
      });
    });

    expect(seen).toEqual([true, false]);
    // The join itself is unchanged: ONE transaction, and the nested write rode
    // the outer owner's handle.
    expect(driver.writes).toHaveLength(1);
    expect(driver.writes[0].transaction).toEqual({ __trx: 'primary' });
  });

  it('owned: false on the degrade path — there is no transaction to own', async () => {
    const { engine } = await engineWith({ transactional: false });
    let owned: boolean | undefined;

    await engine.transaction(async (_ctx, info) => { owned = info.owned; });

    // Not a lie by omission: `owned: false` says "you do not own a rollback",
    // which is exactly true here. A caller that needs to distinguish "someone
    // else owns it" from "nobody does" passes `require: true` and never
    // reaches this branch at all.
    expect(owned).toBe(false);
  });

  it('does not disturb one-argument callbacks', async () => {
    const { engine } = await engineWith({ transactional: true });
    const legacy = async (ctx: any) => {
      expect(ctx.transaction).toEqual({ __trx: 'primary' });
      return 'legacy';
    };
    await expect(engine.transaction(legacy)).resolves.toBe('legacy');
  });

  it('still threads baseContext when the third argument is present', async () => {
    const { engine } = await engineWith({ transactional: true });

    const ctx = await engine.transaction(
      async (trxCtx) => trxCtx,
      { userId: 'u1', isSystem: true },
      { require: true },
    );

    expect(ctx).toMatchObject({ userId: 'u1', isSystem: true, transaction: { __trx: 'primary' } });
  });
});

// ---------------------------------------------------------------------------
// The sandbox surface is the same primitive, not a second dialect
// ---------------------------------------------------------------------------

describe('ScopedContext.transaction (ctx.api.transaction) carries the same two points (#5696)', () => {
  function scopedOf(engine: ObjectQL): ScopedContext {
    return (engine as any).createContext({ userId: 'u1' }) as ScopedContext;
  }

  it('refuses under require: true, with the same error', async () => {
    const { engine } = await engineWith({ transactional: false });
    let ran = false;

    await expect(
      scopedOf(engine).transaction(async () => { ran = true; }, { require: true }),
    ).rejects.toBeInstanceOf(TransactionUnsupportedError);
    expect(ran).toBe(false);
  });

  it('still degrades without require — behaviour unchanged', async () => {
    const { engine } = await engineWith({ transactional: false });
    await expect(scopedOf(engine).transaction(async () => 'ran')).resolves.toBe('ran');
  });

  it('reports owned: true when it opens one, and false when degraded', async () => {
    const withTx = await engineWith({ transactional: true });
    const withoutTx = await engineWith({ transactional: false });
    let ownedOpen: boolean | undefined;
    let ownedDegraded: boolean | undefined;

    await scopedOf(withTx.engine).transaction(async (_ctx, info) => { ownedOpen = info.owned; });
    await scopedOf(withoutTx.engine).transaction(async (_ctx, info) => { ownedDegraded = info.owned; });

    expect(ownedOpen).toBe(true);
    expect(ownedDegraded).toBe(false);
  });

  // The third point of parity, added by #6168. Until then this was the ONE
  // place the second implementation still diverged: it had no ADR-0067 D2 join
  // branch, so `owned` reported `true` here forever — honest about a behaviour
  // that was not. Durability coverage lives in `engine-ambient-transaction.test.ts`
  // (the inner write must be undone by the outer rollback); what is pinned here
  // is the CONTRACT parity — same handle, same signal, same ordering.
  it('JOINS an ambient transaction rather than opening a second one (ADR-0067 D2, #6168)', async () => {
    const { engine, driver } = await engineWith({ transactional: true });
    let outerHandle: unknown;
    let innerHandle: unknown;
    let innerOwned: boolean | undefined;

    await engine.transaction(async (ctx: any) => {
      outerHandle = ctx.transaction;
      await scopedOf(engine).transaction(async (trxCtx, info) => {
        innerHandle = (trxCtx as unknown as { transactionHandle: unknown }).transactionHandle;
        innerOwned = info.owned;
      });
    });

    // `beginTransaction` mints a fresh object per call, so identity is what
    // separates "joined the outer handle" from "opened an identical-looking one".
    expect(innerOwned).toBe(false);
    expect(innerHandle).toBe(outerHandle);
    expect(driver.writes).toHaveLength(0);
  });

  it('joins under require: true — an ambient transaction satisfies it, nothing is refused', async () => {
    const { engine } = await engineWith({ transactional: true });
    let owned: boolean | undefined;

    // The join sits BEFORE the driver/`require` handling on both surfaces, and
    // it must: when there is an ambient transaction there IS a transaction, so
    // a caller who declared it cannot run without one is served by joining.
    await engine.transaction(async () => {
      await scopedOf(engine).transaction(
        async (_ctx, info) => { owned = info.owned; },
        { require: true },
      );
    });

    expect(owned).toBe(false);
  });
});
