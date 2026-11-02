// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `isUnparseableDate` — the mark `date()` / `datetime()` put on the invalid
 * Date they answer for non-empty text they cannot parse.
 *
 * The VALUE is unchanged: still an invalid Date, still `ok: true`, so every
 * predicate answers exactly as before. What is added is a way for a
 * formula-field reader to tell "the text was not a date" from "there was no
 * text", which both serialize to `null`. The objectql read path reports the
 * first as a fault (`engine-formula-fault-log.test.ts`).
 */

import { describe, it, expect } from 'vitest';

import { celEngine } from './cel-engine';
import { isUnparseableDate } from './stdlib';

const ev = (source: string, record: Record<string, unknown>) =>
  celEngine.evaluate({ dialect: 'cel', source }, { record });

describe('isUnparseableDate', () => {
  it('marks date() / datetime() over text they cannot parse, and the value stays an ok invalid Date', () => {
    for (const fn of ['date', 'datetime']) {
      const r = ev(`${fn}(record.first)`, { first: 'grace' });
      expect(r.ok).toBe(true);
      const v = (r as { value: unknown }).value;
      expect(v).toBeInstanceOf(Date);
      expect(Number.isNaN((v as Date).getTime())).toBe(true);
      expect(isUnparseableDate(v)).toBe(true);
    }
  });

  it('the mark survives addDays / addMonths over it', () => {
    for (const source of ['addDays(date(record.first), 1)', 'addMonths(date(record.first), 2)']) {
      const r = ev(source, { first: 'grace' });
      expect(r.ok).toBe(true);
      expect(isUnparseableDate((r as { value: unknown }).value)).toBe(true);
    }
  });

  it('control: an EMPTY source is not marked (null, empty and blank text)', () => {
    for (const first of [null, '', '   ']) {
      const r = ev('date(record.first)', { first });
      expect(r.ok).toBe(true);
      const v = (r as { value: unknown }).value as Date;
      expect(Number.isNaN(v.getTime())).toBe(true);
      expect(isUnparseableDate(v)).toBe(false);
    }
  });

  it('control: ISO text, epoch numbers and non-Dates are not marked', () => {
    const iso = ev('date(record.first)', { first: '2026-03-04' });
    expect(iso.ok && (iso.value as Date).toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(isUnparseableDate((iso as { value: unknown }).value)).toBe(false);
    const epoch = ev('date(record.n)', { n: 5 });
    expect(isUnparseableDate((epoch as { value: unknown }).value)).toBe(false);
    for (const v of [null, undefined, 'grace', new Date(Number.NaN), 0]) {
      expect(isUnparseableDate(v)).toBe(false);
    }
  });

  it('control: a predicate over date() on bad text answers as before — false, ok', () => {
    expect(ev('date(record.first) == today()', { first: 'grace' })).toEqual({ ok: true, value: false });
    expect(ev('date(record.first) != today()', { first: 'grace' })).toEqual({ ok: true, value: true });
  });

  it('control: isoDate / daysBetween over it still refuse at evaluate', () => {
    const iso = ev('isoDate(date(record.first))', { first: 'grace' });
    expect(iso.ok).toBe(false);
    expect(!iso.ok && iso.error.message).toContain('not a renderable timestamp');
    const days = ev('daysBetween(date(record.first), today())', { first: 'grace' });
    expect(days.ok).toBe(false);
  });
});
