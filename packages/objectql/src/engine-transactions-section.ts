// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Transactions" section of `ObjectQL`: the bodies of
 * `transaction`, `runOpenedUnit`, `isClosedUnitHandle`, `newTransactionScope`,
 * `datasourceNameOf` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link TransactionsSectionFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link TransactionsSectionHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `transactionsSectionHost` in `engine-facet-hosts.ts`, built
 * once per engine by the class's static block. Methods go as closures that
 * call them on the engine at call time, so a subclass override or an instance
 * spy is still the one reached; fields and accessors go as GETTERS, read when
 * the body reads them, as they were on the class, and a field a body assigns
 * goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { driverSupportsTransactions } from '@objectstack/spec/data';
import { redactPropagatedDriverFault } from '@objectstack/types';
import type { EngineTransactionInfo, EngineTransactionOptions, IDataDriver } from '@objectstack/core';
import { rollbackFailedRefusal, rolledBackRefusal } from './summary-errors.js';
import { TransactionUnsupportedError } from './transaction-errors.js';
import type { TransactionScope } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link TransactionsSectionFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface TransactionsSectionHost {
  datasourceNameOf: ObjectQL['datasourceNameOf'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  newTransactionScope: ObjectQL['newTransactionScope'];
  readonly openedUnits: ObjectQL['openedUnits'];
  runOpenedUnit: ObjectQL['runOpenedUnit'];
  readonly txStore: ObjectQL['txStore'];
  warnTransactionUnsupported: ObjectQL['warnTransactionUnsupported'];
}

/** The bodies of the "Transactions" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class TransactionsSectionFacet {
  /** The body of `ObjectQL#transaction`; the method's docblock there is its contract. */
  static async transaction<T>(this: Pick<TransactionsSectionHost, 'defaultDriver' | 'drivers' | 'runOpenedUnit' | 'txStore' | 'warnTransactionUnsupported'>, callback: (trxCtx: any, info: EngineTransactionInfo) => Promise<T>, baseContext?: any, opts?: EngineTransactionOptions): Promise<T> {
    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of
    // opening a nested driver transaction. A nested begin would acquire a
    // second connection (a deadlock on single-connection pools like the
    // SQLite knex pool) and would NOT be covered by the outer rollback —
    // exactly the half-landing this join prevents: an outer batch
    // transaction (e.g. `publishPackageDrafts`) must own the one-and-only
    // commit/rollback for every write made through nested helpers (the
    // sys-metadata repository's `withTxn`, hook-driven writes, …).
    const ambient = this.txStore.getStore();
    if (ambient?.transaction) {
      // JOINED, not owned: some outer caller decides commit vs rollback (#5696).
      return callback(
        { ...(baseContext ?? {}), transaction: ambient.transaction },
        { owned: false },
      );
    }
    const driver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    const drv = driver as any;
    // [#18063] The gate is the DECLARATION, not bare method presence. A
    // subclass inherits `beginTransaction` from a base whose transport has
    // transactions while its own has none — it cannot opt out of a door it did
    // not open, so presence alone routed it down the transactional path and the
    // handle it produced covered nothing. `driverSupportsTransactions` is the
    // one definition (`@objectstack/spec`), shared with the ScopedContext trio
    // below so the engine's transaction entrances cannot drift apart.
    if (!driverSupportsTransactions(drv)) {
      const datasource = this.defaultDriver ?? drv?.name;
      if (opts?.require === true) {
        // Fail CLOSED (#5696 point 1): the caller declared it cannot tolerate
        // running without a rollback, so refuse BEFORE the callback writes
        // anything rather than degrade behind a warning it may never read.
        // Generalizes `batchData`'s atomic gate (ADR-0119 D4).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // Declared degrade (ADR-0119 D1) — behaviour unchanged, but no longer
      // mute: the caller asked for atomicity and is not getting it (#4619).
      this.warnTransactionUnsupported(datasource, drv?.supports?.transactionsUnsupported === true);
      // `owned: false` — honest: there is no transaction here to own, and no
      // rollback the callback may promise on the strength of it.
      return callback(baseContext, { owned: false });
    }
    const trx = await drv.beginTransaction();
    const trxCtx = { ...(baseContext ?? {}), transaction: trx };
    try {
      // Run the callback inside the ambient transaction store so internal
      // queries during writes reuse this transaction's connection (ADR-0034),
      // CLOSED once the callback settles, before the commit (#22782, #22855).
      const result = await this.runOpenedUnit(trx, driver!, () => callback(trxCtx, { owned: true }));
      if (drv.commit) await drv.commit(trx);
      else if (drv.commitTransaction) await drv.commitTransaction(trx);
      return result;
    } catch (err) {
      let rollbackFailed = false;
      try {
        if (drv.rollback) await drv.rollback(trx);
        else if (drv.rollbackTransaction) await drv.rollbackTransaction(trx);
      } catch {
        // swallow rollback failures so the original error surfaces
        rollbackFailed = true;
      }
      // [#21274] A boundary outside the middleware seam: a commit failure, or
      // a callback that reached the driver through the transaction handle.
      // An error that already crossed an engine boundary inside the callback
      // comes back as the same reference. A stale-roll-up refusal ("stored")
      // is no longer true once this rollback has run: `rolledBackRefusal`.
      // [#29421] Nor is "rolled back" once the rollback threw:
      // `rollbackFailedRefusal`.
      throw redactPropagatedDriverFault(rollbackFailed ? rollbackFailedRefusal(err) : rolledBackRefusal(err));
    }
  }

  /**
   * [#22782, #22855] Run `body`, the callback of a unit just opened on `owner`
   * with handle `trx`. This is the ONE place both transaction surfaces
   * ({@link transaction} and `ScopedContext.transaction`) publish a unit and
   * close it again.
   *
   * Published: the entry goes into {@link txStore} (ADR-0034) for the body's
   * lifetime, carrying its owner (#4619). Internal queries during writes reuse
   * this connection, and a nested `transaction()` on either surface joins it.
   *
   * Closed once `body` settles, BEFORE the caller commits or rolls back. Work
   * the body started and did not await (an `async: true` hook) holds the
   * handle two ways: ambiently, through this entry, and explicitly, threaded
   * into the callback's context and from there into the hook's `ctx.api`. That
   * work used to run on the finished handle and lose its write ("Transaction
   * query already complete"). Emptying the entry ends the ambient way;
   * {@link openedUnits} ends the explicit one, because
   * {@link buildDriverOptions} treats a closed unit's handle as absent. The
   * work then runs unenrolled, on its own connection, as outside any unit:
   * `opensAfterAbortUnit` reads the handle the same way, so such a write opens
   * the door's own unit when its hooks call for one.
   *
   * A primitive handle cannot key {@link openedUnits}, so it keeps only the
   * ambient half.
   */
  static runOpenedUnit<T>(this: Pick<TransactionsSectionHost, 'newTransactionScope' | 'openedUnits' | 'txStore'>, trx: unknown, owner: IDataDriver, body: () => Promise<T>): Promise<T> {
    const entry: { transaction: unknown; scope?: TransactionScope } =
      { transaction: trx, scope: this.newTransactionScope(owner) };
    if (trx !== null && (typeof trx === 'object' || typeof trx === 'function')) this.openedUnits.set(trx, entry);
    return this.txStore.run(entry, body).finally(() => { entry.transaction = undefined; entry.scope = undefined; });
  }

  /** [#22855] Is `handle` a unit {@link runOpenedUnit} published whose callback has since settled? */
  static isClosedUnitHandle(this: Pick<TransactionsSectionHost, 'openedUnits'>, handle: unknown): boolean {
    if (handle === null || (typeof handle !== 'object' && typeof handle !== 'function')) return false;
    const entry = this.openedUnits.get(handle);
    return entry !== undefined && entry.transaction === undefined;
  }

  /**
   * Build the observability record for a transaction this engine just opened
   * (#4619). See {@link TransactionScope} — records only, routes nothing.
   */
  static newTransactionScope(this: Pick<TransactionsSectionHost, 'datasourceNameOf'>, owner: IDataDriver): TransactionScope {
    return {
      driver: owner,
      datasource: this.datasourceNameOf(owner),
      reportedOutOfScope: new Set<string>(),
    };
  }

  /**
   * Which datasource name is `driver` registered under?
   *
   * `registerDriver` keys {@link drivers} by `driver.name`, so the two normally
   * agree — but the map is the routing authority (`getDriver` resolves through
   * it), so the map is what is searched, and `driver.name` is only the fallback
   * for a driver that was never registered. Runs at most once per transaction
   * (and once per out-of-scope report), never on the hot path.
   */
  static datasourceNameOf(this: Pick<TransactionsSectionHost, 'drivers'>, driver: IDataDriver): string {
    for (const [name, registered] of this.drivers) {
      if (registered === driver) return name;
    }
    return driver?.name ?? 'unknown';
  }
}
