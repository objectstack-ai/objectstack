// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Lifecycle" section of `SqlDriver`: the bodies of
 * `connect` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link LifecycleHost}: exactly the
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

import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface LifecycleHost {
  applyAutoVacuumIncremental: SqlDriver['applyAutoVacuumIncremental'];
  applySqliteJournalMode: SqlDriver['applySqliteJournalMode'];
  ensureDatabaseExists: SqlDriver['ensureDatabaseExists'];
  readonly isSqlite: SqlDriver['isSqlite'];
  releaseRefusedSqliteConnection: SqlDriver['releaseRefusedSqliteConnection'];
}

/** The body of `SqlDriver#connect`; the method's docblock there is its contract. */
export async function connect(this: Pick<LifecycleHost, 'applyAutoVacuumIncremental' | 'applySqliteJournalMode' | 'ensureDatabaseExists' | 'isSqlite' | 'releaseRefusedSqliteConnection'>): Promise<void> {
    try {
      // Ensure the database directory exists before any query can trigger
      // better-sqlite3 to open the file (e.g. loadMetaFromDb on startup).
      await this.ensureDatabaseExists();

      if (this.isSqlite) {
        // Both pragmas below are persistent properties of the FILE, so one
        // connection setting them is enough for every process that follows.
        // Each is READ first and set only when the file answers differently, so
        // a connect to a file an earlier boot already configured writes nothing
        // to it (#21734) — one rule for every connect, read-only boots included.
        // A `false` means the very first statement on this connection failed —
        // in practice a native addon that cannot load — so asking it for another
        // pragma would only repeat the same warning.
        if (await this.applyAutoVacuumIncremental()) {
          await this.applySqliteJournalMode();
        }
      }
    } catch (error) {
      if (this.isSqlite) await this.releaseRefusedSqliteConnection();
      throw error;
    }
  }
