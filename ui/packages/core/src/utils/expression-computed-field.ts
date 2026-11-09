/**
 * ObjectUI — the computed-by-expression predicate
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is this object field's value computed from its `expression`, so that no
 * write surface may offer it a value? (objectstack#31759)
 *
 * `@objectstack/spec`'s `FieldSchema.expression` makes a field computed on
 * every type. On a `formula` field it is computed on read. On any other
 * (stored) field the engine computes it from the row the write stores and
 * stores the result, "so a client-sent value never stands". The spec names
 * the class in the same terms: a `lookupAutofill` target must be "not
 * computed (`formula`, `summary`, `autonumber`, or an `expression`)".
 *
 * The edit gates in this repo used to decide "computed" from a list of TYPES
 * (`formula`, `summary`, `auto_number`, …), each list its own, and none read
 * `expression`. So a stored `currency` field carrying one was an editable
 * input on the record form, an editable grid cell, an inline-editable record
 * row and an import write column, and the save replaced what the user typed
 * without a word. Every such gate asks this predicate as well as its type
 * list: a surface treats a field carrying an `expression` exactly as it
 * treats a `formula`.
 *
 * The reading is the spec's own `isComputed`
 * (`packages/spec/src/data/inline-grid-columns.ts`): a non-empty `expression`,
 * either the bare CEL string or the `source` of the `{ dialect, source }`
 * envelope the build emits. An empty string or an envelope with no source
 * declares nothing, so it is not computed.
 *
 * Takes an untyped bag on purpose: every caller holds a raw object-schema
 * field, served JSON, never a parsed `FieldSchema`.
 */
export function isExpressionComputedField(def: unknown): boolean {
  if (def === null || typeof def !== 'object') return false;
  const expression = (def as { expression?: unknown }).expression;
  const source =
    typeof expression === 'string'
      ? expression
      : expression !== null && typeof expression === 'object'
        ? (expression as { source?: unknown }).source
        : undefined;
  return typeof source === 'string' && source.length > 0;
}
