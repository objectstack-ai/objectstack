// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filter refusals this driver raises, in ONE place.
 *
 * Both of this package's filter surfaces refuse the same shapes with the same
 * wire envelope: the live query path (`memory-driver.ts` → mingo) and the
 * reference matcher (`memory-matcher.ts`, the record-at-a-time evaluator the
 * conformance suites hold against `driver-sql` and `@objectstack/formula`). They
 * were two independent code paths with two independent notions of what a filter
 * may be, which is exactly how #5240's divergence survived unnoticed in-package.
 */

import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#4436] A filter this driver cannot evaluate — see the twin in `driver-sql`'s
 * `unsupportedFilterError`, which carries the full rationale.
 *
 * Kept in lockstep with driver-sql deliberately: #3948 made the two backends
 * AGREE that an uncompilable filter is a refusal rather than a silent
 * match-everything, and the refusal's wire envelope has to agree too. A test
 * suite that swaps the memory driver for SQL must see the same `400
 * INVALID_FILTER`, not a coded refusal on one backend and a bare `{error}` on
 * the other.
 */
export function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#5158] A `FilterArray` reached the driver unlowered.
 *
 * `where` is a `FilterCondition` — `QueryASTSchema.where: FilterConditionSchema`
 * — and `FilterArray` is INPUT-ONLY authoring sugar the spec declares separately
 * (`spec/data/filter.zod.ts`, #5285). Both doors into the runtime lower it
 * through `parseFilterAST` before any driver is reached: the protocol face
 * (`metadata-protocol`) and the engine (`ObjectQL`, maintainer ruling C).
 *
 * The twin of `driver-sql`'s `filterArrayReachedDriverError`, and deliberately
 * word-for-word: #3948 made the two backends AGREE that an uncompilable filter
 * is a loud refusal rather than a silent match-everything, and the four drivers
 * each carrying their own array compiler is how they drifted apart in the first
 * place. cloud's `RemoteTransport.buildWhereSQL` already refuses this input
 * (cloud#1075); deleting the dialect here converges the product on one answer.
 */
export function filterArrayReachedDriverError(filters: unknown[]): Error {
  return unsupportedFilterError(
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
      `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
      `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
      `and protocol doors before any driver sees it (#5158). This driver no longer carries a ` +
      `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
      `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
      `all: write the prefix form ["or", condA, condB].`,
  );
}

/**
 * [#5240] Is this field spec `{}` — a field constrained by ZERO operators?
 *
 * A plain object with no own enumerable keys, and nothing else: a `Date`, a
 * `RegExp` or a class instance also enumerates to nothing but is a COMPARAND,
 * not a constraint, and is left to the paths that already handle it.
 */
export function isEmptyFieldConstraint(spec: unknown): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(spec as Record<string, unknown>).length === 0;
}

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators.
 *
 * One declared shape, three answers across the repo: `driver-sql` refused it at
 * the top level but DROPPED it inside `$and`/`$or`/`$not` (a predicate that
 * emits nothing matches every row), while this driver and `@objectstack/formula`
 * answered "matches nothing" — this one only incidentally, by falling through to
 * a structural-equality comparison against the empty object.
 *
 * Ruled on #5240: refused everywhere, in the ADR-0112 envelope every sibling
 * filter refusal speaks. The shape is almost always an authoring accident (a
 * filter builder that recorded a field and never its operator, or generated
 * metadata that lost one), and both silent readings answer it with a row count
 * the author never asked for. This driver's incidental FALSE is the clearest
 * case of that: `{ status: {} }` did not mean "no rows", it meant "rows whose
 * `status` is literally the empty object" — a different filter that HAPPENS to
 * match nothing in ordinary data.
 */
export function emptyFieldConstraintError(field: string, path: string): Error {
  return unsupportedFilterError(
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than evaluated because the ` +
      `backends disagreed on what it means — driver-sql dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and this driver / @objectstack/formula ` +
      `answered "matches nothing". #5240.`,
  );
}
