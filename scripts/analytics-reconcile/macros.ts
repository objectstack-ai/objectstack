// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0021 Phase 2 — date-macro resolver for the reconciliation harness.
//
// In production `{today}` / `{current_quarter_start}` / `{30_days_ago}` resolve
// to concrete dates BEFORE the query runs — in the renderer (@object-ui/core
// `resolveDateMacros()`) or, since framework#3582, server-side in
// `resolveFilterTokens()` (@objectstack/core). The harness pre-resolves them
// itself for a different reason: it must hand BOTH compared paths the byte-identical
// concrete filter, so any difference in the result is a semantic disagreement
// between the paths rather than a difference in when each resolved the clock.
//
// This is also why it does NOT call `resolveFilterTokens()`: that emits ISO
// strings (the driver then coerces per column), while the harness compares raw
// stored values and wants epoch-millis directly. The resolved VALUE is arbitrary
// here — only its identity across the two paths matters.
//
// Token grammar mirrors packages/spec/src/data/date-macros.zod.ts.

import { DATE_MACRO_WRAPPED_RE, parseDateMacroParam } from '@objectstack/spec/data';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Monday-based week start (matches the spec's "Monday 00:00 of this week"). */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // 0 = Monday
  s.setDate(s.getDate() - dow);
  return s;
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfQuarter(d: Date): Date { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
function startOfYear(d: Date): Date { return new Date(d.getFullYear(), 0, 1); }

// ObjectStack `date` fields are stored as epoch-millis (the seed loader writes
// `cel`daysFromNow(n)`` as a timestamp number), so resolve macros to epoch-millis
// — a number compares correctly against the stored column, where an ISO string
// would not. The exact value is arbitrary as long as BOTH paths get the same one.
const iso = (d: Date): number => d.getTime();

type PeriodKind = 'week' | 'month' | 'quarter' | 'year';
const startOf: Record<PeriodKind, (d: Date) => Date> = {
  week: startOfWeek, month: startOfMonth, quarter: startOfQuarter, year: startOfYear,
};
function addPeriod(kind: PeriodKind, d: Date, n: number): Date {
  const r = new Date(d);
  if (kind === 'week') r.setDate(r.getDate() + n * 7);
  else if (kind === 'month') r.setMonth(r.getMonth() + n);
  else if (kind === 'quarter') r.setMonth(r.getMonth() + n * 3);
  else r.setFullYear(r.getFullYear() + n);
  return r;
}

/** Resolve a single token name (inside the braces) to an epoch-millis number, or null. */
function resolveToken(name: string, now: Date): number | null {
  switch (name) {
    case 'today': return iso(startOfDay(now));
    case 'yesterday': { const d = startOfDay(now); d.setDate(d.getDate() - 1); return iso(d); }
    case 'tomorrow': { const d = startOfDay(now); d.setDate(d.getDate() + 1); return iso(d); }
    case 'now': return now.getTime();
  }

  // current/last/next  ×  week/month/quarter/year  ×  start/end (+ bare aliases).
  const m = name.match(/^(current|last|next)?_?(week|month|quarter|year)_(start|end)$/);
  if (m) {
    const rel = (m[1] ?? 'current') as 'current' | 'last' | 'next';
    const kind = m[2] as PeriodKind;
    const bound = m[3] as 'start' | 'end';
    const offset = rel === 'last' ? -1 : rel === 'next' ? 1 : 0;
    const periodStart = startOf[kind](addPeriod(kind, now, offset));
    if (bound === 'start') return iso(periodStart);
    // end = day before the next period's start.
    const nextStart = addPeriod(kind, periodStart, 1);
    nextStart.setDate(nextStart.getDate() - 1);
    return iso(nextStart);
  }

  // Parameterised: N_<unit>_(ago|from_now).
  const p = parseDateMacroParam(name);
  if (p) {
    const d = new Date(now);
    const sign = p.direction === 'ago' ? -1 : 1;
    switch (p.unit) {
      case 'minute': d.setMinutes(d.getMinutes() + sign * p.n); break;
      case 'hour': d.setHours(d.getHours() + sign * p.n); break;
      case 'day': d.setDate(d.getDate() + sign * p.n); break;
      case 'week': d.setDate(d.getDate() + sign * p.n * 7); break;
      case 'month': d.setMonth(d.getMonth() + sign * p.n); break;
      case 'year': d.setFullYear(d.getFullYear() + sign * p.n); break;
    }
    return p.unit === 'minute' || p.unit === 'hour' ? d.getTime() : iso(startOfDay(d));
  }
  return null;
}

/** Resolve a placeholder string like `'{today}'` / `'${30_days_ago}'`, else return it unchanged. */
function resolveValue(value: unknown, now: Date): unknown {
  if (typeof value !== 'string') return value;
  const m = value.match(DATE_MACRO_WRAPPED_RE);
  if (!m) return value;
  return resolveToken(m[1], now) ?? value;
}

/**
 * Deep-clone a FilterCondition, replacing every `{date-macro}` placeholder with
 * a concrete ISO date. `now` is fixed once per call so all tokens in one filter
 * resolve against the same instant.
 */
export function resolveDateMacros<T>(filter: T, now: Date = new Date()): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return resolveValue(node, now);
  };
  return walk(filter) as T;
}
