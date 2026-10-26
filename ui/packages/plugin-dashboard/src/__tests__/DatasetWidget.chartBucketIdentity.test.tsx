/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4508 — the CONSUMER half of the chart bucket identity.
 *
 * `DatasetWidget.handleChartDrill` is the one production caller of
 * `findChartSeriesRow`, so it is where the two collisions were felt: it takes a
 * clicked segment, resolves it to a raw dataset row, and opens the drawer
 * filtered by that row. Both collisions were invisible in the transform's
 * return value and visible here, as the WRONG RECORDS (or none).
 *
 * The sibling files pin the other two layers: `chart-series.nullCategory.test.
 * ts` the transform, `AdvancedChartImpl.bucketIdentity.test.tsx` that the
 * identity survives the chart library. This one asserts the thing a user
 * experiences — which records the drawer opens on.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the two collision cases are RED before the change, and each in its own
 *    way: the literal-label case resolves to the WRONG row (a filter naming
 *    another group's record), the empty-string case to a null group's row;
 *  - every BOUNDARY case is GREEN on both sides. A chart with no colliding
 *    bucket must drill byte-identically to how it drills today, including the
 *    plain null bucket that objectui#4466/#4500 made work.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, NULL_CATEGORY_LABEL, chartRowBucketId } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

/** Observe the drill filter without rendering the real drawer. */
const drillFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drillFilters.push(filter);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drillFilters.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Plain TEXT dimension field: no option list, so no relabel can blur which
 *  channel produced the category string under test. */
const OPPORTUNITY = { name: 'crm_opportunity', fields: { owner_id: { type: 'text' } } };

function installMetaRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: OPPORTUNITY }) })),
  );
}

/**
 * `drillRawRows` carries the IDENTITY keys, deliberately spelled differently
 * from every display value, so a resolved drill names exactly one row and a
 * lucky string match cannot be mistaken for a correct one.
 */
const datasetOf = (rows: Array<Record<string, unknown>>, rawRows: Array<Record<string, unknown>>) => ({
  queryDataset: vi.fn(async () => ({
    rows,
    fields: [
      { name: 'owner_name', type: 'text', label: 'Owner' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { owner_name: 'owner_id' },
    drillRawRows: rawRows,
  })),
});

function renderWidget(dataSource: { queryDataset: unknown }) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'deals_by_owner',
          dimensions: ['owner_name'],
          values: ['deals'],
          drillDown: { enabled: true },
        }}
        dataSource={dataSource as any}
      />
    </I18nProvider>,
  );
}

/** The rows the widget handed the chart renderer — one per drawn bar. */
const chartRows = (): Array<Record<string, unknown>> => capturedChartProps?.schema?.data ?? [];

/**
 * Click the bar drawn from `chartRows()[i]`, exactly as the renderer would:
 * the axis text it paints, plus whatever identity that row carries.
 */
const clickBar = (i: number) => {
  const row = chartRows()[i];
  capturedChartProps.onSegmentClick({
    category: row.owner_name == null ? undefined : String(row.owner_name),
    categoryId: chartRowBucketId(row),
  });
};

const lastFilter = () => drillFilters[drillFilters.length - 1];

describe('DatasetWidget — a bucket drills to ITS OWN rows (objectui#4508)', () => {
  it('a stored value spelling the bucket label no longer steals the null bucket’s drill', async () => {
    // Collision 2. Both bars paint `(None)`: one because a record literally
    // stores that text, one because a group has no value at all. Pre-fix the
    // click resolved by axis text, so BOTH bars filtered on `user-literal` —
    // a drill into records the clicked bar was not drawn from.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { owner_name: NULL_CATEGORY_LABEL, deals: 1 },
          { owner_name: null, deals: 2 },
        ],
        [{ owner_name: 'user-literal' }, { owner_name: 'user-absent' }],
      ),
    );

    await waitFor(() => expect(chartRows().length).toBe(2));
    // Precondition, stated rather than assumed: the axis text cannot tell them
    // apart, which is why the identity is carried at all.
    expect(chartRows().map((r) => r.owner_name)).toEqual([NULL_CATEGORY_LABEL, NULL_CATEGORY_LABEL]);

    clickBar(0);
    // Bound to the drill having opened AT LEAST once (objectui#4706/#4718), not
    // to an exact cumulative render count: `drillFilters` only ever grows, and
    // a late, unrelated `setMeta` from the dimension-metadata fetch (issued by
    // `useDatasetDimensionMeta`, resolving independently of the click) can land
    // a SECOND identical render after this one click — an overshoot `waitFor`
    // can never recover from once it happens, since the array never shrinks.
    // The case is about WHICH records the drawer filters on, not how many
    // times React chose to render it, so `lastFilter()` — the content check
    // below — is what carries the assertion; the count only needs to confirm
    // the drawer opened at all.
    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(lastFilter()).toEqual({ owner_id: 'user-literal' });

    clickBar(1);
    // Pre-fix: `user-literal` again — the wrong records, silently.
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: 'user-absent' }));
  });

  it('an empty-string group drills to itself, not to the null group', async () => {
    // Collision 1, on the drill side. `''` and null used to read as the same
    // "no value" spelling, so the empty-string bar resolved to the null row.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { owner_name: null, deals: 3 },
          { owner_name: '', deals: 5 },
        ],
        [{ owner_name: 'user-absent' }, { owner_name: 'user-empty' }],
      ),
    );

    await waitFor(() => expect(chartRows().length).toBe(2));
    // Two DIFFERENT bars: the null one labelled, the empty-string one blank.
    expect(chartRows().map((r) => r.owner_name)).toEqual([NULL_CATEGORY_LABEL, '']);

    clickBar(1);
    // Pre-fix: `user-absent` — the null group's records under the blank bar.
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: 'user-empty' }));

    clickBar(0);
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: 'user-absent' }));
  });

  it('BOUNDARY — the plain null bucket still drills exactly as objectui#4466 made it', async () => {
    // Green on both sides. Nothing about this widget is ambiguous, so no
    // identity is carried and the bucket label resolves it, as it always did.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { owner_name: 'Ada Lovelace', deals: 5 },
          { owner_name: null, deals: 3 },
        ],
        [{ owner_name: 'user-ada' }, { owner_name: null }],
      ),
    );

    await waitFor(() => expect(chartRows().length).toBe(2));
    expect(chartRows()[1]).toEqual({ owner_name: NULL_CATEGORY_LABEL, deals: 3 });

    clickBar(1);
    // objectui#9085: the empty bucket's is-empty predicate, not a bare `null`
    // the converter would drop. What this BOUNDARY case pins is unchanged —
    // that the null bucket drills by the OWNER FIELD at all.
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: { $null: true } }));
  });

  it('BOUNDARY — an ordinary category drills by its stored id, rows untouched', async () => {
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { owner_name: 'Ada Lovelace', deals: 5 },
          { owner_name: 'Grace Hopper', deals: 3 },
        ],
        [{ owner_name: 'user-ada' }, { owner_name: 'user-grace' }],
      ),
    );

    await waitFor(() => expect(chartRows().length).toBe(2));
    // No renderer-internal key reaches the chart schema for an ordinary chart.
    expect(chartRows()).toEqual([
      { owner_name: 'Ada Lovelace', deals: 5 },
      { owner_name: 'Grace Hopper', deals: 3 },
    ]);

    clickBar(0);
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: 'user-ada' }));
  });

  it('BOUNDARY — a host that forwards no identity keeps its current drill', async () => {
    // The widget must not require the new field: an older renderer (or a chart
    // family whose click carries no row) still drills by category text.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { owner_name: 'Ada Lovelace', deals: 5 },
          { owner_name: null, deals: 3 },
        ],
        [{ owner_name: 'user-ada' }, { owner_name: null }],
      ),
    );

    await waitFor(() => expect(chartRows().length).toBe(2));
    capturedChartProps.onSegmentClick({ category: NULL_CATEGORY_LABEL });
    // objectui#9085 spelling; the identity-free fallback path itself is unchanged.
    await waitFor(() => expect(lastFilter()).toEqual({ owner_id: { $null: true } }));
  });
});
