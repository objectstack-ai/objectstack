/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A segment click whose drill filter this layer refuses is reported, not
 * thrown out of render — objectui#10789.
 *
 * `ObjectChart` composes its own `filter` with the clicked category inside a
 * RENDER-time `useMemo` (`composeDrillFilter` → `mergeFilterNodes`), which
 * lowers through the THROWING converter form. A spec `$not` in the widget
 * filter is refused by this layer's converter, so the click that set the
 * drill event re-rendered the chart into a `FilterOperatorError` — the error
 * boundary instead of the chart.
 *
 * Pinned on both targets, because each had its own way of going wrong once the
 * throw was caught: the drawer must not open, and `navigate` must not hand the
 * host a filter-less list (`openRecordList(object, undefined)` lists every
 * record the chart is scoped to exclude). The refusal is logged, naming the
 * operator.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DrillNavigationProvider } from '@object-ui/react';
import type { ObjectChartSchema } from '@object-ui/types';

vi.mock('../ChartRenderer', () => ({
  ChartRenderer: ({ onChartClick }: any) => (
    <button
      type="button"
      data-testid="fake-segment"
      onClick={() => onChartClick?.({ category: 'won', series: 'count', value: 1 })}
    >
      segment
    </button>
  ),
}));

import { ObjectChart } from '../ObjectChart';

const OBJECT = 'crm_opportunity';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderChart(filter: ObjectChartSchema['filter'], target: 'drawer' | 'navigate') {
  const openRecordList = vi.fn();
  render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          objectName: OBJECT,
          xAxisKey: 'stage',
          data: [{ stage: 'won', count: 2 }],
          isAnimationActive: false,
          filter,
          drillDown: { enabled: true, target },
        } as ObjectChartSchema}
        dataSource={{ find: async () => ({ data: [] }) }}
      />
    </DrillNavigationProvider>,
  );
  return openRecordList;
}

const refusalWarnings = () =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('drill-down refused'));

/**
 * Two refusals, one per refusing step of the drill seam:
 *  - `$not` — declared by the spec, refused by this layer's CONVERTER;
 *  - `[['stage', 'in', 'won']]` — the array dialect `ObjectChartSchema.filter`
 *    admits, which the converter passes through untouched and the spec's own
 *    `parseFilterAST` refuses (a scalar on a list operator). The contract
 *    review's probe of this PR's first head.
 */
const REFUSALS: ReadonlyArray<[string, ObjectChartSchema['filter'], string]> = [
  ['converter refusal', { $not: { region: 'apac' } } as unknown as ObjectChartSchema['filter'], '$not'],
  ['spec refusal (array dialect)', [['stage', 'in', 'won']] as unknown as ObjectChartSchema['filter'], '$in'],
];
const CASES = REFUSALS.flatMap(([label, filter, operator]) =>
  (['drawer', 'navigate'] as const).map((target) => [label, target, filter, operator] as const),
);

describe('ObjectChart — a refused drill filter (objectui#10789)', () => {
  it.each(CASES)('%s, target %s — the chart stays, nothing opens, the refusal is logged', (_label, target, filter, operator) => {
    const openRecordList = renderChart(filter, target);
    fireEvent.click(screen.getByTestId('fake-segment'));

    // The chart is still mounted: the click did not throw it into a boundary.
    expect(screen.getByTestId('fake-segment')).toBeTruthy();
    expect(screen.queryByTestId('chart-drill-body')).toBeNull();
    expect(openRecordList).not.toHaveBeenCalled();
    expect(refusalWarnings()).toHaveLength(1);
    expect(refusalWarnings()[0]).toContain(operator);
  });

  it('CONTROL — a well-formed widget filter still drills', () => {
    const openRecordList = renderChart({ region: 'emea' } as ObjectChartSchema['filter'], 'navigate');
    fireEvent.click(screen.getByTestId('fake-segment'));
    expect(openRecordList).toHaveBeenCalledWith(OBJECT, {
      $and: [{ region: 'emea' }, { stage: 'won' }],
    });
    expect(refusalWarnings()).toHaveLength(0);
  });
});
