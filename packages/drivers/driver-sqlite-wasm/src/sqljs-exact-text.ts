// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Exact text transport for sql.js: a text value crosses this driver's engine
 * boundary byte-for-byte, the way it crosses better-sqlite3's.
 *
 * ## What sql.js does to a text value, and where
 *
 * Measured on sql.js 1.14.1, the version the lockfile installs, against
 * better-sqlite3 as the control (which round-trips every case below):
 *
 * - **WRITE — the bind.** `Statement.bindString` copies the JS string to the
 *   WASM heap and calls `sqlite3_bind_text(stmt, i, ptr, -1, …)`. A length of
 *   `-1` tells SQLite to read up to the first NUL byte, so `'a'` + U+0000 +
 *   `'b'` is stored as the one byte `61`, and `'ab'` + U+0000 as `6162`. A
 *   U+FEFF survives the bind: its bytes are not NUL.
 * - **READ — the column decode.** `Statement.getString` returns
 *   `sqlite3_column_text` through `UTF8ToString`, which stops at the first NUL
 *   byte and decodes with a `TextDecoder` built with the default
 *   `ignoreBOM: false`. So a stored `610062` reads `'a'`, and a stored text
 *   that begins `EFBBBF` reads without its U+FEFF. `getAsObject` and `exec`
 *   both go through it.
 *
 * Neither raises. Both are silent changes to a value the caller wrote, which is
 * why the answer here is a round trip and never a quieter variant of the loss.
 *
 * ## How each half is made exact
 *
 * sql.js has no length-aware text bind and no length-aware text read, so each
 * half goes through the one sql.js path that does carry a byte length:
 *
 * - **Read** ({@link readExactRow}): a cell `get()` returned as a string is a
 *   TEXT cell, and `Statement.getBlob` on it answers `sqlite3_column_bytes`
 *   bytes of `sqlite3_column_blob` — the stored bytes, NUL and BOM included
 *   (SQLite hands a UTF-8 TEXT value to `column_blob` unconverted). They are
 *   decoded with `ignoreBOM: true`. `getBlob` is not in sql.js's typings, but
 *   it is the method sql.js's own `get()` calls for a BLOB column, and it keeps
 *   its name in all three 1.14.1 builds this package can load (`sql-wasm.js`,
 *   `sql-wasm-browser.js`, `sql-wasm-debug.js`); `getString` does not. Its
 *   absence is refused loudly rather than read around.
 * - **Write** ({@link exactTextBindings}): a string that holds U+0000 — the
 *   only text the `-1` bind truncates — is bound as its UTF-8 bytes, which
 *   sql.js binds as a BLOB with an explicit length, and every parameter that
 *   receives it is wrapped as `+CAST(<parameter> AS TEXT)`, so SQLite turns
 *   those bytes back into a TEXT value unchanged. The unary `+` matters:
 *   `CAST(… AS TEXT)` alone carries TEXT affinity and changes a comparison a
 *   bare bound text does not (`5 < ' x'` is 1 bound, 0 through a bare CAST);
 *   `+CAST(…)` has no affinity, like the bound text it stands in for. Every
 *   other binding, and every statement that binds no such string, is left
 *   exactly as it was.
 *
 * ## Which parameter receives which binding
 *
 * sql.js binds an array positionally: `bindings[i]` goes to parameter index
 * `i + 1`. Which tokens carry that index is SQLite's rule, applied here as
 * SQLite applies it: a bare `?` takes the largest index so far plus one; `?NNN`
 * takes `NNN` (and raises the largest to it); a named parameter (`:name`,
 * `@name`, `#name`, `$name`) takes the index of its first occurrence, or the
 * largest plus one when new. Tokens inside quoted strings and identifiers and
 * inside comments are not parameters. Wrapping a parameter in `+CAST(… AS
 * TEXT)` adds and removes no parameter token, so every index — the wrapped
 * ones' and all the others' — is the one SQLite assigned before the rewrite.
 */

import type { Statement } from 'sql.js';

const NUL = String.fromCharCode(0x00);

/** UTF-8 in; the leading U+FEFF, when present, is content — never a signature. */
const EXACT_UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const UTF8_ENCODER = new TextEncoder();

/** Decode stored UTF-8 bytes exactly as better-sqlite3 hands them back. */
export function decodeExactText(bytes: Uint8Array): string {
  return EXACT_UTF8_DECODER.decode(bytes);
}

/** The slice of a sql.js `Statement` the exact read needs. */
type ExactReadStatement = Pick<Statement, 'get'> & {
  getBlob?: (index: number) => Uint8Array;
};

/**
 * Read the current row of a stepped statement into an object keyed by column
 * name — `getAsObject()`'s shape — with every TEXT cell read from its stored
 * bytes rather than through sql.js's NUL-terminated, BOM-stripping decode.
 *
 * `columns` is `stmt.getColumnNames()`, taken once per statement by the caller.
 */
export function readExactRow(
  stmt: ExactReadStatement,
  columns: readonly string[],
): Record<string, unknown> {
  const values = stmt.get();
  const row: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i += 1) {
    const value = values[i];
    row[columns[i]] = typeof value === 'string' ? decodeExactText(storedBytes(stmt, i)) : value;
  }
  return row;
}

function storedBytes(stmt: ExactReadStatement, index: number): Uint8Array {
  if (typeof stmt.getBlob !== 'function') {
    throw new Error(
      'driver-sqlite-wasm cannot read a text value exactly: this sql.js build has no ' +
        '`Statement.getBlob`, the only sql.js read that carries a byte length. Reading ' +
        'through `getString` instead would cut the value at an embedded U+0000 and drop a ' +
        'leading U+FEFF, so the read is refused. Install the sql.js version this package ' +
        'declares.',
    );
  }
  return stmt.getBlob(index);
}

/** One parameter token of a statement, with the index SQLite assigns it. */
interface ParameterToken {
  readonly start: number;
  readonly end: number;
  /** 1-based, as SQLite numbers parameters and sql.js binds an array. */
  readonly index: number;
}

/** SQLite's `IdChar`: ASCII letters and digits, `_`, `$`, and every non-ASCII code unit. */
const ID_CHAR_RE = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT_RE = /[0-9]/;
const WHITESPACE_RE = /\s/;

const isIdChar = (c: string | undefined) => c !== undefined && ID_CHAR_RE.test(c);

/**
 * Every parameter token in `sql`, numbered by SQLite's rule (see the module
 * docblock). Mirrors SQLite's tokenizer for the three things that decide it:
 * quoted strings and identifiers (`'…'`, `"…"`, `` `…` `` with a doubled quote
 * as an escape, and `[…]`), comments (`--` to end of line, `/* … *\/`), and the
 * variable forms, including the Tcl `::` and `(…)` suffixes a named parameter
 * may carry.
 */
function scanParameters(sql: string): ParameterToken[] {
  const tokens: ParameterToken[] = [];
  const named = new Map<string, number>();
  let largest = 0;
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] !== ch) break;
          i += 1;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '[') {
      const close = sql.indexOf(']', i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i + 2);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '?') {
      let end = i + 1;
      while (end < n && DIGIT_RE.test(sql[end])) end += 1;
      let index: number;
      if (end === i + 1) {
        largest += 1;
        index = largest;
      } else {
        index = Number(sql.slice(i + 1, end));
        if (index > largest) largest = index;
      }
      tokens.push({ start: i, end, index });
      i = end;
      continue;
    }
    // `$` is itself an identifier character, so it opens a parameter only where
    // a token starts; `:`, `@` and `#` never belong to an identifier.
    if ((ch === ':' || ch === '@' || ch === '#' || ch === '$') && !(ch === '$' && isIdChar(sql[i - 1]))) {
      let end = i + 1;
      let nameChars = 0;
      while (end < n) {
        const c = sql[end];
        if (isIdChar(c)) {
          nameChars += 1;
          end += 1;
        } else if (c === '(' && nameChars > 0) {
          let close = end + 1;
          while (close < n && !WHITESPACE_RE.test(sql[close]) && sql[close] !== ')') close += 1;
          end = sql[close] === ')' ? close + 1 : close;
          break;
        } else if (c === ':' && sql[end + 1] === ':') {
          end += 2;
        } else {
          break;
        }
      }
      if (nameChars > 0) {
        const name = sql.slice(i, end);
        let index = named.get(name);
        if (index === undefined) {
          largest += 1;
          index = largest;
          named.set(name, index);
        }
        tokens.push({ start: i, end, index });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return tokens;
}

/**
 * Rebind every text binding that holds U+0000 so it reaches SQLite whole.
 *
 * Returns `sql` and `bindings` unchanged — the same array — when no binding is
 * such a string, which is every statement that does not carry one. Otherwise
 * each such binding becomes its UTF-8 bytes and every parameter token that
 * receives it becomes `+CAST(<token> AS TEXT)`; see the module docblock for why
 * that pair is exact and why no other index moves.
 *
 * A binding no parameter receives is left as the string it was: sql.js then
 * answers exactly what it answered before — a range error for an index past
 * the statement's parameters, nothing at all for an index no token reads.
 */
export function exactTextBindings(
  sql: string,
  bindings: unknown[],
): { sql: string; bindings: unknown[] } {
  const truncatable = new Set<number>();
  for (let i = 0; i < bindings.length; i += 1) {
    const b = bindings[i];
    if (typeof b === 'string' && b.includes(NUL)) truncatable.add(i + 1);
  }
  if (truncatable.size === 0) return { sql, bindings };

  const rebound = bindings.slice();
  let out = '';
  let from = 0;
  for (const token of scanParameters(sql)) {
    if (!truncatable.has(token.index)) continue;
    out += `${sql.slice(from, token.start)}+CAST(${sql.slice(token.start, token.end)} AS TEXT)`;
    from = token.end;
    rebound[token.index - 1] = UTF8_ENCODER.encode(bindings[token.index - 1] as string);
  }
  out += sql.slice(from);
  return { sql: out, bindings: rebound };
}
