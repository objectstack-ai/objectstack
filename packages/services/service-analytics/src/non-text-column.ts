// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14079] A text operator aimed at a column whose STORED value is never text
 * — the declared-type half of the text-operator contract, shared by this
 * package's three SQL compilers (`read-scope-sql.ts`,
 * `NativeSQLStrategy.buildFilterClause`, the `ObjectQLStrategy` echo of it).
 *
 * ## The contract row this serves
 *
 * `FILTER_TEXT_CASES` (`@objectstack/spec`) declares, since the maintainer's
 * 2026-09-05 ruling on #14079: a stored value that is not a string never
 * satisfies a positive text operator and always satisfies `$notContains` —
 * complementarity holds, on every face. The JS faces read that off the value.
 * A SQL compiler cannot see the value at compile time and reads the DECLARED
 * type instead: `NON_TEXT_STORED_VALUE_TYPES` is the spec's list of the field
 * types whose stored value is never text (the numeric and boolean value
 * classes), and a column in one of them compiles the positive operators to the
 * FALSE constant and `$notContains` to the TRUE constant.
 *
 * ## What compiled before
 *
 * `col LIKE ? ESCAPE ?`, on every column. Over a numeric column that is a
 * dialect accident rather than an answer: SQLite coerces the number to text in
 * its storage class's spelling (REAL renders `5` as `'5.0'`), MySQL casts, and
 * Postgres refuses at query time (SQLSTATE 42883 `operator does not exist:
 * real ~~ text`) — on a READ SCOPE that is a 500 for a policy the platform
 * accepted. `driver-sql` and `driver-turso`'s remote transport emit the same
 * two constants from their own declared-type registries; here the declaration
 * arrives through `DatasetScopedStrategyContext.declaredFieldType`, and a host
 * that wired none keeps the `LIKE` — "cannot answer, do not block".
 *
 * ## Why the constants compose with the NULL rules rather than fight them
 *
 * A row with no value already satisfies `$notContains` (#5298) and fails every
 * positive operator, so `1 = 1` / `1 = 0` agree with the null polarity on every
 * row. Under `$not`, the leaf is totalised first (`nullSafeNegationOperand`):
 * `NOT (col IS NOT NULL AND 1 = 0)` is TRUE for every row — what the JS faces
 * answer for `!contains` on a number — and `NOT (col IS NULL OR 1 = 1)` is
 * FALSE for every row, what they answer for `!notContains`.
 */

import { NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';
import type { DatasetScopedStrategyContext } from './strategies/types.js';

/**
 * Which way a text operator answers over a non-text column: `'positive'`
 * (never matches) or `'negative'` (always matches). Both spellings — the
 * `$`-prefixed Filter Protocol operator a read scope carries, and the lowered
 * analytics name `filter-normalizer.ts` gives the strategies. `null` for every
 * operator that does not read the column as text.
 */
export function textOperatorPolarity(op: string): 'positive' | 'negative' | null {
  switch (op) {
    case '$contains':
    case '$startsWith':
    case '$endsWith':
    case '$icontains':
    case '$like':
    case '$ilike':
    case 'contains':
    case 'startsWith':
    case 'endsWith':
    case 'icontains':
      return 'positive';
    case '$notContains':
    case 'notContains':
      return 'negative';
    default:
      return null;
  }
}

/** Is `type` a declared field type whose stored value is never text? `undefined` — unknown — is NOT. */
export function isNonTextDeclaredType(type: string | undefined | null): boolean {
  return typeof type === 'string' && NON_TEXT_STORED_VALUE_TYPES.has(type);
}

/**
 * The per-object predicate "is this field a non-text column?", read off the
 * context's `declaredFieldType` hook — or `undefined` when the host wired no
 * hook, in which case every compiler keeps the `LIKE` it always emitted.
 */
export function nonTextColumnResolver(
  ctx: StrategyContext,
  objectName: string,
): ((field: string) => boolean) | undefined {
  const declared = (ctx as DatasetScopedStrategyContext).declaredFieldType;
  if (typeof declared !== 'function') return undefined;
  return (field: string) => isNonTextDeclaredType(declared.call(ctx, objectName, field));
}
