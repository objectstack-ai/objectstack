// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LIKE pattern construction for this package's three SQL compilers (#5567).
 *
 * A `$contains` / `$notContains` / `$startsWith` / `$endsWith` comparand is a
 * LITERAL the author typed. Concatenating it straight into a wildcard position
 * silently reinterprets it as a pattern, because `_` is LIKE's single-character
 * wildcard and `%` its multi-character one:
 *
 *   - `{name: {$contains: '_admin'}}` matched `xyadmin` as well as `x_admin`;
 *   - `{name: {$contains: '50%'}}` matched `off 5012 now` as well as `off 50% now`.
 *
 * Both directions are WIDENING, and one of the three call sites is
 * `read-scope-sql.ts` — the ADR-0021 D-C read-scope (tenant + RLS) lowering,
 * where a wider predicate is over-reach rather than a loose filter (#5347 /
 * #5324, on that same file). Prime Directive #3 forces machine names to
 * `snake_case`, so essentially every machine-name comparand carries a `_` and
 * hits this silently.
 *
 * ## The two halves are one fix
 *
 * Escaping the value and declaring the escape character are not independent
 * steps — either alone is a different bug:
 *
 *   - Escaping alone: `%\_admin%` with no escape character in force is a search
 *     for a literal backslash. SQLite has NO default escape character, so this
 *     would return zero rows there.
 *   - The clause alone: nothing in the pattern is escaped, so nothing changes.
 *
 * Hence {@link likePattern} always produces a pattern escaped for
 * {@link LIKE_ESCAPE_CHAR}, and every emitter pairs it with an `ESCAPE` binding.
 *
 * ## Why the escape character is BOUND, never written as a literal
 *
 * Every emitter here binds it as an ordinary placeholder (`LIKE ? ESCAPE ?`)
 * rather than writing `ESCAPE '\'` into the SQL text. Two reasons, both load-bearing:
 *
 *   1. **The literal spelling is not portable.** MySQL applies C escape syntax
 *      inside string literals — "If you want a LIKE string to contain a literal
 *      `\`, you must double it" — so the backslash escape character is spelled
 *      `'\\'` there and `'\'` on SQLite/Postgres. These compilers do not know
 *      which dialect will run their output. A bound value is escaped by the
 *      driver for its own dialect, so there is exactly one spelling here.
 *   2. **It rides the existing placeholder plumbing.** `read-scope-sql.ts` emits
 *      `?` and BOTH of its consumers (`NativeSQLStrategy.applyReadScope`,
 *      `ObjectQLStrategy.generateSql`) renumber `?` → `$N` while pushing the
 *      matching value. Because the escape character is a bound value it is
 *      carried by that rewrite with no change at the upper layer — which answers
 *      the "which layer does the ESCAPE clause belong to" question in the issue:
 *      the predicate layer, entirely, because nothing above it has to know.
 *
 * Dialect support for the clause itself, confirmed against the vendors' own
 * reference manuals (quoted in PR for #5567): Postgres defaults to backslash and
 * accepts `ESCAPE`; MySQL assumes `\` unless `NO_BACKSLASH_ESCAPES` is set and
 * accepts `ESCAPE` with an argument that "must evaluate as a constant at
 * execution time" (a bound placeholder is); SQLite honours NO default escape
 * character at all, which is the reason the explicit clause is required rather
 * than merely tidy.
 *
 * ## Relationship to `driver-sql`'s `applyLike`
 *
 * This is deliberately the same transform `SqlDriver.applyLike`
 * (`packages/drivers/driver-sql/src/sql-driver.ts`) applies — same escaped
 * character class, same three wildcard shapes, same bound `ESCAPE` — and its
 * TSDoc points back here. It is a SECOND implementation on purpose, not an
 * oversight:
 *
 *   - `service-analytics` depends on no driver (see its `package.json`: only
 *     `@objectstack/core` and `@objectstack/spec`), and `applyLike` is a private
 *     method on a knex builder — it takes a builder and a field, not a string,
 *     so there is nothing importable even if the dependency existed.
 *   - Promoting it to a shared package would add a new public surface to
 *     `@objectstack/core` for three call sites inside one package. Not worth a
 *     new export until a fourth consumer outside this package needs it.
 *
 * What keeps the two from drifting is not these comments: it is
 * `__tests__/like-metacharacter-escape.test.ts`, which asserts
 * {@link escapeLikePattern} against `applyLike`'s expression character for
 * character. A third hand-copy of this logic anywhere is the thing to refuse —
 * import from here, or add a consumer to that test.
 *
 * ## [#6518 / #15684] Case sensitivity: this file builds the PATTERN, not the keyword
 *
 * #4706 Q2 = A rules the `$contains` family case-SENSITIVE on every backend,
 * and #6518 moved the driver family onto that answer — `SqlDriver`'s
 * `textMatchPredicate` picks the construct per DIALECT, because `LIKE` folds
 * ASCII on SQLite and follows the collation on MySQL.
 *
 * This file did not move with it, and the argument for staying was written
 * here: that these compilers emit Postgres-shaped SQL, so `LIKE` was already
 * exactly the ruled semantics and changing the construct would create a
 * divergence rather than close one. **That argument was wrong, and #15684
 * measured how.** The placeholders are Postgres-shaped; the STATEMENT is not
 * addressed to Postgres. `plugin.ts`'s raw-SQL auto-bridge rewrites `$N` into
 * `?` and hands the statement to whichever driver owns the object — so on a
 * SQLite datasource these compilers' output runs on SQLite. Measured on sql.js
 * over the shared `FILTER_TEXT_ROWS` fixture: `{name: {$contains: 'acme'}}`
 * answered `['1','2']` — `ACME Corp` AND `acme corp` — where
 * `FILTER_TEXT_CASES` says `['2']`. On `read-scope-sql.ts`'s output that is
 * ADR-0021 read-scope over-reach, not a loose filter (#3948).
 *
 * The two things that had to arrive together arrived together: a dialect input
 * reaching these three compilers (`DatasetScopedStrategyContext.sqlDialect`,
 * answered by the driver that will execute the statement) and the per-dialect
 * construct table (`text-match-sql.ts`, #6518's arm for arm). So the division
 * of labour here is now explicit:
 *
 *   - {@link likePattern} / {@link escapeLikePattern} build the LIKE PATTERN
 *     of the `unknown` residue, for BOTH text families. [#31394] The modelled
 *     dialects' arms — their keywords, their patterns (GLOB's escaped class and
 *     SQL Server's wider one among them) and their folds — come from
 *     `@objectstack/core`'s `dialectTextMatchSql`, the table `driver-sql` emits
 *     through too. ⛔ Do not re-derive any of it here.
 *
 * [#15780] `$icontains` (#6520) goes through that same table, and its fold is a
 * per-dialect construct too. What the two families share is the TABLE and the
 * escaping; what separates them is one `fold` flag set on the `$icontains` row
 * alone. ⛔ The two must never be collapsed into one case-insensitive path —
 * that would give the `$contains` family back the fold #4706 Q2 = A took away
 * from it, which is the failure `text-operator-case-exactness.test.ts` guards.
 *
 * ## `String(value)` is safe here because nothing unrenderable reaches it (#5234)
 *
 * The `String()` below used to be the whole defect on the other side: `String({})`
 * is the literal `'[object Object]'`, so an object comparand built a parameterised
 * `LIKE '%[object Object]%'` — valid SQL, a pattern nobody wrote, and one that
 * MATCHED a row whose text really was `[object Object]`. This function is NOT the
 * place that was fixed. Both of this package's doors refuse an object comparand
 * before a pattern is built — `filter-normalizer.ts`'s `fieldLeaves` for the
 * analytics `where` path and `read-scope-sql.ts`'s `compileOperator` for the RLS
 * lowering — using the one rule in `comparand-shape.ts`, and `driver-sql`'s
 * `assertCompilableComparand` does the same for `applyLike`.
 *
 * So `escapeLikePattern` keeps its `unknown` parameter and its unconditional
 * `String()` on purpose: what arrives is a string, number, bigint, boolean,
 * `null`, `undefined` or `Date`, each of which `String()` renders faithfully, and
 * a number comparand (`{$contains: 5}` → `%5%`) is deliberately still accepted —
 * it agrees across every face and #5526 kept it. Do NOT add a tolerant reading of
 * an object here; add it to neither door either.
 */

/**
 * Where the wildcard sits relative to the comparand. Named exactly as
 * `driver-sql`'s `applyLike` names its `shape` parameter, so the two read alike:
 * `contains` → `%v%`, `starts` → `v%`, `ends` → `%v`.
 */
export type LikeShape = 'contains' | 'starts' | 'ends';

/**
 * The escape character every emitter in this package binds into its `ESCAPE`
 * clause. A single backslash — the value `driver-sql` binds, and the default
 * Postgres and MySQL already assume.
 */
export const LIKE_ESCAPE_CHAR = '\\';

/**
 * Escape the LIKE metacharacters (`%`, `_`) and the escape character itself
 * (`\`) so a comparand matches literally.
 *
 * Character for character the expression `driver-sql`'s `applyLike` uses; the
 * shared test holds them to each other.
 */
export function escapeLikePattern(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

/**
 * Build the LIKE pattern for one comparand: escaped, then wrapped in the
 * wildcards `shape` calls for.
 *
 * The result MUST be bound together with {@link LIKE_ESCAPE_CHAR} as the
 * predicate's `ESCAPE` argument — see the escaping-alone note in this file's
 * header for what happens on SQLite otherwise.
 */
export function likePattern(shape: LikeShape, value: unknown): string {
  const escaped = escapeLikePattern(value);
  return shape === 'starts' ? `${escaped}%` : shape === 'ends' ? `%${escaped}` : `%${escaped}%`;
}
