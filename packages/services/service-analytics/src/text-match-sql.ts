// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15684] The case-EXACT text family — `$contains` / `$notContains` /
 * `$startsWith` / `$endsWith` — compiled per DIALECT, for this package's three
 * SQL compilers (`read-scope-sql.ts`, `NativeSQLStrategy.buildFilterClause`,
 * the `ObjectQLStrategy` echo of that statement).
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
 * ## What is NOT here
 *
 * `$icontains` (#6520) keeps its own construct in `like-pattern.ts` and is
 * untouched by this file: it folds BOTH sides through `asciiLowerSqlExpr`, and
 * collapsing the two families onto one path would hand the case-EXACT family
 * the fold #4706 Q2 = A took away from it. Escaping (#5567) is likewise
 * unchanged — {@link likePattern} still builds every LIKE-arm pattern, and the
 * GLOB arm's own escaped class is a DIFFERENT one, not a shared regex.
 */

import { likePattern, LIKE_ESCAPE_CHAR, type LikeShape } from './like-pattern.js';
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

/** One case-EXACT text predicate, ready to splice into a WHERE clause. */
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
  /** The caller's placeholder plumbing. */
  bind: TextMatchBind;
}

/**
 * The one place a case-EXACT text predicate becomes SQL in this package.
 *
 * `$icontains` does NOT come through here — see this file's header.
 */
export function textMatchPredicateSql(req: TextMatchRequest): string {
  const { dialect, column, shape, value, bind } = req;
  const negate = req.negate === true;

  if (dialect === 'sqlite') {
    // GLOB takes no ESCAPE clause, so this arm binds ONE value, not two.
    return `${column} ${negate ? 'NOT GLOB' : 'GLOB'} ${bind(globPattern(shape, value))}`;
  }

  const keyword = negate ? 'NOT LIKE' : 'LIKE';
  // [#5567] The escape character is BOUND, never written as a literal: MySQL
  // applies C escape syntax inside string literals, so the literal spelling
  // differs per dialect while a bound value has one spelling everywhere.
  if (dialect === 'mysql') {
    const binary = (expr: string) => `CAST(${expr} AS BINARY)`;
    return `${binary(column)} ${keyword} ${binary(bind(likePattern(shape, value)))} ESCAPE ${bind(LIKE_ESCAPE_CHAR)}`;
  }

  // `postgres` — where LIKE is already case-exact — and `unknown`, the residue.
  return `${column} ${keyword} ${bind(likePattern(shape, value))} ESCAPE ${bind(LIKE_ESCAPE_CHAR)}`;
}
