// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A URL-ish authored string as a URL parser reads it, and where its userinfo
 * sits — the boundary parse every URL-credential judge in this package reads.
 * Internal: imported by the datasource write door's userinfo accessors and
 * query-pair judgement (`./common.zod.ts`), the datasource read redactor
 * (`../datasource-credential-redaction.ts`) and the connector URL judge
 * (`../../integration/connector-url-credentials.ts`), never re-exported.
 *
 * ## The string a URL parser reads
 *
 * A URL parser (the WHATWG URL Standard, which `fetch`, `new URL()` and the
 * clients built on them follow) cleans a string before it reads it: it trims
 * the leading and trailing C0 control characters and spaces — U+0000 to
 * U+0020 — and deletes every ASCII tab, LF and CR anywhere in what is left.
 * So a URL is judged as the parser reads it: on the cleaned string
 * ({@link urlAsParsed}). A judge that read the authored string as written
 * would answer for a value no client ever opens.
 *
 * The cleaned string carries a map back to the authored one, so a read
 * redactor rewrites the credential part at the position the write door
 * judged — in the authored string — and leaves every other character, the
 * surrounding and deleted ones included, byte for byte.
 */

/** U+0000 to U+0020: the C0 control characters and space a URL parser trims from both ends. */
function isC0ControlOrSpace(code: number): boolean {
  return code <= 0x20;
}

/** ASCII tab, LF and CR: what a URL parser deletes from anywhere in a URL. */
function isAsciiTabOrNewline(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * `value` with every ASCII tab, LF and CR deleted — the parser's deletion
 * applied to a piece of a URL (a query pair), where the trim of the whole
 * string does not reach. The input itself when it holds none.
 */
export function withoutAsciiTabOrNewline(value: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < value.length; i += 1) {
    if (isAsciiTabOrNewline(value.charCodeAt(i))) changed = true;
    else out += value[i];
  }
  return changed ? out : value;
}

/** A string as a URL parser reads it, mapped back to the authored string. */
export interface UrlAsParsed {
  /** The cleaned string: trimmed, and with every ASCII tab, LF and CR deleted. */
  readonly text: string;
  /**
   * For each index of {@link UrlAsParsed.text}, the offset in the authored
   * string the character came from; one more entry, at `text.length`, is the
   * authored offset where the trimmed span ends.
   */
  readonly rawOffsets: readonly number[];
}

/** `value` cleaned as a URL parser cleans it (module note), with the offset map back to `value`. */
export function urlAsParsed(value: string): UrlAsParsed {
  let start = 0;
  let end = value.length;
  while (start < end && isC0ControlOrSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isC0ControlOrSpace(value.charCodeAt(end - 1))) end -= 1;
  let text = '';
  const rawOffsets: number[] = [];
  for (let i = start; i < end; i += 1) {
    if (isAsciiTabOrNewline(value.charCodeAt(i))) continue;
    text += value[i];
    rawOffsets.push(i);
  }
  rawOffsets.push(end);
  return { text, rawOffsets };
}

/** `scheme://` or a scheme-relative `//`: where an authority starts. */
const AUTHORITY_START_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Where the userinfo of an authored string sits, and what a URL parser reads there. */
export interface UrlUserinfoSpan {
  /** Offset in the authored string where the userinfo starts. */
  start: number;
  /** Offset in the authored string of the `@` that ends the userinfo. */
  end: number;
  /** The userinfo as a URL parser reads it (cleaned; percent-encoding preserved). */
  userinfo: string;
  /** Offset in the authored string of the userinfo's FIRST `:`, or `-1` when it has none. */
  colon: number;
}

/**
 * The userinfo of `value`, or `undefined` when it carries none — the ONE
 * userinfo boundary parse of both metadata doors that judge a URL credential:
 * the datasource write door's accessors (`urlUserinfoPassword`,
 * `urlUserinfoUsername`) read {@link UrlUserinfoSpan.userinfo}, the datasource
 * read redactor (`redactUrlPassword`) rewrites the password at the offsets,
 * and the connector entry judges and rewrites the whole userinfo at them — so
 * each read rewrites exactly what its write refuses.
 *
 * Deliberately NOT `new URL()`: real DSNs take forms WHATWG parsing rejects or
 * mangles (postgres/mongo multi-host `user:pass@h1:5432,h2:5432/db` throws
 * `ERR_INVALID_URL`, bare `:memory:`, `file:` paths), and a parse that throws
 * on the exact inputs it must judge would fail open. The boundaries are
 * RFC 3986's, read on the cleaned string ({@link urlAsParsed}):
 *
 *  - the authority is what follows `//` (scheme-relative included), up to the
 *    first `/`, `?` or `#` — a `:` or `@` in a path or query is never userinfo;
 *  - userinfo ends at the LAST `@` in the authority (a malformed literal `@`
 *    inside a password must not decide how much of it goes unjudged).
 *
 * A string with no `//` (sqlite/turso `file:` paths, `:memory:`) has no
 * authority and answers `undefined`.
 */
export function urlUserinfoSpan(value: string): UrlUserinfoSpan | undefined {
  const { text, rawOffsets } = urlAsParsed(value);
  const scheme = AUTHORITY_START_RE.exec(text);
  if (!scheme) return undefined;
  const rest = text.slice(scheme[0].length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at === -1) return undefined;
  const userinfoStart = scheme[0].length;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  return {
    start: rawOffsets[userinfoStart]!,
    end: rawOffsets[userinfoStart + at]!,
    userinfo,
    colon: colon === -1 ? -1 : rawOffsets[userinfoStart + colon]!,
  };
}
