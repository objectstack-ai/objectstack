// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4878 — a report's embedded chart never bucketed a NULL category.
 *
 * `DatasetReportChart` built its rows as `relabelDimensions(state.rows, …)` and
 * handed them to the registered chart component verbatim. Nothing on that path
 * bucketed a null dimension value, so the renderer received a null category —
 * the exact input objectui#4466 measured as drawing **no mark at all**. The
 * dashboard and chart-view surfaces never had the defect because they route
 * through `buildChartSeries` (`@object-ui/core`), whose `bucketNullCategories`
 * limb is where #4466 / #4497 / #4673 / #4500 / #4508 were all fixed.
 *
 * The fix ROUTES rather than re-derives, so this file pins the family as
 * INHERITED properties, not as a second implementation of them:
 *
 *  ① the bucket exists and keeps its measure (#4466);
 *  ② its label comes from the locale bundle at this call site, because
 *    `@object-ui/core` is React-free (#4500);
 *  ③ a stored value that literally spells the bucket label stays a DIFFERENT
 *    bucket (#4508);
 *  ④ #4020's three-level measure display name still outranks the label the
 *    derivation itself assigns — the load-bearing constraint of the switch.
 *
 * DIRECTIONS, written before the reverse verification was run. The mutation is
 * "put the deleted limb back": restore `data: relabelDimensions(state.rows, …)`
 * and `series: [{ dataKey: yAxis, label: measureLabel }]`, i.e. the pre-change
 * lines.
 *
 * Measured: 5 red / 5 green, matching the prediction case for case.
 *
 *  - ①/②/③ go RED: with the rows passed through, the category stays `null` and
 *    every assertion about a bucket string fails on `null`. This is the
 *    ordinary direction and the one the card describes.
 *  - The `en` BOUNDARY case goes red too, and that is worth stating precisely
 *    rather than filing under "boundary cases stay green". It is green on both
 *    sides of the NARROWER mutation it was written for — dropping the
 *    `nullCategoryLabel` option while keeping the routing, i.e. objectui#4500's
 *    own limb, where core's English floor and the `en` pack produce the same
 *    bytes through different channels. It cannot be green across THIS mutation,
 *    which removes the bucket itself: there is no label to read in either
 *    language when nothing is bucketed.
 *  - The no-null-group BOUNDARY stays GREEN on both sides, and that is its job:
 *    this card buys a bucketed null category and must not move a byte of an
 *    ordinary report's chart.
 *  - ④ stays GREEN on both sides too, and is NOT a weak case: it is the guard
 *    that the new derivation's own `fields[].label` did not silently take over
 *    the label, which is a failure only visible AFTER the change. Reverting
 *    cannot show it — the pre-change code had no derivation to be outranked by.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry, NULL_CATEGORY_LABEL, chartRowBucketId } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

/** Props the registered chart component was handed, or `null` if never called. */
let captured: { schema: Record<string, any> } | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The card's own measured shape: a dominant NULL group beside a named one.
 * `owner` is a plain text dimension on purpose — this card is about the null
 * BUCKET, so the fixture carries no option list that could relabel a category
 * through `relabelDimensions` and blur which channel produced the string.
 */
const NULL_GROUP = {
  rows: [
    { owner: null, n: 51 },
    { owner: 'Dev Admin', n: 2 },
  ],
  fields: [
    { name: 'owner', type: 'text', label: 'Owner' },
    { name: 'n', type: 'number', label: 'Events' },
  ],
};

/** The same report over data with NO null group — the untouched-surface case. */
const FULLY_KEYED = {
  rows: [
    { owner: 'Ada Lovelace', n: 51 },
    { owner: 'Dev Admin', n: 2 },
  ],
  fields: NULL_GROUP.fields,
};

/**
 * objectui#4508's collision, reachable here for the first time: a stored value
 * that literally spells the bucket label, beside the real null group.
 */
const SPELLS_THE_LABEL = {
  rows: [
    { owner: null, n: 51 },
    { owner: NULL_CATEGORY_LABEL, n: 7 },
  ],
  fields: NULL_GROUP.fields,
};

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const BASE = {
  name: 'events_by_owner',
  type: 'tabular',
  dataset: 'event_metrics',
  rows: ['owner'],
  values: ['n'],
  chart: { type: 'bar', xAxis: 'owner', yAxis: 'n' },
};

/** Render the report, optionally inside a locale, and wait for the chart props. */
async function chartSchema(
  result: unknown,
  opts: { language?: string; report?: Record<string, unknown> } = {},
) {
  const element = (
    <DatasetReportRenderer
      report={{ ...BASE, ...(opts.report ?? {}) } as never}
      dataSource={sourceOf(result) as never}
    />
  );
  render(
    opts.language ? (
      <I18nProvider
        config={{ defaultLanguage: opts.language, detectBrowserLanguage: false, resources: {} }}
      >
        {element}
      </I18nProvider>
    ) : (
      element
    ),
  );
  await waitFor(() => expect(captured?.schema?.data?.length).toBe(2));
  return captured!.schema;
}

/** The categories the report actually handed the chart component. */
const categoriesOf = (schema: Record<string, any>) => schema.data.map((r: any) => r.owner);

describe('report chart — the null category is bucketed (objectui#4878 / #4466)', () => {
  it('① replaces the raw null with the bucket label instead of forwarding it', async () => {
    const schema = await chartSchema(NULL_GROUP);
    // The card's measurement: `data[0].owner` was `null` and drew no mark.
    expect(categoriesOf(schema)).toContain(NULL_CATEGORY_LABEL);
    expect(categoriesOf(schema)).not.toContain(null);
  });

  it('① keeps the measure attached to the bucket — the mark has a height', async () => {
    // #4466's harm was not an empty chart but a quietly WRONG one: the dominant
    // group vanished while the y-axis still accommodated it. The bucket must
    // therefore carry its own 51, not merely exist.
    const schema = await chartSchema(NULL_GROUP);
    const byCategory = Object.fromEntries(schema.data.map((r: any) => [r.owner, r.n]));
    expect(byCategory).toMatchObject({ [NULL_CATEGORY_LABEL]: 51, 'Dev Admin': 2 });
  });

  it('① the series still binds the plotted measure, so the bucket draws', async () => {
    // A bucket with no series bound to it is objectui#4673's defect one axis
    // over: the number is in the row and no mark reads it.
    const schema = await chartSchema(NULL_GROUP);
    expect(schema.series.map((s: any) => s.dataKey)).toEqual(['n']);
    expect(schema.xAxisKey).toBe('owner');
  });
});

describe('report chart — the bucket label comes from the locale bundle (objectui#4500)', () => {
  it('② reads `(未指定)` under `zh`, not the English floor', async () => {
    // `@object-ui/core` is React-free and cannot read the bundle, so a call site
    // that passes no `nullCategoryLabel` gets the English constant — a zh
    // console would draw the bar and label it `(None)`.
    const schema = await chartSchema(NULL_GROUP, { language: 'zh' });
    expect(categoriesOf(schema)).toContain('(未指定)');
    expect(categoriesOf(schema)).not.toContain(NULL_CATEGORY_LABEL);
  });

  it('BOUNDARY — under `en` the bucket reads `(None)`, through the same channel', async () => {
    // The boundary this guards is objectui#4500's CHANNEL, not #4878's routing:
    // core's hardcoded floor produces this string without the option and the
    // `en` pack's `chart.nullCategory` produces it with, so an `en` console
    // reads exactly what it read before the label became localizable. Measured
    // red under the routing mutation, as it must be — with no bucket at all
    // there is no label to read in either language.
    const schema = await chartSchema(NULL_GROUP, { language: 'en' });
    expect(categoriesOf(schema)).toContain(NULL_CATEGORY_LABEL);
    expect(categoriesOf(schema)).not.toContain('(未指定)');
  });
});

describe('report chart — bucket IDENTITY is not the bucket label (objectui#4508)', () => {
  it('③ a stored value spelling `(None)` stays a different bucket from null', async () => {
    const schema = await chartSchema(SPELLS_THE_LABEL);
    // Two rows in, two rows out: the null group and the record whose stored
    // value happens to spell its label were never the same group.
    expect(schema.data).toHaveLength(2);
    const ids = schema.data.map((r: any) => chartRowBucketId(r));
    expect(ids.filter(Boolean)).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // Both paint the same axis text, which is exactly why they need identities.
    expect(categoriesOf(schema)).toEqual([NULL_CATEGORY_LABEL, NULL_CATEGORY_LABEL]);
  });
});

describe('report chart — the untouched surface (objectui#4878 boundary)', () => {
  it('BOUNDARY — a report with no null group is byte-identical', async () => {
    const schema = await chartSchema(FULLY_KEYED);
    expect(schema.data).toEqual([
      { owner: 'Ada Lovelace', n: 51 },
      { owner: 'Dev Admin', n: 2 },
    ]);
    // No bucket identity is written when the display string names the bucket on
    // its own — the rows a chart is drawn from are an authoring-visible surface.
    expect(schema.data.map((r: any) => chartRowBucketId(r))).toEqual([undefined, undefined]);
  });
});

describe('report chart — #4020 still outranks the derivation (the load-bearing constraint)', () => {
  it('④ an authored chart.series[].label beats the derived `fields[].label`', async () => {
    // `buildChartSeries` assigns `label: fields.find(…)?.label ?? name`, i.e.
    // `Events` here. objectui#4020's resolution is HIGHER: the authored
    // per-chart override first, then the dataset label through the i18n
    // field-label convention. Adopting the derivation must not demote it.
    const schema = await chartSchema(NULL_GROUP, {
      report: {
        chart: {
          type: 'bar',
          xAxis: 'owner',
          yAxis: 'n',
          series: [{ name: 'n', label: '事件数' }],
        },
      },
    });
    expect(schema.series[0].label).toBe('事件数');
  });

  it('④ an i18n label record still picks the console language, not the first limb', async () => {
    // The derivation cannot do this: core holds no provider, so its own label
    // pick is first-string-wins and would paint `Events (en)` on a zh console.
    const schema = await chartSchema(NULL_GROUP, {
      language: 'zh',
      report: {
        chart: {
          type: 'bar',
          xAxis: 'owner',
          yAxis: 'n',
          series: [{ name: 'n', label: { en: 'Events (en)', 'zh-CN': '事件数' } }],
        },
      },
    });
    expect(schema.series[0].label).toBe('事件数');
  });

  it('④ with nothing authored, the dataset measure label still wins', async () => {
    const schema = await chartSchema(NULL_GROUP);
    expect(schema.series[0].label).toBe('Events');
  });
});
