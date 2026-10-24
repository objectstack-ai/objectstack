/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7946 — the RUNTIME half of the anchor: a structured
 * `aggregate.groupBy` node resolves to its projected COLUMN everywhere the
 * column is used.
 *
 * ## Why this file exists
 *
 * The card's changeset claims a behaviour fix, and a claim without a pin is a
 * claim. Its two new companions are compile-time and census pins — the anchored
 * prop type (`ObjectChart.schemaAnchor-7946.test.ts`) and the declared-key
 * census (`packages/types/src/__tests__/widget-schema-anchors-7946.test.ts`) —
 * and NEITHER can see this: the defect is a wrong runtime VALUE flowing from a
 * correctly-typed read.
 *
 * ## The defect, stated so an ablation reads cleanly
 *
 * `aggregate.groupBy` is a union — a bare field name, or the structured
 * date-bucketing node `{ field, dateGranularity?, alias? }` the engine takes.
 * When it is the node, the column the result rows are keyed by is `alias`, or
 * the `field` it defaults to — NOT the node. `ObjectChart.tsx` resolved that
 * twice: the comparison-merge leg normalised, and the drill / label leg 200
 * lines below used the raw union as
 *
 *   - a ROW INDEX (`row[groupByField]` — the label→raw reverse map), and
 *   - a DRILL-FILTER KEY (`computeDrillFilter(…, { groupByField })`).
 *
 * A JavaScript object used as either is stringified, so on every date-bucketed
 * chart the reverse map was empty and the drill filtered on the literal key
 * `[object Object]` — silently, with a drawer that opened on the wrong rows.
 * `(props: any)` is why no instrument said so. Both sites now share
 * `aggregateGroupByKey`.
 *
 * ## Why the observation point is `target: 'navigate'`
 *
 * The drill filter is the value under test, and through the navigate arm the
 * component hands it to the host verbatim — one spy, no DOM archaeology over a
 * drilled table. The drawer arm composes the SAME `drillFilter` memo (hoisted
 * precisely so both targets drill by one filter), so this is not a
 * navigate-only property. `ChartRenderer` is mocked down to a click surface for
 * the reason `ObjectChart.drillNavigate.test.tsx` gives: what is under test is
 * this component's key resolution, not recharts' hit-testing.
 *
 * ⭐ Each case asserts the WHOLE filter object, not just its value, so the
 * pre-fix state fails on the KEY (`[object Object]`) rather than needing a
 * separate probe for it — and the negative assertion is spelled out anyway,
 * because a key that changed to something else wrong would otherwise read the
 * same as a key that was fixed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DrillNavigationProvider } from '@object-ui/react';
import type { ObjectChartSchema } from '@object-ui/types';

/** The category the fake segment reports as clicked, per test. */
let clickedCategory = '';

vi.mock('../ChartRenderer', () => ({
  // Rows arrive on `schema.data` — `ObjectChart` hands the renderer ONE schema
  // (`finalSchemaWithColors`), not a separate `data` prop.
  ChartRenderer: ({ onChartClick, schema }: any) => (
    <button
      type="button"
      data-testid="fake-segment"
      data-rows={JSON.stringify(schema?.data ?? [])}
      onClick={() => onChartClick?.({ category: clickedCategory, series: 'count', value: 1 })}
    >
      segment
    </button>
  ),
}));

import { ObjectChart } from '../ObjectChart';

const OBJECT = 'crm_opportunity';

/**
 * The option-colour probe reads `GET /api/v1/meta/object/<objectName>` off the
 * GLOBAL fetch for any schema carrying `objectName`. Answering `{}` reproduces
 * the failed-request outcome exactly (the effect swallows it by design), and
 * recording the URLs keeps an escape to any OTHER endpoint a failure rather
 * than swallowed stderr — the shape `ObjectChart.drillNavigate.test.tsx`
 * established.
 */
let metaCalls: string[] = [];
beforeEach(() => {
  clickedCategory = '';
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      metaCalls.push(String(input));
      return { ok: true, json: async () => ({}) };
    }),
  );
});
afterEach(() => {
  expect(metaCalls.filter((u) => u !== `/api/v1/meta/object/${OBJECT}`)).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
});

/** Renders through the navigate arm and hands back the host spy. */
function renderChart(schema: Partial<ObjectChartSchema>, ds: Record<string, unknown>) {
  const openRecordList = vi.fn();
  render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          objectName: OBJECT,
          isAnimationActive: false,
          drillDown: { enabled: true, target: 'navigate' },
          ...schema,
        } as ObjectChartSchema}
        dataSource={ds}
      />
    </DrillNavigationProvider>,
  );
  return openRecordList;
}

describe('ObjectChart — a structured `aggregate.groupBy` resolves to its projected column (objectui#7946)', () => {
  it('drills on the ALIAS the aggregate projects the group under, not on the node', async () => {
    // The engine projects the bucketed group under `alias`, so this is the
    // column every result row is keyed by — and the only key a drill filter on
    // this chart can mean.
    const ds = {
      aggregate: vi.fn(async () => [
        { month: '2026-03-01', count: 7 },
        { month: '2026-04-01', count: 3 },
      ]),
      find: vi.fn(async () => []),
    };
    clickedCategory = '2026-03-01';

    const openRecordList = renderChart(
      {
        aggregate: { function: 'count', groupBy: { field: 'close_date', dateGranularity: 'month', alias: 'month' } },
        series: [{ dataKey: 'count' }],
      },
      ds,
    );

    await waitFor(() => expect(screen.getByTestId('fake-segment')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const [objectName, filter] = openRecordList.mock.calls[0];
    expect(objectName).toBe(OBJECT);
    // Whole object: the pre-fix state fails on the KEY, not on the value.
    expect(filter).toEqual({ month: '2026-03-01' });
    // …spelled out, because a differently-wrong key reads the same as a fixed one.
    expect(Object.keys(filter as object)).not.toContain('[object Object]');
  });

  it('falls back to the node`s FIELD when it declares no alias', async () => {
    // `alias` is optional; with none, the engine projects under `field`. The
    // control for the case above — it proves the resolution reads the node
    // rather than always finding a key called `month`.
    const ds = {
      aggregate: vi.fn(async () => [{ close_date: '2026-03-01', count: 7 }]),
      find: vi.fn(async () => []),
    };
    clickedCategory = '2026-03-01';

    const openRecordList = renderChart(
      {
        aggregate: { function: 'count', groupBy: { field: 'close_date', dateGranularity: 'month' } },
        series: [{ dataKey: 'count' }],
      },
      ds,
    );

    await waitFor(() => expect(screen.getByTestId('fake-segment')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    expect(openRecordList.mock.calls[0][1]).toEqual({ close_date: '2026-03-01' });
  });

  it('recovers the RAW value behind a resolved option label — the reverse map, on a structured node', async () => {
    // The other half the raw union broke. `resolveGroupByLabels` replaces the
    // group column with the option's LABEL and stashes the original under
    // `__raw_<column>`; the click handler reverses that so the drill filters on
    // what the backend stores. Both the stash and the lookup are keyed by the
    // projected column, so with the raw node they were keyed by its
    // stringification — the map came back empty and the label leaked into the
    // filter.
    const ds = {
      aggregate: vi.fn(async () => [{ stage: 'won', count: 4 }]),
      find: vi.fn(async () => []),
      getObjectSchema: vi.fn(async () => ({
        fields: {
          stage: { type: 'select', options: [{ value: 'won', label: 'Closed Won' }] },
        },
      })),
    };
    // The user clicks the LABEL — that is what the chart drew.
    clickedCategory = 'Closed Won';

    const openRecordList = renderChart(
      {
        aggregate: { function: 'count', groupBy: { field: 'stage', alias: 'stage' } },
        series: [{ dataKey: 'count' }],
      },
      ds,
    );

    // Non-vacuity: the label resolution must actually have run, otherwise the
    // reverse map is trivially the identity and this pin measures nothing.
    await waitFor(() => {
      const rows = JSON.parse(screen.getByTestId('fake-segment').getAttribute('data-rows') ?? '[]');
      expect(rows[0]?.stage).toBe('Closed Won');
      expect(rows[0]?.__raw_stage).toBe('won');
    });

    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    expect(openRecordList.mock.calls[0][1]).toEqual({ stage: 'won' });
  });

  it('still drills on a BARE-STRING groupBy — the arm that always worked', async () => {
    // The control that keeps the three cases above from passing for a reason
    // that has nothing to do with the union: the legacy string arm must be
    // untouched by the normalisation.
    const ds = {
      aggregate: vi.fn(async () => [{ stage: 'won', count: 4 }]),
      find: vi.fn(async () => []),
    };
    clickedCategory = 'won';

    const openRecordList = renderChart(
      {
        aggregate: { function: 'count', groupBy: 'stage' },
        series: [{ dataKey: 'count' }],
      },
      ds,
    );

    await waitFor(() => expect(screen.getByTestId('fake-segment')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    expect(openRecordList.mock.calls[0][1]).toEqual({ stage: 'won' });
  });
});
