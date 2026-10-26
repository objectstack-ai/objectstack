/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11112 — a gantt-variant timeline draws a date-only `endDate`
 * through the end of the day it names.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * Every gantt date was read as local midnight of its day (`readGanttDate`,
 * objectui#10866), the START of the day, and the bar was drawn to it. So a bar
 * authored January 1st to January 31st, as the schema catalog's gantt authors
 * it, ended one day before the February column began, and a bar whose
 * date-only start and end named the same day was zero wide.
 *
 * ── What these pins hold ────────────────────────────────────────────────────
 *  - the schema catalog's gantt, the named producer, read from disk: each bar
 *    that ends on a month's last day ends exactly at that month column's edge;
 *  - a same-day date-only bar is one day wide;
 *  - an end with a time part keeps its instant (objectui#10866), and so do a
 *    number and a `Date`: only a date-only STRING is a day;
 *  - the computed axis runs on to where the bars are drawn: on an `hour` axis
 *    a date-only end's whole day, and an instant end's hour, have columns.
 *
 * Geometry is read off the DOM the real `TimelineRenderer` emits, as the
 * objectui#11079 pins beside this file read it. The suite runs in UTC
 * (`vitest.config.mts` pins `TZ`); the same reads under Los Angeles and
 * Shanghai are in `TimelineGantt.dateOnlyZone-10866.test.tsx`.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer } from '../renderer';

afterEach(() => {
  cleanup();
});

/** The named producer: the schema catalog's gantt. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PRODUCER = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
);

interface Bar {
  left: string;
  width: string;
}

interface Drawn {
  /** Each header cell's label and inline width, in order. */
  columns: Array<{ label: string; width: string }>;
  /** Each bar's inline `left` / `width`, in order. */
  bars: Bar[];
  /** Each bar's tooltip, in order. */
  titles: string[];
}

/** What the gantt branch draws for `schema`, in `en-US`. */
function draw(schema: Record<string, unknown>): Drawn {
  const { container } = render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as never} />
    </LocalizationProvider>,
  );
  const bars = Array.from(container.querySelectorAll<HTMLElement>('.absolute.h-8.rounded-md'));
  const drawn: Drawn = {
    columns: Array.from(
      container.querySelectorAll<HTMLElement>('.border-r.text-xs.font-medium.text-center'),
    ).map((n) => ({ label: n.textContent ?? '', width: n.style.width })),
    bars: bars.map((b) => ({ left: b.style.left, width: b.style.width })),
    titles: bars.map((b) => b.getAttribute('title') ?? ''),
  };
  cleanup();
  return drawn;
}

/** A percentage string's number. */
const num = (value: string): number => {
  expect(value, 'expected a percentage').toMatch(/%$/);
  return Number.parseFloat(value);
};

/** Where a bar's right edge is, as a percentage of the axis. */
const right = (bar: Bar): number => num(bar.left) + num(bar.width);

/** `n` of `d` as the percentage string the renderer writes. */
const share = (n: number, d: number): string => `${(n / d) * 100}%`;

/** One row of bars on a `scale` axis the bars' own dates decide. */
function plan(scale: string, bars: Array<{ startDate: unknown; endDate: unknown }>): Drawn {
  return draw({
    scale,
    items: [{ label: 'Plan', items: bars.map((bar, i) => ({ title: `Bar ${i}`, ...bar })) }],
  });
}

describe('the schema catalog gantt, the named real producer (objectui#11112)', () => {
  it('the producer fixture is on disk, and still authors its ends on the days they run through', () => {
    expect(fs.existsSync(PRODUCER), `fixture not found at ${PRODUCER}`).toBe(true);
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as {
      variant: string;
      scale: string;
      items: Array<{ items: Array<{ title: string; startDate: string; endDate: string }> }>;
    };
    expect(doc.variant).toBe('gantt');
    expect(doc.scale).toBe('month');
    const ends = doc.items.flatMap((row) => row.items.map((bar) => [bar.title, bar.endDate]));
    expect(ends).toEqual([
      ['API Design', '2024-01-31'],
      ['Implementation', '2024-03-31'],
      ['UI Design', '2024-02-15'],
      ['Component Dev', '2024-04-15'],
      ['QA Phase', '2024-04-30'],
    ]);
  });

  it('a bar ending on a month\'s last day ends exactly where the next month\'s column begins', () => {
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
    const { columns, bars } = draw(doc);
    // January 1st to the end of April 30th 2024: 31 + 29 + 31 + 30 = 121 days.
    expect(columns.map((col) => col.label)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024', 'Apr 2024']);
    const edge = (months: number) =>
      columns.slice(0, months).reduce((sum, col) => sum + num(col.width), 0);
    // Bars in document order: API Design, Implementation, UI Design,
    // Component Dev, QA Phase.
    expect(right(bars[0]), 'API Design, January 1st to 31st').toBeCloseTo(edge(1), 10);
    expect(right(bars[1]), 'Implementation, February 1st to March 31st').toBeCloseTo(edge(3), 10);
    expect(right(bars[4]), 'QA Phase, March 1st to April 30th').toBeCloseTo(100, 10);
    // API Design fills January: as wide as January's column, which is 31 of
    // the 121 days. On the base it was 30.
    expect(bars[0]).toEqual({ left: '0%', width: share(31, 121) });
  });

  it('a bar ending mid-month runs through that day', () => {
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
    const { bars } = draw(doc);
    // UI Design ends on February 15th: through day 46 of the axis (31 + 15).
    expect(right(bars[2])).toBeCloseTo((46 / 121) * 100, 10);
    // Component Dev ends on April 15th: through day 106 (31 + 29 + 31 + 15).
    expect(right(bars[3])).toBeCloseTo((106 / 121) * 100, 10);
  });

  it('the tooltip still names the authored end, not the edge the bar is drawn to', () => {
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
    const { titles } = draw(doc);
    expect(titles[0]).toBe('API Design\n1/1/2024 - 1/31/2024');
    expect(titles[4]).toBe('QA Phase\n3/1/2024 - 4/30/2024');
  });
});

describe('a same-day date-only bar is one day wide (objectui#11112)', () => {
  it('on a day axis, as wide as its day\'s column', () => {
    const { columns, bars } = plan('day', [
      { startDate: '2026-10-05', endDate: '2026-10-07' },
      { startDate: '2026-10-06', endDate: '2026-10-06' },
    ]);
    expect(columns.map((col) => col.label)).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // The three-day bar fills the axis; the same-day bar is its day's column.
    expect(bars[0]).toEqual({ left: '0%', width: '100%' });
    expect(bars[1]).toEqual({ left: columns[0].width, width: columns[1].width });
  });

  it('on a one-day plan, the whole of its one day column', () => {
    const { columns, bars } = plan('day', [{ startDate: '2026-10-06', endDate: '2026-10-06' }]);
    expect(columns).toEqual([{ label: 'Oct 6', width: '100%' }]);
    expect(bars).toEqual([{ left: '0%', width: '100%' }]);
  });

  it('on a month axis, one of the month\'s days', () => {
    const { columns, bars } = plan('month', [{ startDate: '2026-10-06', endDate: '2026-10-06' }]);
    expect(columns.map((col) => col.label)).toEqual(['Oct 2026']);
    expect(bars).toEqual([{ left: share(5, 31), width: share(1, 31) }]);
  });
});

describe('an end with a time part, a number or a Date keeps its instant (objectui#11112)', () => {
  it('an ISO date-time end at midnight is drawn to that midnight, not through the day', () => {
    // The same day, written as an instant: it is the START of October 7th.
    const { columns, bars } = plan('day', [
      { startDate: '2026-10-05', endDate: '2026-10-07T00:00:00' },
      { startDate: '2026-10-05', endDate: '2026-10-07' },
    ]);
    expect(columns.map((col) => col.label)).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    expect(bars[0]).toEqual({ left: '0%', width: share(2, 3) });
    // Control: the date-only spelling of the same end runs through the 7th.
    expect(bars[1]).toEqual({ left: '0%', width: '100%' });
  });

  it('an ISO date-time end mid-day is drawn to its hour', () => {
    const { bars } = plan('day', [
      { startDate: '2026-10-05', endDate: '2026-10-06T12:00:00' },
      { startDate: '2026-10-05', endDate: '2026-10-07' },
    ]);
    // 36 of the axis's 72 hours.
    expect(bars[0]).toEqual({ left: '0%', width: share(36, 72) });
  });

  it('an epoch-millisecond end and a Date end are instants', () => {
    const midnight = new Date(2026, 9, 7);
    const { bars } = plan('day', [
      { startDate: '2026-10-05', endDate: midnight.getTime() },
      { startDate: '2026-10-05', endDate: midnight },
      { startDate: '2026-10-05', endDate: '2026-10-07' },
    ]);
    expect(bars[0]).toEqual({ left: '0%', width: share(2, 3) });
    expect(bars[1]).toEqual({ left: '0%', width: share(2, 3) });
  });
});

describe('the computed axis runs on to where the bars are drawn (objectui#11112)', () => {
  it('an hour axis over date-only bars gives the last day all of its hours', () => {
    const { columns, bars } = plan('hour', [{ startDate: '2026-10-05', endDate: '2026-10-06' }]);
    // October 5th and 6th, through the end of the 6th: 48 hour columns.
    expect(columns).toHaveLength(48);
    expect(columns[0].label).toBe('Oct 5, 12 AM');
    expect(columns[47].label).toBe('Oct 6, 11 PM');
    expect(bars).toEqual([{ left: '0%', width: '100%' }]);
  });

  it('an hour axis over an instant end gives that end\'s hour a column, where it had only the day\'s first hour', () => {
    const { columns, bars } = plan('hour', [
      { startDate: '2026-10-05T09:00:00', endDate: '2026-10-05T12:00:00' },
    ]);
    // Midnight to noon: the extent's first day starts the axis, and the bar
    // ends at the end of the 11 AM column. On the base the axis was the one
    // column `Oct 5, 12 AM` and the bar was drawn at `left: 900%`.
    expect(columns).toHaveLength(12);
    expect(columns[11].label).toBe('Oct 5, 11 AM');
    expect(bars).toEqual([{ left: share(9, 12), width: share(3, 12) }]);
    expect(right(bars[0])).toBeCloseTo(100, 10);
  });

  it('a month axis gains no column: a bar ending on April 30th ends at the axis\'s end', () => {
    const { columns, bars } = plan('month', [{ startDate: '2024-03-01', endDate: '2024-04-30' }]);
    expect(columns.map((col) => col.label)).toEqual(['Mar 2024', 'Apr 2024']);
    expect(right(bars[0])).toBeCloseTo(100, 10);
  });
});
