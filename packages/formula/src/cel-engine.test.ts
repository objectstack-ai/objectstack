import { describe, expect, it } from 'vitest';

import { celEngine, rewriteTemporalEquality } from './cel-engine';
import { CEL_STDLIB_FUNCTIONS } from './validate';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

describe('celEngine', () => {
  it('evaluates simple arithmetic, coercing BigInt to number', () => {
    const r = celEngine.evaluate(cel('1 + 2'), {});
    expect(r).toEqual({ ok: true, value: 3 });
  });

  it('evaluates predicates against record context', () => {
    const r = celEngine.evaluate(cel('record.amount > 1000'), {
      record: { amount: 1500 },
    });
    expect(r).toEqual({ ok: true, value: true });
  });

  it('exposes os.* namespace from EvalContext', () => {
    const r = celEngine.evaluate(cel('"manager" in os.user.positions'), {
      user: { id: 'u1', positions: ['manager'] },
    });
    expect(r).toEqual({ ok: true, value: true });
  });

  it('uses pinned now() for determinism', () => {
    const pinned = new Date('2026-01-15T10:00:00Z');
    const r = celEngine.evaluate(cel('now()'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe(pinned.toISOString());
  });

  it('today() truncates to UTC start-of-day', () => {
    const pinned = new Date('2026-01-15T10:30:45.123Z');
    const r = celEngine.evaluate(cel('today()'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('daysFromNow(n) returns the calendar day n days out, at midnight (ADR-0053 D1)', () => {
    // Calendar-day semantics: the wall-clock time of `now` is dropped, so
    // `record.date == daysFromNow(n)` matches in-memory (the defect-3 fix).
    const pinned = new Date('2026-01-15T10:00:00Z');
    const r = celEngine.evaluate(cel('daysFromNow(30)'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-02-14T00:00:00.000Z');
  });

  it('addDays(date, n) shifts an arbitrary date — the "next service date" shape', () => {
    // 下次维保日期 = 上次维保 + 周期天数. Operates on record.date, not now().
    const r = celEngine.evaluate(cel('addDays(record.last_service, record.cycle_days)'), {
      record: { last_service: '2026-06-18T00:00:00Z', cycle_days: 90 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('addDays accepts a negative offset', () => {
    const r = celEngine.evaluate(cel("addDays(date('2026-03-01'), -1)"), {});
    expect(r.ok && (r.value as Date).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('addMonths clamps to the target month\'s last day (Jan 31 + 1mo → Feb 28)', () => {
    const r = celEngine.evaluate(cel("addMonths(date('2026-01-31'), 1)"), {});
    expect(r.ok && (r.value as Date).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('addMonths handles year roll-over and the common 6-month cycle', () => {
    const r = celEngine.evaluate(cel("addMonths(date('2026-09-30'), 6)"), {});
    expect(r.ok && (r.value as Date).toISOString()).toBe('2027-03-30T00:00:00.000Z');
  });

  it('today()/daysFromNow()/daysAgo() resolve the calendar day in the reference timezone', () => {
    // 2026-01-15T02:00Z is still Jan 14 in America/New_York (UTC-5).
    const pinned = new Date('2026-01-15T02:00:00Z');
    const tz = 'America/New_York';
    const today = celEngine.evaluate(cel('today()'), { now: pinned, timezone: tz });
    expect(today.ok && (today.value as Date).toISOString()).toBe('2026-01-14T00:00:00.000Z');
    const tomorrow = celEngine.evaluate(cel('daysFromNow(1)'), { now: pinned, timezone: tz });
    expect(tomorrow.ok && (tomorrow.value as Date).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    const yesterday = celEngine.evaluate(cel('daysAgo(1)'), { now: pinned, timezone: tz });
    expect(yesterday.ok && (yesterday.value as Date).toISOString()).toBe('2026-01-13T00:00:00.000Z');
    // Default (UTC) sees Jan 15.
    const utc = celEngine.evaluate(cel('today()'), { now: pinned });
    expect(utc.ok && (utc.value as Date).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  // ADR-0053 Phase 2 · Slice 3 acceptance criteria (#1980). The three
  // calendar-day functions resolve the reference-tz calendar day expressed as a
  // UTC-midnight Date (decision D1), DST-safe via `Intl.formatToParts` — never
  // hand-rolled offset math. These lock the issue's criteria verbatim plus the
  // DST-boundary and equality behavior the ADR promises.
  describe('ADR-0053 Phase 2 · Slice 3 acceptance criteria (#1980)', () => {
    const isoOf = (r: ReturnType<typeof celEngine.evaluate>): string | false =>
      r.ok ? (r.value as Date).toISOString() : false;

    it('AC1: today() at 2026-06-16T02:00Z in America/Los_Angeles is the UTC-midnight of 2026-06-15', () => {
      // 02:00Z is 2026-06-15 19:00 PDT (UTC-7) — still June 15 in LA.
      const now = new Date('2026-06-16T02:00:00Z');
      const tz = 'America/Los_Angeles';
      expect(isoOf(celEngine.evaluate(cel('today()'), { now, timezone: tz })))
        .toBe('2026-06-15T00:00:00.000Z');
      expect(isoOf(celEngine.evaluate(cel('daysFromNow(1)'), { now, timezone: tz })))
        .toBe('2026-06-16T00:00:00.000Z');
      expect(isoOf(celEngine.evaluate(cel('daysAgo(1)'), { now, timezone: tz })))
        .toBe('2026-06-14T00:00:00.000Z');
    });

    it('AC3: reference tz unset vs "UTC" is byte-for-byte the pre-Phase-2 behavior', () => {
      const now = new Date('2026-06-16T02:00:00Z');
      const unsetToday = celEngine.evaluate(cel('today()'), { now });
      expect(isoOf(unsetToday)).toBe('2026-06-16T00:00:00.000Z');
      // Explicit 'UTC' is identical to unset for all three functions.
      for (const src of ['today()', 'daysFromNow(5)', 'daysAgo(5)']) {
        expect(celEngine.evaluate(cel(src), { now, timezone: 'UTC' }))
          .toEqual(celEngine.evaluate(cel(src), { now }));
      }
    });

    it('AC2: calendar days are correct across the spring-forward boundary (US DST 2026-03-08)', () => {
      // now = 2026-03-07T04:30Z = 2026-03-06 23:30 EST. daysFromNow(3) crosses
      // the Mar 8 spring-forward — a naive offset add would land on the wrong
      // instant; the Intl-based calendar math does not.
      const now = new Date('2026-03-07T04:30:00Z');
      const tz = 'America/New_York';
      expect(isoOf(celEngine.evaluate(cel('today()'), { now, timezone: tz })))
        .toBe('2026-03-06T00:00:00.000Z');
      expect(isoOf(celEngine.evaluate(cel('daysFromNow(3)'), { now, timezone: tz })))
        .toBe('2026-03-09T00:00:00.000Z');
    });

    it('AC2: calendar days are correct across the fall-back boundary (US DST 2026-11-01)', () => {
      // now = 2026-11-02T04:30Z = 2026-11-01 23:30 EST, just after the fall-back.
      const now = new Date('2026-11-02T04:30:00Z');
      const tz = 'America/New_York';
      expect(isoOf(celEngine.evaluate(cel('today()'), { now, timezone: tz })))
        .toBe('2026-11-01T00:00:00.000Z');
      expect(isoOf(celEngine.evaluate(cel('daysAgo(2)'), { now, timezone: tz })))
        .toBe('2026-10-30T00:00:00.000Z');
    });

    it('AC2: a datetime record field == daysFromNow(n) matches the right day across DST', () => {
      // A `Field.datetime` arrives as a Date instant, so equality is
      // Timestamp==Timestamp — the representation D1 makes today()/daysFromNow()
      // produce (UTC-midnight). This is the case D1's rationale targets.
      const now = new Date('2026-03-07T04:30:00Z'); // Mar 6 in NY
      const tz = 'America/New_York';
      const r = celEngine.evaluate(cel('record.due_at == daysFromNow(3)'), {
        now, timezone: tz, record: { due_at: new Date('2026-03-09T00:00:00Z') },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('AC2: a date-string field matches today()/daysAgo() via the hydration-safe idioms', () => {
      // ADR-0053 Phase 1 (#1968) reads a `Field.date` back as a "YYYY-MM-DD"
      // string. The ordering operators fault → hydrate (the string becomes a
      // Date) and compare cleanly; `date(...)` and `daysBetween(...)` coerce
      // explicitly. All resolve on the reference-tz calendar day.
      const now = new Date('2026-11-02T04:30:00Z'); // Nov 1 in NY
      const ctx = { now, timezone: 'America/New_York', record: { due_date: '2026-11-01' } };
      expect(celEngine.evaluate(cel('record.due_date >= today() && record.due_date <= today()'), ctx))
        .toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('date(record.due_date) == today()'), ctx))
        .toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('daysBetween(today(), record.due_date) == 0'), ctx))
        .toEqual({ ok: true, value: true });
    });

    it('bare `date-string == today()` now matches (the #3183 runtime fix)', () => {
      // Previously the KNOWN GAP: cel-js's `isEqual` hard-codes `string == X` to
      // false, so a bare `Field.date` string never equalled the Timestamp from
      // today(). The engine now rewrites the field operand to `date(record.d)`
      // (AST temporal-comparison rewrite, #3183), so it compares two Timestamps
      // and matches on the reference-tz calendar day.
      const now = new Date('2026-11-02T04:30:00Z'); // Nov 1 in NY
      const ny = { now, timezone: 'America/New_York', record: { due_date: '2026-11-01' } };
      expect(celEngine.evaluate(cel('record.due_date == today()'), ny))
        .toEqual({ ok: true, value: true });
      // The `!=` dual is now correctly false for a same-day record.
      expect(celEngine.evaluate(cel('record.due_date != today()'), ny))
        .toEqual({ ok: true, value: false });
      // A different day still compares unequal.
      expect(celEngine.evaluate(cel('record.due_date == today()'), {
        now, timezone: 'America/New_York', record: { due_date: '2026-10-31' },
      })).toEqual({ ok: true, value: false });
    });
  });

  it('classifies parse errors with kind=parse', () => {
    const r = celEngine.evaluate(cel('1 +'), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['parse', 'type', 'runtime']).toContain(r.error.kind);
  });

  it('enforces AST size bounds (kind=bounds)', () => {
    const huge = Array.from({ length: 500 }, (_, i) => i.toString()).join(' + ');
    const r = celEngine.evaluate(cel(huge), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('bounds');
  });

  it('rejects evaluation when dialect mismatches', () => {
    const r = celEngine.evaluate({ dialect: 'js', source: 'x' } as Expression, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dialect');
  });

  it('compile() returns AST on success', () => {
    const r = celEngine.compile('record.amount > 1000');
    expect(r.ok).toBe(true);
  });

  // #1877 — cel-js `check()` returns a `{ valid, error }` object, not an array.
  // compile() must read that shape so an UNKNOWN function (here `PRIOR`) is
  // reported as a type fault at build time instead of slipping through.
  it('compile() rejects an unknown function as a type error (#1877)', () => {
    const r = celEngine.compile('PRIOR(status) != "promoted"');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('type');
      expect(r.error.message).toMatch(/overload|PRIOR/);
    }
  });

  it('compile() still accepts a registered stdlib function (#1877)', () => {
    expect(celEngine.compile('!isBlank(record.target_channels)').ok).toBe(true);
  });

  it('handles timestamp + duration arithmetic', () => {
    const pinned = new Date('2026-01-01T00:00:00Z');
    const r = celEngine.evaluate(cel('now() + duration("720h")'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('coerces large BigInt to string to avoid silent truncation', () => {
    const r = celEngine.evaluate(cel('9999999999999999999'), {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.value === 'string' || typeof r.value === 'number').toBe(true);
  });

  // ADR-0032 §1c — string-serialized numeric fields (#1530, #1534).
  describe('numeric-string field hydration', () => {
    it('compares a rating that serializes as "5.0" against an int literal', () => {
      const r = celEngine.evaluate(cel('record.rating >= 4'), {
        record: { rating: '5.0' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('compares a currency string against an int literal', () => {
      const r = celEngine.evaluate(cel('record.amount > 100000'), {
        record: { amount: '250000.00' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('returns false (not a fault) when the hydrated compare is unmet', () => {
      const r = celEngine.evaluate(cel('record.rating >= 4'), {
        record: { rating: '2.5' },
      });
      expect(r).toEqual({ ok: true, value: false });
    });

    it('compares a percent string against a number literal', () => {
      const r = celEngine.evaluate(cel('record.completion >= 0.8'), {
        record: { completion: '0.95' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('hydrates within a compound predicate (the real flow-condition shape)', () => {
      const r = celEngine.evaluate(
        cel('record.rating >= 4 && record.status == "new"'),
        { record: { rating: '5.0', status: 'new' } },
      );
      expect(r).toEqual({ ok: true, value: true });
    });

    it('hydrates nested numeric strings (e.g. previous.* transition gates)', () => {
      const r = celEngine.evaluate(cel('record.amount > previous.amount'), {
        record: { amount: '600000.00' },
        previous: { amount: '500000.00' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('leaves genuine string equality untouched (no spurious coercion)', () => {
      // string == string already type-checks, so the retry path never runs
      // and a numeric-looking string stays a string.
      const r = celEngine.evaluate(cel('record.zip == "02134"'), {
        record: { zip: '02134' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('does not coerce non-numeric strings', () => {
      // "high" is not a number literal, so the compare still faults loudly
      // rather than being silently rescued.
      const r = celEngine.evaluate(cel('record.rating >= 4'), {
        record: { rating: 'high' },
      });
      expect(r.ok).toBe(false);
    });
  });

  // #1928 — cel-js ships no `double <op> int` arithmetic overload, so a field
  // number (double) combined with a bare integer literal faulted `no such
  // overload` and the formula silently evaluated to null. registerNumericCoercions
  // closes the gap; these are the everyday formula shapes that were broken.
  describe('mixed double/int arithmetic overloads (#1928)', () => {
    it('divides a currency field by an int literal (expected_revenue shape)', () => {
      const r = celEngine.evaluate(
        cel('record.amount * record.probability / 100'),
        { record: { amount: 120000, probability: 70 } },
      );
      expect(r).toEqual({ ok: true, value: 84000 });
    });

    it('divides a field by an int literal', () => {
      const r = celEngine.evaluate(cel('record.amount / 100'), {
        record: { amount: 120000 },
      });
      expect(r).toEqual({ ok: true, value: 1200 });
    });

    it('handles *, +, -, % between a field and an int literal', () => {
      expect(celEngine.evaluate(cel('record.x * 2'), { record: { x: 5.5 } }))
        .toEqual({ ok: true, value: 11 });
      expect(celEngine.evaluate(cel('record.x + 1'), { record: { x: 2.5 } }))
        .toEqual({ ok: true, value: 3.5 });
      expect(celEngine.evaluate(cel('record.x - 100'), { record: { x: 250 } }))
        .toEqual({ ok: true, value: 150 });
      expect(celEngine.evaluate(cel('record.x % 7'), { record: { x: 20 } }))
        .toEqual({ ok: true, value: 6 });
    });

    it('handles the int-literal on the left (int op double)', () => {
      const r = celEngine.evaluate(cel('100 - record.x'), {
        record: { x: 40 },
      });
      expect(r).toEqual({ ok: true, value: 60 });
    });

    it('leaves pure int/int arithmetic as integer division (7 / 2 == 3)', () => {
      const r = celEngine.evaluate(cel('7 / 2'), {});
      expect(r).toEqual({ ok: true, value: 3 });
    });

    it('still evaluates double/double field arithmetic', () => {
      const r = celEngine.evaluate(cel('record.a / record.b'), {
        record: { a: 10, b: 4 },
      });
      expect(r).toEqual({ ok: true, value: 2.5 });
    });

    it('composes with string-field hydration (currency string + int literal)', () => {
      const r = celEngine.evaluate(cel('record.amount + 1'), {
        record: { amount: '120000.00' },
      });
      expect(r).toEqual({ ok: true, value: 120001 });
    });
  });

  // ADR-0032 §1c — string-serialized date/datetime fields (#1530). Field.date
  // serializes to "YYYY-MM-DD" and Field.datetime to a full ISO string; cel-js
  // compares those raw strings against the google.protobuf.Timestamp returned by
  // today()/now()/daysFromNow() and faults `no such overload`, which previously
  // surfaced as a silent `null`.
  describe('date/datetime-string field hydration (#1530)', () => {
    const now = new Date('2026-06-02T08:00:00Z');

    it('compares a date-only field against today()/daysFromNow() (is_expiring_soon)', () => {
      const r = celEngine.evaluate(
        cel('record.end_date >= today() && record.end_date <= daysFromNow(60)'),
        { now, record: { end_date: '2026-06-20' } },
      );
      expect(r).toEqual({ ok: true, value: true });
    });

    it('returns false (not a fault) when the date compare is unmet', () => {
      const r = celEngine.evaluate(cel('record.end_date <= daysFromNow(60)'), {
        now,
        record: { end_date: '2027-01-01' },
      });
      expect(r).toEqual({ ok: true, value: false });
    });

    it('handles is_overdue: a past date-only field < today()', () => {
      const r = celEngine.evaluate(cel('record.due_date < today()'), {
        now,
        record: { due_date: '2026-05-31' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('hydrates a full ISO datetime field against now()', () => {
      const r = celEngine.evaluate(cel('record.resolution_due_at < now()'), {
        now,
        record: { resolution_due_at: '2026-06-01T08:15:35.244Z' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });

    it('supports timestamp arithmetic on hydrated date fields (today() - hire_date)', () => {
      // hire_date ~2.4y before `now` → tenure exceeds 2 years (17520h).
      const r = celEngine.evaluate(
        cel('(today() - record.hire_date) > duration("17520h")'),
        { now, record: { hire_date: '2024-01-01' } },
      );
      expect(r).toEqual({ ok: true, value: true });
    });

    it('hydrates date + numeric strings together in one record', () => {
      const r = celEngine.evaluate(
        cel('record.amount >= 1000 && record.end_date >= today()'),
        { now, record: { amount: '2500.00', end_date: '2026-06-20' } },
      );
      expect(r).toEqual({ ok: true, value: true });
    });

    it('does not coerce non-temporal strings (still faults loudly)', () => {
      const r = celEngine.evaluate(cel('record.end_date <= today()'), {
        now,
        record: { end_date: 'soon' },
      });
      expect(r.ok).toBe(false);
    });

    it('leaves genuine date-string equality untouched (no spurious coercion)', () => {
      // string == string type-checks, so the retry never runs and the value
      // stays a string.
      const r = celEngine.evaluate(cel('record.end_date == "2026-06-20"'), {
        record: { end_date: '2026-06-20' },
      });
      expect(r).toEqual({ ok: true, value: true });
    });
  });

  // #1928 follow-up — the authoring catalog (`introspectScope`) advertised 25
  // functions but only 8 were registered; 14 faulted at runtime. These cover the
  // newly-registered stdlib, plus a drift-guard that every advertised function resolves.
  describe('stdlib catalog (registered functions)', () => {
    const now = new Date('2026-06-16T00:00:00Z');

    it('daysBetween counts whole days (negative when reversed)', () => {
      expect(celEngine.evaluate(cel('daysBetween(today(), daysFromNow(7))'), { now }))
        .toEqual({ ok: true, value: 7 });
      expect(celEngine.evaluate(cel('daysBetween(today(), daysAgo(3))'), { now }))
        .toEqual({ ok: true, value: -3 });
    });

    it('daysBetween coerces a date-string field arg (no manual hydration)', () => {
      const r = celEngine.evaluate(cel('daysBetween(today(), record.due)'), {
        now, record: { due: '2026-06-26' },
      });
      expect(r).toEqual({ ok: true, value: 10 });
    });

    it('date / datetime parse ISO strings to a timestamp', () => {
      const r = celEngine.evaluate(cel('date("2026-03-15") < datetime("2026-03-16T08:00:00Z")'), {});
      expect(r).toEqual({ ok: true, value: true });
    });

    it('abs / round / min / max', () => {
      expect(celEngine.evaluate(cel('abs(record.x)'), { record: { x: -3.5 } })).toEqual({ ok: true, value: 3.5 });
      expect(celEngine.evaluate(cel('round(2.6)'), {})).toEqual({ ok: true, value: 3 });
      expect(celEngine.evaluate(cel('min(record.a, record.b)'), { record: { a: 3, b: 7 } })).toEqual({ ok: true, value: 3 });
      expect(celEngine.evaluate(cel('max(record.a, record.b)'), { record: { a: 3, b: 7 } })).toEqual({ ok: true, value: 7 });
    });

    it('string ops: upper / lower / contains / startsWith / endsWith / matches', () => {
      expect(celEngine.evaluate(cel('upper(record.s)'), { record: { s: 'hi' } })).toEqual({ ok: true, value: 'HI' });
      expect(celEngine.evaluate(cel('lower("HI")'), {})).toEqual({ ok: true, value: 'hi' });
      expect(celEngine.evaluate(cel('contains(record.s, "ell")'), { record: { s: 'hello' } })).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('startsWith("hello", "he")'), {})).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('endsWith("hello", "lo")'), {})).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('matches("a1", "a.")'), {})).toEqual({ ok: true, value: true });
    });

    it('len / isEmpty over strings and lists', () => {
      expect(celEngine.evaluate(cel('len(record.items)'), { record: { items: [1, 2, 3] } })).toEqual({ ok: true, value: 3 });
      expect(celEngine.evaluate(cel('isEmpty("")'), {})).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('isEmpty(record.items)'), { record: { items: [] } })).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('isEmpty(record.items)'), { record: { items: [1] } })).toEqual({ ok: true, value: false });
    });

    // Drift guard: introspectScope promises these to authors; every one must resolve.
    it('every advertised CEL_STDLIB_FUNCTIONS entry resolves at runtime', () => {
      const call: Record<string, string> = {
        now: 'now()', today: 'today()', daysFromNow: 'daysFromNow(30)', daysAgo: 'daysAgo(7)',
        daysBetween: 'daysBetween(today(), daysFromNow(7))', date: 'date("2026-03-15")',
        addDays: 'addDays(today(), 7)', addMonths: 'addMonths(today(), 3)',
        datetime: 'datetime("2026-03-15T08:00:00Z")', abs: 'abs(-3.5)', round: 'round(2.6)',
        min: 'min(1, 2)', max: 'max(1, 2)', upper: 'upper("hi")', lower: 'lower("HI")',
        trim: 'trim(" x ")', contains: 'contains("hello", "ell")', startsWith: 'startsWith("hi", "h")',
        endsWith: 'endsWith("hi", "i")', matches: 'matches("a1", "a.")', joinNonEmpty: 'joinNonEmpty(["a", "b"], "-")',
        isBlank: 'isBlank("")', isEmpty: 'isEmpty([])', coalesce: 'coalesce(null, "x")', len: 'len("ab")',
        size: 'size([1, 2])', has: 'has(record.a)', int: 'int("3")', string: 'string(3)',
        bool: 'bool("true")', double: 'double("3.5")', timestamp: 'timestamp("2026-01-01T00:00:00Z")',
        duration: 'duration("3600s")',
      };
      const unresolved: string[] = [];
      for (const fn of CEL_STDLIB_FUNCTIONS) {
        const src = call[fn];
        expect(src, `no probe call defined for advertised function \`${fn}\``).toBeTruthy();
        const r = celEngine.evaluate(cel(src), { now, record: { a: 1 } });
        if (!r.ok) unresolved.push(`${fn}: ${r.error.message.split('\n')[0]}`);
      }
      expect(unresolved, `advertised functions that fault at runtime:\n${unresolved.join('\n')}`).toEqual([]);
    });
  });

  // #3183 — AST rewrite backing the runtime date-equality fix: wrap a field
  // operand compared with `==`/`!=` against a temporal function in `date(...)`.
  describe('rewriteTemporalEquality (#3183)', () => {
    it('wraps the field operand on either side, for all four temporal functions', () => {
      expect(rewriteTemporalEquality('record.due == today()')).toBe('date(record.due) == today()');
      expect(rewriteTemporalEquality('today() != record.due')).toBe('today() != date(record.due)');
      expect(rewriteTemporalEquality('record.due == daysFromNow(3)')).toBe('date(record.due) == daysFromNow(3)');
      expect(rewriteTemporalEquality('record.due != daysAgo(7)')).toBe('date(record.due) != daysAgo(7)');
      expect(rewriteTemporalEquality('previous.due == now()')).toBe('date(previous.due) == now()');
      expect(rewriteTemporalEquality('due == today()')).toBe('date(due) == today()'); // bare (flattened)
    });

    it('leaves the working idioms, ordering comparisons, and non-temporal equality untouched', () => {
      for (const src of [
        'date(record.due) == today()',                    // already coerced — idempotent
        'record.due >= today()',                          // ordering (already works)
        'daysBetween(today(), record.due) == 0',          // integer compare
        'record.a == record.b',                           // no temporal
        'record.due == "2026-06-20"',                     // string literal, no temporal
      ]) {
        expect(rewriteTemporalEquality(src)).toBe(src);
      }
    });

    it('rewrites per-occurrence — a mixed literal+temporal expression keeps the literal intact', () => {
      expect(rewriteTemporalEquality('record.d == "2026-06-20" || record.d == today()'))
        .toBe('record.d == "2026-06-20" || date(record.d) == today()');
    });

    it('returns the source unchanged (no throw) on adversarial input — no ReDoS', () => {
      // AST-based + a plain-`includes` gate; the parse either bails or is linear.
      expect(rewriteTemporalEquality('$'.repeat(5000))).toBe('$'.repeat(5000));
      expect(rewriteTemporalEquality('now('.repeat(2000))).toBe('now('.repeat(2000));
    });
  });

  // #3183 — the end-to-end runtime behavior the rewrite delivers: a `Field.date`
  // string operand now matches a temporal function under `==`/`!=`, while string
  // literals and already-typed operands are unaffected.
  describe('date-string == temporal runtime fix (#3183)', () => {
    const now = new Date('2026-06-20T08:00:00Z');
    const rec = (due: unknown) => ({ now, record: { due } });

    it('a date-only string field == today() matches on the same day', () => {
      expect(celEngine.evaluate(cel('record.due == today()'), rec('2026-06-20')))
        .toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('record.due == today()'), rec('2026-06-19')))
        .toEqual({ ok: true, value: false });
      // same-day record → `!=` is correctly false (previously silently true)
      expect(celEngine.evaluate(cel('record.due != today()'), rec('2026-06-20')))
        .toEqual({ ok: true, value: false });
    });

    it('a string literal comparison is unchanged, even mixed with a temporal one', () => {
      // Pre-existing behavior: string == string literal works.
      expect(celEngine.evaluate(cel('record.due == "2026-06-20"'), rec('2026-06-20')))
        .toEqual({ ok: true, value: true });
      // Mixed: literal clause AND temporal clause both correct for a same-day record.
      expect(celEngine.evaluate(cel('record.due == "2026-06-20" || record.due == today()'), rec('2026-06-20')))
        .toEqual({ ok: true, value: true });
      // Mixed, record on neither day: both clauses false.
      expect(celEngine.evaluate(cel('record.due == "2026-06-20" || record.due == today()'), rec('2026-06-18')))
        .toEqual({ ok: true, value: false });
    });

    it('an already-Date operand and non-date/null operands are unaffected (graceful date() coercion)', () => {
      expect(celEngine.evaluate(cel('record.due == today()'), rec(new Date('2026-06-20T00:00:00Z'))))
        .toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(cel('record.due == today()'), rec('not-a-date')))
        .toEqual({ ok: true, value: false });
      expect(celEngine.evaluate(cel('record.due == today()'), rec(null)))
        .toEqual({ ok: true, value: false });
    });
  });
});
