/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4682 — the drill drawer's TITLE, over a group that keys by identity.
 *
 * `handleChartDrill` composed its title out of `ev.series`, which is a renderer
 * `dataKey` and not a display label. For every ordinary group those are the
 * same string, which is why this read correctly for so long. They part company
 * exactly when a group's label cannot NAME it — objectui#4508's collision on
 * the series axis, reachable since objectui#4673 — and the group keys its
 * column by its `chartBucketId` instead.
 *
 * The user then clicks a segment labelled `(None)` and the drawer opens on the
 * right records under the title `Backlog / [null]`. Right data, opaque title:
 * an internal id where a label belongs reads as broken DATA rather than as a
 * broken title, which is the whole reason this was filed.
 *
 * The KEY still does the lookup — `findChartSeriesRow` resolves it through the
 * same assignment `buildChartSeries` made, and a label cannot be resolved that
 * way because a label is exactly what these two groups SHARE. Only the title
 * reads `seriesLabel`.
 *
 * DIRECTIONS, written before the reverse verification was run: the identity
 * case is RED before the change (the title carries `[null]`), and every
 * ordinary case is GREEN on both sides — an ordinary group's label IS its key,
 * so its title cannot move.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import {
  ComponentRegistry,
  NULL_CATEGORY_LABEL,
  buildChartSeries,
  chartRowBucketId,
  type ChartSegmentClickEvent,
} from '@object-ui/core';
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

/** Observe the drawer's TITLE — the field under test — and its filter. */
const drawerProps: Array<{ title: string; filter: Record<string, unknown> }> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ title, filter }: { title: string; filter: Record<string, unknown> }) => {
    drawerProps.push({ title, filter });
    return null;
  },
}));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drawerProps.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Plain TEXT dimensions: no option list can relabel anything under the test. */
const TASK = {
  name: 'proj_task',
  fields: { status_id: { type: 'text' }, priority_id: { type: 'text' } },
};

function installMetaRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: TASK }) })),
  );
}

const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

const datasetOf = (
  rows: Array<Record<string, unknown>>,
  rawRows: Array<Record<string, unknown>>,
) => ({
  queryDataset: vi.fn(async () => ({
    rows,
    fields: [
      { name: 'status', type: 'text', label: 'Status' },
      { name: 'priority', type: 'text', label: 'Priority' },
      { name: 'est_hours', type: 'number', label: 'Hours' },
    ],
    object: 'proj_task',
    // Both dimensions drill, so the filter names the clicked GROUP as well as
    // the clicked bucket — which is what makes a wrong series visible.
    dimensionFields: { status: 'status_id', priority: 'priority_id' },
    drillRawRows: rawRows,
  })),
});

function renderWidget(dataSource: { queryDataset: unknown }) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'hours_by_status_priority',
          dimensions: DIMS,
          values: VALS,
          drillDown: { enabled: true },
        }}
        dataSource={dataSource as any}
      />
    </I18nProvider>,
  );
}

/** The series the widget handed the renderer — one per drawn group. */
const chartSeries = (): Array<{ dataKey: string; label?: string }> =>
  capturedChartProps?.schema?.series ?? [];
const chartData = (): Array<Record<string, unknown>> => capturedChartProps?.schema?.data ?? [];

/**
 * Click the segment series `si` drew over bucket `bi`, composing exactly what
 * `AdvancedChartImpl`'s mark handler composes: the key for the lookup, the
 * label for the title, and the bucket's identity.
 */
const clickSegment = (si: number, bi: number) => {
  const s = chartSeries()[si];
  const row = chartData()[bi];
  const ev: ChartSegmentClickEvent = {
    category: row[capturedChartProps.schema.xAxisKey] == null
      ? undefined
      : String(row[capturedChartProps.schema.xAxisKey]),
    categoryId: chartRowBucketId(row),
    series: s.dataKey,
    seriesLabel: s.label,
    value: typeof row[s.dataKey] === 'number' ? (row[s.dataKey] as number) : undefined,
  };
  capturedChartProps.onSegmentClick(ev);
  return ev;
};

const lastDrawer = () => drawerProps[drawerProps.length - 1];

describe('DatasetWidget — the drill title reads the series LABEL (objectui#4682)', () => {
  it('titles an identity-keyed group with what its segment said, not with its key', async () => {
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          // Two groups that PAINT the same text: one stores it literally, one
          // has no value at all. objectui#4508's collision, on the series axis.
          { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
          { status: 'Backlog', priority: null, est_hours: 2 },
        ],
        [
          { status: 'st-backlog', priority: 'pri-literal' },
          { status: 'st-backlog', priority: null },
        ],
      ),
    );

    await waitFor(() => expect(chartSeries().length).toBe(2));
    // The precondition, stated rather than assumed: neither group's label can
    // name it, so both key by identity and the key is NOT a readable string.
    expect(chartSeries()).toEqual([
      { dataKey: '["(None)"]', label: NULL_CATEGORY_LABEL },
      { dataKey: '[null]', label: NULL_CATEGORY_LABEL },
    ]);

    const ev = clickSegment(1, 0);
    expect(ev.series).toBe('[null]');

    // Bound to the drawer having opened AT LEAST once (objectui#4706), not to
    // an exact cumulative render count: `drawerProps` only ever grows, and a
    // late, unrelated `setMeta` from the dimension-metadata fetch (issued by
    // `useDatasetDimensionMeta`, resolving independently of the click) can
    // land a SECOND identical render after this one click — an overshoot
    // `waitFor` can never recover from once it happens, since the array never
    // shrinks. The case is about WHICH title the drawer shows, not how many
    // times React chose to render it, so `lastDrawer()` — the content check
    // below — is what carries the assertion; the count only needs to confirm
    // the drawer opened at all.
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    // The KEY did the lookup — the right records, which is what objectui#4673
    // already guaranteed and what must not move…
    // objectui#9085: the empty `priority` dimension carries the is-empty
    // predicate; the identity-keyed `status` half is untouched, which is what
    // this test is about.
    expect(lastDrawer().filter).toEqual({ status_id: 'st-backlog', priority_id: { $null: true } });
    // …and the TITLE reads the label. Pre-fix: 'Backlog / [null]'.
    expect(lastDrawer().title).toBe(`Backlog / ${NULL_CATEGORY_LABEL}`);
    expect(lastDrawer().title).not.toContain('[null]');
  });

  it('titles the OTHER colliding group with the same text, and drills it apart', async () => {
    // Both segments read `(None)` to the user, so both titles must — while the
    // filters stay different. Label and identity answer different questions.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
          { status: 'Backlog', priority: null, est_hours: 2 },
        ],
        [
          { status: 'st-backlog', priority: 'pri-literal' },
          { status: 'st-backlog', priority: null },
        ],
      ),
    );
    await waitFor(() => expect(chartSeries().length).toBe(2));

    clickSegment(0, 0);
    // At-least-once, not exact-once (objectui#4706) — see the first case in
    // this file for why a cumulative count overshoots.
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    expect(lastDrawer().title).toBe(`Backlog / ${NULL_CATEGORY_LABEL}`);
    expect(lastDrawer().filter).toEqual({ status_id: 'st-backlog', priority_id: 'pri-literal' });
  });

  it('BOUNDARY — an ordinary group’s title is byte-identical to before', async () => {
    // Green on both sides: an ordinary group keys by its own label, so
    // `seriesLabel ?? series` cannot change what this title says.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [
          { status: 'Backlog', priority: 'High', est_hours: 5 },
          { status: 'Backlog', priority: 'Low', est_hours: 3 },
        ],
        [
          { status: 'st-backlog', priority: 'pri-high' },
          { status: 'st-backlog', priority: 'pri-low' },
        ],
      ),
    );
    await waitFor(() => expect(chartSeries().length).toBe(2));
    expect(chartSeries()).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: 'Low', label: 'Low' },
    ]);

    clickSegment(1, 0);
    // At-least-once, not exact-once (objectui#4706) — see the first case in
    // this file for why a cumulative count overshoots.
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    expect(lastDrawer().title).toBe('Backlog / Low');
    expect(lastDrawer().filter).toEqual({ status_id: 'st-backlog', priority_id: 'pri-low' });
  });

  it('BOUNDARY — a click carrying no label still titles from the key', async () => {
    // Every renderer that resolves a series does send the label now, but the
    // field is OPTIONAL on the event (scatter / treemap / sankey map their own
    // events and know no series label). Those clicks must keep the title they
    // have always had rather than losing the series half of it.
    installMetaRouter();
    renderWidget(
      datasetOf(
        [{ status: 'Backlog', priority: 'High', est_hours: 5 }],
        [{ status: 'st-backlog', priority: 'pri-high' }],
      ),
    );
    await waitFor(() => expect(chartSeries().length).toBe(1));

    capturedChartProps.onSegmentClick({
      category: 'Backlog',
      categoryId: chartRowBucketId(chartData()[0]),
      series: 'High',
    });

    // At-least-once, not exact-once (objectui#4706) — see the first case in
    // this file for why a cumulative count overshoots.
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    expect(lastDrawer().title).toBe('Backlog / High');
  });

  it('BOUNDARY — a NON-pivoted widget still omits the series from its title', async () => {
    // `seriesLabel` must not smuggle the measure name into a title the pivot
    // check deliberately keeps out of it.
    installMetaRouter();
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
        <DatasetWidget
          widget={{
            type: 'bar',
            dataset: 'hours_by_status',
            dimensions: ['status'],
            values: VALS,
            drillDown: { enabled: true },
          }}
          dataSource={{
            queryDataset: vi.fn(async () => ({
              rows: [{ status: 'Backlog', est_hours: 5 }],
              fields: [
                { name: 'status', type: 'text', label: 'Status' },
                { name: 'est_hours', type: 'number', label: 'Hours' },
              ],
              object: 'proj_task',
              dimensionFields: { status: 'status_id' },
              drillRawRows: [{ status: 'st-backlog' }],
            })),
          } as any}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(chartData().length).toBe(1));
    capturedChartProps.onSegmentClick({
      category: 'Backlog',
      categoryId: chartRowBucketId(chartData()[0]),
      series: 'est_hours',
      seriesLabel: 'Hours',
    });

    // At-least-once, not exact-once (objectui#4706) — see the first case in
    // this file for why a cumulative count overshoots.
    await waitFor(() => expect(drawerProps.length).toBeGreaterThan(0));
    expect(lastDrawer().title).toBe('Backlog');
  });
});

/**
 * The transform's own statement of the fact this card rests on, kept beside the
 * consumer that reads it: a group's key and its label are DIFFERENT strings
 * exactly when the label cannot name the group.
 */
describe('buildChartSeries — key and label diverge only on collision (objectui#4682)', () => {
  it('gives the colliding groups one label and two keys', () => {
    const { series } = buildChartSeries(
      [
        { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
        { status: 'Backlog', priority: null, est_hours: 2 },
      ],
      DIMS,
      VALS,
    );
    expect(series.map((s) => s.label)).toEqual([NULL_CATEGORY_LABEL, NULL_CATEGORY_LABEL]);
    expect(new Set(series.map((s) => s.dataKey)).size).toBe(2);
    // Which is the whole reason the title cannot be composed from the key, and
    // the lookup cannot be performed from the label.
    expect(series.every((s) => s.dataKey === s.label)).toBe(false);
  });

  it('keeps them identical for an ordinary pivot', () => {
    const { series } = buildChartSeries(
      [
        { status: 'Backlog', priority: 'High', est_hours: 5 },
        { status: 'Backlog', priority: 'Low', est_hours: 3 },
      ],
      DIMS,
      VALS,
    );
    expect(series.every((s) => s.dataKey === s.label)).toBe(true);
  });
});
