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
  // currency | currency:EUR  → defaults to USD
  currency: (v, arg, locale) => {
    const n = asNumber(v);
    if (n === undefined) return baseString(v);
    const code = (arg && arg.trim()) || 'USD';
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(n);
    } catch {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
    }
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
}

const PATH_ONLY_RE = /^[\w.[\]]+$/;

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
  const colon = filterPart.indexOf(':');
  let name = filterPart;
  let arg: string | undefined;
  if (colon !== -1) {
    name = filterPart.slice(0, colon).trim();
    arg = filterPart.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  if (!FORMATTERS[name]) return null;
  return { path, filter: { name, arg } };
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
    const locale =
      (ctx.extra && typeof ctx.extra.locale === 'string' && ctx.extra.locale) ||
      (typeof (ctx as { locale?: string }).locale === 'string' && (ctx as { locale?: string }).locale) ||
      'en-US';
    // Reference timezone for `datetime` rendering (ADR-0053 Phase 2). Unset →
    // Intl uses the runtime zone, matching pre-Phase-2 behavior.
    const timeZone = typeof ctx.timezone === 'string' ? ctx.timezone : undefined;

    const out = expr.source.replace(HOLE_RE, (_match, inner) => {
      const parsed = parseHole(String(inner));
      if (!parsed) return _match; // compile already validated; defensive
      const value = resolvePath(scope, parsed.path);
      if (parsed.filter) {
        return FORMATTERS[parsed.filter.name](value, parsed.filter.arg, locale as string, timeZone);
      }
      return baseString(value);
    });
    return { ok: true, value: out as unknown as T };
  },
};
