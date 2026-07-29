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
