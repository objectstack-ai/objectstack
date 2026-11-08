// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31394] The text operators — the case-EXACT family (`$contains` /
 * `$notContains` / `$startsWith` / `$endsWith`) and the ASCII-folding
 * `$icontains` — as SQL for each dialect: #6518's construct table, held ONCE
 * for every SQL face of the platform.
 *
 * ## Why it lives here
 *
 * `@objectstack/driver-sql` answered the operators per dialect (#6518, #19999,
 * #20024, #31327) in a module-private `textMatchPredicate` that returned knex
 * bindings. `@objectstack/service-analytics` compiles its own SQL for the same
 * operators in three places (its native `where`, the ADR-0021 D-C read scope,
 * the ObjectQL echo), depends on no driver (importing one would invert the
 * layering), and so kept a second, hand-held copy of the table, held to the
 * driver by suites that run both. That copy had arms for three dialects; when
 * the driver modelled SQL Server (#31327), the copy did not follow, and a
 * dashboard's text filter over a SQL Server object compared under the
 * database's case-insensitive collation while the list view compared under a
 * binary one. Both packages already stand on this one, so the table moved here
 * — the shape #20987 gave the `$contains` membership test
 * (`json-membership-sql.ts`) — rather than gaining a sixth and seventh arm in a
 * second copy.
 *
 * The placeholder plumbing is the caller's: `driver-sql` binds the column as a
 * knex identifier and returns a bindings array, each analytics compiler quotes
 * the column itself and numbers its own value placeholders. So
 * {@link dialectTextMatchSql} emits the column and every value through the
 * caller's {@link TextMatchEmitters}, left to right in the order their
 * references appear in the SQL.
 *
 * ## The `'unknown'` dialect: one `null`, two residues
 *
 * The function answers `null` there, before either emitter is called. That arm
 * is not a dialect but everything nothing answered for, and the two faces keep
 * DIFFERENT residues on purpose: `driver-sql` the pre-#6518 `LIKE` / `LOWER()`
 * shape, `service-analytics` the portable nested-`REPLACE` fold (#16028),
 * because SQLite reaches that package's residue through embedder compositions
 * where `translate()` does not parse. Each face's own docblock carries why.
 *
 * ## The arms, and why each cell
 *
 * - **SQLite → `GLOB` for a `starts` comparand free of U+0000; `instr()` and a
 *   BLOB byte suffix for every other comparand.** SQLite's `LIKE` folds ASCII
 *   case and the fold cannot be turned off per statement (`PRAGMA
 *   case_sensitive_like` is connection-global); `CAST(col AS BLOB) LIKE ?`
 *   means two different things on the two SQLite builds this repo ships
 *   (`SQLITE_LIKE_DOESNT_MATCH_BLOBS` is a compile-time flag); `GLOB` is
 *   case-exact by definition but cuts its pattern AND the stored value at the
 *   first U+0000, so it now serves only the one shape neither cut can change
 *   and the one an index can serve ({@link sqliteLengthAwareTextMatch} carries
 *   the rest). The fold is SQLite's own `lower()`, ASCII-only — measured,
 *   `lower('CAFÉ')` is `cafÉ`.
 * - **Postgres → `LIKE`**, already case-exact there; the fold is `translate()`
 *   over the 26 ASCII letters, never `LOWER()`, which follows the collation
 *   and folds `É` to `é` (measured live, PG 16, ICU database).
 * - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, byte-wise and so case-exact
 *   whatever the column's collation says; the fold is
 *   {@link mysqlAsciiLowerBinarySql}. NOT executed on a server where this was
 *   written: a declared skip in the live matrix, not a claimed pass.
 * - **SQL Server → `LIKE` over {@link mssqlCaseExactSql}** (`nvarchar(max)`
 *   under a `_BIN2` collation, so the database's case-insensitive default
 *   cannot fold the match), with `[` escaped too — it opens a character class
 *   there — and {@link mssqlAsciiLowerSql}'s `TRANSLATE` for the fold.
 *   Executed on SQL Server 2022 by `driver-sql`'s live mssql cell.
 * - **Oracle → the Postgres arm.** `LIKE` is byte-wise under `NLS_COMP =
 *   BINARY`, which every Oracle session `driver-sql` opens pins
 *   (`ORACLE_SESSION_SETUP_SQL`); Oracle's `TRANSLATE` has Postgres's
 *   signature. Measured on Oracle 23ai.
 *
 * ## Why one function and not five emitters
 *
 * The escaping is the P0 (#5567: an unescaped `%` matches every row), the fold
 * is the contract (#4706 Q1 = A ASCII-only, Q2 = A the four case-exact), and
 * the two interact — the SQLite arm escapes a DIFFERENT character class from
 * the LIKE arms, and the SQL Server arm a WIDER one. Every arm builds its
 * pattern from one of three named escape functions and one shared
 * {@link wrapTextMatchShape}, so "which characters are literal" is answered
 * per dialect in one readable place.
 */

/**
 * The dialects {@link dialectTextMatchSql} has a construct for, plus
 * `'unknown'`, the residue: the names `driver-sql`'s `SqlDialectName` carries.
 */
export type TextMatchDialect = 'sqlite' | 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'unknown';

/** Where the wildcard sits: `contains` → `%v%`, `starts` → `v%`, `ends` → `%v`. */
export type TextMatchShape = 'contains' | 'starts' | 'ends';

/**
 * The caller's placeholder plumbing for {@link dialectTextMatchSql}.
 *
 * Both are called left to right, in the order their references appear in the
 * emitted SQL, so a caller that binds positionally pushes in placeholder order.
 * `column` may be called more than once (the SQLite suffix construct reads the
 * column twice). Neither is called for the `'unknown'` dialect.
 */
export interface TextMatchEmitters {
  /** One reference to the column: an identifier placeholder, or the already-quoted column. */
  column: () => string;
  /** One bound value: push `value` and return the placeholder that references it. */
  value: (value: unknown) => string;
}

/** One text predicate to compile. */
export interface TextMatchRequest {
  /** The dialect that will execute the statement. */
  dialect: TextMatchDialect;
  /** Where the wildcard sits. */
  shape: TextMatchShape;
  /** The author's comparand, at its own type; rendered with `String()`. */
  value: unknown;
  /** `$notContains` — the negated keyword, on whichever construct the arm picks. */
  negate?: boolean;
  /**
   * `$icontains` — fold BOTH sides to ASCII lower case (#4706 Q1 = A). Set on
   * the `$icontains` row alone: the case-EXACT four must never reach an arm
   * with this true (#4706 Q2 = A).
   */
  fold?: boolean;
}

/**
 * The escape character every LIKE arm binds into its `ESCAPE` clause — BOUND,
 * never written as a literal: MySQL applies C escape syntax inside string
 * literals, so the literal spelling differs per dialect while a bound value has
 * one spelling everywhere (#5567).
 */
const TEXT_MATCH_ESCAPE_CHARACTER = '\\';

/**
 * The ASCII case map, written out as data. "ASCII only" is the CONTRACT
 * (#4706 Q1 = A), so the mapping is visible in the emitted SQL: a reviewer can
 * see that exactly 26 characters fold, without knowing the server's locale.
 */
export const ASCII_UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const ASCII_LOWER_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Escape the LIKE metacharacters (`%`, `_`) and the escape character itself. */
function escapeLikeComparand(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

/**
 * Escape the GLOB metacharacters (`*`, `?`, `[`) with GLOB's ONLY escape
 * mechanism, a single-character class. `]` needs none: every `[` becomes a
 * class that closes itself. `%` and `_` are ordinary characters to GLOB — this
 * is NOT the LIKE class, and writing the two as one regex is the mistake to
 * refuse.
 */
function escapeGlobComparand(value: unknown): string {
  return String(value).replace(/[*?[]/g, '[$&]');
}

/**
 * Escape a comparand for SQL Server's `LIKE`, whose pattern language has ONE
 * metacharacter more than the shared one: `[` opens a character class. Left
 * unescaped, `$contains: '[1]'` would match every value holding a `1` — the
 * #5567 bypass in a fourth spelling. `]` and `^` are literal outside a class,
 * and with every `[` escaped no class can open.
 */
function escapeMssqlLikeComparand(value: unknown): string {
  return String(value).replace(/[\\%_[]/g, '\\$&');
}

/** Wrap an already-escaped comparand in the wildcards `shape` calls for. */
function wrapTextMatchShape(escaped: string, shape: TextMatchShape, wildcard: string): string {
  if (shape === 'starts') return `${escaped}${wildcard}`;
  if (shape === 'ends') return `${wildcard}${escaped}`;
  return `${wildcard}${escaped}${wildcard}`;
}

/**
 * The shared LIKE pattern for one comparand: `%`, `_` and the escape character
 * escaped, then wrapped in the wildcards `shape` calls for — what every LIKE
 * arm but SQL Server's binds, with a bound backslash as its `ESCAPE`. A face
 * building its own residue binds its own backslash beside it.
 *
 * Exported for the `'unknown'` residue a face builds itself, so that residue
 * escapes exactly as the arms do rather than through a second regex.
 */
export function textMatchLikePattern(shape: TextMatchShape, value: unknown): string {
  return wrapTextMatchShape(escapeLikeComparand(value), shape, '%');
}

/**
 * SQL Server's case-EXACT rendering of a text expression: the value as
 * `nvarchar(max)`, under a binary (`_BIN2`, code-point) collation.
 *
 * Both halves are load-bearing. A SQL Server database's default collation is
 * case-insensitive, so a bare `LIKE` folds case — `$contains: 'Caf'` matched
 * `café`, measured on SQL Server 2022 — and an explicit collation on an operand
 * outranks the column's own. A `COLLATE` on a `varchar` operand re-encodes it
 * into the target collation's code page, where a Latin1 page has no Chinese or
 * Cyrillic characters; widening to `nvarchar` first converts through the
 * column's own code page into Unicode, so the collation changes only how
 * characters compare. Applied to the comparand too.
 */
export function mssqlCaseExactSql(expr: string): string {
  return `CAST(${expr} AS nvarchar(max)) COLLATE Latin1_General_100_BIN2`;
}

/**
 * The ASCII-only fold on SQL Server: `TRANSLATE` over the 26 letters, applied
 * to the {@link mssqlCaseExactSql} rendering, so exactly the 26 ASCII capitals
 * move. `LOWER()` would fold `É` to `é`. `TRANSLATE` is SQL Server 2017 (14.x)
 * and later — the dialect floor this arm declares.
 */
export function mssqlAsciiLowerSql(expr: string): string {
  return `TRANSLATE(${mssqlCaseExactSql(expr)}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')`;
}

/**
 * MySQL's ASCII-only case fold: 26 `REPLACE`s over the BINARY rendering of an
 * expression.
 *
 * Ugly, and the alternatives are all wrong rather than merely uglier: `LOWER()`
 * folds the full Unicode range, and on a binary string it is documented as
 * INEFFECTIVE; `CONVERT(x USING ascii)` maps every non-ASCII character to `?`,
 * colliding `café` with `cafÉ`; no MySQL collation is case-insensitive for
 * ASCII and exact elsewhere. In binary space `REPLACE` matches bytes, and UTF-8
 * is self-synchronising — a byte in `0x41..0x5A` is only ever a real ASCII
 * capital — so byte-wise ASCII lowering IS the ruled fold.
 */
export function mysqlAsciiLowerBinarySql(expr: string): string {
  let out = `CAST(${expr} AS BINARY)`;
  for (let i = 0; i < ASCII_UPPER_LETTERS.length; i++) {
    out = `REPLACE(${out}, '${ASCII_UPPER_LETTERS[i]}', '${ASCII_LOWER_LETTERS[i]}')`;
  }
  return out;
}

/** U+0000, spelled by its code point so no raw control byte sits in this file. */
const NUL_CHARACTER = String.fromCharCode(0x00);

/**
 * [#19999, #20024] The SQLite text match that reads the WHOLE comparand and the
 * WHOLE stored value — every `contains` / `ends` comparand, and a `starts`
 * comparand that holds U+0000.
 *
 * | shape | predicate |
 * |---|---|
 * | `contains` | `instr(col, ?) > 0` |
 * | `starts` | `instr(col, ?) = 1` — the first occurrence IS the prefix |
 * | `ends` | `coalesce(substr(CAST(col AS BLOB), -length(CAST(? AS BLOB))), CAST(col AS BLOB)) = CAST(? AS BLOB)` |
 *
 * `glob()` reads its pattern and the stored value as C strings, each cut at its
 * first U+0000; measured on better-sqlite3 (3.53.4), sql.js (3.49.1) and a
 * local libSQL engine (3.45.1), a comparand STARTING with U+0000 became the
 * pattern `*`, and a value was seen only up to its first U+0000. `instr()`
 * compares bytes over the full length of both arguments, and `lower()` folds
 * every byte it is given. `length()` and `substr()` over TEXT stop at the first
 * U+0000, so the suffix is taken over BLOB, where both count bytes — and a byte
 * suffix equal to a valid UTF-8 comparand starts on a character boundary,
 * UTF-8 being self-synchronising. Over a zero-length blob `substr` answers
 * NULL, not the empty blob, which would answer NULL for `''` and drop that row
 * under `$not`, so `coalesce()` falls back to the value itself.
 *
 * The EMPTY comparand never reaches the suffix construct: `-length('')` is
 * `-0`, which `substr` reads as "from the start". An empty string ends every
 * value, so it takes `instr(col, '') > 0`: 1 for every non-NULL value, NULL for
 * NULL, exactly as `GLOB '*'` answered it.
 *
 * Nothing is escaped — none of the three has a pattern language. The fold is
 * `lower()` on both sides. The negation is `NOT (…)`, NULL for a NULL value
 * exactly as `NOT GLOB` is, so the NULL-safe wrapper the callers put around
 * `$notContains` composes unchanged (#5298).
 */
function sqliteLengthAwareTextMatch(
  text: string,
  shape: TextMatchShape,
  negate: boolean,
  lower: (expr: string) => string,
  emit: TextMatchEmitters,
): string {
  let positive: string;
  if (shape === 'ends' && text !== '') {
    // Emitted in the order the four references appear.
    const col = lower(emit.column());
    const lengthOf = lower(emit.value(text));
    const col2 = lower(emit.column());
    const suffix = lower(emit.value(text));
    positive =
      `coalesce(substr(CAST(${col} AS BLOB), -length(CAST(${lengthOf} AS BLOB))), CAST(${col2} AS BLOB))`
      + ` = CAST(${suffix} AS BLOB)`;
  } else {
    const col = lower(emit.column());
    positive = `instr(${col}, ${lower(emit.value(text))}) ${shape === 'starts' ? '= 1' : '> 0'}`;
  }
  return negate ? `NOT (${positive})` : positive;
}

/**
 * The one place a text predicate becomes SQL, for every SQL face — or `null`
 * for the `'unknown'` dialect, where each face emits its own residue.
 *
 * See this file's header for why each cell is the construct it is.
 */
export function dialectTextMatchSql(req: TextMatchRequest, emit: TextMatchEmitters): string | null {
  const { dialect, shape, value } = req;
  const negate = req.negate === true;
  const fold = req.fold === true;

  if (dialect === 'sqlite') {
    const lower = (expr: string) => (fold ? `lower(${expr})` : expr);
    // `glob()` cuts its pattern AND the stored value at their first U+0000.
    // Only a `starts` comparand free of U+0000 is immune to both cuts.
    const text = String(value);
    if (shape !== 'starts' || text.includes(NUL_CHARACTER)) {
      return sqliteLengthAwareTextMatch(text, shape, negate, lower, emit);
    }
    // GLOB takes no ESCAPE clause, so this arm binds ONE value.
    const column = lower(emit.column());
    const pattern = lower(emit.value(wrapTextMatchShape(escapeGlobComparand(value), shape, '*')));
    return `${column} ${negate ? 'NOT GLOB' : 'GLOB'} ${pattern}`;
  }

  const keyword = negate ? 'NOT LIKE' : 'LIKE';

  if (dialect === 'mssql') {
    // `[` is a fourth metacharacter here, so the comparand takes its own escape.
    const caseExact = fold ? mssqlAsciiLowerSql : mssqlCaseExactSql;
    const column = caseExact(emit.column());
    const pattern = caseExact(emit.value(wrapTextMatchShape(escapeMssqlLikeComparand(value), shape, '%')));
    return `${column} ${keyword} ${pattern} ESCAPE ${emit.value(TEXT_MATCH_ESCAPE_CHARACTER)}`;
  }

  let operand: (expr: string) => string;
  if (dialect === 'postgres' || dialect === 'oracle') {
    operand = (expr) => (fold ? `translate(${expr}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')` : expr);
  } else if (dialect === 'mysql') {
    operand = (expr) => (fold ? mysqlAsciiLowerBinarySql(expr) : `CAST(${expr} AS BINARY)`);
  } else {
    return null;
  }
  const column = operand(emit.column());
  const pattern = operand(emit.value(textMatchLikePattern(shape, value)));
  return `${column} ${keyword} ${pattern} ESCAPE ${emit.value(TEXT_MATCH_ESCAPE_CHARACTER)}`;
}
