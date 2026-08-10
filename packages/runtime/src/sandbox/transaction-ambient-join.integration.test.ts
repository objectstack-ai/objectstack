// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end regression for #6406 — ADR-0067 D2 on the SANDBOX face.
 *
 * A QuickJS hook body's `ctx.api.transaction(fn)` is VM-side sugar over three
 * host leaves (`__txBegin` / `__txCommit` / `__txRollback`), which drive
 * `ScopedContext`'s discrete trio — NOT the callback `ScopedContext.transaction`
 * that #6168 (PR #6403) taught to join. So the violation that PR closed on the
 * callback face stayed open here: a body running inside a host
 * `engine.transaction()` opened a SECOND driver transaction, which
 *
 *   1. asks the pool for a second connection — the deadlock D2 exists to avoid
 *      on a single-connection pool, and
 *   2. committed itself, so its writes SURVIVED the outer rollback: the caller
 *      was told the unit of work was undone while some of its rows were still
 *      there, with no error and no log.
 *
 * Everything below wires a REAL {@link ObjectQL} engine to the REAL
 * {@link QuickJSScriptRunner} through {@link hookBodyRunnerFactory}, so the
 * whole host-transaction → write → hook → VM → host-leaf path is exercised. The
 * driver double is ROLLBACK-HONEST (writes are staged per handle; `commit`
 * flushes, `rollback` discards), which is what lets these cases pin the fact the
 * issue is actually about — whether the row is still there afterwards — rather
 * than merely "rollback was called".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

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
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    // Reads see COMMITTED state only — nothing here reads back its own
    // uncommitted write, and it keeps the durability assertion unambiguous.
    async find(object: string) { return Array.from(committedFor(object).values()); },
    async findOne(object: string) { for (const r of committedFor(object).values()) return r; return null; },
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
    async bulkUpdate() { return []; }, async bulkDelete() {}, async syncSchema() {},
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
    async rollback(trx: unknown) { seen.rollbacks.push(trx); staged.delete(trx); },
  };
  const committedNames = (object: string) =>
    Array.from(committedFor(object).values()).map((r) => r.name).sort();
  return { driver, seen, committedNames };
}

/**
 * A hook whose BODY runs in QuickJS and opens a transaction — the real
 * reachability path the issue names. The `name` guard matters: the body's own
 * write fires this hook again, and without it the join would be measured
 * against that recursion instead of against the host's transaction.
 */
const TX_BODY = `
  if (ctx.input.name !== 'outer') return;
  await ctx.api.transaction(async () => {
    await ctx.api.object('thing').insert({ name: 'inner' });
  });
`;

const THROWING_TX_BODY = `
  if (ctx.input.name !== 'outer') return;
  await ctx.api.transaction(async () => {
    await ctx.api.object('thing').insert({ name: 'inner' });
    throw new Error('body boom');
  });
`;

describe('#6406 sandbox ctx.api.transaction joins the host transaction (real engine + real QuickJS)', () => {
  let engine: ObjectQL;
  let seen: ReturnType<typeof makeRollbackHonestDriver>['seen'];
  let committedNames: ReturnType<typeof makeRollbackHonestDriver>['committedNames'];

  const wire = async (source: string, driverOverrides?: (d: any) => void) => {
    engine = new ObjectQL();
    const d = makeRollbackHonestDriver();
    driverOverrides?.(d.driver);
    seen = d.seen;
    committedNames = d.committedNames;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } } as any, 'test');
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'test' }),
    );
    bindHooksToEngine(
      engine,
      [
        {
          name: 'sandbox_opens_a_transaction',
          object: 'thing',
          events: ['afterInsert'],
          body: { language: 'js', source, capabilities: ['api.write', 'api.transaction'] },
        } as any,
      ],
      { packageId: 'test' },
    );
  };

  beforeEach(() => { seen = undefined as any; });

  it('JOINS the host transaction — one begin, one handle, no commit of its own', async () => {
    await wire(TX_BODY);

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'outer' });
    });

    // ONE driver transaction for the whole unit of work — the connection half
    // of D2. Before #6406 there were two begins and two commits.
    expect(seen.begins).toHaveLength(1);
    expect(seen.commits).toHaveLength(1);
    expect(seen.creates).toHaveLength(2);
    expect(seen.creates[1].transaction).toBe(seen.creates[0].transaction);
    expect(seen.creates[0].transaction).toBe(seen.begins[0]);
    expect(committedNames('thing')).toEqual(['inner', 'outer']);
  }, 30000);

  it('the sandbox write is UNDONE by the outer rollback — the durability pin', async () => {
    await wire(TX_BODY);

    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'outer' });
        throw new Error('outer boom');
      }),
    ).rejects.toThrow('outer boom');

    // Before #6406: `committedNames('thing')` was `['inner']` — the VM's write
    // committed on its own transaction and outlived the rollback the caller was
    // told had undone the whole unit. Nothing failed, nothing was logged.
    expect(committedNames('thing')).toEqual([]);
    expect(seen.commits).toHaveLength(0);
    expect(seen.rollbacks).toHaveLength(1);
    expect(seen.begins).toHaveLength(1);
  }, 30000);

  it('a throw inside the JOINED body rolls back the OUTER transaction, once', async () => {
    await wire(THROWING_TX_BODY);

    // The sugar's catch branch reaches `__txRollback`, which ABSTAINS for a
    // joined handle, and then RE-THROWS — so the failure travels out of the VM,
    // out of the hook, and up to the host owner, which rolls the whole unit
    // back. That is the callback face's answer to "explicit rollback of a
    // joined transaction" (its joined branch has no rollback either), in the
    // shape the trio can express it.
    await expect(
      engine.transaction(async () => {
        await engine.insert('thing', { name: 'outer' });
      }),
    ).rejects.toThrow(/body boom/);

    expect(seen.rollbacks).toHaveLength(1);   // the OUTER one, not an inner one
    expect(seen.rollbacks[0]).toBe(seen.begins[0]);
    expect(seen.commits).toHaveLength(0);
    expect(committedNames('thing')).toEqual([]);
  }, 30000);

  it('with NO host transaction the sandbox still OPENS one — unchanged behaviour', async () => {
    await wire(TX_BODY);

    await engine.insert('thing', { name: 'outer' });

    // The outer write is not in any transaction; the body's is, and owns it.
    expect(seen.begins).toHaveLength(1);
    expect(seen.commits).toHaveLength(1);
    expect(seen.commits[0]).toBe(seen.begins[0]);
    expect(committedNames('thing')).toEqual(['inner', 'outer']);
  }, 30000);

  it('with NO host transaction a throwing body still ROLLS BACK its own — unchanged', async () => {
    await wire(THROWING_TX_BODY);

    await expect(engine.insert('thing', { name: 'outer' })).rejects.toThrow(/body boom/);

    expect(seen.begins).toHaveLength(1);
    expect(seen.rollbacks).toHaveLength(1);
    expect(seen.commits).toHaveLength(0);
    // The body's write is discarded; the outer one was never transactional.
    expect(committedNames('thing')).toEqual(['outer']);
  }, 30000);

  /**
   * The other half of D2's rationale. A real single-connection pool BLOCKS on
   * the second checkout — that is the deadlock — and a test modelling the block
   * faithfully could only fail by timing out. This double refuses instead, so
   * what is measured is the thing that causes both: whether a second connection
   * is asked for at all.
   */
  it('never asks for a second connection — a single-connection pool survives the body', async () => {
    let checkedOut = false;
    const checkouts: number[] = [];
    await wire(TX_BODY, (driver) => {
      const staged = new Map<unknown, unknown[]>();
      driver.beginTransaction = async () => {
        if (checkedOut) throw new Error('pool exhausted: no connection available (max=1)');
        checkedOut = true;
        checkouts.push(checkouts.length + 1);
        const h = { __trx: 'only' };
        staged.set(h, []);
        return h;
      };
      driver.commit = async () => { checkedOut = false; };
      driver.rollback = async () => { checkedOut = false; };
    });

    await expect(
      engine.transaction(async () => { await engine.insert('thing', { name: 'outer' }); }),
    ).resolves.toBeUndefined();

    expect(checkouts).toHaveLength(1);
  }, 30000);
});
