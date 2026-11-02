// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Bulk & Batch Operations" section of `SqlDriver`: the
 * bodies of `bulkUpdate` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link BulkOperationsHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time, so a subclass override or an instance spy
 * is still the one reached; fields and accessors go as GETTERS, read when the
 * body reads them, as they were on the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface BulkOperationsHost {
  readonly knex: SqlDriver['knex'];
  update: SqlDriver['update'];
}

/** The body of `SqlDriver#bulkUpdate`; the method's docblock there is its contract. */
export async function bulkUpdate(this: Pick<BulkOperationsHost, 'knex' | 'update'>, object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // An empty batch issues no statement, exactly as before: a BEGIN/COMMIT
    // pair — and the pool checkout behind it — buys nothing for zero rows.
    if (updates.length === 0) return [];

    const applyAll = async (scoped: DriverOptions): Promise<Record<string, any>[]> => {
      const results: Record<string, any>[] = [];
      for (const { id, data } of updates) {
        const updated = await this.update(object, id, data, scoped);
        if (updated) results.push(updated);
      }
      return results;
    };

    // The `(caller's transaction) ?? this.knex` runner idiom this file already
    // uses (see {@link collidingAutoNumberReservations}); here the choice of
    // runner is also the choice between a transaction and a savepoint.
    const runner: Knex | Knex.Transaction = (options?.transaction as Knex.Transaction | undefined) ?? this.knex;
    return runner.transaction(async (trx) => applyAll({ ...options, transaction: trx }));
  }
