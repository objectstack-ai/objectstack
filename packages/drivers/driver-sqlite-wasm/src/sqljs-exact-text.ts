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
 *   sql.js binds as a BLOB with an explicit length, and its placeholder is
 *   rewritten to `+CAST(? AS TEXT)`, so SQLite turns those bytes back into a
 *   TEXT value unchanged. The unary `+` matters: `CAST(… AS TEXT)` alone
 *   carries TEXT affinity and changes a comparison a bare bound text does not
 *   (`5 < ' x'` is 1 bound, 0 through a bare CAST); `+CAST(…)` has no affinity,
 *   like the bound text it stands in for. Every other binding, and every
 *   statement that binds no such string, is left exactly as it was.
 *
 * The rewrite needs the positional `?` a binding belongs to, so it reads the
 * statement with SQLite's own tokenizer rules (quoted strings and identifiers,
 * comments). When it cannot match placeholders to bindings one-for-one, it
 * refuses the statement ({@link cannotPlaceExactTextError}) instead of guessing
 * — a value bound to the wrong placeholder would be a worse defect than the
 * truncation it replaces.
 */

import type { Statement } from 'sql.js';

const NUL = String.fromCharCode(0x00);

/** UTF-8 in; the leading U+FEFF, when present, is content — never a signature. */
const EXACT_UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const UTF8_ENCODER = new TextEncoder();

/** The placeholder a U+0000-bearing text binding is moved into. */
const EXACT_TEXT_PLACEHOLDER = '+CAST(? AS TEXT)';

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

/** The positional parameters of a statement, located by SQLite's tokenizer rules. */
interface ParameterScan {
  /** Offsets of every bare `?` outside quotes and comments, in order. */
  readonly positional: readonly number[];
  /** A `?NNN`, `:name`, `@name` or `$name` parameter was seen as well. */
  readonly otherForms: boolean;
}

const DIGIT_RE = /[0-9]/;
const IDENT_CHAR_RE = /[A-Za-z0-9_$]/;

function scanParameters(sql: string): ParameterScan {
  const positional: number[] = [];
  let otherForms = false;
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      // A quoted string or identifier; a doubled quote is an escaped quote.
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
      if (DIGIT_RE.test(sql[i + 1] ?? '')) otherForms = true;
      else positional.push(i);
    } else if (
      (ch === ':' || ch === '@' || ch === '$') &&
      IDENT_CHAR_RE.test(sql[i + 1] ?? '') &&
      !IDENT_CHAR_RE.test(sql[i - 1] ?? '')
    ) {
      otherForms = true;
    }
    i += 1;
  }
  return { positional, otherForms };
}

/**
 * The located refusal for a statement whose placeholders cannot be matched to
 * its bindings while one of them is a text holding U+0000. ADR-0112 envelope:
 * `code` + `status` at the throw site.
 */
export function cannotPlaceExactTextError(
  positional: number,
  bindings: number,
  otherForms: boolean,
): Error & { code: string; status: number } {
  const found =
    `${positional} positional "?" parameter(s) for ${bindings} binding(s)` +
    (otherForms ? ', plus a numbered or named parameter' : '');
  return Object.assign(
    new Error(
      `driver-sqlite-wasm cannot write a text value holding U+0000 through this statement: ` +
        `it binds such a value exactly only through positional "?" parameters matched ` +
        `one-for-one to the bindings, and this statement has ${found}. The statement was not ` +
        `run, because sql.js's own text bind would have cut the value at the U+0000.`,
    ),
    { code: 'NOT_IMPLEMENTED', status: 501 },
  );
}

/**
 * Rebind every text binding that holds U+0000 so it reaches SQLite whole.
 *
 * Returns `sql` and `bindings` unchanged — the same array — when no binding is
 * such a string, which is every statement that does not carry one. Otherwise
 * each such binding becomes its UTF-8 bytes and its `?` becomes
 * `+CAST(? AS TEXT)`; see the module docblock for why that pair is exact.
 */
export function exactTextBindings(
  sql: string,
  bindings: unknown[],
): { sql: string; bindings: unknown[] } {
  const truncatable: number[] = [];
  for (let i = 0; i < bindings.length; i += 1) {
    const b = bindings[i];
    if (typeof b === 'string' && b.includes(NUL)) truncatable.push(i);
  }
  if (truncatable.length === 0) return { sql, bindings };

  const scan = scanParameters(sql);
  if (scan.otherForms || scan.positional.length !== bindings.length) {
    throw cannotPlaceExactTextError(scan.positional.length, bindings.length, scan.otherForms);
  }

  const rebound = bindings.slice();
  let out = '';
  let from = 0;
  for (const i of truncatable) {
    const at = scan.positional[i];
    out += sql.slice(from, at) + EXACT_TEXT_PLACEHOLDER;
    from = at + 1;
    rebound[i] = UTF8_ENCODER.encode(bindings[i] as string);
  }
  out += sql.slice(from);
  return { sql: out, bindings: rebound };
}
