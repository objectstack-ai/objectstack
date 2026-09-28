// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Minimal mustache-style template renderer.
 *
 * Supports `{{path.to.value}}` placeholders resolved against a plain
 * JS object via dotted-path lookup.
 *
 * Escaping follows the FACE being rendered, so there are two entry points:
 *
 * - {@link renderTemplate} renders an HTML face (`body_html`). Values are
 *   HTML-escaped by default; use `{{{path}}}` (triple braces) to opt out
 *   of escaping (e.g. when injecting pre-rendered HTML fragments such as
 *   URLs in `<a href="">`).
 * - {@link renderPlainTextTemplate} renders a plain-text face (`subject`,
 *   `body_text`). Every hole, double- or triple-braced, renders its value
 *   verbatim: HTML entities in plain text are not markup, they are
 *   corruption — a `&` in a link turned into `&amp;` hands a plain-text
 *   reader a query parameter named `amp;callbackURL`. The switch lives
 *   here, once, so every template that reaches the renderer — built-in,
 *   declared or authored — gets it without a per-template brace change.
 *
 * A hole may carry an optional formatter from the shared formula
 * whitelist — `{{ order.total | currency:EUR }}`, `{{ ts | datetime }}` —
 * reusing `@objectstack/formula`'s `formatValue` so dates, money, and
 * (ADR-0053 Phase 2) reference-timezone `datetime` render identically to
 * in-app templates. An unknown formatter falls back to the raw string,
 * keeping the lenient "never throw on render" contract.
 *
 * Deliberately tiny (no loops / conditionals / partials) — the design
 * stance is that email templates SHOULD be data-only renderings; any
 * branching belongs in the caller. If we ever need more, swap for
 * Handlebars, but bringing it in costs ~50KB and pulls a parser at
 * runtime; we resist that until a real use case demands it.
 */

import { formatValue } from '@objectstack/formula';

// Match a hole: open braces, a BRACE-FREE inner body, close braces. Capturing
// the inner with `[^{}]*` (a single star over a negated class — no nested
// quantifier, no overlapping `\s*` groups) keeps the matcher strictly linear:
// it can never backtrack into a polynomial-ReDoS shape. The inner body is then
// parsed with plain string ops (`parseHole`) instead of a complex pattern.
// 1=open(`{{`|`{{{`)  2=inner  3=close(`}}`|`}}}`).
const PLACEHOLDER = /(\{\{\{?)([^{}]*)(\}\}\}?)/g;

/** Locale + reference timezone for hole formatters (ADR-0053 Phase 2). */
export interface RenderOptions {
  locale?: string;
  timeZone?: string;
}

// A hole body is a dotted path with an optional `| formatter[:arg]`. Validated
// against small, already-extracted strings (bounded input → no ReDoS).
const PATH_RE = /^[\w.]+$/;
const FILTER_RE = /^(\w+)(?::\s*'?([^']*?)'?)?$/;

interface ParsedHole {
  path: string;
  formatter?: string;
  arg?: string;
}

/** Parse a hole's inner body into a path + optional formatter. Null if malformed. */
function parseHole(inner: string): ParsedHole | null {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const path = inner.trim();
    return PATH_RE.test(path) ? { path } : null;
  }
  const path = inner.slice(0, pipe).trim();
  if (!PATH_RE.test(path)) return null;
  const m = FILTER_RE.exec(inner.slice(pipe + 1).trim());
  if (!m) return null;
  return { path, formatter: m[1], arg: m[2] };
}

function lookup(data: Record<string, any>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: any = data;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** How a double-braced hole's value is encoded for the face being rendered. */
type HoleEncoder = (value: string) => string;

const verbatim: HoleEncoder = (value) => value;

/**
 * Render `template` as an HTML face with values from `data`: `{{x}}`
 * holes are HTML-escaped, `{{{x}}}` holes are not. Missing placeholders
 * render as empty strings (no throw); call `requireVars()` first if
 * you need strict validation.
 */
export function renderTemplate(
  template: string,
  data: Record<string, any>,
  opts: RenderOptions = {},
): string {
  return render(template, data, opts, escapeHtml);
}

/**
 * Render `template` as a PLAIN-TEXT face (`subject`, `body_text`) with
 * values from `data`: every hole renders its value verbatim, with no HTML
 * escaping — plain text is not markup, so an entity there is a corrupted
 * character, never a safe one. Same lookup, formatter and missing-value
 * rules as {@link renderTemplate}.
 */
export function renderPlainTextTemplate(
  template: string,
  data: Record<string, any>,
  opts: RenderOptions = {},
): string {
  return render(template, data, opts, verbatim);
}

function render(
  template: string,
  data: Record<string, any>,
  opts: RenderOptions,
  encode: HoleEncoder,
): string {
  if (!template) return '';
  return template.replace(
    PLACEHOLDER,
    (match: string, open: string, inner: string, close: string) => {
      const parsed = parseHole(inner);
      if (!parsed) return match; // not a path[+formatter] hole — leave verbatim
      const isUnescaped = open === '{{{' && close === '}}}';
      const raw = lookup(data, parsed.path);
      let str: string;
      if (parsed.formatter) {
        // Formatted holes render '' for a missing value (the formula formatters
        // treat null as empty), so they never emit "undefined".
        const formatted = formatValue(parsed.formatter, raw, parsed.arg, {
          locale: opts.locale,
          timeZone: opts.timeZone,
        });
        str = formatted !== undefined
          ? formatted
          : raw == null ? '' : (typeof raw === 'string' ? raw : String(raw)); // unknown formatter → raw
      } else {
        if (raw == null) return '';
        str = typeof raw === 'string' ? raw : String(raw);
      }
      return isUnescaped ? str : encode(str);
    },
  );
}

/**
 * Throw `Error('MISSING_VARIABLES: a, b')` when required vars are
 * absent from `data`. Used by `IEmailService.sendTemplate()` to
 * fail fast rather than send a half-rendered email.
 */
export function requireVars(
  data: Record<string, any>,
  required: ReadonlyArray<string>,
): void {
  const missing = required.filter((name) => lookup(data, name) == null);
  if (missing.length > 0) {
    throw new Error(`MISSING_VARIABLES: ${missing.join(', ')}`);
  }
}

/**
 * Decode the small set of HTML entities `escapeHtml` can emit, in a
 * SINGLE left-to-right pass. Doing this with one alternation regex —
 * rather than a chain of `.replace('&amp;','&').replace('&lt;','<')…`
 * — is deliberate: a sequential chain is order-dependent and can
 * double-unescape (e.g. `&amp;lt;` → `&lt;` → `<`). Because each match
 * is consumed and the scan resumes *after* it, `&amp;lt;` decodes to
 * the literal text `&lt;` and stops, never to `<`.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|#39);/g;

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (m) => ENTITIES[m] ?? m);
}

const TAG_RE = /<[^>]*>/g;

/**
 * Remove HTML tags robustly. A single `.replace(/<[^>]*>/g, '')` pass
 * is not enough: stripping a tag can splice the surrounding text into a
 * fresh tag (e.g. `<scr<script>ipt>` → `<script>`), so we loop until the
 * string stops changing. This closes the "incomplete multi-character
 * sanitization" gap where crafted/overlapping input leaves a `<…>` tag
 * behind.
 */
function stripTags(s: string): string {
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out.replace(TAG_RE, '');
  } while (out !== prev);
  return out;
}

/**
 * Strip HTML tags + collapse whitespace to derive a plain-text body
 * from an HTML template. Conservative: keeps line breaks at block
 * boundaries (<br>, </p>, </div>) so the resulting text is at least
 * paragraph-shaped.
 *
 * Order matters for safety: tags are stripped (looping until stable)
 * *before* entities are decoded, and entities are decoded in a single
 * pass — so neither tag removal nor entity decoding can re-introduce a
 * live tag or double-unescape an entity.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  return decodeEntities(stripTags(withBreaks))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
