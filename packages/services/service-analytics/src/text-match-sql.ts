// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15684 / #15780] The text operators — the case-EXACT family (`$contains` /
 * `$notContains` / `$startsWith` / `$endsWith`) and the case-INSENSITIVE
 * `$icontains` — compiled per DIALECT, for this package's three SQL compilers
 * (`read-scope-sql.ts`, `NativeSQLStrategy.buildFilterClause`, the
 * `ObjectQLStrategy` echo of that statement).
 *
 * ## The defect this closes
 *
 * Every one of the three emitted `col LIKE ? ESCAPE ?` on every dialect, and
 * SQLite's `LIKE` folds ASCII case unconditionally — the fold cannot be turned
 * off per statement (`PRAGMA case_sensitive_like` is a CONNECTION-global
 * switch). Measured on sql.js over the shared `FILTER_TEXT_ROWS` fixture:
 * `{ name: { $contains: 'acme' } }` answered `['1','2']` — `ACME Corp` AND
 * `acme corp` — where `FILTER_TEXT_CASES` (#4706 Q2 = A) says `['2']`.
 *
 * Two of the three compilers make that a correctness bug in a chart. The third
 * is `read-scope-sql.ts`, the ADR-0021 D-C read scope: a scope that ADMITS rows
 * the policy's case-sensitive predicate excludes is over-reach (#3948), not a
 * loose filter — the reading that file already writes down for its own LIKE
 * escaping (#5567) and the reason #6518 moved the DRIVER family off `LIKE`.
 *
 * ## Why the construct has to be chosen per dialect, and cannot be chosen here
 *
 * There is no single construct that is case-exact on all three dialects and
 * parses on all three, so a dialect-blind fix does not exist:
 *
 *   - `GLOB` is case-exact by definition but is SQLite-only — a syntax error on
 *     Postgres and MySQL.
 *   - `CAST(… AS BINARY)` is byte-wise on MySQL, is not a type on Postgres, and
 *     takes NUMERIC affinity on SQLite (it would compare a number).
 *   - `CAST(col AS BLOB) LIKE ?` was measured on the driver side to return
 *     NOTHING at all — SQLite's LIKE is false for a BLOB operand.
 *   - The portable primitives that ARE case-sensitive everywhere (`replace()`)
 *     express "occurs somewhere" but not "occurs at the start / at the end"
 *     without character-length arithmetic that is spelled differently on every
 *     dialect (`LENGTH` is bytes on MySQL, characters elsewhere; `right()` does
 *     not exist on SQLite; a negative `substr` start is not portable to
 *     Postgres). A prefix/suffix arm built on them would be a fourth spelling
 *     of the family with no way to hold it to the other three.
 *
 * So the dialect is an INPUT, exactly as `like-pattern.ts`'s header said the
 * remedy would have to be, and it arrives the way every other thing these
 * compilers cannot see from the filter alone arrives: an optional hook on the
 * context, tiered "cannot answer, do not block" ({@link sqlDialectFor}).
 *
 * ## Why this is a second implementation of `driver-sql`'s `textMatchPredicate`
 *
 * The same reason `escapeLikePattern` is a second implementation of the same
 * driver's `applyLike` escaping, stated in `like-pattern.ts`: `service-analytics`
 * depends on NO driver — importing one would invert the dependency (a service
 * reaching down into a driver), and `textMatchPredicate` is a module-private
 * function that returns knex bindings (`??` the identifier, `?` the value)
 * while these three compilers each carry their own placeholder scheme (`$N`
 * here, `?` in the read scope). There is nothing importable even if the
 * dependency existed.
 *
 * What is shared is therefore the CONSTRUCT TABLE, not the code: arm for arm,
 * escaped character class for escaped character class, this is #6518's table
 * re-emitted through a caller-supplied {@link TextMatchBind}. What keeps the two
 * from drifting is not this comment — it is
 * `__tests__/text-operator-case-exactness.test.ts`, which runs the shared
 * `FILTER_TEXT_CASES` through BOTH this package's compilers and a real
 * `SqliteWasmDriver` (a devDependency, never a runtime one) on the same engine
 * and requires the same row sets. A third hand-copy of this table anywhere is
 * the thing to refuse — import from here, or add a consumer to that test.
 *
 * ## The arms, and why each cell
 *
 * Character for character #6518's, whose header carries the measurements:
 *
 *   - **`sqlite` → `GLOB`.** Case-exact by definition, and it carries its OWN
 *     escape mechanism — a single-character class — because SQLite's grammar
 *     has no `ESCAPE` clause for `GLOB`. So this arm binds ONE value where the
 *     others bind two, which is precisely the kind of divergence a second
 *     emitter drops on the floor; every arm below therefore goes through one
 *     {@link TextMatchBind} and one shared shape wrapper.
 *   - **`postgres` → `LIKE`, unchanged.** `LIKE` is already case-exact there,
 *     so the bytes this package emitted before #15684 are the bytes it emits
 *     now — a Postgres deployment sees no change at all.
 *   - **`mysql` → `LIKE` over `CAST(… AS BINARY)`**, byte-wise and therefore
 *     case-exact whatever the column's collation says. NOT MEASURED here: no
 *     MySQL server is provisionable in this container, exactly as on the driver
 *     side, so this cell is a declared skip rather than a claimed pass.
 *   - **`unknown` → `LIKE`.** The dialect nothing answered for (no hook wired,
 *     a driver that does not name its dialect, a client neither side models —
 *     mssql, oracle) keeps the shape it has always had. It is not an
 *     endorsement: it is the only answer that still RUNS, and it is the residue
 *     this file's own suite names.
 *
 * ## [#15780] `$icontains` is here too — one FLAG on the same table
 *
 * It arrived second, and for a different failure mode. `$icontains` (#6520)
 * folds both sides with `asciiLowerSqlExpr` — `translate(col, 'ABC…', 'abc…')`
 * — which is a PostgreSQL/Oracle function. SQLite has none, so where the
 * case-EXACT four answered the WRONG ROWS on SQLite, this one did not answer at
 * all: measured on sql.js 1.14.1, `SELECT translate('ABC','ABC','abc')` is `no
 * such function: translate`, so the statement failed to PARSE. On
 * `read-scope-sql.ts` that meant an RLS read scope carrying `$icontains` over a
 * SQLite datasource could not be evaluated.
 *
 * The remedy is one FLAG ({@link TextMatchRequest.fold}), not a second table:
 * the dialect question, the escaping and the placeholder plumbing are identical
 * for both families, and only the fold's spelling differs per arm:
 *
 *   - **`sqlite` → `lower()` around the GLOB arm.** ASCII-only there —
 *     measured, `lower('CAFÉ')` is `cafÉ` — which is the #4706 Q1 = A boundary
 *     executed rather than argued.
 *   - **`postgres` / `unknown` → `translate()`, unchanged.** These two arms
 *     were never broken; the bytes emitted before #15780 are the bytes emitted
 *     now. ⚠️ This DIVERGES from `driver-sql`, whose `unknown` arm folds with
 *     `LOWER()`: each face keeps the residue it already had, and neither claims
 *     the other's.
 *   - **`mysql` → the nested-`REPLACE` binary fold**
 *     ({@link mysqlAsciiLowerBinarySql}). NOT MEASURED — no MySQL server is
 *     provisionable in this container, so this cell is a declared skip, exactly
 *     as its case-exact neighbour above.
 *
 * ⛔ What must NOT be done is give the case-EXACT four this flag: that hands
 * them back the fold #4706 Q2 = A took away. One `fold: true`, on the
 * `$icontains` row of each compiler's operator table, and nowhere else —
 * `text-operator-case-exactness.test.ts` and
 * `icontains-dialect-sql.test.ts` pin both halves of that boundary.
 *
 * Escaping (#5567) is unchanged — {@link likePattern} still builds every
 * LIKE-arm pattern, and the GLOB arm's own escaped class is a DIFFERENT one,
 * not a shared regex. The fold composes with it rather than replacing it: on
 * the SQLite arm `lower()` wraps an already-GLOB-escaped pattern, and `[`, `]`,
 * `*` and `?` are not letters, so the escape survives the fold untouched.
 */

import {
  likePattern,
  LIKE_ESCAPE_CHAR,
  asciiLowerSqlExpr,
  ASCII_UPPER_LETTERS,
  ASCII_LOWER_LETTERS,
  type LikeShape,
} from './like-pattern.js';
import type { StrategyContext } from '@objectstack/spec/contracts';
import type { DatasetScopedStrategyContext } from './strategies/types.js';

/**
 * The dialects this package's compilers distinguish — deliberately the same
 * four names `driver-sql`'s `SqlDialectName` carries, including `'unknown'`,
 * so a driver's own answer can be handed straight through with no second
 * mapping table to drift.
 */
export type AnalyticsSqlDialect = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

/** Every dialect this file has an arm for; anything else is `'unknown'`. */
const KNOWN_DIALECTS = new Set<string>(['sqlite', 'postgres', 'mysql']);

/**
 * Read a host's / driver's dialect answer as one of {@link AnalyticsSqlDialect}.
 *
 * Anything unrecognised — including `undefined` from a host that wired no hook
 * — is `'unknown'`, which compiles the pre-#15684 `LIKE`. "Cannot answer, do
 * not block": a name this file does not model must not silently pick an arm.
 */
export function normalizeSqlDialect(name: string | undefined | null): AnalyticsSqlDialect {
  return typeof name === 'string' && KNOWN_DIALECTS.has(name) ? (name as AnalyticsSqlDialect) : 'unknown';
}

/**
 * The dialect of the datasource backing `objectName`, read off the context's
 * `sqlDialect` hook — `'unknown'` when the host wired none.
 *
 * The same tiering, and the same shape, as `nonTextColumnResolver` (#14079):
 * the compilers cannot see this from the filter, the host can answer it from
 * the driver that will execute the statement, and a host that cannot answer
 * keeps the behaviour it had.
 */
export function sqlDialectFor(ctx: StrategyContext, objectName: string): AnalyticsSqlDialect {
  const hook = (ctx as DatasetScopedStrategyContext).sqlDialect;
  if (typeof hook !== 'function') return 'unknown';
  return normalizeSqlDialect(hook.call(ctx, objectName));
}

/**
 * [#6518] Escape the GLOB metacharacters (`*`, `?`, `[`) so a comparand matches
 * literally, using GLOB's ONLY escape mechanism: a single-character class.
 *
 * Character for character `driver-sql`'s `escapeGlobComparand`. `]` needs no
 * escape and deliberately gets none — every `[` this function sees becomes a
 * class that closes itself, so no unclosed class survives for a later `]` to
 * terminate. `%` and `_` are ORDINARY characters to GLOB and are left alone:
 * this is NOT the LIKE escaped class, and writing the two as one shared regex
 * is the mistake to refuse.
 */
export function escapeGlobPattern(value: unknown): string {
  return String(value).replace(/[*?[]/g, '[$&]');
}

/** Wrap an already-escaped comparand in the wildcards `shape` calls for. */
function wrapShape(escaped: string, shape: LikeShape, wildcard: string): string {
  if (shape === 'starts') return `${escaped}${wildcard}`;
  if (shape === 'ends') return `${wildcard}${escaped}`;
  return `${wildcard}${escaped}${wildcard}`;
}

/**
 * Build the GLOB pattern for one comparand: escaped, then wrapped in `*`.
 *
 * The GLOB twin of {@link likePattern}, and separate from it because the
 * escaped character class differs — see {@link escapeGlobPattern}.
 */
export function globPattern(shape: LikeShape, value: unknown): string {
  return wrapShape(escapeGlobPattern(value), shape, '*');
}

/**
 * Push a value onto the caller's parameter list and return the placeholder text
 * that references it.
 *
 * Each of the three compilers has its own scheme — `$N` for
 * `NativeSQLStrategy` and the echo, `?` for the read scope, which its two
 * consumers renumber on the way out — so the numbering stays with the compiler
 * and only the CONSTRUCT lives here. Calls happen left to right in the emitted
 * SQL, which is the order the placeholders appear.
 */
export type TextMatchBind = (value: unknown) => string;

/**
 * [#15780] MySQL's ASCII-ONLY case fold, byte-wise: one nested `REPLACE` per
 * letter over `CAST(… AS BINARY)`.
 *
 * Character for character `driver-sql`'s `mysqlAsciiLowerBinary`, and built
 * from the ONE copy of the domain ({@link ASCII_UPPER_LETTERS}) rather than a
 * second 26-character literal.
 *
 * Why not `LOWER()`, which MySQL does have: `LOWER()` there follows the
 * collation and folds well beyond ASCII, so it would answer the Unicode fold
 * #4706 Q1 = A rules out. Why not `translate()`: MySQL has no such function —
 * the same reason this whole card exists, one dialect over. The `CAST(…
 * AS BINARY)` underneath is what makes the REPLACE chain the WHOLE fold rather
 * than a fold on top of the collation's own.
 */
function mysqlAsciiLowerBinarySql(expr: string): string {
  let out = `CAST(${expr} AS BINARY)`;
  for (let i = 0; i < ASCII_UPPER_LETTERS.length; i++) {
    out = `REPLACE(${out}, '${ASCII_UPPER_LETTERS[i]}', '${ASCII_LOWER_LETTERS[i]}')`;
  }
  return out;
}

/** One text predicate, ready to splice into a WHERE clause. */
export interface TextMatchRequest {
  /** The dialect that will execute the statement. */
  dialect: AnalyticsSqlDialect;
  /** The already-quoted column expression the predicate reads. */
  column: string;
  /** Where the wildcard sits: `contains` / `starts` / `ends`. */
  shape: LikeShape;
  /** The author's comparand, at its own type ({@link likePattern} renders it). */
  value: unknown;
  /** `$notContains` — the negated keyword, on whichever construct the arm picks. */
  negate?: boolean;
  /**
   * [#15780] `$icontains` — apply the ASCII-ONLY case fold (#4706 Q1 = A) to
   * BOTH sides of the comparison, in whatever spelling this dialect has one.
   *
   * Set on the `$icontains` row ALONE. The case-EXACT four are case-sensitive
   * by ruling (#4706 Q2 = A) and must never reach an arm with this true.
   */
  fold?: boolean;
  /** The caller's placeholder plumbing. */
  bind: TextMatchBind;
}

/**
 * The one place a text predicate becomes SQL in this package — both families.
 *
 * `fold` picks between them; every other input is shared. See this file's
 * header for why each cell is the construct it is.
 */
export function textMatchPredicateSql(req: TextMatchRequest): string {
  const { dialect, column, shape, value, bind } = req;
  const negate = req.negate === true;
  const fold = req.fold === true;

  if (dialect === 'sqlite') {
    // GLOB takes no ESCAPE clause, so this arm binds ONE value, not two.
    // [#15780] The fold is SQLite's own `lower()`, which is ASCII-only —
    // measured, `lower('CAFÉ')` is `cafÉ` — so it is exactly the #4706 Q1 = A
    // domain rather than an approximation of it. Applied to BOTH sides: a
    // folded needle against a raw column matches only the already-lower rows.
    const lower = (expr: string) => (fold ? `lower(${expr})` : expr);
    return `${lower(column)} ${negate ? 'NOT GLOB' : 'GLOB'} ${lower(bind(globPattern(shape, value)))}`;
  }

  const keyword = negate ? 'NOT LIKE' : 'LIKE';
  // [#5567] The escape character is BOUND, never written as a literal: MySQL
  // applies C escape syntax inside string literals, so the literal spelling
  // differs per dialect while a bound value has one spelling everywhere.
  if (dialect === 'mysql') {
    const binary = (expr: string) => (fold ? mysqlAsciiLowerBinarySql(expr) : `CAST(${expr} AS BINARY)`);
    return `${binary(column)} ${keyword} ${binary(bind(likePattern(shape, value)))} ESCAPE ${bind(LIKE_ESCAPE_CHAR)}`;
  }

  // `postgres` — where LIKE is already case-exact — and `unknown`, the residue.
  // [#15780] The fold here is the `translate()` this package has always emitted
  // ({@link asciiLowerSqlExpr}); on these two arms it was never the defect, so
  // the correct diff is no diff.
  const folded = (expr: string) => (fold ? asciiLowerSqlExpr(expr) : expr);
  return `${folded(column)} ${keyword} ${folded(bind(likePattern(shape, value)))} ESCAPE ${bind(LIKE_ESCAPE_CHAR)}`;
}
