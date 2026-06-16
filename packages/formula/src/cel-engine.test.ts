import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
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
    const r = celEngine.evaluate(cel('os.user.role == "manager"'), {
      user: { id: 'u1', role: 'manager' },
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

  it('daysFromNow(n) advances by n days from pinned now', () => {
    const pinned = new Date('2026-01-15T10:00:00Z');
    const r = celEngine.evaluate(cel('daysFromNow(30)'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-02-14T10:00:00.000Z');
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
});
