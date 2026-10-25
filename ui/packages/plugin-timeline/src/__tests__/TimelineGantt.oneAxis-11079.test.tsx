/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11079 — a gantt-variant timeline draws its header row and its bars
 * on ONE continuous axis, `[start of the first unit, end of the last unit)`.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * The headers were one equal-width bucket per unit from the minimum date to
 * the maximum date inclusive, and the bars were a percentage of the span from
 * the minimum date to the maximum date, which ends at the START of the last
 * bucket. So the bars sat on a scale one column narrower than the headers: on
 * a day axis over October 5th to 7th the bar starting on the 6th was drawn at
 * `left: 50%` under a column that starts at one third.
 *
 * ── What these pins hold ────────────────────────────────────────────────────
 * For each of the six spec scales, on a pinned three-unit range:
 *  - a bar starting at the second unit's start begins EXACTLY where the second
 *    header begins (the first header's width), and a bar spanning the second
 *    unit is exactly as wide as the second header;
 *  - a bar spanning the last unit ends at 100%.
 * A bar spans a unit as a plan author writes it (objectui#11112): a date-only
 * end names the unit's LAST day and is drawn through it, and an instant end on
 * the `hour` scale is the next unit's start.
 * Plus the `month` columns across a 28/31-day boundary, the card's own day
 * axis on a computed range, and the schema catalog's gantt (the named real
 * producer) read from disk.
 *
 * Geometry is read off the DOM the real `TimelineRenderer` emits: each header
 * cell's inline `width` and each bar's inline `left` / `width`. The suite runs
 * in UTC (`vitest.config.mts` pins `TZ`), so a day is 24 hours here; the DST
 * case runs west of UTC in `TimelineGantt.dateOnlyZone-10866.test.tsx`.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer, generateTimeScaleHeaders } from '../renderer';

afterEach(() => {
  cleanup();
});

/** The named producer: the schema catalog's gantt. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PRODUCER = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
);

interface Drawn {
  /** Each header cell's label and inline width, in order. */
  columns: Array<{ label: string; width: string }>;
  /** Each bar's inline `left` / `width`, in order. */
  bars: Array<{ left: string; width: string }>;
}

/** What the gantt branch draws for `schema`, in `en-US`. */
function draw(schema: Record<string, unknown>): Drawn {
  const { container } = render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as never} />
    </LocalizationProvider>,
  );
  const drawn: Drawn = {
    columns: Array.from(
      container.querySelectorAll<HTMLElement>('.border-r.text-xs.font-medium.text-center'),
    ).map((n) => ({ label: n.textContent ?? '', width: n.style.width })),
    bars: Array.from(container.querySelectorAll<HTMLElement>('.absolute.h-8.rounded-md')).map((b) => ({
      left: b.style.left,
      width: b.style.width,
    })),
  };
  cleanup();
  return drawn;
}

/** A percentage string's number. */
const num = (value: string): number => {
  expect(value, 'expected a percentage').toMatch(/%$/);
  return Number.parseFloat(value);
};

/** `n` of `d` as the percentage string the renderer writes. */
const share = (n: number, d: number): string => `${(n / d) * 100}%`;

/**
 * One scale's three-unit range, pinned by the author: `minDate` is the first
 * unit's start and `maxDate` the last unit's start, so the axis is
 * `[u0, u3)`. `second` spans the second unit and `last` spans the last one,
 * drawn to `u3`, past the pinned `maxDate` and exactly at the axis's end.
 *
 * `e1` / `e2` are the two bars' authored ends. A date-only end is inclusive
 * (objectui#11112), so a bar that fills a unit ends on that unit's last day:
 * `e1` is the day before `u2` and `e2` the day before `u3`. The `hour` scale's
 * ends are instants, `u2` and `u3` themselves.
 */
interface ScaleCase {
  scale: string;
  u0: string;
  u1: string;
  u2: string;
  u3: string;
  e1: string;
  e2: string;
  labels: [string, string, string];
  /** Each unit's length, in any one unit of time, when the columns are not all equal. */
  lengths?: [number, number, number];
}

const SCALES: ScaleCase[] = [
  {
    scale: 'hour',
    u0: '2026-10-05T10:00:00',
    u1: '2026-10-05T11:00:00',
    u2: '2026-10-05T12:00:00',
    u3: '2026-10-05T13:00:00',
    e1: '2026-10-05T12:00:00',
    e2: '2026-10-05T13:00:00',
    labels: ['Oct 5, 10 AM', 'Oct 5, 11 AM', 'Oct 5, 12 PM'],
  },
  {
    scale: 'day',
    u0: '2026-10-05',
    u1: '2026-10-06',
    u2: '2026-10-07',
    u3: '2026-10-08',
    e1: '2026-10-06',
    e2: '2026-10-07',
    labels: ['Oct 5', 'Oct 6', 'Oct 7'],
  },
  {
    scale: 'week',
    u0: '2026-10-05',
    u1: '2026-10-12',
    u2: '2026-10-19',
    u3: '2026-10-26',
    e1: '2026-10-18',
    e2: '2026-10-25',
    labels: ['Week 1', 'Week 2', 'Week 3'],
  },
  {
    // January, February and March 2026: 31, 28 and 31 days.
    scale: 'month',
    u0: '2026-01-01',
    u1: '2026-02-01',
    u2: '2026-03-01',
    u3: '2026-04-01',
    e1: '2026-02-28',
    e2: '2026-03-31',
    labels: ['Jan 2026', 'Feb 2026', 'Mar 2026'],
    lengths: [31, 28, 31],
  },
  {
    // Q1, Q2 and Q3 2026: 90, 91 and 92 days.
    scale: 'quarter',
    u0: '2026-01-01',
    u1: '2026-04-01',
    u2: '2026-07-01',
    u3: '2026-10-01',
    e1: '2026-06-30',
    e2: '2026-09-30',
    labels: ['Q1 2026', 'Q2 2026', 'Q3 2026'],
    lengths: [90, 91, 92],
  },
  {
    // 2024 is a leap year: 366, 365 and 365 days.
    scale: 'year',
    u0: '2024-01-01',
    u1: '2025-01-01',
    u2: '2026-01-01',
    u3: '2027-01-01',
    e1: '2025-12-31',
    e2: '2026-12-31',
    labels: ['2024', '2025', '2026'],
    lengths: [366, 365, 365],
  },
];

function drawScale(c: ScaleCase): Drawn {
  return draw({
    scale: c.scale,
    minDate: c.u0,
    maxDate: c.u2,
    items: [
      {
        label: 'Plan',
        items: [
          { title: 'Second', startDate: c.u1, endDate: c.e1 },
          { title: 'Last', startDate: c.u2, endDate: c.e2 },
        ],
      },
    ],
  });
}

describe('every spec scale draws its headers and bars on one axis (objectui#11079)', () => {
  it.each(SCALES)(
    '$scale: a bar starting at the second unit begins exactly where the second header begins',
    (c) => {
      const { columns, bars } = drawScale(c);
      expect(columns.map((col) => col.label)).toEqual(c.labels);
      const [second] = bars;
      // The second header begins after the first header's width; the bar that
      // starts at the second unit's start is measured on the same axis, so the
      // two are the same number, not two numbers that happen to be close.
      expect(second.left).toBe(columns[0].width);
      expect(second.width).toBe(columns[1].width);
    },
  );

  it.each(SCALES)(
    '$scale: a bar spanning the last unit ends at the right edge, 100 percent of the axis',
    (c) => {
      const { columns, bars } = drawScale(c);
      const last = bars[1];
      // Two separately rounded shares of the axis, so their sum is compared to
      // ten decimal places rather than as a string.
      expect(num(last.left) + num(last.width)).toBeCloseTo(100, 10);
      expect(last.width).toBe(columns[2].width);
      // The columns tile the axis with no gap.
      expect(columns.reduce((sum, col) => sum + num(col.width), 0)).toBeCloseTo(100, 10);
    },
  );

  it.each(SCALES)(
    '$scale: each header is as wide as its unit is long',
    (c) => {
      const { columns } = drawScale(c);
      if (c.lengths) {
        const total = c.lengths[0] + c.lengths[1] + c.lengths[2];
        expect(columns.map((col) => col.width)).toEqual(c.lengths.map((n) => share(n, total)));
      } else {
        // `hour`, `day` and `week` units are all the same length here.
        expect(columns.map((col) => col.width)).toEqual([share(1, 3), share(1, 3), share(1, 3)]);
      }
    },
  );

  it('month across a 28/31-day boundary: February is narrower than January, and a bar from February 1st starts on its header', () => {
    const month = SCALES.find((c) => c.scale === 'month')!;
    const { columns, bars } = drawScale(month);
    expect(columns[0].width).toBe(share(31, 90));
    expect(columns[1].width).toBe(share(28, 90));
    expect(num(columns[1].width)).toBeLessThan(num(columns[0].width));
    expect(bars[0]).toEqual({ left: share(31, 90), width: share(28, 90) });
  });
});

describe("the card's own day axis, on a computed range (objectui#11079)", () => {
  it('the bar starting on October 6th begins at one third, where its header begins, not at 50%', () => {
    const { columns, bars } = draw({
      scale: 'day',
      items: [
        {
          label: 'Build',
          items: [
            { title: 'First', startDate: '2026-10-05', endDate: '2026-10-06' },
            { title: 'Second', startDate: '2026-10-06', endDate: '2026-10-07' },
          ],
        },
      ],
    });
    // The axis is October 5th to the end of October 7th: three days.
    expect(columns).toEqual([
      { label: 'Oct 5', width: share(1, 3) },
      { label: 'Oct 6', width: share(1, 3) },
      { label: 'Oct 7', width: share(1, 3) },
    ]);
    // Each date-only end is drawn through its day (objectui#11112), so each
    // bar is two days wide and the second one ends at the axis's end.
    expect(bars).toEqual([
      { left: '0%', width: share(2, 3) },
      { left: share(1, 3), width: share(2, 3) },
    ]);
    expect(bars[1].left).toBe(columns[0].width);
  });
});

describe('each unit starts on its unit boundary (objectui#11079)', () => {
  it('a month range that starts mid-month draws the month its end falls in', () => {
    // The walk used to step from the minimum date itself, so April 15th was
    // past the end and April had no column under a bar that reached it.
    expect(generateTimeScaleHeaders('month', '2026-01-15', '2026-04-10')).toEqual([
      'Jan 2026',
      'Feb 2026',
      'Mar 2026',
      'Apr 2026',
    ]);
  });

  it('a month range that starts on the 31st does not skip February', () => {
    // January 31st plus one month rolls into March 3rd.
    expect(generateTimeScaleHeaders('month', '2026-01-31', '2026-03-15')).toEqual([
      'Jan 2026',
      'Feb 2026',
      'Mar 2026',
    ]);
  });

  it('a day axis whose ends carry a time of day still gives the last day a column', () => {
    expect(generateTimeScaleHeaders('day', '2026-10-05T10:00:00', '2026-10-07T09:00:00')).toEqual([
      'Oct 5',
      'Oct 6',
      'Oct 7',
    ]);
  });
});

describe('the schema catalog gantt, the named real producer (objectui#11079)', () => {
  it('the producer fixture is on disk, and is a month gantt from January to April 2024', () => {
    expect(fs.existsSync(PRODUCER), `fixture not found at ${PRODUCER}`).toBe(true);
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
    expect(doc.variant).toBe('gantt');
    expect(doc.scale).toBe('month');
  });

  it('its months are as wide as their days, and each bar starting on the 1st starts on its month', () => {
    const doc = JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
    const { columns, bars } = draw(doc);
    // The rows run from January 1st to April 30th 2024, so the axis is
    // January 1st to May 1st: 31 + 29 + 31 + 30 = 121 days.
    expect(columns).toEqual([
      { label: 'Jan 2024', width: share(31, 121) },
      { label: 'Feb 2024', width: share(29, 121) },
      { label: 'Mar 2024', width: share(31, 121) },
      { label: 'Apr 2024', width: share(30, 121) },
    ]);
    // Bars in document order: API Design, Implementation, UI Design,
    // Component Dev, QA Phase.
    expect(bars.map((b) => b.left)).toEqual([
      '0%',
      share(31, 121),
      share(14, 121),
      share(45, 121),
      share(60, 121),
    ]);
    // Implementation starts on February 1st: where the February header begins.
    expect(bars[1].left).toBe(columns[0].width);
    // QA Phase starts on March 1st: after the January and February headers.
    expect(num(bars[4].left)).toBeCloseTo(num(columns[0].width) + num(columns[1].width), 10);
  });
});
