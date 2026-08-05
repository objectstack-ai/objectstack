// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `.describe()` / JSDoc prose → a fragment that is safe to paste into MDX.
 *
 * Extracted from `build-docs.ts` (#5452) for the same reason `format-type.ts`
 * was (#4912): the generator is a top-level script with side effects, so the
 * only way to assert on its escaping used to be to run the whole thing and grep
 * the emitted `.mdx` — which is how the nested-delimiter defect below survived
 * on `main` across five rows of four reference pages.
 */

/** Opening delimiter → its closing partner. */
const DELIMITERS: Record<string, string> = { '{': '}', '<': '>' };

/**
 * Index of the delimiter that closes the pair opened at `start`, or `-1` when
 * the opener has no partner.
 *
 * Counts NESTING rather than taking the first closer (`indexOf`), because the
 * delimiters this escaper cares about arrive doubled far more often than
 * singly: `{{var}}` is the template-interpolation syntax the spec's own
 * `.describe()` text teaches, and `Array< Record< string, x > >` is an ordinary
 * type string. Matching the FIRST closer cuts such a fragment in half — the
 * wrap ends at the inner `}` and the outer one is left outside the code span,
 * so `{{var}}` rendered as `{{var}` followed by a stray `}` (#5452).
 */
function findMatchingClose(raw: string, start: number): number {
  const open = raw[start];
  const close = DELIMITERS[open];
  if (!close) return -1;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === open) {
      depth++;
    } else if (raw[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Escape MDX-unsafe characters in description text.
 *
 * MDX parses `{` as a JS expression and `<` as JSX, so any raw `{token}` /
 * `<title>` inside a Zod `.describe()` string breaks the docs build. Such
 * fragments are wrapped in inline code so they render literally.
 *
 * Single pass with backtick tracking: fragments already inside an inline-code
 * span are left untouched. A naive two-pass replace double-wraps nested cases
 * like `{<id>}` into `` `{`<id>`}` `` — the inner backticks close the span
 * early and leak `<id>` as raw JSX (MDX: "Expected a closing tag for `<id>`").
 *
 * A matched `{…}` / `<…>` pair — matched by NESTING DEPTH, see
 * `findMatchingClose` — is wrapped in an inline-code span so it renders
 * literally. A *lone* `<` or `{` with no closing partner (e.g. a SemVer range
 * `">=4.0 <5"`, or prose like `count < 5`) can't be wrapped, so it is replaced
 * with its HTML entity — otherwise MDX reads the `<` as the start of a JSX tag
 * and the build dies ("Unexpected character `5` before name").
 */
export function escapeMdxDescription(raw: string): string {
  let out = '';
  let inCode = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '`') {
      inCode = !inCode;
      out += ch;
      continue;
    }
    if (!inCode && (ch === '{' || ch === '<')) {
      const end = findMatchingClose(raw, i);
      if (end !== -1) {
        out += '`' + raw.slice(i, end + 1) + '`';
        i = end;
        continue;
      }
      // Unmatched: escape so MDX doesn't treat it as a JSX/expression opener.
      out += ch === '<' ? '&lt;' : '&#123;';
      continue;
    }
    out += ch;
  }
  return out;
}
