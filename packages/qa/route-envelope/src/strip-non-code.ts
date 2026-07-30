// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Reduce TypeScript source to just its *code* tokens: comments removed, and
 * string / template / regex literals emptied while keeping their delimiters.
 *
 * Why this exists at all. The three hand-rolled envelope scans (#3675 / #3689,
 * in `service-storage` and `service-i18n`) each opened with the same pair of
 * `String.replace` calls — one regex deleting block comments, one deleting
 * everything from a `//` to the end of the line — and the same comment
 * explaining them, because a module that documents both the old and the new
 * envelope would otherwise fail its own scan on its prose.
 *
 * That pair is right about comments and wrong about everything else: the
 * line-comment regex also eats `//` inside a *string* (`'http://local'` becomes
 * `'http:`), silently truncating the rest of the line — including any `.json(`
 * call on it. A scan that under-counts call sites is a guard that passes while
 * drift ships, which is the failure mode this whole issue is about.
 *
 * So the shared harness tokenizes properly, once, instead of three copies of a
 * regex that nearly works.
 *
 * Literal *contents* are dropped rather than the literals themselves, so
 * `{ error: 'not_found' }` reduces to `{ error: '' }` — still recognisable as
 * "error is a bare string", which is exactly the pre-#3675 dialect the caller
 * needs to detect.
 *
 * Known limits, stated rather than discovered later: `${…}` interpolations are
 * dropped with the rest of the template body (no route module builds an
 * envelope inside one), and regex-vs-division is resolved by the standard
 * preceding-token heuristic below rather than a real parser.
 */

/**
 * Tokens after which a `/` opens a regex literal rather than a division. The
 * standard heuristic: division follows a *value* (identifier, literal, `)`),
 * a regex follows an operator or an opening bracket.
 */
const REGEX_PRECEDERS = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n',
]);

export function stripNonCode(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  /** Last non-whitespace character emitted — drives the regex/division call. */
  let prev = '';

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];

    // Line comment → collapse to a space so tokens on either side stay apart.
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // Block comment → same.
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }

    // Regex literal → keep an empty one, drop the pattern (which may itself
    // contain quotes, braces or `//` and would otherwise unbalance the scan).
    if (c === '/' && REGEX_PRECEDERS.has(prev)) {
      i++;
      let inClass = false;
      while (i < n) {
        const r = source[i]!;
        if (r === '\\') { i += 2; continue; }
        if (r === '\n') break;
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) { i++; break; }
        i++;
      }
      // Skip trailing flags so `g`/`u` don't read as identifiers.
      while (i < n && /[a-z]/.test(source[i]!)) i++;
      out += '//';
      prev = '/';
      continue;
    }

    // String / template literal → keep the delimiters, empty the body.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        const s = source[i]!;
        if (s === '\\') { i += 2; continue; }
        if (s === quote) { i++; break; }
        // An unterminated single-line string: bail at the newline rather than
        // swallowing the rest of the file.
        if (quote !== '`' && s === '\n') break;
        i++;
      }
      out += quote + quote;
      prev = quote;
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return out;
}
