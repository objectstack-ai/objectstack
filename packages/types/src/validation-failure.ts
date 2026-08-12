// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Recognising a record-validation failure at an HTTP boundary.
 *
 * `ValidationError` (`@objectstack/objectql`'s record/rule validators) carries
 * `.code = 'VALIDATION_FAILED'` and `.fields[]` — one entry per offending
 * field — but deliberately carries NO `.status` / `.statusCode` and no
 * `.issues`. It is a plain domain error; deciding it means "400" is the job of
 * whichever boundary serves it.
 *
 * `@objectstack/rest` has always done that (`mapDataError` → 400 with
 * `fields[]`). The runtime dispatcher's two error exits did not (#3918): with
 * no `.status` to read they fell back to **500**, and both read only `.issues`
 * for structured detail — which a `ValidationError` never has — so `fields[]`
 * was dropped and the caller got a generic "internal error" for what was
 * really a user-input mistake. That forecloses per-field error display on every
 * surface the dispatcher serves.
 *
 * Matched by duck-typing on `code` / `name` — exactly the predicate
 * `mapDataError` uses — so this module stays free of a runtime dependency on
 * `objectql`, and so hand-rolled errors of the same shape (e.g. a hook that
 * throws `{ code: 'VALIDATION_FAILED', fields }`) are served identically.
 *
 * ## Why it lives in `@objectstack/types` (#8016)
 *
 * It was `packages/runtime/src/validation-failure.ts` until the *package* door's
 * four status-blind catch-alls were converged onto the dispatcher's mapping
 * ({@link resolveThrownHttpError}, one file over). That resolver has to answer
 * "is this throw a validation failure?" the same way on both doors, and
 * `@objectstack/rest` cannot import `@objectstack/runtime` — runtime depends on
 * rest, so the arrow only points one way. `@objectstack/types` depends on
 * nothing but `@objectstack/spec`, which is why the shared HTTP-boundary
 * helpers (`looksLikeInternalErrorLeak`, `sendOk`/`sendError`) already live
 * here. This module moved for the same reason and is unchanged otherwise;
 * `packages/runtime/src/validation-failure.ts` re-exports it, so every runtime
 * import site still reads the name it always did.
 */

/** The HTTP status a validation failure maps to when the error names none. */
export const VALIDATION_FAILED_STATUS = 400;

export interface ValidationFailureDetails {
  code: 'VALIDATION_FAILED';
  /** Per-field envelopes, passed through verbatim. `[]` when absent/malformed. */
  fields: unknown[];
}

/**
 * Structured `details` for a thrown validation failure, or `undefined` when
 * `err` is not one. Callers use the `undefined` result as the predicate and the
 * returned object as the `details` payload, so the two can never disagree.
 */
export function validationFailureDetails(err: any): ValidationFailureDetails | undefined {
  if (!err) return undefined;
  if (err.code !== 'VALIDATION_FAILED' && err.name !== 'ValidationError') return undefined;
  return {
    code: 'VALIDATION_FAILED',
    fields: Array.isArray(err.fields) ? err.fields : [],
  };
}

/**
 * [#3878/#3899] The CONSTRUCTOR for the shape {@link validationFailureDetails}
 * recognises — kept in the same module so the two can never drift. Thrown from
 * a domain handler, both dispatcher error exits map it to
 * `400 VALIDATION_FAILED` + `details.fields[]` (#3918) with no new error
 * channel and no runtime dependency on objectql's `ValidationError` class.
 * First built inline by the analytics domain; hoisted here when notifications
 * and automation grew the same entry gates rather than a third copy.
 */
export function validationFailure(message: string, fields: unknown[]): Error {
  const err = new Error(message) as Error & { code: string; fields: unknown[] };
  err.name = 'ValidationError';
  err.code = 'VALIDATION_FAILED';
  err.fields = fields;
  return err;
}

/**
 * Zod issues → the dispatcher's `fields[]` envelope entries
 * (`{ field, code, message }`). `'(body)'` names a root-level failure — a body
 * that is the wrong TYPE entirely has no path to point at.
 */
export function fieldsFromZodIssues(
  issues: Array<{ path: Array<string | number | symbol>; code: string; message: string }>,
): Array<{ field: string; code: string; message: string }> {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    code: issue.code,
    message: issue.message,
  }));
}
