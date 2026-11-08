// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 16] The leaf predicate emitters of `SqlDriver`'s filter compiler:
 * the methods that turn ONE comparison the compiler has already validated into
 * SQL on the builder. `applyNormalizedComparison` compiles a value test against
 * a storage-normalised column expression; `applyNullSafeNegative` is the #5298
 * `(col IS NULL OR <test>)` wrapper of a negative-polarity test; `applyEmptyOperator`
 * is #20444's `$empty`; `applyJsonMembership` is the membership reading of
 * `$contains` / `$notContains` on a JSON column; `applyLike` is the `$contains`
 * family and `$icontains`; `applyLikePattern` is #7536's `$like` / `$ilike`.
 * They moved out of `sql-driver.ts` whole, with the module-level declarations
 * only they read: the dialect text-match constructs (`textMatchPredicate`,
 * `sqliteLengthAwareTextMatch`, `mysqlAsciiLowerBinary`, the comparand escapes,
 * the ASCII case map and `NUL_CHARACTER`), the `$like` pattern plan
 * (`likePatternPredicate`, `sqliteLikePatternPlan`, `sqliteLikePatternMatch`
 * and the `SqliteLikePatternPlan` shape), and the `$empty` construct and its two
 * refusals (`emptyJsonListPredicate`, `undeclaredEmptyOperatorFieldError`,
 * `emptyListUnsupportedDialectError`).
 *
 * [#31394] The text-match constructs then moved on, out of this package: the
 * per-dialect table, its comparand escapes, the ASCII case map, `NUL_CHARACTER`
 * and `sqliteLengthAwareTextMatch` live in `@objectstack/core`
 * (`utils/text-match-sql.ts`), shared with the analytics compilers.
 * `textMatchPredicate` stays here as the knex adapter over it and keeps the
 * `'unknown'` residue; `likePatternPredicate` reads the SQL Server and MySQL
 * renderings from the same module.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited, and each moved declaration is byte-identical but for a leading
 * `export` on the five that docblocks staying in `sql-driver.ts` still link:
 * the same SQL, the same bindings, the same refusals.
 *
 * What did NOT move, and why:
 *
 *  - The compiler that calls these (`applyFilters`, `compileFilters`,
 *    `applyFilterCondition`) stays; `applyFilterCondition` is pinned in place by
 *    its ADR-0139 pointer.
 *  - `applyContainsLike`, `applyTextOperatorOverNonTextColumn` and
 *    `applyFalseConstant` are leaf emitters too, but each reads none of the
 *    declarations above and its stub would cost as many lines as its body.
 *  - `LIKE_ESCAPE_CHARACTER` is also bound by `scanMaxNumericTail`'s prefix
 *    scan, and `TextMatchShape` is named by `applyLike`'s signature on the
 *    class. Both gained `export` in place in `sql-driver.ts` and are imported
 *    here. `withheldFilterError`, the #7929 seam both refusals build through,
 *    was already exported.
 *  - `declaredValueShape` and `isJsonColumn` are read by members that stay
 *    too; the moved bodies reach them through the host.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps every
 * method, because the published `dist/*.d.ts` lists each one's name and
 * position, and because an instance spy or a subclass method of the same name
 * must still be the one the compiler reaches. A body that reads
 * a member of the driver is now one literal of exactly the
 * {@link PredicateEmitterHost} members that method reads, plus a `.call`.
 * Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one a body reaches;
 * `dialectName` goes as a GETTER, so it is read when the body reads it, as it
 * was on the class. `applyNormalizedComparison` and `applyNullSafeNegative`
 * read no member of the driver, and their methods call them directly.
 *
 * The module cycle is evaluation-safe because every value import from
 * `sql-driver.ts` is read only inside a function body, never while the two
 * modules are first evaluated. `index.ts` re-exports nothing from this module
 * and names its `sql-driver.ts` exports one by one, so the published surface
 * does not move.
 */

import { coreSqlDialectOf } from './sql-driver-oracle-dialect.js';
import {
  ASCII_LOWER_LETTERS,
  ASCII_UPPER_LETTERS,
  dialectTextMatchSql,
  jsonMembershipPredicate,
  mssqlAsciiLowerSql,
  mssqlCaseExactSql,
  mysqlAsciiLowerBinarySql,
  textMatchLikePattern,
} from '@objectstack/core';
import { expandEmptyOperator, likePatternToGlobPattern } from '@objectstack/spec/data';
import type { SqlDialectName } from './schema-drift.js';
import {
  type isMultiValuedColumn,
  LIKE_ESCAPE_CHARACTER,
  type SqlDriver,
  type TextMatchShape,
  withheldFilterError,
} from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface PredicateEmitterHost {
  applyNullSafeNegative: SqlDriver['applyNullSafeNegative'];
  declaredValueShape: SqlDriver['declaredValueShape'];
  readonly dialectName: SqlDriver['dialectName'];
  isJsonColumn: SqlDriver['isJsonColumn'];
}

/**
 * Carry a caller's `$like` PATTERN into SQL Server's pattern language.
 *
 * The shared language has two wildcards (`%`, `_`) and the backslash escape;
 * SQL Server's adds the `[…]` character class. Every UNESCAPED `[` is therefore
 * escaped, so it means the literal character it means everywhere else, and an
 * already-escaped pair (`\%`, `\[`) is copied through untouched — the escape is
 * the shared one, bound as `ESCAPE` exactly as on the other dialects.
 */
function mssqlLikePattern(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      out += ch + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    out += ch === '[' ? '\\[' : ch;
  }
  return out;
}

/**
 * [#6518] The `$contains` family and `$icontains` as `{sql, bindings}` for
 * knex's `whereRaw`, with `??` the column and `?` each value.
 *
 * [#31394] The construct table itself — one arm per dialect, the escaping and
 * the ASCII fold, with the measurements behind every cell — moved to
 * `@objectstack/core` (`dialectTextMatchSql`, `utils/text-match-sql.ts`), so
 * the analytics compilers emit the SAME arms instead of a hand-held copy. This
 * adapter is the knex half: the column goes out as an identifier binding, each
 * value as a value binding, pushed in the order the placeholders appear. The
 * emitted SQL and bindings are byte-identical to what this function built
 * before the move, which every text-match suite in this package pins.
 *
 * What stays HERE is the `'unknown'` residue, the one cell the two faces do
 * not share: the pre-#6518 `LIKE` / `LOWER()` shape. `dialectName` is
 * `'unknown'` for a knex client this driver does not model, where `GLOB` is a
 * syntax error and `CAST(… AS BINARY)` means something else. Emitting the old
 * shape is not an endorsement of it — it is the only answer that still RUNS,
 * and it is the residue the conformance ledger names.
 */
export function textMatchPredicate(
  dialect: SqlDialectName,
  field: string,
  value: unknown,
  shape: TextMatchShape,
  negate: boolean,
  fold: boolean,
): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = [];
  const sql = dialectTextMatchSql(
    { dialect, shape, value, negate, fold },
    {
      column: () => {
        bindings.push(field);
        return '??';
      },
      value: (v) => {
        bindings.push(v);
        return '?';
      },
    },
  );
  if (sql !== null) return { sql, bindings };

  const column = fold ? 'LOWER(??)' : '??';
  const comparand = fold ? 'LOWER(?)' : '?';
  return {
    sql: `${column} ${negate ? 'NOT LIKE' : 'LIKE'} ${comparand} ESCAPE ?`,
    bindings: [field, textMatchLikePattern(shape, value), LIKE_ESCAPE_CHARACTER],
  };
}

/**
 * [#20024] What the SQLite `$like` / `$ilike` emitter reads off one pattern.
 * `RemoteTransport.pushLikePattern` in `driver-turso` restates this reading
 * for the remote transport, and the turso #20024 suite holds the two to the
 * same statement text and the same rows.
 */
interface SqliteLikePatternPlan {
  /** The whole pattern in GLOB's language ({@link likePatternToGlobPattern}). */
  readonly glob: string;
  /**
   * The pattern's literal prefix, the text before its first unescaped
   * wildcard, as the GLOB pattern `<prefix>*`, or `null` when that prefix is
   * empty. A value the pattern matches starts with that prefix.
   */
  readonly prefixGlob: string | null;
  /**
   * The pattern is its literal prefix followed by one or more `%` and nothing
   * else, so cutting the value at its first U+0000 cannot change the answer.
   */
  readonly cutProof: boolean;
  /**
   * The code point each stored U+0000 is replaced with before `GLOB` reads the
   * value: never U+0000, never an ASCII letter, never a surrogate, and never a
   * literal character of the pattern.
   */
  readonly sentinel: number;
}

/** [#20024] Read a NUL-free, gated pattern into its {@link SqliteLikePatternPlan}. */
function sqliteLikePatternPlan(pattern: string): SqliteLikePatternPlan {
  // First, so a dangling escape still meets that function's backstop throw.
  const glob = likePatternToGlobPattern(pattern);
  const literals = new Set<number>();
  let prefixEnd = pattern.length;
  let sawWildcard = false;
  let onlyPercentAfterPrefix = true;
  for (let i = 0; i < pattern.length; i++) {
    const escaped = pattern[i] === '\\';
    if (escaped) i++;
    if (!escaped && (pattern[i] === '%' || pattern[i] === '_')) {
      if (!sawWildcard) prefixEnd = i;
      sawWildcard = true;
      if (pattern[i] === '_') onlyPercentAfterPrefix = false;
      continue;
    }
    if (sawWildcard) onlyPercentAfterPrefix = false;
    literals.add(pattern.charCodeAt(i));
  }
  const isAsciiLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  let sentinel = 0x01;
  while (literals.has(sentinel) || isAsciiLetter(sentinel) || (sentinel >= 0xd800 && sentinel <= 0xdfff)) {
    sentinel++;
  }
  return {
    glob,
    prefixGlob: prefixEnd > 0 ? `${likePatternToGlobPattern(pattern.slice(0, prefixEnd))}*` : null,
    cutProof: sawWildcard && onlyPercentAfterPrefix,
    sentinel,
  };
}

/**
 * [#20024] The SQLite `$like` / `$ilike` predicate, which reads the WHOLE stored
 * value, U+0000s included.
 *
 * `glob()` reads the stored value as a C string, only up to its first U+0000,
 * so a NUL-free pattern over a value holding one answered a different
 * question: `$like: 'a'` matched `'a'` + U+0000 + `'b'`, and `$like: ''`
 * matched U+0000 + `'z'`. Measured at base `fe677aeeed` over 108 patterns and
 * 22 compositions against 59 stored values, identically on better-sqlite3
 * (SQLite 3.53.4), sql.js (3.49.1), `TursoDriver` local, and `TursoDriver`
 * remote over a real `@libsql/client` engine (3.45.1): 359 of 3380 cells over a
 * value holding U+0000 differed from `@objectstack/formula`, and 0 of 3640 over
 * a value without one inside the Basic Multilingual Plane. SQLite has no
 * NUL-safe pattern operator (`LIKE` cuts the same way) and `replace()` cannot
 * target U+0000 (it returns its input unchanged), so the value is rewritten
 * first and then handed to `GLOB`:
 *
 * - **A value without U+0000** takes `col GLOB ?`, exactly as before, so its
 *   answer cannot move. `instr()` over BLOB finds a U+0000 wherever it is.
 * - **A value holding U+0000** has each U+0000 replaced by one
 *   {@link SqliteLikePatternPlan.sentinel} character, found by `instr()` over
 *   BLOB and spliced by a recursive CTE, one step per U+0000. The rewrite
 *   cannot change the answer. The pattern holds no U+0000 (the refusal door
 *   `hasNulInLikePattern` guards that), so a U+0000 in the value can only ever
 *   be matched by a `%` or a `_`. The sentinel is one character, as U+0000 is,
 *   so `_` counts it the same way. And it is not a literal of the pattern, so
 *   no literal position matches it, as none matched U+0000. It is not an ASCII
 *   letter either, so the `$ilike` fold cannot make it one.
 * - **A pattern that is its literal prefix plus trailing `%`s** (`'ab%'`,
 *   `'%'`) keeps the bare `col GLOB ?`. A prefix free of U+0000 lies wholly
 *   before the value's first U+0000 or is not a prefix at all, so the cut
 *   cannot change that answer, the same argument `$startsWith` stands on.
 * - **Any other pattern with a literal prefix**, case-exact, gets `col GLOB
 *   '<prefix>*'` as a leading conjunct. It is TRUE of every value the pattern
 *   matches, cut or not, and it keeps the index range `GLOB` gives a literal
 *   prefix. `$ilike` has no such range to keep, because `lower(col)` is not an
 *   indexed column.
 *
 * NULL stays NULL: `instr(NULL, …) > 0` is NULL, so the `CASE` takes its
 * `ELSE` arm, and `NULL GLOB ?` is NULL, as before. So the NULL-safe `$not`
 * wrapper composes unchanged. `_` matches one code point in both arms, as
 * `GLOB`'s `?` does.
 */
function sqliteLikePatternMatch(field: string, pattern: string, fold: boolean): { sql: string; bindings: unknown[] } {
  const plan = sqliteLikePatternPlan(pattern);
  // GLOB takes no ESCAPE clause, so the pattern binds alone.
  const column = fold ? 'lower(??)' : '??';
  const comparand = fold ? 'lower(?)' : '?';
  if (plan.cutProof) {
    return { sql: `${column} GLOB ${comparand}`, bindings: [field, plan.glob] };
  }
  const wholeValue =
    `(WITH RECURSIVE os_like_nul(os_rest, os_head) AS (SELECT CAST(${column} AS BLOB), X'' UNION ALL `
    + `SELECT substr(os_rest, instr(os_rest, X'00') + 1), `
    + `os_head || substr(os_rest, 1, instr(os_rest, X'00') - 1) || char(${plan.sentinel}) `
    + `FROM os_like_nul WHERE instr(os_rest, X'00') > 0) `
    + `SELECT (os_head || os_rest) GLOB ${comparand} FROM os_like_nul WHERE instr(os_rest, X'00') = 0)`;
  const sql = `CASE WHEN instr(CAST(?? AS BLOB), X'00') > 0 THEN ${wholeValue} ELSE ${column} GLOB ${comparand} END`;
  const bindings = [field, field, plan.glob, field, plan.glob];
  if (fold || plan.prefixGlob === null) return { sql, bindings };
  return { sql: `(${column} GLOB ${comparand} AND ${sql})`, bindings: [field, plan.prefixGlob, ...bindings] };
}

/**
 * [#7536] The one place a `$like` / `$ilike` PATTERN becomes SQL.
 *
 * The sibling of {@link textMatchPredicate}, and deliberately a second function
 * rather than a flag on it, because the comparand travels in the opposite
 * direction through both of that function's jobs:
 *
 * | | `$contains` family ({@link textMatchPredicate}) | `$like` / `$ilike` (here) |
 * |---|---|---|
 * | the comparand is | TEXT to match literally | a PATTERN the caller wrote |
 * | `%` / `_` in it | escaped, so they are ordinary characters | the caller's WILDCARDS, left alone |
 * | wildcards | added by the shape (`%v%`, `v%`, `%v`) | already in the pattern; none added |
 * | anchoring | substring / prefix / suffix | the WHOLE value, which is what `LIKE` means |
 *
 * The dialect matrix is #6518's, unchanged and for its reasons — `$like` is
 * case-SENSITIVE (#4706 Q2 = A, the contract its `$contains` sibling answers),
 * and `$ilike` folds ASCII and nothing else (Q1 = A):
 *
 * - **SQLite → `GLOB`**, over {@link likePatternToGlobPattern}'s translation of
 *   the pattern. `LIKE` there folds ASCII unconditionally and cannot be told
 *   not to per statement, so a case-exact pattern match has to change operator
 *   — and changing operator changes the pattern LANGUAGE, which is why the
 *   translation is a shared spec function instead of an escape call. `GLOB`
 *   reads a stored value only up to its first U+0000, so a value holding one
 *   is matched by {@link sqliteLikePatternMatch}'s whole-value program instead
 *   (#20024).
 * - **Postgres → `LIKE`**, pattern bound verbatim with the bound `ESCAPE`, since
 *   `LIKE` is already case-exact there. The `$ilike` fold is `translate()` over
 *   the 26 ASCII letters — deliberately NOT Postgres's own `ILIKE`, which folds
 *   using the database collation and therefore matches `CAFÉ` against `café`,
 *   the over-fold #6518 measured and the Q1 = A boundary this must not cross.
 *   The pattern's `%`, `_` and `\` are not ASCII letters, so `translate()`
 *   passes them through untouched — the fold cannot corrupt the wildcards.
 * - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, byte-wise and so case-exact
 *   whatever the column collation says; `$ilike` adds
 *   {@link mysqlAsciiLowerBinarySql} on both sides. Not executed here for the same
 *   reason its sibling records: no MySQL server is provisionable in this
 *   container, so the cell is a declared skip rather than a claimed pass.
 * - **SQL Server → `LIKE` over {@link mssqlCaseExactSql}**, the pattern carried
 *   through {@link mssqlLikePattern} so an unescaped `[` stays the literal it is
 *   in the shared pattern language; `$ilike` folds through
 *   {@link mssqlAsciiLowerSql}.
 * - **Oracle → the Postgres arm**, for the reasons {@link textMatchPredicate}
 *   gives: `LIKE` is byte-wise under the pinned `NLS_COMP = BINARY`, and
 *   `TRANSLATE` folds the 26 ASCII letters only.
 * - **`'unknown'` → plain `LIKE` / `LOWER()`**, the only shape that still RUNS
 *   on a client this driver does not model. Same residue the conformance ledger
 *   names for the `$contains` family.
 */
export function likePatternPredicate(
  dialect: SqlDialectName,
  field: string,
  pattern: string,
  fold: boolean,
): { sql: string; bindings: unknown[] } {
  if (dialect === 'sqlite') {
    // [#20024] `glob()` reads the stored value only up to its first U+0000;
    // {@link sqliteLikePatternMatch} keeps GLOB wherever that cut cannot change
    // the answer and reads the whole value everywhere else.
    return sqliteLikePatternMatch(field, pattern, fold);
  }

  if (dialect === 'mssql') {
    const caseExact = fold ? mssqlAsciiLowerSql : mssqlCaseExactSql;
    return {
      sql: `${caseExact('??')} LIKE ${caseExact('?')} ESCAPE ?`,
      bindings: [field, mssqlLikePattern(pattern), LIKE_ESCAPE_CHARACTER],
    };
  }

  const bindings = [field, pattern, LIKE_ESCAPE_CHARACTER];

  if (dialect === 'postgres' || dialect === 'oracle') {
    const asciiLower = (expr: string) =>
      fold ? `translate(${expr}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')` : expr;
    return { sql: `${asciiLower('??')} LIKE ${asciiLower('?')} ESCAPE ?`, bindings };
  }

  if (dialect === 'mysql') {
    const caseExact = (expr: string) =>
      fold ? mysqlAsciiLowerBinarySql(expr) : `CAST(${expr} AS BINARY)`;
    return { sql: `${caseExact('??')} LIKE ${caseExact('?')} ESCAPE ?`, bindings };
  }

  const column = fold ? 'LOWER(??)' : '??';
  const comparand = fold ? 'LOWER(?)' : '?';
  return { sql: `${column} LIKE ${comparand} ESCAPE ?`, bindings };
}

/**
 * [#20444] `$empty` aimed at a column whose DECLARATION this driver does not
 * hold — a table created outside `initObjects` / `registerObjectMetadata` /
 * `registerExternalObject`, a builtin column no field declares (`id`), or a
 * field declared with no `type`.
 *
 * What counts as empty is the field's declared row of the ruled table (null or
 * `''` for a text-like type, null or `[]` for a multi-value field, null only
 * for every other type), so without the declaration there is no answer to
 * compile. The spec's by-value reading — the one it gives the faces that hold
 * NO field declarations — has no SQL form here: `amount = ''` is a type error
 * on PostgreSQL, and an empty list is only recognisable as JSON. So the filter
 * is refused rather than guessed.
 */
export function undeclaredEmptyOperatorFieldError(field: string, subtree?: unknown): Error {
  const why =
    "What counts as empty is the field's DECLARED row of the ruled table — null or '' for a " +
    'text-like type, null or [] for a multi-value field, null only for every other type — so ' +
    'the operator is refused rather than guessed. Filter on a declared field, or use "$null" for ' +
    '"has no value".';
  return withheldFilterError(
    'Operator "$empty" in this filter targets a field whose declaration this driver does not ' +
      `hold (no declared type). ${why} The field is withheld from the message; the full ` +
      'diagnostic is in the server log.',
    `Operator "$empty" on field "${field}" targets a field whose declaration this driver does not ` +
      `hold (no declared type). ${why}`,
    subtree,
  );
}

/**
 * `$contains` / `$notContains` on a JSON (multi-value) column of an Oracle
 * table. The membership reading — "is the comparand an element of the stored
 * array" — has no Oracle construct here, and the substring emitter the other
 * dialects fall back to would test the serialized JSON text instead, matching
 * `'red'` inside `["redwood"]`. Refused, with the operators that do run.
 */
export function jsonMembershipUnsupportedOnOracleError(field: string, subtree?: unknown): Error {
  const why =
    'a multi-value (JSON) field of an Oracle table, and element membership in a stored JSON array is not ' +
    'modelled for Oracle. A substring test over the JSON text would match partial elements, so the ' +
    'filter is refused rather than over-matched; "$null" / "$empty" and the scalar operators on other ' +
    'fields still run.';
  return withheldFilterError(
    `Operator "$contains" / "$notContains" in this filter targets ${why} The field is withheld from the ` +
      'message; the full diagnostic is in the server log.',
    `Operator "$contains" / "$notContains" on field "${field}" targets ${why}`,
    subtree,
  );
}

/**
 * [#20444] `$empty` on a multi-value field, over a knex client whose dialect
 * has no JSON-list construct here (`dialectName === 'unknown'`, or `'mssql'` —
 * SQL Server's federation serves scalar columns; see
 * {@link jsonMembershipUnsupportedDialectError}). The empty list is
 * tested with a JSON function that differs per dialect and none of the three
 * this driver speaks parses everywhere, so the multi-value row has no construct
 * there. The text and null-only rows need no dialect and compile everywhere.
 */
export function emptyListUnsupportedDialectError(field: string, subtree?: unknown): Error {
  const why =
    'a multi-value field, whose empty list is tested with a JSON function that differs per SQL ' +
    'dialect, and this driver has that construct only for SQLite, PostgreSQL and MySQL — not for ' +
    'this connection\'s dialect. It is refused rather than guessed; "$null" answers "has no value" ' +
    'on every dialect.';
  return withheldFilterError(
    `Operator "$empty" in this filter targets ${why} The field is withheld from the message; the ` +
      'full diagnostic is in the server log.',
    `Operator "$empty" on field "${field}" targets ${why}`,
    subtree,
  );
}

/**
 * `$contains` / `$notContains` on a multi-value (JSON-array) field over SQL
 * Server.
 *
 * On a JSON column those operators ask whether the comparand is an ELEMENT of
 * the stored array (commit e04a0aff2), and the construct that answers it lives
 * in `@objectstack/core`'s `jsonMembershipPredicate`, which has arms for SQLite,
 * PostgreSQL and MySQL only. The fallback a dialect-less client gets — a
 * substring `LIKE` over the serialized array — answers a different question
 * (`['redwood']` would "contain" `'red'`), so on SQL Server the filter is
 * refused rather than answered wrongly. Scalar columns, which is what a
 * federated SQL Server table holds, are unaffected.
 */
export function jsonMembershipUnsupportedDialectError(field: string, subtree?: unknown): Error {
  const why =
    'a multi-value (JSON-array) field, where it asks whether the value is an ELEMENT of the stored ' +
    'list; this driver has that construct only for SQLite, PostgreSQL and MySQL, not for SQL Server, ' +
    'and a substring match over the serialized list would answer a different question. It is ' +
    'refused rather than guessed.';
  return withheldFilterError(
    `Operator "$contains" / "$notContains" in this filter targets ${why} The field is withheld from ` +
      'the message; the full diagnostic is in the server log.',
    `Operator "$contains" / "$notContains" on field "${field}" targets ${why}`,
    subtree,
  );
}

/**
 * [#20444] "Is this stored JSON value the empty list?", as ONE boolean SQL
 * expression that is FALSE — never NULL, never an error — for every other
 * stored JSON value, or `null` for a dialect with no construct.
 *
 * A multi-value field is a JSON column here ({@link SqlDriver.jsonColumn}: TEXT
 * on SQLite, `json` on PostgreSQL and MySQL — {@link isMultiValuedColumn} keys
 * the DDL), so the question is asked of the stored JSON, never as a `$eq: []`
 * comparand (ruling 乙 on #19757 refuses an empty list in the equality slot, and
 * this operator does not reopen it).
 *
 * - **SQLite** — the column is TEXT, so bytes that are not JSON are physically
 *   storable (the legacy form {@link jsonMembershipPredicate} guards the same
 *   way). `json_valid` is asked first, inside a `CASE` whose branches are
 *   evaluated lazily, so a malformed cell answers FALSE rather than failing the
 *   statement; `json_type` keeps a non-array JSON value (for which
 *   `json_array_length` answers 0) from counting as an empty list.
 * - **PostgreSQL** — `json` has no equality operator, so the value is compared
 *   as `jsonb`, whose equality is structural (`[ ]` equals `[]`).
 * - **MySQL** — `JSON_LENGTH` answers 0 for an empty OBJECT too, so the type is
 *   asked beside it.
 *
 * The same three constructs `service-analytics`' SQL compilers emit for the
 * same row (`empty-operator-sql.ts`); that package depends on no driver, so
 * the construct is restated rather than imported, and both are held to the
 * ruled table by their own suites.
 */
export function emptyJsonListPredicate(
  dialect: SqlDialectName,
  field: string,
): { sql: string; bindings: string[] } | null {
  switch (dialect) {
    case 'sqlite':
      return {
        sql:
          "(CASE WHEN json_valid(??) THEN json_type(??) = 'array' AND json_array_length(??) = 0 " +
          'ELSE 0 END)',
        bindings: [field, field, field],
      };
    case 'postgres':
      return { sql: "(CAST(?? AS jsonb) = CAST('[]' AS jsonb))", bindings: [field] };
    case 'mysql':
      return { sql: "(JSON_TYPE(??) = 'ARRAY' AND JSON_LENGTH(??) = 0)", bindings: [field, field] };
    default:
      return null;
  }
}

/** The body of `SqlDriver#applyNormalizedComparison`; the method's docblock there is its contract. */
export function applyNormalizedComparison(builder: any, join: 'and' | 'or', expr: { sql: string; bindings: any[] }, op: string, value: unknown): boolean {
  const raw = join === 'or' ? 'orWhereRaw' : 'whereRaw';
  /**
   * [#5298] Wrap a value test so a row whose column has no value SATISFIES it:
   * `(<expr> IS NULL OR <test>)`.
   *
   * `expr.sql` is a storage-normalising expression over ONE column
   * ({@link filterColumnExpr}), and every dialect's `datetime()` / `CASE`
   * form answers NULL for a NULL input — so testing the expression is the
   * same question as testing the raw column, and keeps the whole predicate
   * readable as one unit. `expr.bindings` is repeated because `expr.sql`
   * appears twice.
   */
  const nullSafe = (testSql: string, testBindings: any[]): void => {
    builder[raw](`(${expr.sql} IS NULL OR ${testSql})`, [...expr.bindings, ...testBindings]);
  };
  const binary = (sqlOp: string, negative = false): boolean => {
    // A null comparand is a null PREDICATE, not a comparison — hand it back so
    // the caller compiles `IS NULL` / `IS NOT NULL` as it always has.
    if (value == null) return false;
    const sql = `${expr.sql} ${sqlOp} ?`;
    const bindings = [...expr.bindings, value];
    if (negative) nullSafe(sql, bindings);
    else builder[raw](sql, bindings);
    return true;
  };
  const list = (sqlOp: 'in' | 'not in'): boolean => {
    if (!Array.isArray(value) || value.length === 0) return false;
    const placeholders = value.map(() => '?').join(', ');
    const sql = `${expr.sql} ${sqlOp} (${placeholders})`;
    const bindings = [...expr.bindings, ...value];
    // [#5298] Only `not in` is negative-polarity; `in` stays a bare test.
    if (sqlOp === 'not in') nullSafe(sql, bindings);
    else builder[raw](sql, bindings);
    return true;
  };

  switch (op) {
    case '=': case '==': case '$eq':
      return binary('=');
    case '!=': case '<>': case '$ne':
      // [#5298] NULL-safe — the same ruling the plain-column arm below follows.
      return binary('<>', true);
    case '>': case '$gt':
      return binary('>');
    case '>=': case '$gte':
      return binary('>=');
    case '<': case '$lt':
      return binary('<');
    case '<=': case '$lte':
      return binary('<=');
    case 'in': case '$in':
      return list('in');
    case 'nin': case 'not_in': case 'notin': case '$nin':
      return list('not in');
    case 'between': case '$between': {
      if (!Array.isArray(value) || value.length !== 2) return false;
      builder[raw](`${expr.sql} between ? and ?`, [...expr.bindings, value[0], value[1]]);
      return true;
    }
    default:
      return false;
  }
}

/** The body of `SqlDriver#applyEmptyOperator`; the method's docblock there is its contract. */
export function applyEmptyOperator(this: Pick<PredicateEmitterHost, 'declaredValueShape' | 'dialectName'>, builder: any, logicalOp: 'and' | 'or', table: string | null | undefined, localField: string, field: string, empty: boolean, subtree: unknown): void {
  const shape = this.declaredValueShape(table, localField);
  if (!shape) throw undeclaredEmptyOperatorFieldError(field, subtree);
  const expansion = expandEmptyOperator(shape);
  const method = logicalOp === 'or' ? 'orWhere' : 'where';
  // [#31328] Oracle stores `''` as NULL, so a text column's "empty" IS its
  // null row: `= ''` / `<> ''` compare against NULL and answer UNKNOWN, which
  // turned `$empty: false` into "no rows". The text arm therefore compiles as
  // the null-only one there — the same partition, with nothing to compare.
  const arm = expansion.arm === 'text' && this.dialectName === 'oracle' ? 'null_only' : expansion.arm;
  switch (arm) {
    case 'null_only':
      builder[
        empty
          ? (logicalOp === 'or' ? 'orWhereNull' : 'whereNull')
          : (logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull')
      ](field);
      return;
    case 'text':
      builder[method]((qb: any) => {
        if (empty) qb.whereNull(field).orWhere(field, '');
        else qb.whereNotNull(field).andWhere(field, '<>', '');
      });
      return;
    case 'multi_value': {
      const list = emptyJsonListPredicate(this.dialectName, field);
      if (!list) throw emptyListUnsupportedDialectError(field, subtree);
      builder[method]((qb: any) => {
        if (empty) qb.whereNull(field).orWhereRaw(list.sql, list.bindings);
        else qb.whereNotNull(field).andWhereRaw(`NOT ${list.sql}`, list.bindings);
      });
      return;
    }
    default: {
      // The spec's `EmptyOperatorArm` is a closed union of the three rows
      // above; a fourth reaching here is a spec change this driver was not
      // taught, and it must fail loudly rather than answer for it.
      const unknownArm: never = arm;
      throw new Error(`[sql-driver] no $empty arm for the declared row ${JSON.stringify(unknownArm)}`);
    }
  }
}

/** The body of `SqlDriver#applyJsonMembership`; the method's docblock there is its contract. */
export function applyJsonMembership(this: Pick<PredicateEmitterHost, 'applyNullSafeNegative' | 'dialectName' | 'isJsonColumn'>, builder: any, method: string, table: string | null | undefined, localField: string, field: string, value: unknown, negate: boolean, subtree?: unknown): boolean {
  if (!this.isJsonColumn(table, localField)) return false;
  const dialect = this.dialectName;
  // Oracle: no membership construct is modelled, and the substring fallback
  // below would answer a different question (a needle inside the JSON TEXT),
  // so the operator is refused there rather than over-matched.
  if (dialect === 'oracle') throw jsonMembershipUnsupportedOnOracleError(localField);
  // [#31327] SQL Server, the same refusal; `subtree` carries the
  // filter-subtree provenance, so the refusal's detail is shown only to an
  // author-marked filter (#20039).
  if (dialect === 'mssql') throw jsonMembershipUnsupportedDialectError(field, subtree);
  // [#20987] The construct lives in `@objectstack/core`, placeholder-agnostic;
  // this driver's plumbing is knex's: `??` binds the column as an identifier
  // and `?` a value, each pushed in the order the placeholders appear.
  const bindings: unknown[] = [];
  const sql = jsonMembershipPredicate(
    coreSqlDialectOf(dialect),
    {
      column: () => { bindings.push(field); return '??'; },
      value: (v) => { bindings.push(v); return '?'; },
    },
    value,
  );
  if (sql === null) return false;
  const predicate = { sql, bindings };
  const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
  if (!negate) {
    builder[rawMethod](predicate.sql, predicate.bindings);
    return true;
  }
  this.applyNullSafeNegative(builder, method, field, (qb) =>
    qb.orWhereRaw(`NOT ${predicate.sql}`, predicate.bindings),
  );
  return true;
}

/** The body of `SqlDriver#applyNullSafeNegative`; the method's docblock there is its contract. */
export function applyNullSafeNegative(builder: any, method: string, field: string, emitValueTest: (qb: any) => void): void {
  (builder as any)[method]((qb: any) => {
    qb.whereNull(field);
    emitValueTest(qb);
  });
}

/** The body of `SqlDriver#applyLike`; the method's docblock there is its contract. */
export function applyLike(this: Pick<PredicateEmitterHost, 'dialectName'>, builder: any, method: string, field: string, value: unknown, shape: TextMatchShape, negate = false, fold = false): void {
  const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
  const { sql, bindings } = textMatchPredicate(this.dialectName, field, value, shape, negate, fold);
  builder[rawMethod](sql, bindings);
}

/** The body of `SqlDriver#applyLikePattern`; the method's docblock there is its contract. */
export function applyLikePattern(this: Pick<PredicateEmitterHost, 'dialectName'>, builder: any, method: string, field: string, pattern: string, fold: boolean): void {
  const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
  const { sql, bindings } = likePatternPredicate(this.dialectName, field, pattern, fold);
  builder[rawMethod](sql, bindings);
}
