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
