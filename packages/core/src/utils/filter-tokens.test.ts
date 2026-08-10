// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  resolveFilterToken,
  resolveFilterTokens,
  filterTokenContextFrom,
  UnknownFilterTokenError,
  UnresolvedFilterTokenError,
} from './filter-tokens.js';

// A fixed instant so every expectation is deterministic: Wed 2026-07-15 18:30 UTC.
// Mid-month, mid-quarter (Q3), mid-week (Wednesday) — so week/month/quarter/year
// boundaries are all strictly inside the year and none coincide.
const NOW = new Date('2026-07-15T18:30:00.000Z');

describe('resolveFilterToken — date macros (framework#3582)', () => {
  const at = (token: string, extra = {}) => resolveFilterToken(token, { now: NOW, ...extra });

  it('resolves the instant tokens', () => {
    expect(at('today')).toBe('2026-07-15');
    expect(at('yesterday')).toBe('2026-07-14');
    expect(at('tomorrow')).toBe('2026-07-16');
    expect(at('now')).toBe('2026-07-15T18:30:00.000Z');
  });

  it('resolves current/last/next period starts', () => {
    expect(at('current_week_start')).toBe('2026-07-13'); // Monday
    expect(at('current_month_start')).toBe('2026-07-01');
    expect(at('current_quarter_start')).toBe('2026-07-01'); // Q3
    expect(at('current_year_start')).toBe('2026-01-01');

    expect(at('last_month_start')).toBe('2026-06-01');
    expect(at('last_quarter_start')).toBe('2026-04-01');
    expect(at('last_year_start')).toBe('2025-01-01');

    expect(at('next_month_start')).toBe('2026-08-01');
    expect(at('next_quarter_start')).toBe('2026-10-01');
    expect(at('next_year_start')).toBe('2027-01-01');
  });

  it('resolves period ends to the LAST CALENDAR DAY of the period', () => {
    // Documented half-open-range property: `_end` is a day, not the final
    // instant. A `datetime` column wants `< {next_*_start}` instead.
    expect(at('current_week_end')).toBe('2026-07-19'); // Sunday
    expect(at('current_month_end')).toBe('2026-07-31');
    expect(at('current_quarter_end')).toBe('2026-09-30');
    expect(at('current_year_end')).toBe('2026-12-31');
    expect(at('last_month_end')).toBe('2026-06-30');
    expect(at('last_year_end')).toBe('2025-12-31');
  });

  it('treats the bare aliases as the current period', () => {
    expect(at('week_start')).toBe(at('current_week_start'));
    expect(at('month_end')).toBe(at('current_month_end'));
    expect(at('quarter_start')).toBe(at('current_quarter_start'));
    expect(at('year_end')).toBe(at('current_year_end'));
  });

  it('resolves the parameterised grammar', () => {
    expect(at('30_days_ago')).toBe('2026-06-15');
    expect(at('1_day_ago')).toBe('2026-07-14');
    expect(at('2_weeks_ago')).toBe('2026-07-01');
    expect(at('12_months_ago')).toBe('2025-07-15');
    expect(at('1_year_ago')).toBe('2025-07-15');
    expect(at('90_days_from_now')).toBe('2026-10-13');
  });

  it('keeps sub-day units as full instants', () => {
    // A `{15_minutes_ago}` truncated to a date would silently widen the window
    // to the whole day — the exact class of bug this module exists to end.
    expect(at('15_minutes_ago')).toBe('2026-07-15T18:15:00.000Z');
    expect(at('2_hours_from_now')).toBe('2026-07-15T20:30:00.000Z');
  });

  it('anchors the calendar in the reference timezone', () => {
    // 18:30 UTC is already 2026-07-16 in Tokyo (+09:00) but still the 15th in
    // New York (-04:00). The token must follow the request's reference zone.
    expect(at('today', { timezone: 'Asia/Tokyo' })).toBe('2026-07-16');
    expect(at('today', { timezone: 'America/New_York' })).toBe('2026-07-15');
    // …and the period boundaries move with it.
    expect(at('current_week_start', { timezone: 'Asia/Tokyo' })).toBe('2026-07-13');
  });

  it('falls back to the UTC calendar for an unknown zone', () => {
    expect(at('today', { timezone: 'Mars/Olympus_Mons' })).toBe('2026-07-15');
  });

  it('returns undefined for a token outside the vocabulary', () => {
    expect(at('current_user')).toBeUndefined();
    expect(at('this_quarter_start')).toBeUndefined();
  });

  describe('end-of-month reference dates (calendar overflow)', () => {
    // The trap: naive `setUTCMonth(m - 1)` on the 31st rolls FORWARD ("Feb 31"
    // = Mar 3), so "last month" reads back as the current month and
    // `{1_month_ago}` lands AFTER today. Five days a year, silently.
    const eom = (token: string) =>
      resolveFilterToken(token, { now: new Date('2026-03-31T12:00:00.000Z') });

    it('last_month_* stays in February', () => {
      expect(eom('last_month_start')).toBe('2026-02-01');
      expect(eom('last_month_end')).toBe('2026-02-28');
    });

    it('current/next month boundaries are unaffected', () => {
      expect(eom('current_month_start')).toBe('2026-03-01');
      expect(eom('current_month_end')).toBe('2026-03-31');
      expect(eom('next_month_start')).toBe('2026-04-01');
      expect(eom('next_month_end')).toBe('2026-04-30');
    });

    it('quarter boundaries step by whole quarters', () => {
      expect(eom('current_quarter_start')).toBe('2026-01-01');
      expect(eom('last_quarter_start')).toBe('2025-10-01');
      expect(eom('last_quarter_end')).toBe('2025-12-31');
    });

    it('{1_month_ago} clamps to the last day of the shorter month', () => {
      expect(eom('1_month_ago')).toBe('2026-02-28');
      expect(eom('1_month_from_now')).toBe('2026-04-30');
    });

    it('a leap day one year out clamps rather than rolling into March', () => {
      expect(resolveFilterToken('1_year_from_now', { now: new Date('2028-02-29T00:00:00.000Z') }))
        .toBe('2029-02-28');
    });
  });
});

describe('resolveFilterToken — context tokens', () => {
  it('resolves the signed-in user and active org', () => {
    const ctx = { now: NOW, userId: 'usr_1', orgId: 'org_9' };
    expect(resolveFilterToken('current_user_id', ctx)).toBe('usr_1');
    expect(resolveFilterToken('current_org_id', ctx)).toBe('org_9');
  });

  it('throws rather than resolving to null when the request has no user', () => {
    // Resolving to null/undefined degrades to `IS NULL` on most drivers, which
    // hands back rows the filter was written to exclude.
    expect(() => resolveFilterToken('current_user_id', { now: NOW }))
      .toThrow(UnresolvedFilterTokenError);
    expect(() => resolveFilterToken('current_org_id', { now: NOW }))
      .toThrow(UnresolvedFilterTokenError);
  });
});

describe('resolveFilterTokens — tree walk', () => {
  const ctx = { now: NOW, userId: 'usr_1', orgId: 'org_9' };

  it('expands placeholders in a MongoDB-style filter', () => {
    expect(
      resolveFilterTokens(
        { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' },
        ctx,
      ),
    ).toEqual({ close_date: { $gte: '2026-01-01' }, owner: 'usr_1' });
  });

  it('expands placeholders in the array/rule filter shape', () => {
    expect(
      resolveFilterTokens(
        [{ field: 'close_date', operator: 'greater_than', value: '{current_year_start}' }],
        ctx,
      ),
    ).toEqual([{ field: 'close_date', operator: 'greater_than', value: '2026-01-01' }]);
  });

  it('descends logical branches', () => {
    expect(
      resolveFilterTokens(
        { $and: [{ a: '{today}' }, { $or: [{ b: '{30_days_ago}' }, { c: 1 }] }] },
        ctx,
      ),
    ).toEqual({ $and: [{ a: '2026-07-15' }, { $or: [{ b: '2026-06-15' }, { c: 1 }] }] });
  });

  it('leaves non-placeholder values alone, including embedded braces', () => {
    const filter = { name: 'order {id}', qty: 3, flag: true, at: new Date(0) };
    expect(resolveFilterTokens(filter, ctx)).toBe(filter);
  });

  it('returns the input by reference when nothing resolves', () => {
    // The no-placeholder path is every internal query; it must not allocate.
    const filter = { status: 'open', $and: [{ qty: { $gt: 2 } }] };
    expect(resolveFilterTokens(filter, ctx)).toBe(filter);
  });

  it('never mutates the caller — metadata is shared across requests', () => {
    const filter = { owner: '{current_user_id}' };
    const first = resolveFilterTokens(filter, { ...ctx, userId: 'usr_a' });
    const second = resolveFilterTokens(filter, { ...ctx, userId: 'usr_b' });
    expect(filter).toEqual({ owner: '{current_user_id}' });
    expect(first).toEqual({ owner: 'usr_a' });
    expect(second).toEqual({ owner: 'usr_b' });
  });

  it('shares ONE instant across every token in a tree', () => {
    // Straddling boundaries between two `new Date()` calls would silently drop
    // rows from a `>= start` / `< next start` pair.
    const out = resolveFilterTokens(
      { $and: [{ a: '{now}' }, { b: '{now}' }] },
      { userId: 'usr_1' },
    ) as { $and: Array<Record<string, string>> };
    expect(out.$and[0].a).toBe(out.$and[1].b);
  });

  it('throws on an unknown placeholder and names the near miss', () => {
    // The #3582 headline: `{current_user}` used to reach SQL as a literal.
    let err: unknown;
    try {
      resolveFilterTokens({ owner: '{current_user}' }, ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownFilterTokenError);
    expect((err as UnknownFilterTokenError).token).toBe('current_user');
    expect((err as Error).message).toContain('{current_user_id}');
    // 400, not 500 — a malformed filter is the caller's to fix, and the REST
    // layer's generic 4xx passthrough keys on these two fields.
    expect((err as UnknownFilterTokenError).status).toBe(400);
    expect((err as UnknownFilterTokenError).code).toBe('FILTER_TOKEN_UNKNOWN');
  });

  it('throws on a near-miss period spelling', () => {
    expect(() => resolveFilterTokens({ d: '{this_quarter_start}' }, ctx))
      .toThrow(UnknownFilterTokenError);
  });

  it('accepts the `${token}` spelling', () => {
    expect(resolveFilterTokens({ d: '${30_days_ago}' }, ctx)).toEqual({ d: '2026-06-15' });
  });
});

/**
 * #5586 — a placeholder carrying a NON-WORD character used to bypass the
 * diagnostic entirely.
 *
 * Recognition was the token-NAME grammar, so `{TODAY()}` classified as "not a
 * placeholder", was handed to the driver verbatim and compared as a literal
 * string. Measured on 17.0.0-rc.2 against a four-row fixture: `due_date <
 * '{today}'` returned the 2 genuinely overdue rows, `due_date < '{TODAY()}'`
 * returned all 4 — lexicographic string order puts every `'2026-…'` before
 * `'{'`, so the window silently swallowed a row due a week later.
 *
 * The refusal is asserted on the ADR-0112 envelope (`code` + `status`) plus the
 * offending token, never on the bare fact of a throw: the resolver already
 * throws for other reasons, so a throw-only assertion cannot tell "refused with
 * the right identity" from "blew up somewhere else".
 */
describe('resolveFilterTokens — non-word placeholder shapes refuse loudly (#5586)', () => {
  const ctx = { now: NOW, userId: 'usr_1', orgId: 'org_9' };

  const shapes: Array<[label: string, value: string, token: string]> = [
    ['call syntax (Salesforce/Excel migrants)', '{TODAY()}', 'TODAY()'],
    ['kebab-case', '{current-user-id}', 'current-user-id'],
    ['natural language', '{30 days ago}', '30 days ago'],
    ['dotted path', '{user.id}', 'user.id'],
    ['the `${…}` prefix variant', '${TODAY()}', 'TODAY()'],
  ];

  it.each(shapes)('%s — %s refuses with the full error identity', (_label, value, token) => {
    let err: unknown;
    try {
      resolveFilterTokens({ due_date: { $lt: value } }, ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownFilterTokenError);
    const e = err as UnknownFilterTokenError;
    expect(e.name).toBe('UnknownFilterTokenError');
    // ADR-0112 envelope: the caller's filter is malformed, the server is fine.
    expect(e.code).toBe('FILTER_TOKEN_UNKNOWN');
    expect(e.status).toBe(400);
    // The author has to see what THEY wrote, not a normalised paraphrase.
    expect(e.token).toBe(token);
    expect(e.message).toContain(`{${token}}`);
  });

  it('still resolves the canonical spelling — the widening did not eat `{today}`', () => {
    expect(resolveFilterTokens({ due_date: { $lt: '{today}' } }, ctx))
      .toEqual({ due_date: { $lt: '2026-07-15' } });
  });

  it('still refuses the word-character near miss `{TODAY}`', () => {
    // The shape that ALREADY worked. It is the control: if this ever goes
    // quiet, the widening has replaced the diagnostic instead of extending it.
    let err: unknown;
    try {
      resolveFilterTokens({ due_date: { $lt: '{TODAY}' } }, ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownFilterTokenError);
    expect((err as UnknownFilterTokenError).token).toBe('TODAY');
    expect((err as UnknownFilterTokenError).code).toBe('FILTER_TOKEN_UNKNOWN');
  });

  // Decided, not emergent: recognition is ONE brace pair around the WHOLE
  // value. Anything else is ordinary text and reaches the driver untouched —
  // that is what keeps `titleFormat`-style strings and human prose out of the
  // rule, and it is the property that holds false positives at zero.
  it.each(['acme {x} deal', '{a}{b}', '{{x}}', '{}', '{a}b', 'x{a}'])(
    '%s is a literal and passes through unchanged',
    (value) => {
      const filter = { title: value };
      expect(resolveFilterTokens(filter, ctx)).toBe(filter);
    },
  );
});

describe('filterTokenContextFrom', () => {
  it('maps ExecutionContext onto the resolver inputs', () => {
    expect(
      filterTokenContextFrom({ userId: 'usr_1', tenantId: 'org_9', timezone: 'Asia/Tokyo' }, NOW),
    ).toEqual({ now: NOW, userId: 'usr_1', orgId: 'org_9', timezone: 'Asia/Tokyo' });
  });

  it('tolerates a missing context', () => {
    expect(filterTokenContextFrom(undefined)).toEqual({
      now: undefined, userId: undefined, orgId: undefined, timezone: undefined,
    });
  });
});
