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
 * in-app templates.
 *
 * The hole grammar is `@objectstack/formula`'s (`mailHolePattern`,
 * `parseMailHole`), the one copy the authoring rule and the placement judge
 * read too. A hole that grammar REFUSES — a second formatter
 * (`{{ x | default:0 | number:2 }}`), a formatter the whitelist does not name
 * (`{{ amount | curency:EUR }}`), or a `currency` argument that is not a
 * literal ISO 4217 code — is refused at authoring and publish; one that still
 * reaches the renderer (a template stored before the rule existed, or a body
 * handed to these functions directly) makes the render throw
 * `TEMPLATE_INVALID`, naming the hole and the rule.
 *
 * `{{ amount | currency:@currency_code }}` formats the amount in the currency
 * whose ISO 4217 code the send's `data` holds at that path, so one template
 * serves records in many currencies. The path is resolved here, like a hole's
 * own path; a value that is not a code in three capital letters — missing,
 * `null`, lowercase (`eur`), anything else — makes the render throw
 * `TEMPLATE_INVALID` too, naming the hole, the path and the value
 * (`currencyCodeValueRefusal`). Those are the ways a render throws: it prints
 * neither a substituted currency nor formatter syntax to a recipient.
 *
 * Deliberately tiny (no loops / conditionals / partials) — the design
 * stance is that email templates SHOULD be data-only renderings; any
 * branching belongs in the caller. If we ever need more, swap for
 * Handlebars, but bringing it in costs ~50KB and pulls a parser at
 * runtime; we resist that until a real use case demands it.
 */

import { currencyCodeValueRefusal, formatValue, mailHolePattern, parseMailHole } from '@objectstack/formula';

/** Locale + reference timezone for hole formatters (ADR-0053 Phase 2). */
export interface RenderOptions {
  locale?: string;
  timeZone?: string;
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
    mailHolePattern(),
    (match: string, open: string, inner: string, close: string) => {
      const parsed = parseMailHole(inner, match);
      if (!parsed) return match; // not a path[+formatter] hole — leave verbatim
      if (parsed.refusal) throw new Error(`TEMPLATE_INVALID: ${parsed.refusal.message}`);
      const isUnescaped = open === '{{{' && close === '}}}';
      const raw = lookup(data, parsed.path);
      let str: string;
      if (parsed.formatter) {
        // `currency:@path`: the code is the send's data at that path, judged
        // before the amount is read, as a literal argument is.
        let arg = parsed.arg;
        if (parsed.codePath !== undefined) {
          const code = lookup(data, parsed.codePath);
          const refusal = currencyCodeValueRefusal(match, parsed.codePath, code);
          if (refusal) throw new Error(`TEMPLATE_INVALID: ${refusal}`);
          arg = code as string;
        }
        // Formatted holes render '' for a missing value (the formula formatters
        // treat null as empty), so they never emit "undefined".
        const formatted = formatValue(parsed.formatter, raw, arg, {
          locale: opts.locale,
          timeZone: opts.timeZone,
        });
        // The grammar refuses a formatter the whitelist does not name, so
        // `formatValue` knows this one; if the two ever disagree the render
        // fails rather than print the raw value where a formatted one was meant.
        if (formatted === undefined) {
          throw new Error(
            `TEMPLATE_INVALID: the hole ${match} names the formatter '${parsed.formatter}', which is not a template formatter.`,
          );
        }
        str = formatted;
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
