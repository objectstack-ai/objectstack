// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 7] The raw-command and transaction-routing bodies of `ObjectQL`,
 * moved out of `engine.ts` whole: `execute` (the driver a raw command goes to,
 * its two call shapes, and the redaction of a driver fault it propagates),
 * `warnTransactionUnsupported` (the once-per-driver report of ADR-0119's
 * declared degrade) and `enforceTransactionOrigin` (what a write routed to a
 * driver the open transaction does not cover gets: refused, or, for an
 * append-only system ledger under ADR-0057, executed outside it).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same driver-selection order, the same two refusals
 * before any command is sent, the same once-per-name warning and its two
 * causes, the same refusal before hooks run and the same once-per-transaction
 * debug line. Each method's docblock stays on the method in `engine.ts`, which
 * is still the contract.
 *
 * What stays in the class: `transaction`, because ADR-0119 cites it by
 * `engine.ts#transaction` and ADR-0067's join lives in it; `runOpenedUnit`,
 * `isClosedUnitHandle`, `newTransactionScope` and `datasourceNameOf`, whose
 * bodies are shorter than the host literal moving them would cost.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-hook-dispatch.ts` applies it. The class keeps all three methods —
 * the published `.d.ts` lists each one's name and position, and `execute` is
 * public — and each body is one literal of exactly the
 * {@link ExecuteTransactionsHost} members that method reads, plus a `.call`.
 * The fields the bodies read (`drivers`, `defaultDriver`, `txStore`,
 * `transactionUnsupportedReported`, `logger`) go as GETTERS, so each read
 * happens when the body makes it: `registerDriver` changes the driver map and
 * the default, and a body sees whatever is installed at the moment it reads,
 * as it did. The methods they call (`getDriver`, `datasourceNameOf`,
 * `isSystemLedgerObject`) go as late-bound closures over the instance, so a
 * double or spy set on the engine is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import type { IDataDriver } from '@objectstack/core';
import { redactPropagatedDriverFault } from '@objectstack/types';
import { CrossDatasourceTransactionWriteError } from './transaction-errors.js';
import { pickDeclaredDriverOptions } from './engine-driver-options.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface ExecuteTransactionsHost {
  readonly drivers: ObjectQL['drivers'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly txStore: ObjectQL['txStore'];
  readonly transactionUnsupportedReported: ObjectQL['transactionUnsupportedReported'];
  readonly logger: ObjectQL['logger'];
  getDriver: ObjectQL['getDriver'];
  datasourceNameOf: ObjectQL['datasourceNameOf'];
  isSystemLedgerObject: ObjectQL['isSystemLedgerObject'];
}

/** The body of `ObjectQL#execute`; the method's docblock there is its contract. */
export async function execute(
  this: Pick<ExecuteTransactionsHost, 'getDriver' | 'drivers' | 'defaultDriver'>,
  command: any,
  options?: Record<string, any>,
): Promise<any> {
    // Driver selection priority:
    //   1. options.object  → route via getDriver(objectName)
    //   2. options.datasource → explicit driver name
    //   3. default driver (set via datasourceMapping or defaultDriver)
    // This lets system services (e.g. PackageService, AuditService) issue raw
    // SQL against the control-plane / default DB without having to know the
    // object name behind every CREATE TABLE / SELECT statement.
    let driver: IDataDriver | undefined;
    if (options?.object) {
        driver = this.getDriver(options.object);
    } else if (options?.datasource && this.drivers.has(options.datasource)) {
        driver = this.drivers.get(options.datasource);
    } else if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
        driver = this.drivers.get(this.defaultDriver);
    } else if (this.drivers.size === 1) {
        // Single registered driver — unambiguously the right one.
        driver = this.drivers.values().next().value;
    }

    if (!driver) {
        throw new Error(
            'Execute requires options.object to select a driver, or a default driver to be configured. ' +
            'Configure datasourceMapping with `default: true` or pass `{ object }` / `{ datasource }` in options.',
        );
    }
    if (!driver.execute) {
        throw new Error('Selected driver does not implement execute()');
    }

    // Support both call shapes:
    //   execute('SELECT ...', { args: [...] })
    //   execute({ sql: 'SELECT ...', args: [...] })
    let rawCommand: any = command;
    let params: any[] | undefined = options?.args ?? options?.params;
    if (command && typeof command === 'object' && !Array.isArray(command) && 'sql' in command) {
        rawCommand = command.sql;
        if (params === undefined) {
            params = command.args ?? command.params;
        }
    }

    // [#21274] A boundary outside the middleware seam: the raw command's
    // bound `params` are the caller's values, and the driver's refusal
    // carries the dialect error on its `cause`.
    //
    // [#21345] And the one door whose statement the engine did not compose:
    // it may open with a word the shared leak predicate does not list (a
    // common-table-expression form, a dialect's upsert or merge verb), so
    // the cut must not wait for the predicate to recognise it. The door
    // knows it sent a statement, and says so.
    //
    // The driver is handed the declared driver options of the bag and nothing
    // else: `object` / `datasource` chose the driver and `args` / `params` are
    // the statement's, already taken above.
    try {
        return await driver.execute(rawCommand, params, pickDeclaredDriverOptions(options));
    } catch (e) {
        throw redactPropagatedDriverFault(e, { statementSent: true });
    }
}

/**
 * A caller asked for a transaction and the driver cannot give it one (#4619).
 *
 * The behaviour is unchanged and DECLARED (ADR-0119 D1: "when that driver has
 * no `beginTransaction` the callback runs with NO transaction and NO
 * rollback"). What was missing is that a caller had no way to find out —
 *
 * [#18063] TWO reasons now reach this degrade and the message says which.
 * The second is a transport that DECLARED it cannot honour a handle while
 * inheriting `beginTransaction` from a base class that can. Before the
 * declaration existed such a driver was indistinguishable from a working one
 * here, so the engine opened a transaction against it and the degrade — the
 * honest answer — was unreachable.
 *
 * the same shape as `batchData`'s `atomic` flag being a lie for as long as it
 * was (ADR-0119 D4). Tightening this into a throw would change the declared
 * contract and is deliberately NOT done here.
 *
 * `warn`, not `error`, on purpose. AGENTS.md's judgment question asks whether
 * the system looks normal *while something it claims is persisted has not
 * landed*; at this moment nothing has been lost — a capability simply is not
 * there, and every write in the callback still lands. This is the
 * `if (!capability)` composition branch the same section names as the
 * usual `warn`; escalating it would train readers to skim `error`, which is
 * exactly what made the #4420 `warn` unreadable.
 *
 * Once per engine instance per driver: the drivers that reach this path (test
 * doubles, foreign engines) reach it on EVERY call.
 */
export function warnTransactionUnsupported(
  this: Pick<ExecuteTransactionsHost, 'transactionUnsupportedReported' | 'logger'>,
  datasource: string | undefined,
  declaredUnsupported = false,
): void {
  const name = datasource ?? '<no default datasource>';
  if (this.transactionUnsupportedReported.has(name)) return;
  this.transactionUnsupportedReported.add(name);
  // [#18063] The two reasons reach the same degrade and must not read the
  // same. Telling an operator a Turso REMOTE datasource "has no
  // beginTransaction" sends them looking for a missing method on a class that
  // publishes one; the fix for that reason is a different transport, not a
  // different driver.
  const cause = declaredUnsupported
    ? `driver '${name}' declares supports.transactionsUnsupported — its transport cannot carry a ` +
      'transaction handle even though it inherits beginTransaction'
    : `driver '${name}' has no beginTransaction`;
  const remedy = declaredUnsupported
    ? 'Point this datasource at a transport that honours transactions (for libSQL: the local or ' +
      'embedded-replica mode rather than the remote one), or have the caller fail '
    : 'Register a driver that implements beginTransaction for this datasource, or have the caller fail ';
  this.logger.warn(
    `transaction() requested a transaction but ${cause} — ` +
      'running WITHOUT transaction or rollback. Every write the callback makes commits as it executes, ' +
      'so a later throw leaves the earlier ones PERSISTED even though the call rejects as if the whole ' +
      'unit of work had been undone; no caller is told, and the records stay behind. ' +
      remedy +
      "closed itself when it cannot tolerate losing atomicity (batchData's atomic gate, ADR-0119 D4, is " +
      'the pattern). Reported once per driver per engine instance.',
    { datasource: name, declaredUnsupported },
  );
}

/**
 * A write inside an open `transaction()` resolved to a driver that
 * transaction does not cover — decide what happens to it (#5351, #5696).
 *
 * Called at the TOP of `insert`/`update`/`delete`, before hooks, validation
 * or defaults run: a refusal here has cost the caller nothing.
 *
 * This seam replaced `reportWriteOutsideTransaction` (#4619 / PR #5724),
 * which reported the split at `error` and let the write proceed with the
 * owner's handle. Reporting was the right first move — it made the defect
 * audible without pre-empting a decision that changes ADR-0119 D1's declared
 * contract for every multi-datasource deployment. The 2026-08-06 maintainer
 * ruling made that decision, and it is TWO answers, not one, because the two
 * kinds of write fail in opposite directions:
 *
 * - **Business writes are REFUSED** ({@link CrossDatasourceTransactionWriteError},
 *   #5696 point 2). The caller opened a transaction and asked for one unit of
 *   work; there is no way to give them one across two drivers (no two-phase
 *   commit on `IDataDriver`, deliberately out of scope). Silently committing
 *   part of it — which is what the pre-v17 engine did, on the wrong
 *   connection at that — is the outcome a caller can neither detect nor undo.
 *   Refusing hands them the choice: one datasource per transaction, or
 *   per-datasource units they reconcile themselves.
 * - **Append-only system ledgers are CARVED OUT** (#5351): audit / telemetry
 *   / event rows execute OUTSIDE the transaction, on their own connection,
 *   with no foreign handle. They therefore survive a rollback of the business
 *   transaction — an "orphan row" describing a write that was undone. For an
 *   append-only compliance ledger that is the correct direction of error:
 *   a spurious row is reconcilable, a MISSING row for a write that did
 *   commit is an unrecoverable compliance hole, and the missing row is what
 *   shipped before this change. It is also what lets a plugin author write an
 *   ordinary `afterInsert` audit hook with no knowledge that datasource
 *   routing exists — refusing here would be swallowed by that hook's
 *   try/catch and lose the row exactly as before.
 *
 * No `error` log survives on either path. The refusal IS the report, louder
 * than any line; and the carve-out is now DECLARED behaviour that fires on
 * every audited write of every transaction in a lifecycle-split deployment —
 * logging it at `error`, or even `warn`, would train readers to skim the
 * levels that carry real durability failures, which AGENTS.md names as the
 * mirror-image mistake. It is recorded at `debug`, once per transaction per
 * datasource, for the operator who is asking why an audit row outlived a
 * rolled-back write; the durable answer lives in ADR-0067/ADR-0119.
 */
export function enforceTransactionOrigin(
  this: Pick<ExecuteTransactionsHost, 'txStore' | 'datasourceNameOf' | 'isSystemLedgerObject' | 'logger'>,
  objectName: string,
  driver: IDataDriver,
  operation: 'insert' | 'update' | 'delete',
): void {
  const scope = this.txStore.getStore()?.scope;
  // No engine-owned transaction in scope (or a handle threaded explicitly by
  // the sandbox trio, which this store never sees) — nothing to be outside
  // of. See `transactionCoversDriverFor` for why that limit is declared.
  if (!scope) return;
  // Identity, not name: this is about riding the same connection.
  if (driver === scope.driver) return;
  const target = this.datasourceNameOf(driver);

  if (!this.isSystemLedgerObject(objectName)) {
    throw new CrossDatasourceTransactionWriteError(objectName, operation, target, scope.datasource);
  }

  if (scope.reportedOutOfScope.has(target)) return;
  scope.reportedOutOfScope.add(target);
  this.logger.debug(
    `${operation} of '${objectName}' inside transaction() is routed to datasource '${target}' while the ` +
      `transaction is open on '${scope.datasource}' — executing it OUTSIDE the transaction, on its own ` +
      'connection (ADR-0057 §3.6 system ledger — the one class carved out of the cross-datasource write ' +
      'refusal). It commits independently and will ' +
      'SURVIVE a rollback of this transaction: an audit/telemetry/event row may describe a write that was ' +
      'undone. That is the decided direction of error for an append-only ledger — an extra reconcilable ' +
      'row beats a missing row for a write that did commit. Said once per transaction per datasource.',
    { object: objectName, operation, datasource: target, transactionDatasource: scope.datasource },
  );
}
