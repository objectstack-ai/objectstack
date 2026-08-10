// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime resolution of filter placeholders — the server-side half of the
 * `{token}` contract that `@objectstack/spec` declares (framework#3582).
 *
 * `date-macros.zod.ts` and `context-tokens.zod.ts` freeze the *vocabulary*;
 * `@objectstack/lint`'s `validate-filter-tokens` rejects a token outside it at
 * authoring time. Neither one ever substituted a value: every server-side
 * consumer handed the literal `'{current_year_start}'` to the database, where
 * it compared as a string and matched nothing. The failure was invisible —
 * an empty widget, an unfiltered list — so apps worked around it by computing
 * dates at module load, freezing "this year" into the built artifact.
 *
 * This module is the missing evaluator. It walks a filter tree and replaces
 * every fully-wrapped placeholder with a concrete value:
 *
 *     { close_date: { $gte: '{current_year_start}' } }
 *       → { close_date: { $gte: '2026-01-01' } }
 *     { owner: '{current_user_id}' }
 *       → { owner: 'usr_7f3a…' }
 *
 * # Output form: ISO strings, not driver-native values
 *
 * Date tokens resolve to `YYYY-MM-DD` (or a full ISO timestamp for the
 * sub-day tokens `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`), exactly the
 * form the spec's module doc promises the data engine sees. Translating that
 * to a column's on-disk form is the DRIVER's job and already exists —
 * `SqlDriver.coerceFilterValue` / `temporalFilterValue` turn an ISO comparand
 * into SQLite epoch-ms or leave it alone on native-timestamp dialects. Emitting
 * a driver-native value here would fork that convention into a second source of
 * truth and break the moment a query crosses datasources.
 *
 * # Period `_end` is the last calendar DAY, not the last instant
 *
 * `{current_year_end}` is `2026-12-31`, per the spec's own
 * `DATE_MACRO_DESCRIPTIONS` ("Dec 31 of this year"). On a `datetime` column
 * that means `<= {current_year_end}` excludes everything after midnight on the
 * 31st — the classic half-open-range trap. Authors filtering a timestamp want
 * `< {next_year_start}`. This is a documented property of the vocabulary, not
 * something the resolver may quietly "fix": silently widening a bound would
 * make the same token mean different things on different column types.
 *
 * # An unknown token throws
 *
 * A value that is entirely `{something}` is a placeholder by construction — no
 * author means the literal six characters `{foo}`. Passing an unrecognised one
 * through is precisely the silent-zero bug this module exists to end, so it is
 * a hard error carrying the near-miss suggestion (`{current_user}` →
 * `{current_user_id}`). Values that merely CONTAIN braces are left untouched.
 *
 * "Entirely `{something}`" means ANY character between the braces (#5586).
 * Until then the recognition grammar was the token-NAME grammar
 * (`[a-zA-Z0-9_]+`), so a placeholder carrying a non-word character —
 * `{TODAY()}`, `{current-user-id}`, `{30 days ago}`, `{user.id}` — was not
 * recognised as a token at all and fell straight through to the literal
 * comparison this module exists to abolish. The failure was inverted against
 * the author: `{TODAY}` threw (diagnostic working), `{TODAY()}` returned rows
 * (diagnostic bypassed) — and the parenthesised, kebab-case and
 * natural-language spellings are exactly what an author migrating from another
 * system's macro syntax reaches for first. See `FILTER_TOKEN_WRAPPED_RE` in
 * `@objectstack/spec`.
 */

import {
  classifyFilterToken,
  parseDateMacroParam,
  type DateMacroUnit,
} from '@objectstack/spec/data';
import { calendarPartsInTzOrUtc } from './datetime.js';

/**
 * The slice of an execution context the resolver reads. Structural on purpose —
 * see {@link filterTokenContextFrom}.
 */
export interface ExecutionContextLike {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly timezone?: string;
}

/**
 * The request-scoped values a placeholder can resolve against.
 *
 * `now` is captured ONCE per resolve call so every token in one filter shares
 * an instant — otherwise a `$gte {current_month_start}` / `$lt
 * {next_month_start}` pair evaluated microseconds apart could straddle a
 * month boundary and silently drop a row.
 */
export interface FilterTokenResolutionContext {
  /** Reference instant. Defaults to `new Date()` at call time. */
  now?: Date;
  /** IANA reference timezone for calendar boundaries. Defaults to UTC. */
  timezone?: string;
  /** Resolves `{current_user_id}`. */
  userId?: string;
  /** Resolves `{current_org_id}`. */
  orgId?: string;
}

/**
 * Raised when a filter carries a placeholder outside the vocabulary.
 *
 * Carries `status`/`code` so the REST layer's generic 4xx passthrough maps it
 * to a **400 with a fixable message** rather than a 500: the caller's filter is
 * malformed, the server is fine. (Same convention plugin-sharing uses for its
 * record-scope denial — no runtime dependency in either direction.)
 */
export class UnknownFilterTokenError extends Error {
  readonly token: string;
  readonly suggestion?: string;
  readonly status = 400;
  readonly code = 'FILTER_TOKEN_UNKNOWN';

  constructor(token: string, suggestion?: string) {
    super(
      `Unresolvable filter placeholder "{${token}}". ` +
      (suggestion
        ? `Did you mean "{${suggestion}}"? `
        : 'Resolvable placeholders are the context tokens ({current_user_id}, ' +
          '{current_org_id}) and the date macros ({today}, {current_quarter_start}, ' +
          '{30_days_ago}, …). ') +
      'Sending it to the data engine verbatim would compare it as a literal ' +
      'string and match nothing, which is indistinguishable from an empty result.',
    );
    this.name = 'UnknownFilterTokenError';
    this.token = token;
    this.suggestion = suggestion;
  }
}

/**
 * Raised when a token IS in the vocabulary but the request carries no value
 * for it — an unauthenticated caller filtering on `{current_user_id}`.
 *
 * Distinct from {@link UnknownFilterTokenError} because the fix is different:
 * the metadata is correct, the context is not. Never silently resolves to
 * `null`/`undefined`, which on most drivers degrades to `IS NULL` and would
 * quietly hand back rows the filter was written to exclude.
 */
export class UnresolvedFilterTokenError extends Error {
  readonly token: string;
  /** 400, not 500 — see {@link UnknownFilterTokenError}. */
  readonly status = 400;
  readonly code = 'FILTER_TOKEN_UNRESOLVED';

  constructor(token: string, detail: string) {
    super(`Filter placeholder "{${token}}" cannot be resolved: ${detail}`);
    this.name = 'UnresolvedFilterTokenError';
    this.token = token;
  }
}

/** `YYYY-MM-DD` for a calendar day, zero-padded. */
function ymd(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

/**
 * Calendar arithmetic is done on a UTC "proxy" date built from the reference
 * timezone's calendar parts. Working in UTC keeps the math free of DST jumps
 * (a local-midnight `Date` can shift by an hour when `setMonth` crosses a
 * transition); the zone only decides WHICH calendar day "now" is, which
 * {@link calendarPartsInTzOrUtc} answers from the platform tz database.
 */
function proxyDay(now: Date, timezone?: string): Date {
  const { year, month, day } = calendarPartsInTzOrUtc(now, timezone);
  return new Date(Date.UTC(year, month - 1, day));
}

const asYmd = (d: Date): string => ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

type PeriodKind = 'week' | 'month' | 'quarter' | 'year';

/** Monday-based week start — matches the spec's "Monday 00:00 of this week". */
function startOfPeriod(kind: PeriodKind, d: Date): Date {
  const r = new Date(d.getTime());
  switch (kind) {
    case 'week': {
      const dow = (r.getUTCDay() + 6) % 7; // 0 = Monday
      r.setUTCDate(r.getUTCDate() - dow);
      return r;
    }
    case 'month':
      return new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), 1));
    case 'quarter':
      return new Date(Date.UTC(r.getUTCFullYear(), Math.floor(r.getUTCMonth() / 3) * 3, 1));
    case 'year':
      return new Date(Date.UTC(r.getUTCFullYear(), 0, 1));
  }
}

/** Days in the given (0-based) month of `year`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Shift `d` by `n` months, CLAMPING the day to the target month's length.
 *
 * Bare `setUTCMonth(m - 1)` on the 31st rolls FORWARD into the following month
 * (Mar 31 minus one month = "Feb 31" = Mar 3), which would make
 * `{1_month_ago}` land after `{today}` on five days of the year. Clamping to
 * Feb 28 is what every calendar library does and the only answer an author
 * would call correct.
 */
function addMonthsClamped(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(
    targetYear, targetMonth, day,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
  ));
}

/** Shift `d` by `n` whole periods of `kind` (negative shifts backwards). */
function addPeriods(kind: PeriodKind, d: Date, n: number): Date {
  switch (kind) {
    case 'week': {
      const r = new Date(d.getTime());
      r.setUTCDate(r.getUTCDate() + n * 7);
      return r;
    }
    case 'month': return addMonthsClamped(d, n);
    case 'quarter': return addMonthsClamped(d, n * 3);
    case 'year': return addMonthsClamped(d, n * 12);
  }
}

/** Shift `d` by `n` units of the parameterised grammar. */
function addUnits(unit: DateMacroUnit, d: Date, n: number): Date {
  const r = new Date(d.getTime());
  switch (unit) {
    case 'minute': r.setUTCMinutes(r.getUTCMinutes() + n); return r;
    case 'hour': r.setUTCHours(r.getUTCHours() + n); return r;
    case 'day': r.setUTCDate(r.getUTCDate() + n); return r;
    case 'week': r.setUTCDate(r.getUTCDate() + n * 7); return r;
    // Month/year steps clamp rather than overflow — see addMonthsClamped.
    case 'month': return addMonthsClamped(d, n);
    case 'year': return addMonthsClamped(d, n * 12);
  }
}

/**
 * `current|last|next` × `week|month|quarter|year` × `start|end`, plus the bare
 * `week_start`-style aliases (which mean `current_`). Returns `undefined` when
 * the token is not a period token.
 */
const PERIOD_RE = /^(?:(current|last|next)_)?(week|month|quarter|year)_(start|end)$/;

function resolvePeriodToken(token: string, today: Date): string | undefined {
  const m = PERIOD_RE.exec(token);
  if (!m) return undefined;
  const rel = (m[1] ?? 'current') as 'current' | 'last' | 'next';
  const kind = m[2] as PeriodKind;
  const bound = m[3] as 'start' | 'end';
  const offset = rel === 'last' ? -1 : rel === 'next' ? 1 : 0;

  // Normalize to the period's own start BEFORE stepping. Day 1 of a
  // month/quarter/year (and a Monday) shifts exactly — no month-length clamping
  // is involved at all — so the answer never depends on the clamp policy, and
  // the arithmetic reads the same for every `kind`.
  const periodStart = startOfPeriod(kind, addPeriods(kind, startOfPeriod(kind, today), offset));
  if (bound === 'start') return asYmd(periodStart);
  // `_end` = the last calendar DAY of the period: the day before the next
  // period begins. See the module doc on half-open ranges.
  const next = addPeriods(kind, periodStart, 1);
  next.setUTCDate(next.getUTCDate() - 1);
  return asYmd(next);
}

/**
 * Resolve one token NAME (the bit inside the braces) to its concrete value.
 * Throws {@link UnresolvedFilterTokenError} for a vocabulary token the request
 * carries no value for. Returns `undefined` only when the token is outside the
 * vocabulary — callers turn that into {@link UnknownFilterTokenError}.
 */
export function resolveFilterToken(
  token: string,
  ctx: FilterTokenResolutionContext = {},
): unknown {
  const now = ctx.now ?? new Date();

  // ── Context tokens ────────────────────────────────────────────────────
  if (token === 'current_user_id') {
    if (!ctx.userId) {
      throw new UnresolvedFilterTokenError(
        token,
        'the request has no authenticated user. A filter scoped to the signed-in ' +
        'user cannot run for an anonymous or system caller — gate the surface on ' +
        'authentication, or drop the token from the filter.',
      );
    }
    return ctx.userId;
  }
  if (token === 'current_org_id') {
    if (!ctx.orgId) {
      throw new UnresolvedFilterTokenError(
        token,
        'the request carries no active organization (ExecutionContext.tenantId is ' +
        'unset). Set the active org on the request, or drop the token from the filter.',
      );
    }
    return ctx.orgId;
  }

  // ── Date macros ───────────────────────────────────────────────────────
  const today = proxyDay(now, ctx.timezone);

  switch (token) {
    case 'now': return now.toISOString();
    case 'today': return asYmd(today);
    case 'yesterday': return asYmd(addUnits('day', today, -1));
    case 'tomorrow': return asYmd(addUnits('day', today, 1));
  }

  const period = resolvePeriodToken(token, today);
  if (period !== undefined) return period;

  const param = parseDateMacroParam(token);
  if (param) {
    const sign = param.direction === 'ago' ? -1 : 1;
    // Sub-day units are instants — they must keep their time-of-day, so they
    // shift `now` and render as a full ISO timestamp. Day-and-coarser units are
    // calendar quantities and render as `YYYY-MM-DD` off the reference day.
    if (param.unit === 'minute' || param.unit === 'hour') {
      return addUnits(param.unit, now, sign * param.n).toISOString();
    }
    return asYmd(addUnits(param.unit, today, sign * param.n));
  }

  return undefined;
}

/**
 * Does this tree contain any fully-wrapped placeholder at all?
 *
 * A read-only pre-pass so the overwhelmingly common case — an internal query
 * whose filter is entirely literal — costs one allocation-free walk instead of
 * a full structural copy. This runs on every server-side read, so "no
 * placeholders" must be close to free.
 */
function hasFilterToken(node: unknown): boolean {
  if (typeof node === 'string') return classifyFilterToken(node) !== null;
  if (Array.isArray(node)) return node.some(hasFilterToken);
  if (node && typeof node === 'object' && !(node instanceof Date)) {
    return Object.values(node as Record<string, unknown>).some(hasFilterToken);
  }
  return false;
}

/**
 * Deep-replace every fully-wrapped placeholder in `filter` with its resolved
 * value, returning a NEW tree (the caller's metadata is never mutated — a view
 * or dataset definition is shared across requests, so resolving in place would
 * bake one request's user id, and one day's dates, into every later render).
 *
 * Returns the input unchanged, by reference, when it holds no placeholders.
 */
export function resolveFilterTokens<T>(
  filter: T,
  ctx: FilterTokenResolutionContext = {},
): T {
  if (filter == null) return filter;
  if (!hasFilterToken(filter)) return filter;

  // One instant for the whole tree (see FilterTokenResolutionContext.now).
  const pinned: FilterTokenResolutionContext = { ...ctx, now: ctx.now ?? new Date() };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const cls = classifyFilterToken(node);
      if (!cls) return node;
      if (cls.kind === 'unknown') throw new UnknownFilterTokenError(cls.token, cls.suggestion);
      const resolved = resolveFilterToken(cls.token, pinned);
      // `classifyFilterToken` already vouched for the token, so `undefined`
      // here would mean the spec vocabulary and this resolver have drifted
      // apart — surface it loudly rather than silently emitting `undefined`.
      if (resolved === undefined) throw new UnknownFilterTokenError(cls.token);
      return resolved;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      // Dates and other class instances are comparands, not filter structure.
      if (node instanceof Date) return node;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  return walk(filter) as T;
}

/**
 * Convenience bridge from an execution context to the resolver's inputs.
 * `{current_org_id}` reads `tenantId` — the active organization IS the tenant
 * on the read path (same value the RLS compiler binds to
 * `current_user.organization_id`).
 *
 * Typed structurally, not as `ExecutionContext`, so both the parsed context
 * (`ExecutionContextParsed`, defaults applied) and the pre-parse
 * `ExecutionContext` a caller holds mid-pipeline satisfy it. The three fields
 * read here are optional in both.
 */
export function filterTokenContextFrom(
  execCtx: ExecutionContextLike | undefined,
  now?: Date,
): FilterTokenResolutionContext {
  return {
    now,
    timezone: execCtx?.timezone,
    userId: execCtx?.userId,
    orgId: execCtx?.tenantId,
  };
}
