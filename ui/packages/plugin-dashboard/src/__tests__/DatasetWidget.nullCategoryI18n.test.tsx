/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4500 — DatasetWidget's half of #4466's null bucket.
 *
 * `buildChartSeries` (core) buckets a null-keyed category under
 * `options.nullCategoryLabel`, falling back to the English constant
 * `NULL_CATEGORY_LABEL = '(None)'`. `@object-ui/core` is React-free and cannot
 * read the locale bundle, so the LABEL has to come from the renderer — which is
 * exactly what makes this failure quiet: the bar draws, the count is right, and
 * only the word is wrong. ObjectChart (plugin-charts) passes its resolved label
 * and localizes; DatasetWidget called the same helper with no options at all,
 * so a dashboard widget rendered the raw English `(None)` inside a zh app.
 *
 * TWO call sites, not one, and the second is the sharp edge. `findChartSeriesRow`
 * is the inverse map used by the segment-click drill: it compares the CLICKED
 * category string against its own `nullCategoryLabel`, defaulting to the same
 * English floor. Localize only the forward call and the bucket bar is drawn as
 * `(未指定)` while the drill still matches against `(None)` — the click resolves
 * to `-1` and `handleChartDrill` returns without opening the drawer. That is a
 * strictly WORSE outcome than the untranslated label this card is about: a
 * visible bar that silently does nothing (#4498's dead-click rule). So the two
 * calls are pinned as a PAIR here, not as two independent facts.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the zh label case and the zh drill case are RED before the change (the
 *    label reads `(None)`; the drill on the localized label no-ops);
 *  - the non-null row, the `en` case and the no-null-group case are GREEN on
 *    both sides. They are the acceptance boundary: this card buys a translated
 *    bucket label and must not move a single other byte the widget charts.
 *
 * Scope note: single-dimension only. The multi-dimension PIVOT arm of
 * `buildChartSeries` is #4497's in-flight surface and is deliberately not
 * touched here — `findChartSeriesRow`'s pivot branch matches the x-axis
 * dimension through the same `xOf`, so the pair property this file pins holds
 * there too, but asserting it would collide with that card.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, NULL_CATEGORY_LABEL } from '@object-ui/core';
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

/**
 * The dataset's base object. `owner_id` is a plain TEXT field on purpose: this
 * card is about the null BUCKET, so the fixture must carry no option list that
 * could relabel a category through `relabelDimensions` and blur which channel
 * produced the string under test.
 */
const OPPORTUNITY = { name: 'crm_opportunity', fields: { owner_id: { type: 'text' } } };

function installMetaRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: OPPORTUNITY }) })),
  );
}

/**
 * A first-boot shape: three deals are owned, three are not (`owner = NULL`).
 * `drillRawRows` carries the IDENTITY keys — deliberately spelled differently
 * from the display values so an index-aligned drill can be told apart from a
 * lucky string match.
 */
const nullKeyedDataset = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [
      { owner_name: 'Ada Lovelace', deals: 5 },
      { owner_name: null, deals: 3 },
    ],
    fields: [
      { name: 'owner_name', type: 'text', label: 'Owner' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { owner_name: 'owner_id' },
    drillRawRows: [{ owner_name: 'user-ada' }, { owner_name: null }],
  })),
});

/** The same widget over data with NO null group — the untouched-surface case. */
const fullyKeyedDataset = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [
      { owner_name: 'Ada Lovelace', deals: 5 },
      { owner_name: 'Grace Hopper', deals: 3 },
    ],
    fields: [
      { name: 'owner_name', type: 'text', label: 'Owner' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { owner_name: 'owner_id' },
    drillRawRows: [{ owner_name: 'user-ada' }, { owner_name: 'user-grace' }],
  })),
});

function renderIn(language: string, dataSource: { queryDataset: unknown }) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
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

/** The categories the widget actually handed the chart renderer. */
const categories = () =>
  (capturedChartProps?.schema?.data ?? []).map((r: any) => r.owner_name);

describe('DatasetWidget — the null-category bucket reads the locale bundle (objectui#4500)', () => {
  it('labels the null group `(未指定)` under `zh`, not the English floor', async () => {
    installMetaRouter();
    renderIn('zh', nullKeyedDataset());

    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain('(未指定)');
    // The English floor must not survive beside the translation — this is the
    // whole card, and `(None)` is what a zh dashboard renders today.
    expect(categories()).not.toContain(NULL_CATEGORY_LABEL);
  });

  it('keeps the measure attached to the (now translated) bucket', async () => {
    installMetaRouter();
    renderIn('zh', nullKeyedDataset());

    await waitFor(() => expect(categories().length).toBe(2));
    const byCategory = Object.fromEntries(
      capturedChartProps.schema.data.map((r: any) => [r.owner_name, r.deals]),
    );
    expect(byCategory).toMatchObject({ '(未指定)': 3 });
  });

  it('PAIR — a click on the localized bucket bar still drills to ITS row', async () => {
    // The dead-click rule (#4498), now on the localized label. Pre-fix this is
    // red in the worse direction: with only the forward call localized the bar
    // reads `(未指定)`, `findChartSeriesRow` matches against `(None)`, returns
    // -1, and `handleChartDrill` returns before `openDrill` — a visible bar
    // that does nothing at all.
    installMetaRouter();
    renderIn('zh', nullKeyedDataset());

    await waitFor(() => expect(categories()).toContain('(未指定)'));
    // Click with WHATEVER the bucket bar reads — the chart knows no other string.
    const bucket = categories().find((c: string) => c !== 'Ada Lovelace');
    capturedChartProps.onSegmentClick({ category: bucket });

    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    // Index 1 of `drillRawRows`: an explicit "is empty" filter on the OBJECT
    // field, never the display label and never Ada's row.
    // objectui#9085 spelling. The PAIRING this test measures — that the
    // localized bucket bar drills to ITS row — is unchanged.
    expect(drillFilters[drillFilters.length - 1]).toEqual({ owner_id: { $null: true } });
  });

  it('BOUNDARY — the non-null group is byte-identical', async () => {
    // Green on both sides. A category that was never null must not acquire a
    // bucket, a relabel, or a changed measure.
    installMetaRouter();
    renderIn('zh', nullKeyedDataset());

    await waitFor(() => expect(categories().length).toBe(2));
    expect(capturedChartProps.schema.data[0]).toEqual({ owner_name: 'Ada Lovelace', deals: 5 });
  });

  it('BOUNDARY — a click on the non-null bar drills by the STORED id', async () => {
    // Green on both sides: identity keys do not translate (#4263's convention),
    // and the fix must not perturb the drill of a category it does not bucket.
    installMetaRouter();
    renderIn('zh', nullKeyedDataset());

    await waitFor(() => expect(categories()).toContain('Ada Lovelace'));
    capturedChartProps.onSegmentClick({ category: 'Ada Lovelace' });

    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toEqual({ owner_id: 'user-ada' });
  });

  it('BOUNDARY — under `en` the bucket reads `(None)`, through the same channel', async () => {
    // Green on both sides, but NOT for the same reason on each: before the fix
    // core's hardcoded floor produces it, after the fix the `en` pack's
    // `chart.nullCategory` does. Same bytes, and that is the requirement — an
    // `en` dashboard must read exactly what it reads today.
    installMetaRouter();
    renderIn('en', nullKeyedDataset());

    await waitFor(() => expect(categories().length).toBe(2));
    expect(categories()).toContain(NULL_CATEGORY_LABEL);
    expect(categories()).not.toContain('(未指定)');
  });

  it('BOUNDARY — a widget with no null group is untouched in either locale', async () => {
    installMetaRouter();
    renderIn('zh', fullyKeyedDataset());

    await waitFor(() => expect(categories().length).toBe(2));
    expect(capturedChartProps.schema.data).toEqual([
      { owner_name: 'Ada Lovelace', deals: 5 },
      { owner_name: 'Grace Hopper', deals: 3 },
    ]);
    expect(categories()).not.toContain(NULL_CATEGORY_LABEL);
    expect(categories()).not.toContain('(未指定)');
  });
});
