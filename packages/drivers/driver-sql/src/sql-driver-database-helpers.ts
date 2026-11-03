// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Database helpers" section of `SqlDriver`: the bodies of
 * `sqliteFilename` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link DatabaseHelpersHost}: exactly the
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
export interface DatabaseHelpersHost {
  readonly config: SqlDriver['config'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly openedEmptyInMemory: SqlDriver['openedEmptyInMemory'];
}

/** The body of `SqlDriver#sqliteFilename`; the method's docblock there is its contract. */
export function sqliteFilename(this: Pick<DatabaseHelpersHost, 'config' | 'isSqlite' | 'openedEmptyInMemory'>): string | null {
    if (!this.isSqlite) return null;
    // Redirected to `:memory:` because the declared file did not exist and the
    // host asked not to create one (#6743). `this.config` still names the
    // declared target — on purpose, so the CLI can print it — but NO on-disk
    // file backs this connection, which is precisely what this method reports.
    // Both callers depend on that reading: `ensureDatabaseExists` would
    // otherwise `mkdir` the state directory this mode exists to avoid, and
    // `applySqliteJournalMode` would try to put an in-memory database in WAL.
    if (this.openedEmptyInMemory) return null;
    const conn = (this.config as any).connection;
    const filename = typeof conn === 'string' ? conn : conn?.filename;
    if (typeof filename !== 'string' || filename === '') return null;
    return filename.startsWith(':') ? null : filename;
  }
