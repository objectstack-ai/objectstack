/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7247 — a vertical bar chart in a dashboard-width widget dropped most
 * of its categorical x-axis labels: 3 bars drew 1 label, 5 bars drew 2, so the
 * bars had no names and a single-series bar chart has no legend to fall back
 * on. The x axis carried a TIME-series thinning policy (`preserveStartEnd` +
 * `minTickGap: 48`) that is correct for hundreds of dates and wrong for a band
 * axis, where a dropped tick is an unrecoverable identity rather than a
 * skippable sample. #7247 fixed this AT OR BELOW 5 buckets by drawing every
 * label unconditionally (`X_AXIS_ALL_LABELS_MAX_BUCKETS`); ABOVE the bound the
 * 48px budget was left untouched and is the subject of objectui#7386 below.
 *
 * objectui#7386 — the same 48px (32px mobile) budget was still charged above
 * the bound: a 7-status pipeline at 290px (≈33px/band) dropped 4 of 7 names
 * even though nothing was actually wide enough to collide. `minTickGap` is
 * ADDED on top of recharts' own measured-overlap check (`getTicks.js`:
 * `start = tickCoord + size/2 + minTickGap`), so it was mandatory whitespace
 * beyond what real collision avoidance required — removing it (`minTickGap:
 * 0`) leaves that check as the only thing doing the work, which is what it
 * already did for every tick it kept. Two things this file's happy-dom
 * environment CANNOT verify, both true only in real Chromium (measured and
 * recorded in the PR, not here — happy-dom's `getStringSize` reports zero for
 * every string, so the tests below can only show that the artificial floor is
 * gone, never that real text would still avoid colliding):
 *   1. at 7/8 buckets and realistic widget widths, every label now draws with
 *      ZERO measured overlap (checked via each rotated label's true rotated
 *      rectangle, not an axis-aligned box, which over-reports collisions for
 *      diagonal text);
 *   2. a high-cardinality series (180 points at 800px) still thins sensibly
 *      with zero overlap — `minTickGap: 0` removes only the extra margin,
 *      not recharts' measured-width check itself, so the "hundreds of
 *      points" case objectui#7247 worried about stays protected by that same
 *      check, just without the added tax.
 *
 * The width is injected the way the sibling axis test does it — recharts'
 * `ResponsiveContainer` measures a real box, and happy-dom has no layout — so
 * these render at the exact widget widths the report names.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/** Widget width under test, in px. Read at render time by the mock below. */
let containerWidth = 200;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: containerWidth, height: 260 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(() => {
  cleanup();
  containerWidth = 200;
});

/**
 * The drawn tick labels of one axis. Recharts renders tick text into a
 * z-index layer OUTSIDE the `.recharts-xAxis` group, so this selects by the
 * per-axis `*-tick-labels` class rather than by descent from the axis.
 */
function tickLabels(container: HTMLElement, axis: 'x' | 'y'): string[] {
  return Array.from(
    container.querySelectorAll(
      `.recharts-${axis}Axis-tick-labels .recharts-cartesian-axis-tick-value`,
    ),
  ).map((n) => (n.textContent || '').trim());
}

const STATUSES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'];
const TASKS_BY_STATUS = STATUSES.map((status, i) => ({ status, count: 5 - i }));
const PROJECTS_BY_HEALTH = ['Green', 'Yellow', 'Red'].map((health, i) => ({ health, count: 4 - i }));
const TASKS_BY_PRIORITY = ['Low', 'Normal', 'High', 'Urgent'].map((priority, i) => ({ priority, count: i + 1 }));

// The report's own reproduction (objectui#7386): a 7-status pipeline, one
// bucket above X_AXIS_ALL_LABELS_MAX_BUCKETS.
const PIPELINE_7 = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Testing', 'Done'];
const TASKS_BY_PIPELINE_STAGE = PIPELINE_7.map((status, i) => ({ status, count: 7 - i }));

function renderBar(data: any[], xAxisKey: string, chartType: 'bar' | 'horizontal-bar' = 'bar') {
  return render(
    <AdvancedChartImpl
      chartType={chartType}
      data={data}
      xAxisKey={xAxisKey}
      series={[{ dataKey: 'count', label: 'Count' }]}
    />,
  );
}

describe('AdvancedChartImpl — categorical x-axis label density (objectui#7247)', () => {
  it('names every bar of a 5-bucket chart at a 200px dashboard widget width', () => {
    const { container } = renderBar(TASKS_BY_STATUS, 'status');
    expect(tickLabels(container, 'x')).toEqual(STATUSES);
  });

  it('names every bar of a 3-bucket chart at a 200px dashboard widget width', () => {
    const { container } = renderBar(PROJECTS_BY_HEALTH, 'health');
    expect(tickLabels(container, 'x')).toEqual(['Green', 'Yellow', 'Red']);
  });

  it('names every bar of a 4-bucket chart at a 200px dashboard widget width', () => {
    const { container } = renderBar(TASKS_BY_PRIORITY, 'priority');
    expect(tickLabels(container, 'x')).toEqual(['Low', 'Normal', 'High', 'Urgent']);
  });

  it('keeps every label for line and area charts on the same short categorical axis', () => {
    for (const chartType of ['line', 'area'] as const) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType}
          data={TASKS_BY_STATUS}
          xAxisKey="status"
          series={[{ dataKey: 'count', label: 'Count' }]}
        />,
      );
      expect(tickLabels(container, 'x')).toEqual(STATUSES);
      cleanup();
    }
  });

  it('ellipsises a rotated label instead of letting it overrun the axis height', () => {
    const { container } = renderBar(
      [
        { status: 'Waiting on customer', count: 3 },
        { status: 'Done', count: 1 },
      ],
      'status',
    );
    // 12 chars kept, the 12th replaced by the ellipsis (see
    // ROTATED_X_LABEL_MAX_CHARS) — a shortened name, never a missing one.
    expect(tickLabels(container, 'x')).toEqual(['Waiting on …', 'Done']);
  });

  describe('above the bound (objectui#7386) — minTickGap no longer taxes a band axis', () => {
    it('names every bar of a 7-bucket pipeline at the reported 290px widget width', () => {
      containerWidth = 290;
      const { container } = renderBar(TASKS_BY_PIPELINE_STAGE, 'status');
      expect(tickLabels(container, 'x')).toEqual(PIPELINE_7);
    });

    it('names every bar of a 6-bucket chart at a 200px dashboard widget width', () => {
      const six = [...STATUSES, 'Archived'].map((status, i) => ({ status, count: 6 - i }));
      const { container } = renderBar(six, 'status');
      expect(tickLabels(container, 'x')).toEqual([...STATUSES, 'Archived']);
    });
  });

  /**
   * objectui#7386 — this is a DELIBERATELY WEAKENED assertion, not an
   * oversight. Before this change, `minTickGap: 48` was the ONLY thing
   * bounding tick count in happy-dom (which reports zero for every string —
   * `getStringSize` — so recharts' real measured-overlap check, the thing
   * that does this job in production, cannot fire here at all). Now that
   * `minTickGap` is `0`, nothing in this environment can distinguish "every
   * label genuinely fits" from "the floor was removed" — with zero measured
   * size, `getTicks.js`'s own boundary math shows every tick regardless of
   * count. So this pin can only document that fact, not guard against a
   * "hundreds of points pile up" regression; that guard now lives in the
   * real-Chromium verification recorded on the PR (180 points at 800px,
   * thinned to 11, zero measured overlap) — see the file header.
   */
  it('draws every tick for a high-cardinality axis in happy-dom (zero text metrics, not a production claim)', () => {
    const many = Array.from({ length: 24 }, (_, i) => ({
      day: `2026-01-${String(i + 1).padStart(2, '0')}`,
      count: i,
    }));
    const { container } = render(
      <AdvancedChartImpl
        chartType="line"
        data={many}
        xAxisKey="day"
        series={[{ dataKey: 'count', label: 'Count' }]}
      />,
    );
    const drawn = tickLabels(container, 'x');
    expect(drawn.length).toBe(many.length);
  });

  it('does not regress the horizontal bar family, whose category axis is y', () => {
    const { container } = renderBar(TASKS_BY_STATUS, 'status', 'horizontal-bar');
    expect(tickLabels(container, 'y')).toEqual(STATUSES);
  });
});
