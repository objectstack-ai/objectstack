// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9038, report surface — a report chart authoring `subtitle` /
 * `description` as the spec's inline-locale-map arm of `I18nLabel` got neither
 * key at all, so the chart drew no sub-heading and carried no accessible
 * description, in every language.
 *
 * The lowering these two keys travel through is `chartConfigPresentation`
 * (`@object-ui/core`), shared with the dashboard; its string-only limb erased
 * the map arm before the schema was built. The sibling
 * `DatasetReportRenderer.chartChrome.test.tsx` already pins that both keys
 * travel — with a plain STRING. This file is the other arm of the same union.
 *
 * ## Scope: `subtitle` and `description`, and why `title` is not here
 *
 * This renderer paints the chart's title itself, as its own `h3` above the
 * plot, and therefore DROPS `title` from the lowered result so the chart does
 * not draw a second one — a decision the sibling file pins, and one this file
 * pins again below for the map arm.
 *
 * When this file was written its `h3` read `chart.title` through a plain-string
 * narrowing of its own, so a locale-map title still drew no heading on this
 * surface — a live defect this scope note reported rather than pinned, because
 * pinning it would have recorded the defect as an expectation. That is
 * objectui#9150, now fixed: the heading resolves through `pickLocalized`, and
 * `DatasetReportRenderer.chartTitleLocale-9150.test.tsx` holds its pins, in two
 * languages and on both branches that paint it. The division of labour is
 * unchanged — this file is the LOWERING (`subtitle`/`description` reaching the
 * chart), that one is the renderer's OWN heading.
 *
 * ## Where these assertions stop
 *
 * At the schema the registered chart component is handed — the same seam the
 * sibling file stops at. What that component then DRAWS from the union is
 * pinned where recharts resolves:
 * `ChartRenderer.presentationLocaleHeading-9038.test.tsx` in
 * `@object-ui/plugin-charts` renders the same maps at two languages.
 *
 * PREDICTIONS, written before the run: both locale-map cases RED before the fix
 * (the key is absent), the plain-string control GREEN on both sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// The repository's ONE resolver for the `I18nLabel` union, and already a
// dependency of this package — `DatasetReportRenderer` itself resolves measure
// labels through it. Used below only to show that what ARRIVES at the chart
// component is a usable two-language value; see the scope note above for which
// half of the claim that is and where the other half lives.
import { pickLocalized } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

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

const RESULT = {
  rows: [
    { stage: 'Qualification', amount: 120 },
    { stage: 'Negotiation', amount: 80 },
  ],
  fields: [
    { name: 'stage', type: 'text', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
  ],
};

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const BASE = {
  name: 'pipeline_by_stage',
  type: 'tabular',
  dataset: 'pipeline_metrics',
  rows: ['stage'],
  values: ['amount'],
};

const CHART = { type: 'bar', xAxis: 'stage', yAxis: 'amount' } as const;

/** ⚠️ `en` FIRST — objectui#8943's defect was a first-string-in-key-order pick. */
const SUBTITLE = { en: 'Open pipeline only', 'zh-CN': '仅未结管道' };
const DESCRIPTION = { en: 'Amount by stage', 'zh-CN': '按阶段的金额' };

/** The schema the registered chart component was handed for this `chart` block. */
async function chartSchema(chart: Record<string, unknown>) {
  render(
    <DatasetReportRenderer
      report={{ ...BASE, chart } as never}
      dataSource={sourceOf(RESULT) as never}
    />,
  );
  await waitFor(() => expect(captured?.schema?.data?.length).toBe(2));
  return captured!.schema;
}

describe('report chart chrome — the locale-map arm travels too (objectui#9038)', () => {
  it('carries an authored locale-map `subtitle` and `description` onto the schema', async () => {
    const schema = await chartSchema({ ...CHART, subtitle: SUBTITLE, description: DESCRIPTION });
    // The failure this replaces was ABSENCE, so presence is the first pin.
    expect(schema.subtitle).toEqual(SUBTITLE);
    expect(schema.description).toEqual(DESCRIPTION);
  });

  it('what arrives is a usable two-language value, not merely a non-empty one', async () => {
    // ⚠️ An EXPLICIT language on every call: `pickLocalized` reads an absent one
    // as `en`, so a two-language claim made without one would print the same
    // string twice and prove nothing (objectui#8943).
    //
    // This restates the RESOLVER, deliberately and with its limit stated: it
    // shows the arriving value resolves both ways, NOT that the renderer feeds
    // it the viewer's language. That second half needs the real chart component
    // and therefore recharts, which resolves in `@object-ui/plugin-charts`
    // alone — `ChartRenderer.presentationLocaleHeading-9038.test.tsx` renders
    // these same maps there and reads the headings out of the DOM.
    const schema = await chartSchema({ ...CHART, subtitle: SUBTITLE, description: DESCRIPTION });
    expect(pickLocalized(schema.subtitle, 'zh-CN')).toBe('仅未结管道');
    expect(pickLocalized(schema.subtitle, 'en')).toBe('Open pipeline only');
    expect(pickLocalized(schema.description, 'zh-CN')).toBe('按阶段的金额');
    expect(pickLocalized(schema.description, 'en')).toBe('Amount by stage');
  });

  it('still drops `title` from the lowered chrome — this renderer paints its own', async () => {
    // Not a heading claim: the pin is that the chart is NOT handed a title, so
    // it cannot draw a second one beside the `h3`. It held for the string arm
    // and must keep holding for the map arm.
    const schema = await chartSchema({ ...CHART, title: { en: 'Pricing', 'zh-CN': '定价' } });
    expect(schema.title).toBeUndefined();
  });

  it('leaves plain-string chrome exactly as it was — the live control', async () => {
    const schema = await chartSchema({
      ...CHART,
      subtitle: 'Open pipeline only',
      description: 'Amount by stage for the current quarter',
    });
    expect(schema.subtitle).toBe('Open pipeline only');
    expect(schema.description).toBe('Amount by stage for the current quarter');
  });
});
