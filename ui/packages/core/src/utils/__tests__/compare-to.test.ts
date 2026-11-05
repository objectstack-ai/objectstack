/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { shiftFilterByCompareTo, compareToTrendLabelKey } from '../compare-to';

describe('shiftFilterByCompareTo', () => {
  // Fixed reference: Monday 2026-05-25 (Q2 2026, week starts Monday).
  const now = new Date(2026, 4, 25, 12, 30, 0);

  describe('previousPeriod', () => {
    it('substitutes current_* tokens with last_* before resolving', () => {
      const filter = {
        created_at: {
          $gte: '{current_quarter_start}',
          $lte: '{current_quarter_end}',
        },
      };
      const out = shiftFilterByCompareTo(filter, { kind: 'previousPeriod' }, now);
      // Q2 2026 → Q1 2026 (2026-01-01 .. 2026-03-31)
      expect(out.created_at.$gte).toBe('2026-01-01');
      expect(out.created_at.$lte).toBe('2026-03-31');
    });

    it('substitutes today → yesterday', () => {
      const out = shiftFilterByCompareTo({ at: '{today}' }, { kind: 'previousPeriod' }, now);
      expect(out.at).toBe('2026-05-24');
    });

    it('substitutes bare aliases (month_start / month_end)', () => {
      const out = shiftFilterByCompareTo(
        { d: { $gte: '{month_start}', $lte: '{month_end}' } },
        { kind: 'previousPeriod' },
        now,
      );
      // May 2026 → April 2026
      expect(out.d.$gte).toBe('2026-04-01');
      expect(out.d.$lte).toBe('2026-04-30');
    });

    it('passes filters with no date tokens through unchanged', () => {
      const out = shiftFilterByCompareTo({ status: 'open' }, { kind: 'previousPeriod' }, now);
      expect(out).toEqual({ status: 'open' });
    });
  });

  // objectstack#30140. A forward window used to keep its own tokens (or, for
  // the rolling window, move only its start), so the comparison read the
  // window against itself and the delta was 0.
  describe('previousPeriod on a forward window', () => {
    // Monday 2026-05-25: next month is June, next quarter Q3.
    it('next month compares with this month', () => {
      const out = shiftFilterByCompareTo(
        { d: { $gte: '{next_month_start}', $lte: '{next_month_end}' } },
        { kind: 'previousPeriod' },
        now,
      );
      expect(out.d).toEqual({ $gte: '2026-05-01', $lte: '2026-05-31' });
    });

    it('next quarter compares with this quarter', () => {
      const out = shiftFilterByCompareTo(
        { d: { $gte: '{next_quarter_start}', $lte: '{next_quarter_end}' } },
        { kind: 'previousPeriod' },
        now,
      );
      expect(out.d).toEqual({ $gte: '2026-04-01', $lte: '2026-06-30' });
    });

    it('steps back once, across a year boundary too', () => {
      // From 2026-12-10, next month and next quarter are in 2027; the period
      // before each is December and Q4 2026, never November or Q3.
      const dec = new Date(2026, 11, 10, 12, 0);
      expect(
        shiftFilterByCompareTo(
          { d: { $gte: '{next_month_start}', $lte: '{next_month_end}' } },
          { kind: 'previousPeriod' },
          dec,
        ).d,
      ).toEqual({ $gte: '2026-12-01', $lte: '2026-12-31' });
      expect(
        shiftFilterByCompareTo(
          { d: { $gte: '{next_quarter_start}', $lte: '{next_quarter_end}' } },
          { kind: 'previousPeriod' },
          dec,
        ).d,
      ).toEqual({ $gte: '2026-10-01', $lte: '2026-12-31' });
    });

    it('today … 30 days from now compares with the 31 days that end yesterday', () => {
      // Current window: 2026-05-25 .. 2026-06-24, 31 days.
      const out = shiftFilterByCompareTo(
        { d: { $gte: '{today}', $lte: '{30_days_from_now}' } },
        { kind: 'previousPeriod' },
        now,
      );
      expect(out.d).toEqual({ $gte: '2026-04-24', $lte: '2026-05-24' });
    });

    it('moves a $between rolling window the same way', () => {
      const out = shiftFilterByCompareTo(
        { d: { $between: ['{today}', '{7_days_from_now}'] } },
        { kind: 'previousPeriod' },
        now,
      );
      // Current 2026-05-25 .. 2026-06-01 (8 days) → 2026-05-17 .. 2026-05-24.
      expect(out.d.$between).toEqual(['2026-05-17', '2026-05-24']);
    });

    it('leaves a lone {today} and a lone {N_days_from_now} to their old reading', () => {
      // Not a forward rolling pair: `{today}` still means yesterday, and a
      // bound with no `{today}` partner has no window length to move by.
      expect(shiftFilterByCompareTo({ at: '{today}' }, { kind: 'previousPeriod' }, now).at).toBe('2026-05-24');
      expect(
        shiftFilterByCompareTo({ d: { $lte: '{30_days_from_now}' } }, { kind: 'previousPeriod' }, now).d,
      ).toEqual({ $lte: '2026-06-24' });
      expect(
        shiftFilterByCompareTo(
          { a: { $gte: '{today}' }, b: { $lte: '{30_days_from_now}' } },
          { kind: 'previousPeriod' },
          now,
        ),
      ).toEqual({ a: { $gte: '2026-05-24' }, b: { $lte: '2026-06-24' } });
      // Two fields are two conditions, not one window.
      expect(
        shiftFilterByCompareTo({ a: '{today}', b: '{30_days_from_now}' }, { kind: 'previousPeriod' }, now),
      ).toEqual({ a: '2026-05-24', b: '2026-06-24' });
    });
  });

  describe('previousYear', () => {
    it('re-resolves macros against now shifted back one year', () => {
      const filter = {
        d: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' },
      };
      const out = shiftFilterByCompareTo(filter, { kind: 'previousYear' }, now);
      // Q2 2025 (2025-04-01 .. 2025-06-30)
      expect(out.d.$gte).toBe('2025-04-01');
      expect(out.d.$lte).toBe('2025-06-30');
    });
  });

  // Replaces the retired `offset` block (objectstack#5011 removed that arm).
  // Re-spelling those cases was not an option: they pinned the duration shift
  // itself, so they would have gone green by producing nothing. What the
  // converged shape needs pinned instead is that `dimension` — the one key the
  // new object gained — stays the EXECUTOR's business: it names the dataset
  // time dimension whose dateRange is shifted, and a renderer that let it reach
  // its own filter shifting would be guessing at a window the executor owns.
  describe('dimension is the executor’s, never read here', () => {
    it('shifts identically with and without a dimension', () => {
      const filter = { d: { $gte: '{current_month_start}', $lte: '{current_month_end}' } };
      const bare = shiftFilterByCompareTo(filter, { kind: 'previousPeriod' }, now);
      const named = shiftFilterByCompareTo(
        filter,
        { kind: 'previousPeriod', dimension: 'close_date' },
        now,
      );
      expect(named).toEqual(bare);
      expect(named.d.$gte).toBe('2026-04-01');
    });

    it('never treats the dimension name as a filter key', () => {
      const out = shiftFilterByCompareTo(
        { status: 'open' },
        { kind: 'previousYear', dimension: 'close_date' },
        now,
      );
      expect(out).toEqual({ status: 'open' });
      expect(out).not.toHaveProperty('close_date');
    });
  });
});

describe('compareToTrendLabelKey', () => {
  it('previousYear → vsLastYear regardless of filter', () => {
    expect(compareToTrendLabelKey({ kind: 'previousYear' }, undefined)).toBe('vsLastYear');
    expect(compareToTrendLabelKey({ kind: 'previousYear' }, { d: '{today}' })).toBe('vsLastYear');
  });

  it('derives the key from .kind alone — a dimension changes nothing', () => {
    expect(
      compareToTrendLabelKey({ kind: 'previousYear', dimension: 'close_date' }, { d: '{today}' }),
    ).toBe('vsLastYear');
    expect(
      compareToTrendLabelKey({ kind: 'previousPeriod', dimension: 'close_date' }, { d: '{today}' }),
    ).toBe('vsYesterday');
  });

  describe('previousPeriod token sniffing', () => {
    it('detects year', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{current_year_start}' })).toBe('vsLastYear');
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{year_start}' })).toBe('vsLastYear');
    });
    it('detects quarter', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{current_quarter_end}' })).toBe('vsLastQuarter');
    });
    it('detects month', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{month_start}' })).toBe('vsLastMonth');
    });
    it('detects week', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{current_week_start}' })).toBe('vsLastWeek');
    });
    it('detects today', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: '{today}' })).toBe('vsYesterday');
    });
    it('names the current period for a forward month or quarter (objectstack#30140)', () => {
      const month = { d: { $gte: '{next_month_start}', $lte: '{next_month_end}' } };
      const quarter = { d: { $gte: '{next_quarter_start}', $lte: '{next_quarter_end}' } };
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, month)).toBe('vsThisMonth');
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, quarter)).toBe('vsThisQuarter');
      expect(compareToTrendLabelKey({ kind: 'previousYear' }, month)).toBe('vsLastYear');
    });
    it('reads a forward rolling window as the previous period, not yesterday (objectstack#30140)', () => {
      expect(
        compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: { $gte: '{today}', $lte: '{30_days_from_now}' } }),
      ).toBe('vsPreviousPeriod');
      expect(
        compareToTrendLabelKey({ kind: 'previousPeriod' }, { d: { $between: ['{today}', '{30_days_from_now}'] } }),
      ).toBe('vsPreviousPeriod');
    });
    it('falls back to vsPreviousPeriod when no token matches', () => {
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, { status: 'open' })).toBe('vsPreviousPeriod');
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, undefined)).toBe('vsPreviousPeriod');
    });
  });
});
