// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15684 / #15780 / #31394] The text operators — the case-EXACT family
 * (`$contains` / `$notContains` / `$startsWith` / `$endsWith`) and the
 * case-INSENSITIVE `$icontains` — compiled per DIALECT, for this package's
 * three SQL compilers (`read-scope-sql.ts`, `NativeSQLStrategy.buildFilterClause`,
 * the `ObjectQLStrategy` echo of that statement).
 *
 * ## The defect #15684 closed
 *
 * Every one of the three emitted `col LIKE ? ESCAPE ?` on every dialect, and
 * SQLite's `LIKE` folds ASCII case unconditionally. Measured on sql.js over the
 * shared `FILTER_TEXT_ROWS` fixture: `{ name: { $contains: 'acme' } }` answered
 * `['1','2']` — `ACME Corp` AND `acme corp` — where `FILTER_TEXT_CASES` (#4706
 * Q2 = A) says `['2']`. Two of the three compilers make that a wrong chart; the
 * third is `read-scope-sql.ts`, the ADR-0021 D-C read scope, where a scope that
 * ADMITS rows the policy's case-sensitive predicate excludes is over-reach
 * (#3948), not a loose filter.
 *
 * No construct is case-exact AND parses on every dialect, so the dialect is an
 * INPUT: an optional hook on the context, tiered "cannot answer, do not block"
 * ({@link sqlDialectFor}).
 *
 * ## [#31394] The construct table is `@objectstack/core`'s, not a copy
 *
 * The arms — which keyword, which escaped character class, which fold — are
 * `dialectTextMatchSql` in `@objectstack/core` (`utils/text-match-sql.ts`),
 * the one table `driver-sql` emits through as well. This file used to carry a
 * second, hand-held copy of it, because this package depends on no driver and
 * the driver's emitter was module-private and returned knex bindings; the copy
 * was held to the driver by suites running both, and it had arms for three
 * dialects. When the driver modelled SQL Server (#31327) the copy did not
 * follow, so a dashboard's text filter over a SQL Server object compared under
 * the database's case-insensitive collation while a list view compared under a
 * binary one, and read `[` as a character class. The table moved to the
 * package both stand on — the shape #20987 gave the JSON membership test — and
 * the caller's placeholder plumbing travels as emitters ({@link TextMatchBind}
 * for the values, the already-quoted column for the column).
 *
 * ⛔ So a dialect arm is never added HERE. Widening what this package can SAY
 * is {@link ACCEPTED_SQL_DIALECTS}; what each name compiles to is core's.
 *
 * ## The `unknown` residue stays here, and differs from the driver's
 *
 * `unknown` is not a dialect: it is everything nothing answered for — no hook
 * wired, a driver that does not name its dialect, a name outside the accept
 * set — and core answers `null` for it. This package's residue is `LIKE` over
 * {@link likePattern}, with the [#16028] portable nested-`REPLACE` fold
 * ({@link asciiLowerReplaceSql}) for `$icontains`:
 *
 *   - Not `translate()`: SQLite reaches this arm through four embedder
 *     compositions (a `SqlDriver` given a CLASS client or an unrecognised
 *     spelling, a host hook answering knex's own `'sqlite3'`, a
 *     directly-constructed `AnalyticsService` with the OPTIONAL `sqlDialect`
 *     omitted, a `data` service with no `getDriverForObject`), and
 *     `translate()` does not parse there — a documented operator answering
 *     500 because one optional field was left out.
 *   - ⛔ Not `LOWER()`, even though `driver-sql`'s own residue folds that way:
 *     `LOWER()` follows the collation, so it would trade a loud parse failure
 *     on SQLite for SILENTLY wrong rows on PostgreSQL — the Unicode fold
 *     #4706 Q1 = A rules out. `REPLACE` is the one string function every SQL
 *     dialect has, and the chain is ASCII-only by construction.
 *   - ⚠️ The residue that REMAINS: the fold is exact everywhere, but the
 *     COMPARISON is `LIKE`, which on a case-/accent-insensitive collation
 *     (MySQL/MariaDB reaching here through the `'mariadb'` spelling #11756
 *     deliberately leaves unrecognised) over-matches, and SQLite's `LIKE` is
 *     cut at U+0000 (#20025). Choosing a construct for a dialect nothing named
 *     would be the guess this file refuses to make.
 *
 * Each face keeps its own residue and neither claims the other's.
 *
 * ## [#31394] Oracle stays on the residue, measured consistent
 *
 * The plugin's bridge answers from `SqlDriver.dialectName`, and Oracle is not
 * in {@link ACCEPTED_SQL_DIALECTS}, so an Oracle object compiles through the
 * residue. Measured against the driver (`text-match-mssql-oracle.test.ts`): the
 * case-EXACT four emit the driver's construct exactly, `LIKE` is byte-wise on
 * every Oracle session the driver opens (`NLS_COMP = BINARY`, the session this
 * package's raw SQL runs on), and `$icontains`' `REPLACE` chain folds the same
 * 26 letters the driver's `translate()` does. Same rows, so the arm was left
 * as it is.
 *
 * ⛔ The case-EXACT four must never be given the fold: that hands them back
 * what #4706 Q2 = A took away. One `fold: true`, on the `$icontains` row of
 * each compiler's operator table, and nowhere else —
 * `text-operator-case-exactness.test.ts` and `icontains-dialect-sql.test.ts`
 * pin both halves of that boundary.
 */

import { ASCII_LOWER_LETTERS, ASCII_UPPER_LETTERS, dialectTextMatchSql } from '@objectstack/core';
import { likePattern, LIKE_ESCAPE_CHAR, type LikeShape } from './like-pattern.js';
import type { StrategyContext } from '@objectstack/spec/contracts';
import type { DatasetScopedStrategyContext } from './strategies/types.js';

/**
 * [#16206] The dialect names a HOST may answer — the declared accept set of
 * `AnalyticsServiceConfig.sqlDialect`: canonical `SqlDialectName` values a
 * `SqlDriver` answers from its own `dialectName`, never knex's client aliases.
 *
 * [#31394] `'mssql'` joined when `driver-sql` modelled SQL Server (#31327): the
 * plugin's bridge answers from the driver, and narrowing the driver's own
 * canonical name to "no answer" is what sent every SQL Server object to the
 * residue arm. `'oracle'` is a `SqlDialectName` too and is deliberately NOT
 * here: the residue answers the driver's rows on Oracle (measured, see the file
 * header), and every other per-dialect table in this package (duration, empty
 * list, window, NULL placement, JSON membership) would owe it an arm first.
 *
 * ⛔ `'unknown'` is deliberately NOT in here. It is this file's RESIDUE arm —
 * what a non-answer normalises to — never a name a host is asked to say, and
 * putting it in the accept set would make "I don't know" indistinguishable from
 * a considered answer at the one seam that exists to tell them apart.
 *
 * Spelled as a `const` tuple so {@link AcceptedSqlDialect} (what the compiler
 * checks a host against) and {@link KNOWN_DIALECTS} (what the runtime checks it
 * against) are ONE source: a widening cannot land in the type and miss the set,
 * which is how a declared vocabulary drifts back into free text.
 */
export const ACCEPTED_SQL_DIALECTS = ['sqlite', 'postgres', 'mysql', 'mssql'] as const;

/**
 * [#16206] The vocabulary `AnalyticsServiceConfig.sqlDialect` accepts, stated
 * on the type so a host reading the config learns the accept set without
 * running anything — the ruled remedy for a hook that was declared as free
 * text while only three spellings ever did anything.
 */
export type AcceptedSqlDialect = (typeof ACCEPTED_SQL_DIALECTS)[number];

/**
 * The dialects this package's compilers distinguish — deliberately spelled as
 * `driver-sql`'s `SqlDialectName` spells them, `'unknown'` included, so a
 * driver's own answer can be handed straight through with no second mapping
 * table to drift. [#31394] A SUBSET of that vocabulary: `'oracle'` reads as
 * `'unknown'` here (see {@link ACCEPTED_SQL_DIALECTS}).
 */
export type AnalyticsSqlDialect = AcceptedSqlDialect | 'unknown';

/** Every dialect this file has an arm for; anything else is `'unknown'`. */
const KNOWN_DIALECTS = new Set<string>(ACCEPTED_SQL_DIALECTS);

/**
 * Read a host's / driver's dialect answer as one of {@link AnalyticsSqlDialect}.
 *
 * Anything unrecognised — including `undefined` from a host that wired no hook
 * — is `'unknown'`, which compiles the pre-#15684 `LIKE`. "Cannot answer, do
 * not block": a name this file does not model must not silently pick an arm.
 *
 * [#16206] ⛔ The accept set stays canonical names: widening it to `driver-sql`'s
 * knex-client aliases was refused by name (a second copy of that table is the
 * drift this repo keeps paying for, and #11756 shows an unrecognised spelling is
 * sometimes deliberate). What changed instead is that a WRONG answer no longer
 * reads as NO answer — see {@link isUnrecognisedSqlDialectAnswer}.
 */
export function normalizeSqlDialect(name: string | undefined | null): AnalyticsSqlDialect {
  return typeof name === 'string' && KNOWN_DIALECTS.has(name) ? (name as AnalyticsSqlDialect) : 'unknown';
}

/**
 * [#16206] Did the host answer something, and is that something outside
 * {@link ACCEPTED_SQL_DIALECTS}?
 *
 * The predicate behind the one diagnostic the hook owes its host. It lives HERE,
 * beside the set it asks about, so "what counts as an out-of-contract answer"
 * has a single definition rather than a second one re-derived at the logging
 * site — the same reason {@link KNOWN_DIALECTS} is not spelled twice.
 *
 * ⛔ It is deliberately FALSE for `undefined`, `null` and `''`. The hook is
 * OPTIONAL and "cannot answer" is a legal, silent answer that
 * {@link sqlDialectFor} is tiered on; making a NON-answer loud would punish the
 * hosts the tiering exists for. The diagnostic's whole subject is the host that
 * DID answer and was not heard.
 */
export function isUnrecognisedSqlDialectAnswer(name: string | undefined | null): name is string {
  return typeof name === 'string' && name.length > 0 && !KNOWN_DIALECTS.has(name);
}

/**
 * [#16206] `name` if it is one of {@link ACCEPTED_SQL_DIALECTS}, else
 * `undefined` — the narrowing a caller needs when it must hand an answer on to
 * something that declares the accept set.
 *
 * ⚠️ It exists for the bridge in `plugin.ts`, which answers from a `SqlDriver`'s
 * `dialectName` — a vocabulary whose last name is `'unknown'`, that driver's
 * own "I cannot say", and [#31394] whose `'oracle'` this package compiles
 * through the residue on purpose. Passed through verbatim, either would
 * arrive at the config hook looking like a considered answer outside the accept
 * set, and the host would be warned about a driver doing exactly the right
 * thing (and about `driver-sql`'s deliberately unrecognised spellings, #11756).
 * ⇒ Translate the residue to the hook's own spelling for "cannot answer" —
 * `undefined` — rather than teaching the diagnostic a list of exceptions.
 */
export function asAcceptedSqlDialect(name: string | undefined | null): AcceptedSqlDialect | undefined {
  return typeof name === 'string' && KNOWN_DIALECTS.has(name) ? (name as AcceptedSqlDialect) : undefined;
}

/**
 * [#31626] Why a dialect has no JSON function in this package, as the clause a
 * refusal ends its reason with: `whenUnknown` — the text each refusal has always
 * given — for `'unknown'`, and the dialect by name otherwise. SQL Server is a
 * named dialect (#31394) for which no JSON membership or empty-list construct is
 * stated (`@objectstack/core`'s `jsonMembershipPredicate` has none), and a
 * refusal that said its dialect "is not known" sent the reader to the host's
 * dialect wiring, which was right.
 */
export function noJsonFunctionReason(dialect: AnalyticsSqlDialect, whenUnknown: string): string {
  return dialect === 'unknown'
    ? whenUnknown
    : `this analytics host emits no such function for the datasource's dialect, "${dialect}"`;
}

/**
 * The dialect of the datasource backing `objectName`, read off the context's
 * `sqlDialect` hook — `'unknown'` when the host wired none.
 *
 * The same tiering, and the same shape, as `nonTextColumnResolver` (#14079):
 * the compilers cannot see this from the filter, the host can answer it from
 * the driver that will execute the statement, and a host that cannot answer
 * keeps the behaviour it had.
 *
 * [#16206] ⚠️ This function still answers `'unknown'` for a wrong answer and for
 * no answer alike, and that is correct HERE: by the time a compiler asks, the
 * only honest reading of an unmodelled name is "no arm for this". Telling the
 * two apart is a job for the seam that OWNS the contract — `AnalyticsService`,
 * where the host's config hook arrives and where the one `warn` is emitted
 * ({@link isUnrecognisedSqlDialectAnswer}) — not for a per-predicate call the
 * compilers make once per filter node.
 */
export function sqlDialectFor(ctx: StrategyContext, objectName: string): AnalyticsSqlDialect {
  const hook = (ctx as DatasetScopedStrategyContext).sqlDialect;
  if (typeof hook !== 'function') return 'unknown';
  return normalizeSqlDialect(hook.call(ctx, objectName));
}

/**
 * Push a value onto the caller's parameter list and return the placeholder text
 * that references it.
 *
 * Each of the three compilers has its own scheme — `$N` for
 * `NativeSQLStrategy` and the echo, `?` for the read scope, which its two
 * consumers renumber on the way out — so the numbering stays with the compiler
 * and only the CONSTRUCT lives in core. Calls happen left to right in the
 * emitted SQL, which is the order the placeholders appear.
 */
export type TextMatchBind = (value: unknown) => string;

/**
 * [#16028] The ASCII-ONLY case fold in the ONE spelling every SQL dialect
 * parses: one nested `REPLACE` per letter of the ruled domain — the residue
 * arm's fold.
 *
 * `translate(x, 'ABC…', 'abc…')` maps each `A`-`Z` occurrence SIMULTANEOUSLY;
 * this applies the 26 maps in sequence. The two agree because no step can feed
 * a later one: every replacement WRITES a lower-case letter and every later
 * step MATCHES an upper-case one. Measured rather than left as that argument —
 * `icontains-dialect-sql.test.ts` runs the emitted chain over every ASCII code
 * point on the engine and requires the ASCII-only map exactly.
 *
 * ⛔ Not `LOWER()`: it follows the database's collation, so on PostgreSQL it
 * folds `É` to `é`. SQLite's `lower()` happens to be ASCII-only, which is why
 * measuring `LOWER()` on THIS container's engine proves nothing about the arm.
 */
function asciiLowerReplaceSql(expr: string): string {
  let out = expr;
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
  /** The author's comparand, at its own type. */
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
 * A modelled dialect takes core's arm, the column and every value going out
 * through this compiler's own plumbing; `unknown` takes this package's residue.
 * See this file's header for both.
 */
export function textMatchPredicateSql(req: TextMatchRequest): string {
  const { dialect, column, shape, value, bind } = req;
  const negate = req.negate === true;
  const fold = req.fold === true;

  const armed = dialectTextMatchSql({ dialect, shape, value, negate, fold }, { column: () => column, value: bind });
  if (armed !== null) return armed;

  // The residue. [#5567] The escape character is BOUND, never written as a
  // literal: MySQL applies C escape syntax inside string literals, so the
  // literal spelling differs per dialect while a bound value has one spelling
  // everywhere. For the case-EXACT four `folded` is the identity on both sides.
  const keyword = negate ? 'NOT LIKE' : 'LIKE';
  const folded = (expr: string) => (fold ? asciiLowerReplaceSql(expr) : expr);
  return `${folded(column)} ${keyword} ${folded(bind(likePattern(shape, value)))} ESCAPE ${bind(LIKE_ESCAPE_CHAR)}`;
}
