// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 3] The transaction doors of `SqlDriver`: `beginTransaction`,
 * `commit`, `rollback`, their deprecated aliases `commitTransaction` and
 * `rollbackTransaction`, and the SQLite single-connection guard
 * `assertBareKnexSafe`. They moved out of `sql-driver.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same open-transaction count, the same release on every close,
 * the same guard.
 *
 * `releaseTransaction` did NOT move. Its body deletes from the
 * `openTransactions` set (`this.openTransactions.delete(`), and the series
 * keeps a body with such a site in the class. `commit` and `rollback` reach it
 * through the host, like any other member.
 *
 * ## How the moved bodies reach the class
 *
 * The shape `sql-driver-introspection.ts` (cut 1) and
 * `sql-driver-raw-execution.ts` (cut 2) apply, after #23050. The class keeps
 * every method, because the published `dist/*.d.ts` lists each one's name,
 * docblock and position. `TursoDriver` overrides `beginTransaction`, `commit`
 * and `rollback`, and each override calls `super`. Each body is now one
 * literal of exactly the {@link TransactionHost} members that method reads,
 * plus a `.call`. The five `async` methods are no longer `async`: each returns
 * the moved function's own promise, so a caller awaits the same promise the
 * body settles, with no extra wrapper.
 *
 * `commit`, `rollback`, `releaseTransaction` and `isProductionEnv` go as
 * closures that call them on the driver at call time. So a subclass override
 * is still the one a body reaches: the deprecated `commitTransaction` reaches
 * `TursoDriver`'s refusing `commit`, as it did when it called `this.commit`.
 * A test spy on the instance is reached the same way.
 *
 * The fields `knex`, `openTransactions` and `activeTransactions`, and the
 * getter `isSqlite`, go as GETTERS, so each read happens when the body makes
 * it, as it did on the class (`SqliteWasmDriver` overrides `isSqlite`).
 * `beginTransaction` also WRITES `activeTransactions` (`++`), so its literal
 * carries a setter beside the getter, which writes the field on the driver.
 * Both fields stay on the class: `releaseTransaction` and the tests read them.
 *
 * The bodies read no module-level declaration of `sql-driver.ts`, so nothing
 * gained an `export` there. `index.ts` re-exports nothing from this module, so
 * the published surface does not move.
 */

import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters, and for the one that is also written.
 */
export interface TransactionHost {
  activeTransactions: SqlDriver['activeTransactions'];
  commit: SqlDriver['commit'];
  isProductionEnv: SqlDriver['isProductionEnv'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
  readonly openTransactions: SqlDriver['openTransactions'];
  releaseTransaction: SqlDriver['releaseTransaction'];
  rollback: SqlDriver['rollback'];
}

/** The body of `SqlDriver#beginTransaction`; the method's docblock there is its contract. */
export async function beginTransaction(this: Pick<TransactionHost, 'activeTransactions' | 'knex' | 'openTransactions'>): Promise<Knex.Transaction> {
  const trx = await this.knex.transaction();
  this.openTransactions.add(trx as unknown as object);
  this.activeTransactions++;
  return trx;
}

/** The body of `SqlDriver#assertBareKnexSafe`; the method's docblock there is its contract. */
export function assertBareKnexSafe(this: Pick<TransactionHost, 'activeTransactions' | 'isProductionEnv' | 'isSqlite'>, op: string): void {
  if (this.isProductionEnv()) return;
  if (!this.isSqlite) return;
  if (this.activeTransactions === 0) return;
  throw new Error(
    `[driver-sql] refusing to run '${op}' on a fresh pooled connection while a ` +
      `transaction is open: SQLite's pool has a single connection, so acquiring a ` +
      `second one would dead-lock (surfacing later as "Knex: Timeout acquiring a ` +
      `connection"). Bind this operation to the active transaction instead of using ` +
      `this.knex.`,
  );
}

/** The body of `SqlDriver#commit`; the method's docblock there is its contract. */
export async function commit(this: Pick<TransactionHost, 'releaseTransaction'>, transaction: unknown): Promise<void> {
  try {
    await (transaction as Knex.Transaction).commit();
  } finally {
    this.releaseTransaction(transaction);
  }
}

/** The body of `SqlDriver#rollback`; the method's docblock there is its contract. */
export async function rollback(this: Pick<TransactionHost, 'releaseTransaction'>, transaction: unknown): Promise<void> {
  try {
    await (transaction as Knex.Transaction).rollback();
  } finally {
    this.releaseTransaction(transaction);
  }
}

/** The body of `SqlDriver#commitTransaction`; the method's docblock there is its contract. */
export async function commitTransaction(this: Pick<TransactionHost, 'commit'>, trx: Knex.Transaction): Promise<void> {
  await this.commit(trx);
}

/** The body of `SqlDriver#rollbackTransaction`; the method's docblock there is its contract. */
export async function rollbackTransaction(this: Pick<TransactionHost, 'rollback'>, trx: Knex.Transaction): Promise<void> {
  await this.rollback(trx);
}
