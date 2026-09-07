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
 * [#16159] The ADR-0112 `code` {@link TransactionUnsupportedError} carries, as a
 * constant a consumer can import instead of re-spelling.
 *
 * This module's own header already says these errors "identify themselves by a
 * `code` field rather than by `instanceof`, for the reason `DriverConnectError`
 * already records: the check has to survive crossing a package boundary, where
 * two copies of this module can exist" — and until now offered nothing to
 * import. The only way to FOLLOW that published instruction was to re-author
 * the wire string in the consumer's own package, which acquires a
 * `check:error-code-provenance` stamp site there and is then free to drift from
 * what this engine throws, with no compile error to say so.
 *
 * ⛔ The string is byte-identical to the literal it replaces. This moves where a
 * spelling lives, never what it says; renaming the code is a separate breaking
 * decision and never a rider on this conversion.
 *
 * ⚠️ `ERR_TRANSACTION_UNSUPPORTED` IS registered in `ERROR_CODE_LEDGER` under
 * `@objectstack/objectql`, so this declaration is a `constdef` stamp site
 * `check:error-code-provenance` DOES see (that gate skips unregistered codes),
 * and it is listed under this package's own owner key, which is what makes the
 * gate accept it. Equally, no row moves in
 * `packages/runtime/src/dispatcher-error-vocabulary.ts`: that table records
 * UNREGISTERED code sites, so a registered code is invisible to it by
 * construction. The two gates are exactly inverted — measured on this branch,
 * not assumed.
 *
 * The `_CODE` NAME and the bare `readonly code = TRANSACTION_UNSUPPORTED_CODE;`
 * spelling are load-bearing rather than cosmetic: the first is the shape
 * `check:error-code-provenance`'s `constdef` pattern can see, the second is the
 * shape `check:dispatcher-error-vocabulary` classifies as `classconst` — its
 * pattern requires the constant name to be followed by `;`, `,` or a newline,
 * so an `as const` suffix on the FIELD takes the site out of it. ⛔ Never rename
 * out of either shape to quiet a gate.
 *
 * Dropping the `ERR_` prefix from the CONSTANT's name follows this package's
 * existing precedents (`READONLY_FIELD_REJECTED_CODE`,
 * `HOOK_TARGET_REBIND_ERROR_CODE`). Re-exported from the `index.ts` barrel,
 * beside the class that is already published there.
 *
 * ⚠️ Placement is deliberate and differs from the sibling batch on this card:
 * the constant and its docblock sit ABOVE the class's own docblock, not between
 * that docblock and the class. Measured with `tsc --declaration`: two
 * consecutive JSDoc blocks are both emitted against the declaration that
 * follows them, so interposing this constant would move the class's
 * documentation onto the CONSTANT in the published `.d.ts` and leave the class
 * with none. That is a published-surface documentation regression, and the
 * grouped shape #16259 landed in `registry.ts` already avoids it.
 */
export const TRANSACTION_UNSUPPORTED_CODE = 'ERR_TRANSACTION_UNSUPPORTED' as const;

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
  readonly code = TRANSACTION_UNSUPPORTED_CODE;

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
 * [#16159] The ADR-0112 `code` {@link CrossDatasourceTransactionWriteError}
 * carries, as a constant a consumer can import instead of re-spelling.
 *
 * This row is the one on the card whose refusal a caller is most likely to
 * WANT to match rather than merely log: the class's docblock below says the
 * decided behaviour is to "refuse, by name, before anything runs", and the
 * remedy it prescribes ("split the work into per-datasource units and have the
 * caller reconcile them explicitly") is a recovery a caller implements around
 * this exact refusal. Matching it by `instanceof` is the thing #14936 measured
 * as silently false across the realm split this package declares in its own
 * `exports`; matching it by `code` meant re-spelling the string, until now.
 *
 * ⛔ The string is byte-identical to the literal it replaces — the conversion
 * moves where a spelling lives, never what it says.
 *
 * ⚠️ `ERR_CROSS_DATASOURCE_TRANSACTION_WRITE` is registered in
 * `ERROR_CODE_LEDGER` under `@objectstack/objectql`, so, exactly as for
 * {@link TRANSACTION_UNSUPPORTED_CODE}, this declaration is a `constdef` stamp
 * site `check:error-code-provenance` sees and accepts under this package's own
 * owner key, while `check:dispatcher-error-vocabulary` — which records only
 * UNREGISTERED sites — stays blind to it by construction.
 *
 * ⭐ Unlike the two `driver-connect-errors.ts` rows of this card's sweep,
 * NEITHER class in this file is published from the lean `./core` entry, so the
 * batteries-only placement of these constants introduces no asymmetry at all
 * here: class and constant are reachable from exactly the same entry point.
 * #16260 owns that question for the classes that ARE on `./core`; this file
 * adds nothing to its population.
 *
 * Naming, field spelling and placement follow
 * {@link TRANSACTION_UNSUPPORTED_CODE} exactly.
 */
export const CROSS_DATASOURCE_TRANSACTION_WRITE_CODE = 'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE' as const;

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
  readonly code = CROSS_DATASOURCE_TRANSACTION_WRITE_CODE;

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
