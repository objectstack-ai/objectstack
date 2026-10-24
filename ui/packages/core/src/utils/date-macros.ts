/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve well-known relative-date placeholders inside a filter object so
 * both server-side aggregation and client-side `find()` calls see a real
 * ISO date string instead of a literal `{current_quarter_start}`.
 *
 * Supported tokens (case-sensitive, both `{token}` and `${token}` forms):
 *   - today / yesterday / tomorrow
 *   - now                        → current timestamp       (full ISO)
 *   - current_week_start / current_week_end
 *   - current_month_start / current_month_end
 *   - current_quarter_start / current_quarter_end
 *   - current_year_start / current_year_end
 *   - week_start / week_end / month_start / month_end /
 *     quarter_start / quarter_end / year_start / year_end
 *       (aliases for the matching `current_*` tokens)
 *   - last_week_start / last_week_end
 *   - last_month_start / last_month_end
 *   - last_quarter_start / last_quarter_end
 *   - last_year_start / last_year_end
 *   - next_week_start / next_month_start / next_quarter_start / next_year_start
 *
 * Parameterised tokens (match `N` as any positive integer):
 *   - {N_minutes_ago} / {N_minutes_from_now}       (returns full ISO timestamp)
 *   - {N_hours_ago}   / {N_hours_from_now}         (returns full ISO timestamp)
 *   - {N_days_ago}    / {N_days_from_now}
 *   - {N_weeks_ago}   / {N_weeks_from_now}
 *   - {N_months_ago}  / {N_months_from_now}
 *   - {N_years_ago}   / {N_years_from_now}
 *
 * The canonical grammar is also published as part of the platform contract at
 * `@objectstack/spec` → `DATE_MACRO_TOKENS` / `DATE_MACRO_PARAM_RE`. Keep this
 * file in sync with the spec; the duplication is temporary until the next
 * coordinated `@objectstack/spec` release.
 *
 * Walks any plain-object / array structure recursively. Non-string values
 * (and unknown tokens) are passed through untouched.
 */
export function resolveDateMacros<T = any>(filter: T, now: Date = new Date()): T {
  if (filter == null) return filter;

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const isoDate = (d: Date) => {
    const x = startOfDay(d);
    const yyyy = x.getFullYear();
    const mm = String(x.getMonth() + 1).padStart(2, '0');
    const dd = String(x.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const startOfWeek = (d: Date) => {
    const x = startOfDay(d);
    const day = x.getDay(); // 0=Sun, 1=Mon, ...
    const diff = (day + 6) % 7; // distance back to Monday
    x.setDate(x.getDate() - diff);
    return x;
  };
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const startOfQuarter = (d: Date) => {
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1);
  };
  const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
  const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const addDays = (d: Date, n: number) => {
    const x = startOfDay(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const endOfMonth = (d: Date) => addDays(addMonths(startOfMonth(d), 1), -1);
  const endOfWeek = (d: Date) => addDays(startOfWeek(d), 6);
  const endOfQuarter = (d: Date) => addDays(addMonths(startOfQuarter(d), 3), -1);
  const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31);

  const macros: Record<string, () => string> = {
    today: () => isoDate(now),
    yesterday: () => isoDate(addDays(now, -1)),
    tomorrow: () => isoDate(addDays(now, 1)),
    now: () => now.toISOString(),

    current_week_start: () => isoDate(startOfWeek(now)),
    current_week_end: () => isoDate(endOfWeek(now)),
    current_month_start: () => isoDate(startOfMonth(now)),
    current_month_end: () => isoDate(endOfMonth(now)),
    current_quarter_start: () => isoDate(startOfQuarter(now)),
    current_quarter_end: () => isoDate(endOfQuarter(now)),
    current_year_start: () => isoDate(startOfYear(now)),
    current_year_end: () => isoDate(endOfYear(now)),

    last_week_start: () => isoDate(addDays(startOfWeek(now), -7)),
    last_week_end: () => isoDate(addDays(startOfWeek(now), -1)),
    last_month_start: () => isoDate(addMonths(startOfMonth(now), -1)),
    last_month_end: () => isoDate(addDays(startOfMonth(now), -1)),
    last_quarter_start: () => isoDate(addMonths(startOfQuarter(now), -3)),
    last_quarter_end: () => isoDate(addDays(startOfQuarter(now), -1)),
    last_year_start: () => isoDate(new Date(now.getFullYear() - 1, 0, 1)),
    last_year_end: () => isoDate(new Date(now.getFullYear() - 1, 11, 31)),

    next_week_start: () => isoDate(addDays(startOfWeek(now), 7)),
    next_month_start: () => isoDate(addMonths(startOfMonth(now), 1)),
    next_quarter_start: () => isoDate(addMonths(startOfQuarter(now), 3)),
    next_year_start: () => isoDate(new Date(now.getFullYear() + 1, 0, 1)),
  };

  // Aliases: bare {week_start} etc. mean the current period.
  const aliases: Record<string, string> = {
    week_start: 'current_week_start',
    week_end: 'current_week_end',
    month_start: 'current_month_start',
    month_end: 'current_month_end',
    quarter_start: 'current_quarter_start',
    quarter_end: 'current_quarter_end',
    year_start: 'current_year_start',
    year_end: 'current_year_end',
  };
  for (const [from, to] of Object.entries(aliases)) {
    macros[from] = macros[to];
  }

  // Parameterised tokens: {N_days_ago}, {N_weeks_from_now}, {N_hours_ago}, ...
  const paramRe = /^(\d+)_(minutes?|hours?|days?|weeks?|months?|years?)_(ago|from_now)$/;
  const resolveParam = (tok: string): string | null => {
    const m = tok.match(paramRe);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) return null;
    const sign = m[3] === 'ago' ? -1 : 1;
    const unit = m[2].replace(/s$/, '');
    if (unit === 'minute') {
      return new Date(now.getTime() + sign * n * 60 * 1000).toISOString();
    }
    if (unit === 'hour') {
      return new Date(now.getTime() + sign * n * 60 * 60 * 1000).toISOString();
    }
    if (unit === 'day') return isoDate(addDays(now, sign * n));
    if (unit === 'week') return isoDate(addDays(now, sign * n * 7));
    if (unit === 'month') {
      const x = new Date(now.getFullYear(), now.getMonth() + sign * n, now.getDate());
      return isoDate(x);
    }
    if (unit === 'year') {
      const x = new Date(now.getFullYear() + sign * n, now.getMonth(), now.getDate());
      return isoDate(x);
    }
    return null;
  };

  const tokenRe = /\$?\{([a-zA-Z0-9_]+)\}/g;

  const walk = (value: any): any => {
    if (value == null) return value;
    if (typeof value === 'string') {
      const wholeMatch = value.match(/^\$?\{([a-zA-Z0-9_]+)\}$/);
      if (wholeMatch) {
        const tok = wholeMatch[1];
        if (macros[tok]) return macros[tok]();
        const param = resolveParam(tok);
        if (param != null) return param;
      }
      let touched = false;
      const replaced = value.replace(tokenRe, (m, tok) => {
        if (macros[tok]) { touched = true; return macros[tok](); }
        const param = resolveParam(tok);
        if (param != null) { touched = true; return param; }
        return m;
      });
      return touched ? replaced : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    // Only a PLAIN object (prototype `Object.prototype` or `null`) is walked;
    // any other object — a `Date` comparand above all — is returned as the
    // same instance rather than rebuilt from its own keys into `{}`
    // (objectui#10506).
    if (typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
      const out: Record<string, any> = {};
      for (const k of Object.keys(value)) out[k] = walk((value as any)[k]);
      return out;
    }
    return value;
  };

  return walk(filter) as T;
}
