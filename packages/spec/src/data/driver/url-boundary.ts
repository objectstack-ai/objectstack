// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a URL-ish authored string starts and ends, and where its userinfo
 * sits — the boundary parse every URL-credential judge in this package reads.
 * Internal: imported by the datasource write door's userinfo accessors
 * (`./common.zod.ts`), the datasource read redactor
 * (`../datasource-credential-redaction.ts`) and the connector URL judge
 * (`../../integration/connector-url-credentials.ts`), never re-exported.
 *
 * ## Surrounding whitespace
 *
 * A URL parser (the WHATWG URL Standard, which `fetch`, `new URL()` and the
 * clients built on them follow) strips leading and trailing C0 control
 * characters and spaces — U+0000 to U+0020 — before it reads the string. So a
 * URL is judged where the parser reads it: on the string trimmed of those
 * characters ({@link urlTrimmedBounds}). A judge that read the untrimmed
 * string would answer for a value no client ever opens.
 *
 * The bounds are offsets into the authored string, not a trimmed copy, so a
 * read redactor rewrites the credential part at the position the write door
 * judged and leaves every other character, the surrounding ones included,
 * byte for byte.
 */

/** U+0000 to U+0020: the C0 control characters and space a URL parser strips from both ends. */
function isC0ControlOrSpace(code: number): boolean {
  return code <= 0x20;
}

/**
 * `[start, end)` of `value` with its leading and trailing C0 control
 * characters and spaces left out — the span a URL parser reads (module note).
 * `start === end` for a string holding nothing else.
 */
export function urlTrimmedBounds(value: string): readonly [start: number, end: number] {
  let start = 0;
  let end = value.length;
  while (start < end && isC0ControlOrSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isC0ControlOrSpace(value.charCodeAt(end - 1))) end -= 1;
  return [start, end];
}

/** `scheme://` or a scheme-relative `//`: where an authority starts. */
const AUTHORITY_START_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * `[start, end)` of the userinfo in `value`, or `undefined` when it carries
 * none — the ONE userinfo boundary parse of the datasource doors: the write
 * door's accessors (`urlUserinfoPassword`, `urlUserinfoUsername`) read the
 * userinfo at these offsets, and the read redactor (`redactUrlPassword`)
 * rewrites the password at them, so the read rewrites exactly what the write
 * refuses.
 *
 * Deliberately NOT `new URL()`: real DSNs take forms WHATWG parsing rejects or
 * mangles (postgres/mongo multi-host `user:pass@h1:5432,h2:5432/db` throws
 * `ERR_INVALID_URL`, bare `:memory:`, `file:` paths), and a parse that throws
 * on the exact inputs it must judge would fail open. The boundaries are
 * RFC 3986's, read on the trimmed span ({@link urlTrimmedBounds}):
 *
 *  - the authority is what follows `//` (scheme-relative included), up to the
 *    first `/`, `?` or `#` — a `:` or `@` in a path or query is never userinfo;
 *  - userinfo ends at the LAST `@` in the authority (a malformed literal `@`
 *    inside a password must not decide how much of it goes unjudged).
 *
 * A string with no `//` (sqlite/turso `file:` paths, `:memory:`) has no
 * authority and answers `undefined`.
 */
export function urlUserinfoSpan(value: string): { start: number; end: number } | undefined {
  const [start, end] = urlTrimmedBounds(value);
  const url = value.slice(start, end);
  const scheme = AUTHORITY_START_RE.exec(url);
  if (!scheme) return undefined;
  const rest = url.slice(scheme[0].length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at === -1) return undefined;
  const userinfoStart = start + scheme[0].length;
  return { start: userinfoStart, end: userinfoStart + at };
}
