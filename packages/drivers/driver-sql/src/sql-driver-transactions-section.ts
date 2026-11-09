// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Transactions" section of `SqlDriver`: the bodies of
 * `releaseTransaction` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link TransactionsSectionFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link TransactionsSectionHost}: exactly
 * the `SqlDriver` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `transactionsSectionHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link TransactionsSectionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface TransactionsSectionHost {
  activeTransactions: SqlDriver['activeTransactions'];
  readonly openTransactions: SqlDriver['openTransactions'];
}

/** The bodies of the "Transactions" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class TransactionsSectionFacet {
  /** The body of `SqlDriver#releaseTransaction`; the method's docblock there is its contract. */
  static releaseTransaction(this: Pick<TransactionsSectionHost, 'activeTransactions' | 'openTransactions'>, transaction: unknown): void {
    const key = transaction as object;
    if (key && this.openTransactions.has(key)) {
      this.openTransactions.delete(key);
      this.activeTransactions = Math.max(0, this.activeTransactions - 1);
    }
  }
}
