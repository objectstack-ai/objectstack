// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Errors thrown by the engine's transaction seam (#5696 — the tightening half
 * of #4619, revising ADR-0119 D1).
 *
 * Errors here identify themselves by a `code` field rather than by
 * `instanceof`, for the reason `DriverConnectError` already records: the check
 * has to survive crossing a package boundary, where two copies of this module
 * can exist.
 */

/**
 * `transaction(cb, base, { require: true })` was called on a datasource whose
 * driver has no `beginTransaction` (#5696 point 1).
 *
 * Without `require` this path DEGRADES — the callback runs with no transaction
 * and no rollback, warning once (ADR-0119 D1, unchanged). The degrade is right
 * for callers who can live without atomicity and wrong for callers whose only
 * reason to open a transaction is the rollback; `require: true` is how the
 * second kind says so, and this error is what it gets. It is thrown BEFORE the
 * callback runs, so nothing has been written when it surfaces — the fail-closed
 * posture `batchData`'s atomic gate established (ADR-0119 D4).
 */
export class TransactionUnsupportedError extends Error {
  readonly code = 'ERR_TRANSACTION_UNSUPPORTED' as const;

  constructor(public readonly datasource: string) {
    super(
      `transaction({ require: true }) cannot be honoured: driver '${datasource}' has no beginTransaction, ` +
        'so the callback would run with NO transaction and NO rollback — every write committing as it ' +
        'executes, and a later throw leaving the earlier ones persisted. Refused before running anything, ' +
        'so nothing has been written. Register a driver that implements beginTransaction for this ' +
        'datasource, or drop `require` if this caller can genuinely tolerate losing atomicity.',
    );
    this.name = 'TransactionUnsupportedError';
  }
}

/**
 * A BUSINESS write inside an open `transaction()` resolved to a driver that
 * transaction does not cover (#5696 point 2, decided together with #5351 by the
 * 2026-08-06 maintainer ruling).
 *
 * `transaction()` opens on ONE driver and covers only that driver's connection.
 * Until v17 a write routed elsewhere was handed the open transaction's handle
 * anyway, so it executed on the WRONG connection — measured on a real SQL
 * driver as `no such table` against a database that never held the object
 * (#5351). Reporting it (#4619 / PR #5724) made it audible; this error is the
 * decided behaviour: refuse, by name, before anything runs, rather than
 * partially commit in silence.
 *
 * Deliberately NOT what this does: open a companion transaction on the second
 * driver. Cross-driver atomicity needs two-phase commit, which `IDataDriver`
 * does not have, and faking it would swap one durability risk for a worse one
 * (#4619 excludes it explicitly).
 *
 * Append-only SYSTEM ledgers (`lifecycle.class` of `audit` / `telemetry` /
 * `event`) never reach this error — they are carved out and executed outside
 * the transaction on their own connection. See `enforceTransactionOrigin` and
 * `isSystemLedgerObject` in the engine.
 */
export class CrossDatasourceTransactionWriteError extends Error {
  readonly code = 'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE' as const;

  constructor(
    public readonly object: string,
    public readonly operation: 'insert' | 'update' | 'delete',
    public readonly datasource: string,
    public readonly transactionDatasource: string,
  ) {
    super(
      `${operation} of '${object}' inside transaction() resolves to datasource '${datasource}', but the ` +
        `transaction is open on '${transactionDatasource}' and covers only that connection — refused. ` +
        'Executing it anyway would either run the statement on the wrong connection (the pre-v17 defect: ' +
        'the row lands in a database that may not even have the table) or commit it on its own, so a ' +
        'rollback of this transaction would leave it behind while the caller is told only that the whole ' +
        'unit failed. Fix it one of two ways: keep every object written inside one transaction() on one ' +
        `datasource (move the object, or drop the datasourceMapping rule that routes '${object}' to ` +
        `'${datasource}'), or split the work into per-datasource units and have the caller reconcile them ` +
        'explicitly — cross-driver atomicity is not something this engine provides. Nothing was written.',
    );
    this.name = 'CrossDatasourceTransactionWriteError';
  }
}
