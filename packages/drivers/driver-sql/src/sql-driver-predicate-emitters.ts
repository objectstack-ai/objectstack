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

import { jsonMembershipPredicate } from '@objectstack/core';
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
 * The ASCII case map, written out as data.
 *
 * [#6518] Spelled as two 26-character constants rather than reached through a
 * locale-aware `LOWER()` because "ASCII only" is the CONTRACT (#4706 Q1 = A),
 * and a locale can be configured to fold more. Measured on a live Postgres 16
 * (both a `C.utf8` database and an ICU one): `lower('CAFÉ')` is `café` — the
 * over-fold — while `translate('CAFÉ', <upper>, <lower>)` is `cafÉ`. The
 * mapping being visible in the emitted SQL is the point: a reviewer can see
 * that exactly 26 characters fold, without knowing the server's locale.
 */
const ASCII_UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_LOWER_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Escape the LIKE metacharacters (`%`, `_`) and the escape character itself
 * (`\`) so a comparand matches literally.
 *
 * This is the expression `service-analytics`'s `escapeLikePattern` is held to
 * character for character by its `like-metacharacter-escape.test.ts`. Changing
 * it here without changing it there forks one `$contains` into two.
 */
function escapeLikeComparand(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

/**
 * [#6518] Escape the GLOB metacharacters (`*`, `?`, `[`) so a comparand matches
 * literally, using GLOB's ONLY escape mechanism: a single-character class.
 *
 * GLOB has no `ESCAPE` clause — SQLite's grammar simply does not have one for
 * it — so `[*]`, `[?]` and `[[]` are how a literal metacharacter is spelled.
 * `]` needs no escape and deliberately gets none: every `[` this function sees
 * is turned into a class that closes itself, so no unclosed class can survive
 * for a later `]` to terminate. `%` and `_` are ordinary characters to GLOB and
 * are likewise left alone — the escaped class here is NOT the LIKE one, and
 * writing the two as one shared regex is the mistake to refuse.
 *
 * Measured before it was written (better-sqlite3 3.53.4, the nine-row
 * `FILTER_TEXT_ROWS` fixture plus `a*b` / `a?b` / `a[b`): the unescaped pattern
 * `*a*b*` returned six rows where `*a[*]b*` returns the one. An unescaped `*`
 * is the same filter bypass an unescaped `%` is under LIKE, which is why this
 * function exists at the same level as its LIKE sibling rather than inline.
 */
function escapeGlobComparand(value: unknown): string {
  return String(value).replace(/[*?[]/g, '[$&]');
}

/** Wrap an already-escaped comparand in the wildcards `shape` calls for. */
function wrapTextMatchShape(escaped: string, shape: TextMatchShape, wildcard: string): string {
  if (shape === 'starts') return `${escaped}${wildcard}`;
  if (shape === 'ends') return `${wildcard}${escaped}`;
  return `${wildcard}${escaped}${wildcard}`;
}

/** U+0000, spelled by its code point so no raw control byte sits in this file. */
const NUL_CHARACTER = String.fromCharCode(0x00);

/**
 * [#19999, #20024] The SQLite text match that reads the WHOLE comparand and the
 * WHOLE stored value — every `contains` / `ends` comparand, and a `starts`
 * comparand that holds U+0000.
 *
 * SQLite's `glob()` reads its pattern AND the stored value as C strings, so each
 * is cut at its first U+0000. Measured on better-sqlite3 (SQLite 3.53.4),
 * sql.js (3.49.1) and a local libSQL engine (3.45.1), all alike and none
 * raising:
 *
 * - **The comparand's cut (#19999).** `$contains` / `$endsWith` of a comparand
 *   that STARTS with U+0000 matched every row (the pattern was cut to `*`), and
 *   `$startsWith` of one matched the rows that are empty before their first
 *   U+0000, `''` among them.
 * - **The stored value's cut (#20024).** With a comparand WITHOUT U+0000, `GLOB`
 *   still saw a stored value only up to its first U+0000: `$contains: 'b'`
 *   missed `'a'` + U+0000 + `'b'`, `$endsWith: 'a'` returned it, and
 *   `$icontains: 'B'` missed `'A'` + U+0000 + `'B'`.
 *
 * So the comparand is compared whole, against the whole value, by constructs
 * each measured NUL-safe on those three engines first:
 *
 * | shape | predicate |
 * |---|---|
 * | `contains` | `instr(col, ?) > 0` |
 * | `starts` | `instr(col, ?) = 1` — the first occurrence IS the prefix |
 * | `ends` | `coalesce(substr(CAST(col AS BLOB), -length(CAST(? AS BLOB))), CAST(col AS BLOB)) = CAST(? AS BLOB)` |
 *
 * `instr()` compares bytes over the full length of both arguments, and `lower()`
 * folds every byte it is given. `length()` and `substr()` over TEXT do NOT —
 * they stop at the first U+0000 (`length('a' || char(0) || 'b')` is 1) — so the
 * suffix is taken over BLOB, where both count bytes. Comparing UTF-8 bytes is
 * comparing characters: UTF-8 is self-synchronising, so a byte suffix equal to
 * a valid UTF-8 comparand starts on a character boundary. A comparand longer
 * than a non-empty value yields the whole, shorter value, which is never equal
 * to it. Over a ZERO-LENGTH blob `substr` yields NULL, not the empty blob
 * (measured on all three engines: `typeof(substr(CAST('' AS BLOB), -1))` is
 * `null`), which would answer NULL for `''` where the answer is false: invisible
 * to a bare `$endsWith`, but a `$not` over it dropped the `''` row. So
 * `coalesce()` falls back to the value itself — `substr` answers NULL exactly
 * when the value is NULL or zero-length, and the value is then the right
 * stand-in: the empty blob, never equal to a comparand of one byte or more, or
 * NULL, which stays NULL as it does under `GLOB`.
 *
 * The EMPTY comparand never reaches the suffix construct: `-length('')` is
 * `-0`, which `substr` reads as "from the start", so the construct would ask
 * whether the whole value equals `''` and answer false for `'abc'`. An empty
 * string is a suffix — and a prefix, and a substring — of every value, so it
 * takes `instr(col, '') > 0` instead, which is 1 for every non-NULL value
 * (`instr('abc', '')` and `instr('', '')` are both 1 on all three engines) and
 * NULL for NULL, exactly as `GLOB '*'` answered it.
 *
 * Nothing is escaped: none of the three has a pattern language, so `*`, `?` and
 * `[` are literal by construction and the comparand is bound as written. The
 * fold is the GLOB arm's own `lower()` on both sides, ASCII-only; it only ever
 * arrives with `contains` (`$icontains`), and the other two shapes honour it
 * anyway, as the GLOB arm does. The negation
 * is `NOT (…)`, which is NULL for a NULL value exactly as `NOT GLOB` is, so the
 * NULL-safe wrapper `$notContains` puts around it composes unchanged (#5298).
 *
 * `starts` with a comparand WITHOUT U+0000 stays on `GLOB` in
 * {@link textMatchPredicate}, byte for byte: cutting the stored value at its
 * first U+0000 cannot change that answer (a prefix free of U+0000 lies wholly
 * before the value's first one, or the value does not start with it), and a
 * `GLOB` prefix pattern is the one text construct here an index can serve.
 */
function sqliteLengthAwareTextMatch(
  field: string,
  text: string,
  shape: TextMatchShape,
  negate: boolean,
  fold: boolean,
): { sql: string; bindings: unknown[] } {
  const column = fold ? 'lower(??)' : '??';
  const comparand = fold ? 'lower(?)' : '?';
  const suffix = shape === 'ends' && text !== '';
  const positive = suffix
    ? `coalesce(substr(CAST(${column} AS BLOB), -length(CAST(${comparand} AS BLOB))), CAST(${column} AS BLOB))`
      + ` = CAST(${comparand} AS BLOB)`
    : `instr(${column}, ${comparand}) ${shape === 'starts' ? '= 1' : '> 0'}`;
  return {
    sql: negate ? `NOT (${positive})` : positive,
    bindings: suffix ? [field, text, field, text] : [field, text],
  };
}

/**
 * [#6518] MySQL's ASCII-only case fold: 26 `REPLACE`s over the BINARY rendering
 * of an expression.
 *
 * Ugly, and the alternatives are all wrong rather than merely uglier — that is
 * the whole justification, so it is written down:
 *
 *   - `LOWER(x)` folds the full Unicode range (the defect this closes).
 *   - `LOWER(x)` on a binary string is documented as INEFFECTIVE, so casting
 *     first and folding after simply does not fold.
 *   - `CONVERT(x USING ascii)` maps every non-ASCII character to `?`, which
 *     COLLIDES `café` with `cafÉ` — strictly worse than over-folding.
 *   - No MySQL collation is case-insensitive for ASCII and exact elsewhere.
 *
 * Operating on `CAST(x AS BINARY)` rather than on the text is what makes it
 * provable without a live server: in binary space `REPLACE` matches bytes, so
 * no collation participates, and UTF-8 is self-synchronising — a byte in
 * `0x41..0x5A` can only ever be a real ASCII `A`..`Z`, never part of a
 * multi-byte character. Byte-wise ASCII lowering therefore IS the ruled fold.
 */
function mysqlAsciiLowerBinary(expr: string): string {
  let out = `CAST(${expr} AS BINARY)`;
  for (let i = 0; i < ASCII_UPPER_LETTERS.length; i++) {
    out = `REPLACE(${out}, '${ASCII_UPPER_LETTERS[i]}', '${ASCII_LOWER_LETTERS[i]}')`;
  }
  return out;
}

/**
 * [#6518] The one place a text predicate becomes SQL — `{sql, bindings}` for
 * knex's `whereRaw`, with `??` the column and `?` the pattern.
 *
 * # The defect this closes
 *
 * Before this, every dialect got `col LIKE ? ESCAPE ?` (and `LOWER()` on both
 * sides for `$icontains`), which made case sensitivity the DIALECT's answer
 * where #4706 rules it the CONTRACT's. Both halves over-matched — they returned
 * rows the filter excludes, which on an RLS read scope is over-reach (#3948),
 * not a loose filter:
 *
 * | | `$contains` family (must be case-SENSITIVE, Q2=A) | `$icontains` (folds ASCII ONLY, Q1=A) |
 * |---|---|---|
 * | SQLite | ✗ `LIKE` folds ASCII | ✓ `lower()` is ASCII-only |
 * | Postgres | ✓ `LIKE` is case-exact | ✗ `LOWER()` folds all of Unicode |
 * | MySQL | ✗ follows the collation | ✗ `LOWER()` folds all of Unicode |
 *
 * # What is emitted now, and why each cell
 *
 * - **SQLite → `GLOB`.** `LIKE`'s ASCII fold cannot be turned off per-statement;
 *   `PRAGMA case_sensitive_like` is a CONNECTION-global switch, so one query
 *   would change every other query's meaning. Of the operand-level tricks,
 *   `CAST(col AS BLOB) LIKE ?` is disqualified by something worse than
 *   failing: it means TWO DIFFERENT THINGS on the two SQLite builds this repo
 *   ships. Whether `LIKE` is false for a BLOB operand is not a property of
 *   SQLite the language — it is set when SQLite is COMPILED, by
 *   `SQLITE_LIKE_DOESNT_MATCH_BLOBS`. Measured over the shared
 *   `FILTER_TEXT_ROWS` fixture, `{name: {$contains: 'acme'}}` compiled to that
 *   construct:
 *
 *   | build | `SQLITE_LIKE_DOESNT_MATCH_BLOBS` | rows |
 *   |---|---|---|
 *   | better-sqlite3 13.0.3 (SQLite 3.53.4) | compiled in | `[]` |
 *   | sql.js 1.14.1 (SQLite 3.49.1) | absent | `['1','2']` — `ACME Corp` AND `acme corp` |
 *
 *   So one build silently answers nothing and the other silently answers
 *   exactly the ASCII over-fold this whole function exists to end, and which
 *   one a caller gets is decided by a flag upstream of us. That divergence is
 *   the rejection on its own: a construct whose meaning depends on how the
 *   driver's SQLite was BUILT cannot carry a read scope (#3948) whatever value
 *   it happens to return in any one container — the `[]` above is a build's
 *   answer, not SQLite's. The CAST itself is not the part that differs:
 *   `typeof CAST(name AS BLOB)` is `'blob'` on BOTH builds, so what diverges is
 *   purely `LIKE`'s rule for a blob operand, which is the compile-time half. So
 *   the operator has to change. `GLOB` is case-exact by definition, answers
 *   `['2']` on BOTH builds above, and carries its own
 *   escape mechanism ({@link escapeGlobComparand}). `lower()` in front of it is
 *   still the
 *   `$icontains` fold, and still ASCII-only: measured, `lower('CAFÉ')` is
 *   `'cafÉ'`, so `lower(name) GLOB '*café*'` answers row 4 and `'*cafÉ*'`
 *   answers row 3 — the Q1 = A boundary, executed rather than argued.
 *   `glob()` cuts its pattern AND the stored value at their first U+0000, so
 *   `GLOB` now serves only `starts` with a comparand free of U+0000 — the one
 *   shape the value's cut cannot change, and the one an index can serve.
 *   Every `contains` / `ends` comparand (#20024), and a `starts` comparand
 *   holding U+0000 (#19999), goes to {@link sqliteLengthAwareTextMatch}, whose
 *   `instr()` / BLOB-suffix constructs read both whole. Measured over an
 *   indexed TEXT column on all three SQLite engines, `EXPLAIN QUERY PLAN` was
 *   already `SCAN` for every `contains` / `ends` shape under `GLOB` (a leading
 *   `*` is never index-usable) and stays `SCAN`; `starts` keeps its `SEARCH`.
 * - **Postgres → `LIKE`, unchanged**, because `LIKE` there is already exact.
 *   Only the fold moves, from `LOWER()` to {@link ASCII_UPPER_LETTERS}-driven
 *   `translate()`. Measured live (PG 16, ICU database): `LOWER(name) LIKE
 *   LOWER('%café%')` returned rows 3 AND 4; the `translate()` form returns row
 *   4, and its `'%CAFÉ%'` mirror returns row 3.
 * - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, which is byte-wise and
 *   therefore case-exact whatever the column's collation says. The fold adds
 *   {@link mysqlAsciiLowerBinary} on top. NOT executed here: no MySQL server was
 *   provisionable in the container that wrote this, so the mysql cell is a
 *   declared skip in the live matrix rather than a claimed pass, and the
 *   reasoning is written out on that helper instead.
 * - **`'unknown'` → the pre-#6518 `LIKE`/`LOWER()` shape.** `dialectName` is
 *   `'unknown'` for a knex client this driver does not model (mssql, oracle),
 *   where `GLOB` is a syntax error and `CAST(… AS BINARY)` means something
 *   else. Emitting the old shape is not an endorsement of it — it is the only
 *   answer that still RUNS, and it is the residue the conformance ledger names.
 *
 * # Why one function and not four emitters
 *
 * The escaping is the P0 (#5567: an unescaped `%` matches every row), the fold
 * is the contract, and the two interact — the SQLite arm needs a DIFFERENT
 * escaped character class from the other three, which is exactly the kind of
 * divergence a second emitter drops on the floor. Every arm below therefore
 * builds its pattern from one of two named escape functions and one shared
 * {@link wrapTextMatchShape}, so "which characters are literal" is answered per
 * dialect in one readable place and can never be answered by accident.
 */
export function textMatchPredicate(
  dialect: SqlDialectName,
  field: string,
  value: unknown,
  shape: TextMatchShape,
  negate: boolean,
  fold: boolean,
): { sql: string; bindings: unknown[] } {
  if (dialect === 'sqlite') {
    // [#19999, #20024] `glob()` cuts its pattern AND the stored value at their
    // first U+0000. Only a `starts` comparand free of U+0000 is immune to both
    // cuts; every other comparand is compared by a length-aware construct.
    const text = String(value);
    if (shape !== 'starts' || text.includes(NUL_CHARACTER)) {
      return sqliteLengthAwareTextMatch(field, text, shape, negate, fold);
    }
    // GLOB takes no ESCAPE clause, so this arm binds two values, not three.
    const pattern = wrapTextMatchShape(escapeGlobComparand(value), shape, '*');
    const column = fold ? 'lower(??)' : '??';
    const comparand = fold ? 'lower(?)' : '?';
    return {
      sql: `${column} ${negate ? 'NOT GLOB' : 'GLOB'} ${comparand}`,
      bindings: [field, pattern],
    };
  }

  const pattern = wrapTextMatchShape(escapeLikeComparand(value), shape, '%');
  const keyword = negate ? 'NOT LIKE' : 'LIKE';
  // The `ESCAPE` character is BOUND, never written as a literal: MySQL applies C
  // escape syntax inside string literals, so `'\'` and `'\\'` are the same
  // backslash spelled two ways per dialect, while a bound value has one
  // spelling everywhere (#5567).
  const bindings = [field, pattern, LIKE_ESCAPE_CHARACTER];

  if (dialect === 'postgres') {
    const asciiLower = (expr: string) =>
      fold ? `translate(${expr}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')` : expr;
    return { sql: `${asciiLower('??')} ${keyword} ${asciiLower('?')} ESCAPE ?`, bindings };
  }

  if (dialect === 'mysql') {
    const caseExact = (expr: string) =>
      fold ? mysqlAsciiLowerBinary(expr) : `CAST(${expr} AS BINARY)`;
    return { sql: `${caseExact('??')} ${keyword} ${caseExact('?')} ESCAPE ?`, bindings };
  }

  const column = fold ? 'LOWER(??)' : '??';
  const comparand = fold ? 'LOWER(?)' : '?';
  return { sql: `${column} ${keyword} ${comparand} ESCAPE ?`, bindings };
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
 *   {@link mysqlAsciiLowerBinary} on both sides. Not executed here for the same
 *   reason its sibling records: no MySQL server is provisionable in this
 *   container, so the cell is a declared skip rather than a claimed pass.
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

  const bindings = [field, pattern, LIKE_ESCAPE_CHARACTER];

  if (dialect === 'postgres') {
    const asciiLower = (expr: string) =>
      fold ? `translate(${expr}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')` : expr;
    return { sql: `${asciiLower('??')} LIKE ${asciiLower('?')} ESCAPE ?`, bindings };
  }

  if (dialect === 'mysql') {
    const caseExact = (expr: string) =>
      fold ? mysqlAsciiLowerBinary(expr) : `CAST(${expr} AS BINARY)`;
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
 * [#20444] `$empty` on a multi-value field, over a knex client whose dialect
 * this driver does not model (`dialectName === 'unknown'`). The empty list is
 * tested with a JSON function that differs per dialect and none of the three
 * this driver speaks parses everywhere, so the multi-value row has no construct
 * there. The text and null-only rows need no dialect and compile everywhere.
 */
export function emptyListUnsupportedDialectError(field: string, subtree?: unknown): Error {
  const why =
    'a multi-value field, whose empty list is tested with a JSON function that differs per SQL ' +
    'dialect, and this connection\'s dialect is not one this driver models (SQLite, PostgreSQL, ' +
    'MySQL). It is refused rather than guessed; "$null" answers "has no value" on every dialect.';
  return withheldFilterError(
    `Operator "$empty" in this filter targets ${why} The field is withheld from the message; the ` +
      'full diagnostic is in the server log.',
    `Operator "$empty" on field "${field}" targets ${why}`,
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
  switch (expansion.arm) {
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
      const unknownArm: never = expansion.arm;
      throw new Error(`[sql-driver] no $empty arm for the declared row ${JSON.stringify(unknownArm)}`);
    }
  }
}

/** The body of `SqlDriver#applyJsonMembership`; the method's docblock there is its contract. */
export function applyJsonMembership(this: Pick<PredicateEmitterHost, 'applyNullSafeNegative' | 'dialectName' | 'isJsonColumn'>, builder: any, method: string, table: string | null | undefined, localField: string, field: string, value: unknown, negate: boolean): boolean {
  if (!this.isJsonColumn(table, localField)) return false;
  // [#20987] The construct lives in `@objectstack/core`, placeholder-agnostic;
  // this driver's plumbing is knex's: `??` binds the column as an identifier
  // and `?` a value, each pushed in the order the placeholders appear.
  const bindings: unknown[] = [];
  const sql = jsonMembershipPredicate(
    this.dialectName,
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
