/**
 * Template dialect engine — strict Mustache subset with a formatter whitelist.
 *
 * Holes are `{{ path }}` or `{{ path | formatter[:'arg'] }}` (ADR-0032 §3).
 * Holes are restricted to a **field/variable path** plus a **whitelisted
 * formatter** — never arbitrary CEL logic — so the grammar stays small (low
 * author/agent error surface), GUI-pickable (path + formatter dropdown), and
 * display strings stay declarative. Real logic belongs in `Predicate`/`Expr`
 * (CEL) fields, where it is validated and visible.
 *
 * The variable scope is the same as CEL (`record`, `previous`, `input`,
 * `os.user/org/env`, plus `extra`), so authors move fluidly between a CEL
 * formula and a template body without re-learning a namespace.
 *
 * Value→string semantics are explicit and defined per formatter (numbers,
 * dates, money, percent, null), instead of implicit coercion.
 */

import type { Expression } from '@objectstack/spec';

import { buildScope } from './stdlib';
import type { DialectEngine, EvalContext, EvalResult } from './types';

/**
 * A hole: capture the full inner content (no `}` allowed inside). Uses a single
 * greedy `[^}]*` (not `\s*…\s*` around a lazy group) so the pattern is linear —
 * `\s` is a subset of `[^}]`, and wrapping a lazy group in `\s*` creates an
 * ambiguous (polynomial-ReDoS) matcher. Surrounding whitespace is stripped in
 * `parseHole` instead.
 */
const HOLE_RE = /\{\{([^}]*)\}\}/g;

// ───────────────────────── formatter whitelist (ADR-0032 §3) ──────────────

type Formatter = (
  value: unknown,
  arg: string | undefined,
  locale: string,
  timeZone?: string,
) => string;

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

const FORMATTERS: Record<string, Formatter> = {
  upper: (v) => baseString(v).toUpperCase(),
  lower: (v) => baseString(v).toLowerCase(),
  trim: (v) => baseString(v).trim(),
  // number | number:2  → grouped, optional fixed decimals
  number: (v, arg, locale) => {
    const n = asNumber(v);
    if (n === undefined) return baseString(v);
    const digits = arg !== undefined ? Number(arg) : undefined;
    return new Intl.NumberFormat(locale, digits !== undefined && !Number.isNaN(digits)
      ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}).format(n);
  },
  // currency | currency:EUR  → no argument formats in USD; an argument is a
  // literal ISO 4217 code. An argument that is not one (a path such as
  // `currency_code`, a lowercase or empty code) is refused when the template
  // is compiled or published (`judgeHoleFormatter`), and refused here too: it
  // throws rather than format the amount in a currency nobody wrote. The mail
  // dialect's `currency:@path` form is resolved by the mail renderer, which
  // hands this formatter the code it read; this formatter never reads a path.
  currency: (v, arg, locale) => {
    if (arg !== undefined && !isCurrencyCode(arg)) {
      throw new RangeError(currencyArgumentRefusal(`currency:${arg}`, arg));
    }
    const n = asNumber(v);
    if (n === undefined) return baseString(v);
    const code = arg !== undefined ? arg.trim() : 'USD';
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(n);
  },
  // percent | percent:1  → 0.42 → "42%" (value is a 0..1 ratio)
  percent: (v, arg, locale) => {
    const n = asNumber(v);
    if (n === undefined) return baseString(v);
    const digits = arg !== undefined ? Number(arg) : 0;
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: Number.isNaN(digits) ? 0 : digits,
      maximumFractionDigits: Number.isNaN(digits) ? 0 : digits,
    }).format(n);
  },
  // date | date:long | date:iso  → date-only. Intentionally tz-naive
  // (ADR-0053): a `Field.date` is a calendar day with no zone, so rendering
  // never applies a reference timezone — that would shift the day.
  date: (v, arg, locale) => {
    const d = asDate(v);
    if (!d) return baseString(v);
    if (arg === 'iso') return d.toISOString().slice(0, 10);
    const style = arg === 'long' ? 'long' : arg === 'medium' ? 'medium' : 'short';
    return new Intl.DateTimeFormat(locale, { dateStyle: style as 'short' | 'medium' | 'long' }).format(d);
  },
  // datetime | datetime:long | datetime:iso. A `datetime` is a UTC instant;
  // when a reference `timeZone` is supplied (ADR-0053 Phase 2) the wall-clock
  // styles render in that zone. `iso` stays UTC (machine-readable, unambiguous).
  datetime: (v, arg, locale, timeZone) => {
    const d = asDate(v);
    if (!d) return baseString(v);
    if (arg === 'iso') return d.toISOString();
    const style = arg === 'long' ? 'long' : arg === 'medium' ? 'medium' : 'short';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: style as 'short' | 'medium' | 'long',
      timeStyle: style as 'short' | 'medium' | 'long',
      ...(timeZone ? { timeZone } : {}),
    }).format(d);
  },
  // truncate:80  → cut with an ellipsis
  truncate: (v, arg) => {
    const s = baseString(v);
    const len = arg !== undefined ? Number(arg) : 80;
    if (Number.isNaN(len) || s.length <= len) return s;
    return s.slice(0, Math.max(0, len - 1)) + '…';
  },
  // default:'N/A'  → fallback when the value is null/undefined/empty
  default: (v, arg) => {
    const s = baseString(v);
    return s === '' ? (arg ?? '') : s;
  },
  json: (v) => {
    try { return JSON.stringify(v); } catch { return String(v); }
  },
};

/** Public list of whitelisted template formatters (for introspection/docs). */
export const TEMPLATE_FORMATTERS: string[] = Object.keys(FORMATTERS);

// ───────────────────────── hole grammar both dialects share ───────────────
//
// The rules about a hole's formatter part, judged by this one function for
// both template dialects: this engine's (in-app slots, ADR-0032 §3) and the
// mail renderer's (`mail-hole-grammar.ts`, read by `@objectstack/plugin-email`
// and by `@objectstack/lint`'s email template rule). Each dialect parses its
// own path; what follows the first `|` is split into a name and an argument
// by `splitHoleFormatter` and judged here, once, so the two dialects accept
// exactly the same formatter parts.
//
// - A formatter is a name of one word, optionally followed by `:` and its
//   argument. The mail renderer used to print any other text after the `|`
//   (`{{ due | date-long }}`, `{{ x | two words }}`) to the reader as
//   written, while this engine refused it.
// - One formatter per hole. A second `|` used to be read as part of the first
//   formatter's argument, so `{{ x | default:0 | number:2 }}` rendered the
//   text `0 | number:2` — formatter syntax printed to the reader — and
//   `{{ x | upper | lower }}` was left on the page as written.
// - The `currency` argument is a literal ISO 4217 code in capitals. A bare
//   path (`currency:currency_code`) is not read: `Intl` refused it and the
//   formatter used to substitute USD, so the amount printed in a currency
//   nobody wrote.
// - A mail template may instead read the code from the send's data, marked
//   with `@` (`currency:@currency_code`, `CURRENCY_ARGUMENT_RULE`). The mark
//   keeps the two forms apart for every input: a literal code never starts
//   with `@`, and no path does. The in-app dialect refuses the marked form by
//   name: its doors judge the roots of a hole's path against the slot's
//   closed scope and do not read an argument, so a path there would reach
//   the page unjudged.

/** The rule a refused hole breaks. */
export type TemplateHoleGrammarRule =
  | 'one-formatter'
  | 'formatter-shape'
  | 'known-formatter'
  | 'currency-code-literal'
  | 'currency-code-path-mail-only'
  | 'currency-code-path-undeclared';

/**
 * The `currency` argument rule, in the one sentence the mail renderer, the
 * `email-template-hole-grammar` authoring rule and the spec's
 * `email_template` face descriptions all quote.
 */
export const CURRENCY_ARGUMENT_RULE =
  'A `currency` argument is either a literal ISO 4217 code in three capital letters (`currency:EUR`) or, '
  + 'in a mail template only, `@` followed by a path into the send\'s data whose value is such a code '
  + '(`currency:@currency_code`).';

/** A hole the shared grammar refuses, with the sentence an author is shown. */
export interface TemplateHoleGrammarRefusal {
  rule: TemplateHoleGrammarRule;
  /** Names the hole as written, the rule it breaks and the remedy. */
  message: string;
}

/** A formatter name as a hole writes one; any other text after the `|` names no formatter. */
const WORD_RE = /^\w+$/;

/** A hole's formatter part, split into the formatter name and its argument. */
export interface HoleFormatterParts {
  /** The text before the first `:`, trimmed: the formatter name when the hole is well formed. */
  name: string;
  /** The text after the first `:`, trimmed, one enclosing quote mark removed at each end; absent when no `:` was written. */
  arg?: string;
}

/**
 * Split a hole's formatter part (the text after its first `|`, trimmed) into
 * a name and an argument — the one tokenizer both template dialects read, so
 * a formatter part one of them accepts is never one the other refuses or
 * prints. `currency :EUR` is `currency` with `EUR`, and `default:'n/a'` and
 * `default:"n/a"` both give `n/a`. The name is judged by
 * {@link judgeHoleFormatter}.
 */
export function splitHoleFormatter(formatterPart: string): HoleFormatterParts {
  const colon = formatterPart.indexOf(':');
  if (colon === -1) return { name: formatterPart };
  return {
    name: formatterPart.slice(0, colon).trim(),
    arg: formatterPart.slice(colon + 1).trim().replace(/^['"]|['"]$/g, ''),
  };
}

/** An ISO 4217 alphabetic code: three capital letters, the form `Intl` formats with. */
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

function isCurrencyCode(arg: string): boolean {
  return CURRENCY_CODE_RE.test(arg.trim());
}

/** The dialect a hole is judged in: the in-app template engine's (the default) or a mail template's. */
export type TemplateHoleDialect = 'in-app' | 'mail';

function currencyArgumentRefusal(hole: string, arg: string, dialect: TemplateHoleDialect = 'in-app'): string {
  if (dialect === 'mail') {
    return (
      `the hole ${hole} gives the currency formatter the argument '${arg.trim()}', which is neither an ISO 4217 `
      + 'currency code nor a marked path: a bare argument is never read as a path to a value. '
      + `${CURRENCY_ARGUMENT_RULE} Write the code itself, or mark the path that holds it with \`@\`.`
    );
  }
  return (
    `the hole ${hole} gives the currency formatter the argument '${arg.trim()}', which is not an ISO 4217 `
    + 'currency code: the argument is a literal code in three capital letters (`currency:EUR`), and it is '
    + 'never read as a path to a value. Write the code itself, or format the amount in the caller that '
    + 'supplies the data and pass the formatted text as its own variable.'
  );
}

/** The `@` mark, then a dotted path of word characters with no empty segment. */
const CURRENCY_CODE_PATH_RE = /^@(\w+(?:\.\w+)*)$/;

/**
 * The path a `currency` hole reads its code from (`currency:@currency_code` →
 * `currency_code`), or `undefined` when the formatter part is not that form.
 * The form is read from the text as written: an argument in quotes
 * (`currency:'@x'`) is not a path, and neither is a mark with no path after
 * it, a space after the mark, or an empty segment (`@a..b`).
 *
 * @param formatterPart the text after the hole's first `|`, trimmed
 */
export function currencyCodePath(formatterPart: string): string | undefined {
  const colon = formatterPart.indexOf(':');
  if (colon === -1 || formatterPart.slice(0, colon).trim() !== 'currency') return undefined;
  return CURRENCY_CODE_PATH_RE.exec(formatterPart.slice(colon + 1).trim())?.[1];
}

function describeCodeValue(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  try {
    return `${typeof value} ${JSON.stringify(value)}`;
  } catch {
    return typeof value;
  }
}

/**
 * Why the value a `currency:@path` hole read from the send's data cannot be
 * the currency it formats in, or `null` when it is an ISO 4217 code in three
 * capital letters, exactly as stored. A missing or null value, a lowercase
 * code (`eur`), a padded one or any other value is refused: the amount is then
 * formatted in no currency at all, never in a default one.
 *
 * @param hole  the hole as written, braces included
 * @param path  the path after the `@` mark
 * @param value what the path resolved to in the send's data
 */
export function currencyCodeValueRefusal(hole: string, path: string, value: unknown): string | null {
  if (typeof value === 'string' && CURRENCY_CODE_RE.test(value)) return null;
  return (
    `the hole ${hole} reads the currency code from \`${path}\`, whose value in this send's data is `
    + `${describeCodeValue(value)}, not an ISO 4217 code in three capital letters, so the amount is not `
    + `formatted in any currency. ${CURRENCY_ARGUMENT_RULE} Supply the code in capitals (\`EUR\`) under `
    + `\`${path}\`.`
  );
}

/**
 * True when the formatter part (the text after a hole's first `|`) carries a
 * second `|` outside a quoted argument — a second formatter. A `|` inside a
 * closed quoted argument (`default:'a | b'`) is the argument's own text.
 */
function chainsASecondFormatter(formatterPart: string): boolean {
  const colon = formatterPart.indexOf(':');
  if (colon === -1) return formatterPart.includes('|');
  if (formatterPart.slice(0, colon).includes('|')) return true;
  const arg = formatterPart.slice(colon + 1).trim();
  const quote = arg[0];
  if (quote === "'" || quote === '"') {
    const close = arg.indexOf(quote, 1);
    if (close !== -1) return arg.slice(close + 1).includes('|');
  }
  return arg.includes('|');
}

/**
 * Judge one hole's formatter against the grammar both template dialects share.
 *
 * The name ({@link splitHoleFormatter}) must be one word (`formatter-shape`):
 * the mail renderer used to print `{{ due | date-long }}` to the reader as
 * written; the in-app dialect refuses such a hole in its own parse and keeps
 * its own wording. A formatter the hole names must be one {@link TEMPLATE_FORMATTERS} holds
 * (`known-formatter`). The mail renderer used to print the raw value for any
 * other name, so `{{ amount | curency:EUR }}` sent `1234.5` where money was
 * meant; the in-app dialect refuses such a hole in its own parse, before this
 * rule's sentence is read, and keeps its own wording.
 *
 * @param hole          the hole as written, braces included — the refusal names it
 * @param formatterPart the text after the hole's first `|`, trimmed
 * @param formatter     the formatter name the dialect parsed
 * @param arg           the argument the dialect parsed, quotes removed; `undefined` when none was written
 * @param dialect       `'mail'` admits the `currency:@path` form ({@link CURRENCY_ARGUMENT_RULE}); the
 *                      in-app dialect (the default) refuses it by name
 * @returns the refusal, or `null` when the hole is within the grammar
 */
export function judgeHoleFormatter(
  hole: string,
  formatterPart: string,
  formatter: string,
  arg: string | undefined,
  dialect: TemplateHoleDialect = 'in-app',
): TemplateHoleGrammarRefusal | null {
  if (chainsASecondFormatter(formatterPart)) {
    return {
      rule: 'one-formatter',
      message:
        `the hole ${hole} chains a second formatter: a hole takes one formatter, `
        + '`{{ path | formatter[:arg] }}`, and the text after the second `|` is never applied. Keep one '
        + 'formatter here, and do any further formatting or branching in the caller that supplies the data, '
        + 'passing the finished value as its own variable.',
    };
  }
  if (!WORD_RE.test(formatter)) {
    return {
      rule: 'formatter-shape',
      message:
        `the hole ${hole} ${formatter === '' ? 'writes no formatter name after the `|`' : `writes '${formatter}' where the formatter name goes`}, `
        + 'so it would never format the value: a formatter is one word, optionally followed by `:` and its '
        + `argument, \`{{ path | formatter[:arg] }}\`. Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}. Write one `
        + 'of them, or format the value in the caller that supplies the data and pass the finished text as its own '
        + 'variable.',
    };
  }
  if (!TEMPLATE_FORMATTERS.includes(formatter)) {
    return {
      rule: 'known-formatter',
      message:
        `the hole ${hole} names the formatter '${formatter}', which is not a template formatter, so it would `
        + `never format the value. Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}. Correct the name, or `
        + 'format the value in the caller that supplies the data and pass the finished text as its own variable.',
    };
  }
  if (formatter === 'currency' && arg !== undefined && !isCurrencyCode(arg)) {
    if (currencyCodePath(formatterPart) === undefined) {
      return { rule: 'currency-code-literal', message: currencyArgumentRefusal(hole, arg, dialect) };
    }
    if (dialect !== 'mail') {
      return {
        rule: 'currency-code-path-mail-only',
        message:
          `the hole ${hole} reads its currency code from the data (\`currency:@path\`), a form only a mail `
          + 'template reads: here the `currency` argument is a literal ISO 4217 code in three capital letters '
          + '(`currency:EUR`), because the doors that judge this text check a hole\'s path against the roots '
          + 'it binds and never read an argument. Write the code itself, or format the amount in the caller '
          + 'that supplies the data and pass the formatted text as its own variable.',
      };
    }
  }
  return null;
}

/**
 * Apply a whitelisted formatter to a value, the single source of truth for
 * value→string semantics across dialects. Returns `undefined` for an unknown
 * formatter name so callers can decide how to handle it (the template engine
 * rejects at compile time; other consumers may pass the raw value through).
 *
 * Exported so renderers that don't run the full CEL template engine — notably
 * the email pipeline (ADR-0053 Phase 2 slice 4) — format dates, money, etc.
 * identically to in-app templates, including reference-timezone `datetime`.
 */
export function formatValue(
  name: string,
  value: unknown,
  arg: string | undefined,
  opts: { locale?: string; timeZone?: string } = {},
): string | undefined {
  const fmt = FORMATTERS[name];
  if (!fmt) return undefined;
  return fmt(value, arg, opts.locale ?? 'en-US', opts.timeZone);
}

function baseString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  const normalized = path.replace(/\[(\w+)\]/g, '.$1');
  const segments = normalized.split('.').filter(Boolean);
  let cursor: unknown = scope;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

interface ParsedHole {
  path: string;
  filter?: { name: string; arg?: string };
  /** Set when the hole is a path and formatter the shared grammar refuses ({@link judgeHoleFormatter}). */
  refusal?: TemplateHoleGrammarRefusal;
}

/**
 * A hole's path: identifier characters, `.` segments and `[i]` indices.
 *
 * `$` is an identifier character here (#22110): a host scope may name a
 * variable with it — a flow's engine-set `$error` (the fault a `try_catch` or
 * fault edge caught), `$runId`, `$flowLabel` — and since protocol 18 a flow's
 * text slots render through this engine, so `{{ $error.message }}` is how a
 * fault-handler notification names the error. Without it the hole failed to
 * compile and the variable had no template spelling at all. A `$` name that no
 * scope binds resolves to nothing, like every other unknown path.
 */
const PATH_ONLY_RE = /^[\w$.[\]]+$/;

/**
 * Parse a hole's inner content into a path + optional single formatter.
 * Returns null when the inner content is not a valid path[+formatter] form
 * (e.g. arbitrary CEL was written into a hole — rejected, ADR-0032 §3).
 */
function parseHole(inner: string): ParsedHole | null {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const path = inner.trim();
    return PATH_ONLY_RE.test(path) ? { path } : null;
  }
  const path = inner.slice(0, pipe).trim();
  if (!PATH_ONLY_RE.test(path)) return null;
  const filterPart = inner.slice(pipe + 1).trim();
  // `name` or `name:arg` or `name:'arg'`
  const { name, arg } = splitHoleFormatter(filterPart);
  const refusal = judgeHoleFormatter(`{{${inner}}}`, filterPart, name, arg);
  // A chained hole is refused by the one-formatter rule before its first
  // formatter's name is looked up (`upper | lower` names no formatter).
  if (refusal?.rule === 'one-formatter') return { path, refusal };
  if (!FORMATTERS[name]) return null;
  return { path, filter: { name, arg }, ...(refusal ? { refusal } : {}) };
}

function compileTemplate(source: string): EvalResult<ParsedHole[]> {
  const open = (source.match(/\{\{/g) ?? []).length;
  const close = (source.match(/\}\}/g) ?? []).length;
  if (open !== close) {
    return { ok: false, error: { kind: 'parse', message: 'template has unbalanced {{ }} delimiters' } };
  }
  const holes: ParsedHole[] = [];
  let m: RegExpExecArray | null;
  HOLE_RE.lastIndex = 0;
  while ((m = HOLE_RE.exec(source)) !== null) {
    const parsed = parseHole(m[1]);
    if (!parsed) {
      return {
        ok: false,
        error: {
          kind: 'parse',
          message:
            `invalid template hole \`{{ ${m[1]} }}\` — holes are a field path with an optional ` +
            `formatter (\`{{ record.amount | currency }}\`), not arbitrary logic. ` +
            `Move logic into a CEL field. Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`,
        },
      };
    }
    if (parsed.refusal) {
      return { ok: false, error: { kind: 'parse', message: `invalid template hole: ${parsed.refusal.message}` } };
    }
    holes.push(parsed);
  }
  return { ok: true, value: holes };
}

export const templateEngine: DialectEngine = {
  dialect: 'template',

  compile(source: string): EvalResult<unknown> {
    return compileTemplate(source);
  },

  evaluate<T = unknown>(expr: Expression, ctx: EvalContext): EvalResult<T> {
    if (expr.dialect !== 'template') {
      return {
        ok: false,
        error: { kind: 'dialect', message: `templateEngine cannot evaluate dialect '${expr.dialect}'` },
      };
    }
    if (typeof expr.source !== 'string') {
      return { ok: false, error: { kind: 'parse', message: 'template Expression.source required' } };
    }
    const check = compileTemplate(expr.source);
    if (!check.ok) return check as EvalResult<T>;

    const scope = buildScope(ctx);
    // Formatter locale: the context's reserved `locale` channel only, never a
    // root — a root named `locale` is a value like any other (#26232).
    const locale = typeof ctx.locale === 'string' && ctx.locale !== '' ? ctx.locale : 'en-US';
    // Reference timezone for `datetime` rendering (ADR-0053 Phase 2). Unset →
    // Intl uses the runtime zone, matching pre-Phase-2 behavior.
    const timeZone = typeof ctx.timezone === 'string' ? ctx.timezone : undefined;

    const out = expr.source.replace(HOLE_RE, (_match, inner) => {
      const parsed = parseHole(String(inner));
      if (!parsed) return _match; // compile already validated; defensive
      const value = resolvePath(scope, parsed.path);
      if (parsed.filter) {
        return FORMATTERS[parsed.filter.name](value, parsed.filter.arg, locale, timeZone);
      }
      return baseString(value);
    });
    return { ok: true, value: out as unknown as T };
  },
};
