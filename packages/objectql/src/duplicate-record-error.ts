// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';

/**
 * The ADR-0112 envelope `engine.insert` raises when a driver refuses a row as a
 * unique-constraint violation (#14095).
 *
 * ## The defect this retires
 *
 * The platform RECOMMENDS "declare a unique index, attempt the insert, swallow
 * the violation" — `createWithAutonumberResync`'s own doc argues at length
 * against the read-then-write alternative ("a probe costs a query on every
 * insert … and is still racy"). An application could not complete that pattern,
 * because the insert door rethrew the DRIVER's error verbatim and left the app
 * three bad options:
 *
 *  1. test `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` — couples the app to one
 *     dialect, and it silently stops being idempotent the day it is deployed on
 *     Postgres (`23505`), MySQL (`ER_DUP_ENTRY`) or Mongo (`E11000`);
 *  2. pattern-match the message — which on the measured SQLite path is the
 *     whole compiled INSERT statement;
 *  3. use the platform's own `isUniqueViolationError`, which is correct and
 *     dialect-independent and lives in `@objectstack/types` — a package an
 *     application cannot reach (`ERR_MODULE_NOT_FOUND`).
 *
 * Triage ruled (2026-09-01) for wrapping in ObjectQL rather than re-exporting
 * the predicate: 「抛一个带既有词表码(`DUPLICATE_RECORD` 已在 ADR-0112 台账里)
 * 的平台错误,原驱动错误作 `cause` ⇒ `insert` 在每个驱动上有同一份契约」.
 *
 * ## The shape, and why each half is here
 *
 *  - **`code: 'DUPLICATE_RECORD'`** — already a member of `StandardErrorCode`
 *    (the 409 conflict group), so nothing in `packages/spec` had to grow a
 *    member for this. It is what an application branches on, on every driver.
 *  - **`status: 409`** — the conflict status the engine's sibling refusals
 *    already declare (`DELETE_RESTRICTED`, `CONCURRENT_UPDATE`), so REST's
 *    declared-status passthrough answers 409 instead of the sanitised 500 an
 *    undeclared status would have earned.
 *  - **`cause`** — the driver's own error, WHOLE and unmodified. Nothing is
 *    copied out of it into the message: `isUniqueViolationError` and
 *    `uniqueViolationColumn` both walk a `cause` chain, so every existing
 *    consumer of the raw error keeps its answer by asking the envelope.
 *  - **`field`** — the conflicting column, and ONLY when
 *    {@link uniqueViolationColumn} determinably named one. An index name is
 *    never reported as a column (MySQL's `for key 'idx_email_unique'`,
 *    Postgres' constraint name, a composite key): that function's contract is
 *    that a wrong field name is worse than none, and this envelope does not
 *    widen it.
 *  - **`developerMessage`** — the remedy half, split off exactly as the
 *    engine's `DELETE_RESTRICTED` refusal splits it: `message` is the sentence
 *    a user-facing surface renders, `developerMessage` is the one addressed to
 *    the application author.
 *
 * ## ⛔ What this deliberately does NOT do
 *
 * It does not copy the driver's prose into `message`. The measured SQLite
 * message IS the compiled statement with its bound values, and REST's declared
 * 4xx arm ships `message` to the client verbatim — so quoting the driver here
 * would move #8682's leak from the log onto the wire. The driver's own
 * diagnosis stays reachable, in one place, on `cause`.
 */
export const DUPLICATE_RECORD_CODE = 'DUPLICATE_RECORD' as const;

/** The conflict status the engine's sibling 409 refusals declare. */
const DUPLICATE_RECORD_STATUS = 409 as const;

export class DuplicateRecordError extends Error {
  readonly code = DUPLICATE_RECORD_CODE;
  readonly status = DUPLICATE_RECORD_STATUS;
  /** The remedy half — see the module header on why it is not in `message`. */
  readonly developerMessage: string;

  constructor(
    /** The object the refused insert targeted. */
    public readonly object: string,
    /** The driver's own error, whole. */
    cause: unknown,
    /** The conflicting column, when the dialect determinably named one. */
    public readonly field?: string,
  ) {
    super(buildDuplicateMessage(object, field));
    this.name = 'DuplicateRecordError';
    // Assigned rather than passed as `new Error(msg, { cause })`: this repo
    // compiles against `lib: ES2020`, where `ErrorOptions` does not exist —
    // the same reason `ERR_AUTONUMBER_COLLISION` one file over assigns it.
    (this as { cause?: unknown }).cause = cause;
    this.developerMessage =
      `The driver refused this insert as a unique-constraint violation. Its own error is attached ` +
      `as \`cause\` — branch on \`code === '${DUPLICATE_RECORD_CODE}'\` (ADR-0112) rather than on a ` +
      `dialect's code or message, so the handling survives a change of store. To make the write ` +
      `idempotent, catch this code and treat the row as already present.`;
  }
}

/**
 * The user-facing sentence.
 *
 * ⛔ It must not begin with a SQL verb. `@objectstack/rest`'s importer runs
 * every row error through `sanitizeRowError`, whose SQL backstop replaces any
 * message STARTING with `insert`/`update`/`delete`/… with generic text — so a
 * message opening "Insert on 'x' …" would be thrown away by a guard written
 * against leaked driver statements. Measured, not guessed.
 */
function buildDuplicateMessage(object: string, field?: string): string {
  return (
    `Duplicate record refused on '${object}': ` +
    (field
      ? `a unique constraint on '${field}' already holds this value. `
      : 'a unique constraint already holds these values. ') +
    'No record was written.'
  );
}

/**
 * The insert door's driver-error exit: the platform envelope for a unique
 * violation, or the caller's own error unchanged for anything else.
 *
 * **Unrecognised is passed through untouched**, which is the whole of the
 * negative contract: a NOT NULL violation, a deadlock, a missing table and an
 * unreachable store all leave the door exactly as they did before. The verdict
 * is {@link isUniqueViolationError} — never a dialect sniff and never a message
 * match written here.
 *
 * Idempotent: an error that is already this envelope is returned as-is, so a
 * seam that wraps a value another seam already wrapped cannot bury the driver's
 * error one `cause` step deeper.
 */
export function envelopeUniqueViolation(error: unknown, object: string): unknown {
  if (error instanceof DuplicateRecordError) return error;
  if (!isUniqueViolationError(error)) return error;
  return new DuplicateRecordError(object, error, uniqueViolationColumn(error));
}
