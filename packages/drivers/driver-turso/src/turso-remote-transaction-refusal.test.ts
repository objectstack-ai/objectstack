// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18616] Transactions on the Turso REMOTE face: refused loudly, not handed
 * out as a decorative handle — and the other two faces untouched.
 *
 * # The defect this replaces
 *
 * `@objectstack/spec`'s `driver.zod.ts` names the delivery mechanism verbatim:
 *
 * > A transaction handle to be passed to subsequent operations via
 * > `options.transaction`.
 *
 * In remote mode nothing could receive it. Re-derived on this branch's base
 * (`f8eaf670454a`, which contains #18668's edit to `remote-transport.ts`, so
 * the card's line numbers no longer apply and every reading below was taken by
 * content):
 *
 * | reading | result |
 * |:--|:--|
 * | `RemoteTransport` members naming a transaction | **3** — `beginTransaction()`, `commit(t)`, `rollback(t)` |
 * | `RemoteTransport` **data** methods accepting `options` or a transaction | **0** |
 * | firing control — data methods present at all in that file | **13** (`find`, `findOne`, `aggregate`, `create`, `update`, `upsert`, `delete`, `count`, `bulkCreate`, `bulkUpdate`, `bulkDelete`, `updateMany`, `deleteMany`) ⇒ the zero is a reading |
 * | `this.isRemote` guards in `turso-driver.ts` | **26** |
 *
 * So a write issued between `beginTransaction()` and `rollback()` executed on
 * the plain connection, was **already durable**, and the rollback resolved
 * having undone nothing. The caller was told the rollback succeeded.
 *
 * ⚠️ The LOCAL pin in `turso-driver.test.ts` ("should support transactions with
 * rollback") already asserted the correct shape for local mode. The remote face
 * was the unpinned one, which is what let this sit.
 *
 * # The deliverable is the REFUSAL, not an implementation
 *
 * Triage's ruling on this card drew that boundary and it is quoted rather than
 * paraphrased, because the boundary is the deliverable:
 *
 * > **止损(本卡)**:remote 模式遇到 `options.transaction` 或
 * > `beginTransaction()` 时**大声拒绝 / 声明不支持**,让调用者立刻知道自己没有
 * > 事务语义。
 * > **实现远程事务**:那是 **#18116 已完成的那次「measure, do not implement」
 * > 量出来的半径**,是**另一件事**、另一个量级。⛔ 不要把它折进本卡。
 *
 * # ⚠️ Every refusal case asserts `code` AND `status`
 *
 * ADR-0112. A bare `rejects.toThrow()` would be satisfied by any error at all —
 * including the `TypeError` an un-fixed driver raises against a client stub
 * with no `transaction()` member, which is precisely the wrong reason to be
 * green. `NOT_IMPLEMENTED`/501 is the class, on the same two-class taxonomy
 * this package already applies to remote `auto_number` (#6944), aggregate
 * functions (#5907) and date buckets (#6212): the request is spelled correctly
 * and the spec declares the member, so the gap is the backend's.
 *
 * # Why BOTH doors, and why neither subsumes the other
 *
 * The dispatch asked which callers can reach a remote data method with a
 * handle in hand. Measured, there are two producers and they are independent:
 *
 * 1. **`driver.beginTransaction()`** — every in-repo producer is one of these:
 *    `engine.transaction()`, `ScopedContext.beginTransaction()`, the sandbox
 *    trio. Closing this door closes all of them, *before* any write.
 * 2. **`ExecutionContext.transaction`**, threaded by the caller —
 *    `buildDriverOptions` (`packages/objectql/src/engine.ts`) reads it FIRST
 *    ("Explicit wins; ambient is the safety net"), and the same-origin gate
 *    does not stop it: `transactionCoversDriverFor` attributes a handle only
 *    when it IS the ambient store's handle and otherwise declines to judge,
 *    returning `true`. Such a handle never passes through (1).
 *
 * ⇒ (1) alone is a **false floor** — the `no beginTransaction call` block below
 * is the instrument for that, and it is the block that would stay red if only
 * the `beginTransaction()` half had been written.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Prediction: with `assertRemoteTransactionUnsupported`'s body emptied and the
 * three trio refusals removed, the REMOTE blocks go red and the LOCAL/REPLICA
 * blocks and the no-handle silence controls stay green — because none of the
 * latter depends on the refusal existing. The measured result is recorded in
 * the PR body.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const OBJECT = {
  name: 'crm_note',
  fields: {
    organization_id: { type: 'string' },
    title: { type: 'string' },
  },
};

/**
 * The refusal's opening clause, spelled out here rather than imported (#5240):
 * a test that imports the string it asserts pins nothing about the wording.
 * Only the first clause is pinned — the remedy paragraph is prose that may be
 * improved without a test edit.
 */
const REFUSES = (door: string) => `${door} is not supported by the Turso REMOTE transport.`;

const open: TursoDriver[] = [];

afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => {});
});

/**
 * A remote driver whose client also answers `transaction()`.
 *
 * ⚠️ Load-bearing: the shared testkit stub has no `transaction()` member, so an
 * un-fixed driver reaching `client.transaction()` throws a `TypeError` — and a
 * suite that accepted any throw would be green against the defect. Modelling
 * the member the real `@libsql/client` has makes the pre-fix behaviour what it
 * really was (a handle, resolved) and forces the assertions to discriminate on
 * `code`/`status` rather than on the existence of an error.
 */
type TransactionalStub = LibsqlSqliteStub & {
  transaction(): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>;
  transactionCalls: number;
};

function makeTransactionalStub(): TransactionalStub {
  const stub = makeLibsqlSqliteStub() as TransactionalStub;
  stub.transactionCalls = 0;
  stub.transaction = async () => {
    stub.transactionCalls += 1;
    return { commit: async () => {}, rollback: async () => {} };
  };
  return stub;
}

async function makeRemote() {
  const stub = makeTransactionalStub();
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
  open.push(driver);
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.initObjects([OBJECT as never]);
  return { driver, stub };
}

async function makeLocal() {
  const driver = new TursoDriver({ url: ':memory:' });
  open.push(driver);
  expect(driver.transportMode).toBe('local');
  await driver.connect();
  await driver.initObjects([OBJECT as never]);
  return driver;
}

/** The third face — `syncUrl` is what makes it `replica`; the sync is off. */
async function makeReplica() {
  const stub = makeTransactionalStub();
  const driver = new TursoDriver({
    url: ':memory:',
    syncUrl: 'libsql://probe.turso.io',
    client: stub as never,
    sync: { onConnect: false, intervalSeconds: 0 },
  });
  open.push(driver);
  await driver.connect();
  expect(driver.transportMode).toBe('replica');
  await driver.initObjects([OBJECT as never]);
  return driver;
}

const rowCount = (stub: LibsqlSqliteStub) =>
  (stub.raw.prepare('select count(*) as c from "crm_note"').all() as Array<{ c: number }>)[0].c;

/**
 * Run a remote call that must be refused, and prove it cost nothing: no
 * statement reached the client, no transaction was opened on it, and no row
 * moved. The rule every other refusal on this path already follows.
 */
async function refusalOf(
  stub: TransactionalStub,
  call: () => Promise<unknown>,
): Promise<WireBearingError> {
  const rowsBefore = rowCount(stub);
  const txBefore = stub.transactionCalls;
  const executed: unknown[] = [];
  const realExecute = stub.execute.bind(stub);
  stub.execute = async (s: unknown) => {
    executed.push(s);
    return realExecute(s);
  };
  try {
    const resolved = await call();
    throw new Error(
      `expected the remote face to refuse, but it resolved with ${JSON.stringify(resolved)}`,
    );
  } catch (e) {
    const err = e as WireBearingError;
    if (err.message.startsWith('expected the remote face to refuse')) throw err;
    expect(executed).toEqual([]);
    expect(stub.transactionCalls).toBe(txBefore);
    expect(rowCount(stub)).toBe(rowsBefore);
    return err;
  } finally {
    stub.execute = realExecute;
  }
}

describe('[#18616] REMOTE: the transaction trio refuses instead of handing out a handle', () => {
  it('beginTransaction — NOT_IMPLEMENTED/501, and the client is never asked for one', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () => driver.beginTransaction());
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSES('`beginTransaction()`'));
  });

  it('commit — refused, because this face issues no handle to commit', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () => driver.commit({ foreign: 'handle' }));
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSES('`commit()`'));
  });

  it('rollback — refused, because a successful undo here would be the false success', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () => driver.rollback({ foreign: 'handle' }));
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSES('`rollback()`'));
  });

  it('the card\'s own sequence cannot start: begin → write → rollback stops at begin', async () => {
    const { driver, stub } = await makeRemote();
    await expect(driver.beginTransaction()).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
    // Nothing was written, so there is nothing a rollback would have had to
    // undo — which is the whole difference from the behaviour this replaces.
    expect(rowCount(stub)).toBe(0);
  });
});

/**
 * The false-floor instrument. Every case here reaches a data method with a
 * handle WITHOUT ever calling `beginTransaction()` — the `ExecutionContext`
 * path. A fix that only closed `beginTransaction()` leaves every one of these
 * silently dropping the handle, exactly as before.
 */
describe('[#18616] REMOTE: a handle threaded in with no beginTransaction call is refused too', () => {
  const HANDLE = { from: 'somewhere else' };

  const CASES: Array<[string, (d: TursoDriver) => Promise<unknown>]> = [
    ['find', (d) => d.find('crm_note', {}, { transaction: HANDLE })],
    ['findOne', (d) => d.findOne('crm_note', { where: { id: 'n1' } }, { transaction: HANDLE })],
    ['count', (d) => d.count('crm_note', {}, { transaction: HANDLE })],
    ['aggregate', (d) => d.aggregate('crm_note', {}, { transaction: HANDLE })],
    ['create', (d) => d.create('crm_note', { title: 'x' }, { transaction: HANDLE })],
    ['update', (d) => d.update('crm_note', 'n1', { title: 'y' }, { transaction: HANDLE })],
    ['upsert', (d) => d.upsert('crm_note', { id: 'n1', title: 'z' }, ['id'], { transaction: HANDLE })],
    ['delete', (d) => d.delete('crm_note', 'n1', { transaction: HANDLE })],
    ['bulkCreate', (d) => d.bulkCreate('crm_note', [{ title: 'a' }], { transaction: HANDLE })],
    ['bulkUpdate', (d) => d.bulkUpdate('crm_note', [{ id: 'n1', data: { title: 'b' } }], { transaction: HANDLE })],
    ['bulkDelete', (d) => d.bulkDelete('crm_note', ['n1'], { transaction: HANDLE })],
    ['updateMany', (d) => d.updateMany('crm_note', {}, { title: 'c' }, { transaction: HANDLE })],
    ['deleteMany', (d) => d.deleteMany('crm_note', {}, { transaction: HANDLE })],
    ['execute', (d) => d.execute('select 1', [], { transaction: HANDLE })],
    ['syncSchema', (d) => d.syncSchema('crm_note', OBJECT, { transaction: HANDLE })],
    ['syncSchemasBatch', (d) => d.syncSchemasBatch([{ object: 'crm_note', schema: OBJECT }], { transaction: HANDLE })],
    ['dropTable', (d) => d.dropTable('crm_note', { transaction: HANDLE })],
  ];

  for (const [name, call] of CASES) {
    it(`${name} — NOT_IMPLEMENTED/501, before any statement is built`, async () => {
      const { driver, stub } = await makeRemote();
      const err = await refusalOf(stub, () => call(driver));
      expect(err.code).toBe('NOT_IMPLEMENTED');
      expect(err.status).toBe(501);
      expect(err.message).toContain(REFUSES(`\`options.transaction\` on \`${name}()\``));
    });
  }
});

/**
 * Silence controls. Every case here is true on BOTH sides of this change — an
 * un-fixed driver satisfies them trivially. They are what stops the refusal
 * from leaking onto a call that has no transaction in it, or onto a face that
 * really does have transactions.
 */
describe('[#18616] the refusal fires on the HANDLE, not on remote mode', () => {
  it('remote writes and reads with no handle are untouched', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_note', { id: 'n1', organization_id: 'orgA', title: 'kept' });
    expect(rowCount(stub)).toBe(1);
    expect(await driver.count('crm_note', {})).toBe(1);
    const rows = await driver.find('crm_note', { where: { id: 'n1' } });
    expect(rows).toHaveLength(1);
  });

  it('an explicitly undefined handle is not a handle', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_note', { id: 'n2', title: 'also kept' }, { transaction: undefined });
    expect(rowCount(stub)).toBe(1);
  });

  it('LOCAL: rollback still undoes the write — the pin this card mirrors', async () => {
    const driver = await makeLocal();
    const trx = await driver.beginTransaction();
    await driver.create('crm_note', { id: 'l1', title: 'RollbackUser' }, { transaction: trx });
    await driver.rollback(trx);
    expect(await driver.find('crm_note', { where: { id: 'l1' } })).toHaveLength(0);
  });

  it('LOCAL: commit still keeps the write', async () => {
    const driver = await makeLocal();
    const trx = await driver.beginTransaction();
    await driver.create('crm_note', { id: 'l2', title: 'TrxUser' }, { transaction: trx });
    await driver.commit(trx);
    expect(await driver.find('crm_note', { where: { id: 'l2' } })).toHaveLength(1);
  });

  it('REPLICA: the third face still opens and rolls back a transaction', async () => {
    const driver = await makeReplica();
    const trx = await driver.beginTransaction();
    await driver.create('crm_note', { id: 'r1', title: 'ReplicaUser' }, { transaction: trx });
    await driver.rollback(trx);
    expect(await driver.find('crm_note', { where: { id: 'r1' } })).toHaveLength(0);
  });
});
