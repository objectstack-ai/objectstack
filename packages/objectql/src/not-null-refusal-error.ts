// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { notNullViolationSite } from '@objectstack/types';
import { envelopeUniqueViolation } from './duplicate-record-error.js';
import { buildFieldError, ValidationError, type ValidationMessageContext } from './validation/record-validator.js';

/**
 * [#24768] The engine's answer when the DATABASE refuses a write as a NOT NULL
 * violation on a field the object declares: its own `ValidationError`, the one
 * the record validator throws for `required`, so every door answers it alike.
 *
 * ## The defect this retires
 *
 * A field declared `storage: { notNull: true }` without `required` is ADR-0113's
 * engine-populated column. D1 / D2 keep the write contract (`required`) and the
 * column constraint apart on purpose, so the record validator judges `required`
 * only and a write with no value for that field reaches the driver, which
 * refuses it. The write doors let the DRIVER's error out, and each door then
 * classified it from the driver's text in its own way. Measured on a real store
 * (`driver-sql` over better-sqlite3), for one refused write:
 *
 *  - the runtime dispatcher's `/data` POST and PATCH let the raw `SqliteError`
 *    out of `dispatch()`; neither exit recognised it, so both answered
 *    `500 INTERNAL_ERROR`;
 *  - the actions door answered `400 VALIDATION_ERROR` with the driver's text as
 *    the message and `SQLITE_CONSTRAINT_NOTNULL` as `declaredCode`;
 *  - `RestServer` answered `400 VALIDATION_FAILED`, naming the column key, and
 *    relabelled it by a second read of the object (#24715), only on its own
 *    `POST` / `PATCH`.
 *
 * ## The answer, and why each half is here
 *
 *  - **A `ValidationError`, `code: 'VALIDATION_FAILED'`** — the class the record
 *    validator throws, recognised by every door already
 *    (`validationFailureDetails`, the classification's validation arm), so no
 *    door learns anything new and none answers it differently.
 *  - **One field error, built by `buildFieldError`** — the validator's own
 *    builder, with the validator's own message context, so the field is named by
 *    its label (translation bundle → declared `label` → API name) in the
 *    caller's locale by construction, and `code: 'required'`, the wire code a
 *    form maps to its input. The message key is the one the validator picks for
 *    the same verb: `required` on insert, `required_cleared` on update (an update
 *    reaches this refusal only by writing a null over the column).
 *  - **`cause`** — the driver's own error, whole, for the door's log line: the
 *    platform logger serializes `message` and `stack` only, so the write doors
 *    log the `cause` (as they do for `DuplicateRecordError`). Where the error
 *    leaves the engine its `cause` is cut like any driver error
 *    (`redactPropagatedDriverFault`).
 *
 * ## ⛔ What is left alone
 *
 *  - A column the object's field map does not hold — the drift where metadata
 *    dropped a field and the column stayed NOT NULL. There is no field to name;
 *    the driver's error goes out as before, and the classification's column
 *    sentence and drift hint answer it.
 *  - A refusal the driver attributes to another table: a nested write to a
 *    second object inside this one. That object's own door translates it, with
 *    that object's field map.
 *  - `required` itself. ⛔ No pre-write check reads `storage.notNull`: ADR-0113
 *    D1 / D2 rule it out, because a column a hook or a default fills is not one
 *    the form should demand. This only renames the database's own refusal.
 */
export class NotNullRefusalError extends ValidationError {
  /**
   * The driver's own error, whole. DECLARED rather than merely assigned: this
   * repo compiles against `lib: ES2020`, where `Error` has no `cause` member.
   */
  readonly cause: unknown;

  constructor(fields: ConstructorParameters<typeof ValidationError>[0], cause: unknown) {
    super(fields);
    this.cause = cause;
  }
}

/** The verb whose driver exit refused the write; it picks the validator's sentence. */
export type NotNullRefusalVerb = 'insert' | 'update';

/**
 * A write door's driver-error exit: the engine's `ValidationError` for a NOT NULL
 * refusal on a field `schema` declares, or the caller's own error unchanged for
 * anything else (see the module header for each case left alone).
 *
 * Idempotent, as `envelopeUniqueViolation` is: an error that is already this
 * envelope is returned as-is.
 */
export function envelopeNotNullViolation(
  error: unknown,
  object: string,
  schema: unknown,
  verb: NotNullRefusalVerb,
  messages: ValidationMessageContext | undefined,
): unknown {
  if (error instanceof NotNullRefusalError) return error;
  const site = notNullViolationSite(error);
  if (!site) return error;
  if (site.table !== undefined && site.table !== object) return error;
  const fields = (schema as { fields?: Record<string, { label?: string } | undefined> } | undefined)?.fields;
  const def = fields && Object.prototype.hasOwnProperty.call(fields, site.column) ? fields[site.column] : undefined;
  if (!def || typeof def !== 'object') return error;
  return new NotNullRefusalError(
    [buildFieldError(
      { field: site.column, code: 'required', def, messageKey: verb === 'update' ? 'required_cleared' : 'required' },
      messages,
    )],
    error,
  );
}

/**
 * The write doors' driver-error exit, both translations in one call: a unique
 * violation becomes `DuplicateRecordError` (#14095), a NOT NULL refusal on a
 * declared field this module's `ValidationError`, and anything else leaves as
 * the driver threw it. The two cannot both answer: the unique predicate refuses
 * NOT NULL text at its gate, and an envelope it built carries no NOT NULL code.
 */
export function envelopeDriverWriteRefusal(
  error: unknown,
  object: string,
  schema: unknown,
  verb: NotNullRefusalVerb,
  messages: ValidationMessageContext | undefined,
): unknown {
  const unique = envelopeUniqueViolation(error, object, schema);
  return unique !== error ? unique : envelopeNotNullViolation(error, object, schema, verb, messages);
}
