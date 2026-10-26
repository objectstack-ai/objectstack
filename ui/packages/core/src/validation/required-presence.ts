/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE client-side answer to "is this field's value absent?" for a
 * `required` check.
 *
 * `required` is a PRESENCE contract, not a truthiness one. `@objectstack/spec`
 * FieldSchema.required (ADR-0113) reads "an insert must provide a NON-NULL
 * value", and objectql's record validator implements exactly that — its
 * `isMissing` is `undefined | null | blank string`, nothing more. This mirrors
 * that verdict so the form, the wizard's cross-step gate, and the server all
 * agree instead of each inventing a dialect.
 *
 * What this deliberately does NOT treat as absent:
 * - `false` — a boolean's second value. react-hook-form's own `required` rule
 *   fails on `isBoolean(v) && !v`, which quietly turns a required checkbox into
 *   "must be TRUE": an AI-built task tracker could not create an UNFINISHED
 *   task, because the state the switch shows by default was the one value it
 *   refused to save (cloud#972).
 * - `0` — a number's identity element. "Zero hours logged" is data.
 *
 * An empty ARRAY *is* absent: the server has no array-valued scalar to
 * disagree about, and "nothing picked" is a multiselect's own empty state,
 * exactly as a blank string is a text input's.
 */
export function isMissingForRequired(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
