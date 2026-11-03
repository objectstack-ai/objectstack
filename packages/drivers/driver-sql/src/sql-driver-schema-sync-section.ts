// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Schema Sync (syncSchema / init)" section of
 * `SqlDriver`: the bodies of `reclaimSpace` moved out of `sql-driver.ts` whole
 * by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link SchemaSyncSectionHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import { reclaimBetterSqlite3 } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface SchemaSyncSectionHost {
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
}

/** The body of `SqlDriver#reclaimSpace`; the method's docblock there is its contract. */
export async function reclaimSpace(this: Pick<SchemaSyncSectionHost, 'isSqlite' | 'knex'>, _options?: DriverOptions): Promise<void> {
    if (!this.isSqlite) return;
    const client = this.knex.client;
    if (client.driverName === 'better-sqlite3') {
      const connection = await client.acquireConnection();
      try {
        reclaimBetterSqlite3(connection);
      } finally {
        await client.releaseConnection(connection);
      }
      return;
    }
    await this.knex.raw('PRAGMA incremental_vacuum');
  }
