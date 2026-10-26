// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4906 — a report chart derived neither the dimension's option
 * COLOURS nor its declared category ORDER; the same dimension on a dashboard
 * chart got both.
 *
 * `DatasetReportChart` (`DatasetReportRenderer.tsx`) resolves its dimension's
 * option LABELS (`useDatasetDimensionLabels` → `relabelDimensions`) but used to
 * call neither `buildOptionColorMap` nor `buildCategoryOrder` — the two
 * `@object-ui/core` helpers `DatasetWidget` (plugin-dashboard) already runs off
 * the SAME resolved field metadata for its own chart. This is cross-surface
 * CONVERGENCE, not a new derivation: the report path now runs the identical
 * `useDatasetDimensionMeta` → `localizeFieldOptions` →
 * `buildOptionColorMap`/`buildCategoryOrder` chain the dashboard does, so a
 * second, independently-written copy of the same rule never has the chance to
 * drift from it (objectui#5301 is what that drift looks like once it happens).
 *
 * ## Why "converges with the dashboard" is pinned at the MECHANISM, not by
 * rendering `DatasetWidget` side by side
 *
 * `DatasetWidget` is `plugin-dashboard`'s own internal implementation detail —
 * it is not part of that package's public export surface (its barrel and
 * `package.json#exports` expose `DashboardRenderer` and friends, never
 * `DatasetWidget` itself; the same shape `DatasetReportChart` has in THIS
 * package). Reaching it from here would mean a deep, non-exported cross-package
 * import that only resolves under this repo's root vitest `src` alias and would
 * not resolve at all through `plugin-dashboard`'s published `dist` — exactly
 * the kind of resolution-path landmine AGENTS.md's ablation guidance warns
 * about, and it would need a new `plugin-report → plugin-dashboard` dev
 * dependency for one test. So convergence is pinned the way that survives
 * both resolution paths: this file's `DatasetReportChart` schema is asserted
 * against the LITERAL output of the exact same `@object-ui/core` call chain
 * (`localizeFieldOptions` → `buildOptionColorMap` / `buildCategoryOrder`) that
 * `DatasetWidget`'s own `useMemo` (`DatasetWidget.tsx`, the block computing
 * `categoryColors`/`categoryOrder`) is written to make — reproduced inline in
 * the "same derivation DatasetWidget makes" block below, over the identical
 * `STAGE_OPTIONS` picklist, so the two are provably the same computation on
 * the same input rather than two implementations that happen to agree today.
 *
 * DIRECTIONS, written before the reverse verification was run. The mutation is
 * to revert `DatasetReportRenderer.tsx` to the pre-fix shape — no
 * `useDatasetDimensionMeta` read in `DatasetReportChart`, no `categoryColors`
 * second argument to `chartConfigPresentation`, no `categoryOrder` spread — with
 * every test file kept. Case by case, of the 9 `it`s below:
 *
 *  - RED (7): both cases in "derives its own colours"; "spreads categoryOrder
 *    from the field's declared picklist order"; both cases in "runs the SAME
 *    derivation DatasetWidget makes"; both cases in "authored `colors` still
 *    wins" — each of THOSE two fails on its field-derived sub-assertion (the
 *    author-only key it also checks, e.g. `categoryColors.qualification`,
 *    already passed pre-fix per objectui#4877; the field-derived keys beside
 *    it did not, which is what fails the case);
 *  - GREEN, both sides, on purpose (2): "the declared order is NOT the
 *    row-arrival order… " is a self-check of the fixture alone — it renders
 *    nothing and cannot move with the fix; "a dimension with no declared
 *    options omits categoryOrder" holds trivially before the fix too, since
 *    pre-fix `categoryOrder` was never spread under ANY input. Both are
 *    recorded as decisions, not pins — the same convention the chartChrome
 *    test file's `title`/`aria` blocks use.
 *
 * Measured: 7 red / 2 green, matching the prediction case for case.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, buildOptionColorMap, buildCategoryOrder, localizeFieldOptions } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

// A sales pipeline `stage` picklist — declared in PIPELINE order (framework#3588)
// and carrying a semantic colour per stage, the exact shape the issue's own
// "a `health` dimension paints its own green/amber/red" example describes.
// Declared order is deliberately NOT alphabetical (alphabetical would be
// Needs Analysis, Negotiation, Proposal, Qualification), so an assertion that
// happened to pass under either ordering would not be trusted.
const STAGE_OPTIONS = [
  { value: 'qualification', label: 'Qualification', color: '#3B82F6' },
  { value: 'needs_analysis', label: 'Needs Analysis', color: '#8B5CF6' },
  { value: 'proposal', label: 'Proposal', color: '#F59E0B' },
  { value: 'negotiation', label: 'Negotiation', color: '#EF4444' },
];

const CRM_OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    stage: { type: 'select', options: STAGE_OPTIONS },
  },
};

// What `buildOptionColorMap`/`buildCategoryOrder` (packages/core) are pinned
// (chart-series.test.ts / category-order.test.ts) to produce for the fixture
// above — spelled out literally here rather than recomputed with the same
// functions under test, so a change to those functions' own behaviour cannot
// silently keep this file green.
const EXPECTED_CATEGORY_COLORS = {
  qualification: '#3B82F6', Qualification: '#3B82F6',
  needs_analysis: '#8B5CF6', 'Needs Analysis': '#8B5CF6',
  proposal: '#F59E0B', Proposal: '#F59E0B',
  negotiation: '#EF4444', Negotiation: '#EF4444',
};
const EXPECTED_CATEGORY_ORDER = [
  'qualification', 'Qualification',
  'needs_analysis', 'Needs Analysis',
  'proposal', 'Proposal',
  'negotiation', 'Negotiation',
];

// Rows arrive SERVER-RESOLVED to the authored label (ADR-0021) and in an order
// that matches NEITHER declared order NOR alphabetical — so a passing
// `categoryOrder` assertion cannot be explained by row-arrival order leaking
// through by coincidence.
const PIPELINE_RESULT = {
  rows: [
    { stage: 'Negotiation', amount: 10 },
    { stage: 'Qualification', amount: 60 },
    { stage: 'Needs Analysis', amount: 40 },
    { stage: 'Proposal', amount: 25 },
  ],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
  ],
  object: 'crm_opportunity',
  dimensionFields: { stage: 'stage' },
};

function installMetaRouter() {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    if (name !== 'crm_opportunity') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: CRM_OPPORTUNITY }) };
  }) as any;
}

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const REPORT_BASE = {
  name: 'pipeline_by_stage',
  type: 'tabular',
  dataset: 'pipeline_metrics',
  rows: ['stage'],
  values: ['amount'],
};

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
 * The schema the registered `chart` component was handed for the report's
 * embedded chart, once BOTH async reads this component fires have settled:
 * the dataset query (`data.length`) and the object-metadata fetch the
 * category derivation depends on. These are two independent effects — the
 * dataset query alone can resolve first, producing an intermediate render
 * with `data` populated but `categoryOrder`/`categoryColors` still absent
 * (metadata in flight). Gating only on `data.length`, as the sibling
 * `chartChrome`/`localSelectI18n` test files' helpers do, is correct for
 * assertions that don't depend on the metadata read — every fixture in THIS
 * file does, so `categoryOrder` (always 8 entries for the four-stage
 * `STAGE_OPTIONS` picklist once metadata lands) is part of the wait itself,
 * not just of the assertion after it.
 */
async function reportChartSchema(chart: Record<string, unknown>) {
  installMetaRouter();
  render(
    <DatasetReportRenderer
      report={{ ...REPORT_BASE, chart } as never}
      dataSource={sourceOf(PIPELINE_RESULT) as never}
    />,
  );
  await waitFor(() => {
    expect(captured?.schema?.data?.length).toBe(4);
    expect(captured?.schema?.categoryOrder).toEqual(EXPECTED_CATEGORY_ORDER);
  });
  return captured!.schema;
}

const CHART = { type: 'funnel', xAxis: 'stage', yAxis: 'amount' } as const;

describe('report chart derives its own option colours (objectui#4906)', () => {
  it('paints the category colours from the dimension field, exactly as `buildOptionColorMap` computes them', async () => {
    const schema = await reportChartSchema({ ...CHART });
    expect(schema.categoryColors).toEqual(EXPECTED_CATEGORY_COLORS);
  });

  it('keys the colour map by BOTH the raw value and the server-resolved label', async () => {
    // Rows in PIPELINE_RESULT carry the LABEL ('Negotiation'); a legacy path
    // could still carry the raw value ('negotiation'). Both must resolve.
    const schema = await reportChartSchema({ ...CHART });
    expect(schema.categoryColors.negotiation).toBe('#EF4444');
    expect(schema.categoryColors.Negotiation).toBe('#EF4444');
  });
});

describe('report chart renders funnel stages in DECLARED order (framework#3588, objectui#4906)', () => {
  it('spreads `categoryOrder` from the field’s declared picklist order', async () => {
    const schema = await reportChartSchema({ ...CHART });
    expect(schema.categoryOrder).toEqual(EXPECTED_CATEGORY_ORDER);
  });

  it('the declared order is NOT the row-arrival order and NOT alphabetical', async () => {
    // Guards the fixture itself: if this ever failed, the order assertion
    // above would no longer be distinguishing "declared" from "coincidence".
    const rowOrder = PIPELINE_RESULT.rows.map((r) => r.stage);
    const alphabetical = [...rowOrder].sort();
    expect(EXPECTED_CATEGORY_ORDER).not.toEqual(rowOrder);
    expect(EXPECTED_CATEGORY_ORDER).not.toEqual(alphabetical);
  });

  it('a dimension with no declared options omits `categoryOrder` (default stands)', async () => {
    // No object/dimensionFields on this result → the metadata read never
    // fires, so there is nothing to derive an order from. Omitted, not
    // `undefined`-valued, so the chart's own default (value-descending) governs.
    captured = null;
    render(
      <DatasetReportRenderer
        report={{ ...REPORT_BASE, chart: { ...CHART } } as never}
        dataSource={sourceOf({
          rows: [{ stage: 'a', amount: 1 }],
          fields: [{ name: 'stage', type: 'string' }, { name: 'amount', type: 'number' }],
        }) as never}
      />,
    );
    await waitFor(() => expect(captured?.schema?.data?.length).toBe(1));
    expect('categoryOrder' in captured!.schema).toBe(false);
  });
});

describe('the report chart runs the SAME derivation DatasetWidget makes, from the same picklist (objectui#4906)', () => {
  // Reproduces `DatasetWidget`'s own `useMemo` body (`plugin-dashboard/src/
  // DatasetWidget.tsx`) verbatim — `localizeFieldOptions` with no translator
  // bound (this suite renders un-translated, matching `fieldOptionLabel`
  // being absent with no I18nProvider mounted), then `buildOptionColorMap` /
  // `buildCategoryOrder` — over the IDENTICAL `STAGE_OPTIONS` picklist the
  // report chart above resolves through its own object-schema fetch. Both
  // call the same three `@object-ui/core` exports on the same input, so
  // agreement here is not incidental: it is what "converges on the ruled
  // dashboard behaviour" (the triage ruling's own words) means mechanically.
  const dashboardStyleOptions = localizeFieldOptions(STAGE_OPTIONS, undefined);
  const dashboardCategoryColors = buildOptionColorMap(dashboardStyleOptions);
  const dashboardCategoryOrder = buildCategoryOrder(dashboardStyleOptions);

  it('derives identical categoryColors', async () => {
    const schema = await reportChartSchema({ ...CHART });
    expect(schema.categoryColors).toEqual(dashboardCategoryColors);
  });

  it('derives identical categoryOrder', async () => {
    const schema = await reportChartSchema({ ...CHART });
    expect(schema.categoryOrder).toEqual(dashboardCategoryOrder);
  });
});

describe('authored `colors` still wins over the derived map (objectui#4877 precedence, preserved)', () => {
  it('an authored per-category colour overrides its field-derived counterpart, others stay field-derived', async () => {
    const schema = await reportChartSchema({
      ...CHART,
      // The author explicitly overrides ONE stage; every other stage is left
      // to the field's own declared colour.
      colors: { qualification: '#000000' },
    });
    expect(schema.categoryColors.qualification).toBe('#000000');
    expect(schema.categoryColors.Qualification).toBe('#3B82F6'); // unmatched label key, field colour stands
    expect(schema.categoryColors.needs_analysis).toBe('#8B5CF6');
    expect(schema.categoryColors.negotiation).toBe('#EF4444');
  });

  it('a `colors` ARRAY (positional palette) still bypasses categoryColors entirely', async () => {
    // The two `colors` overloads reach the renderer through different props
    // (objectui#4877); a positional palette must not be merged with the
    // per-category map at all.
    const schema = await reportChartSchema({ ...CHART, colors: ['#111', '#222'] });
    expect(schema.colors).toEqual(['#111', '#222']);
    // The FIELD's own derived colours still populate categoryColors — an
    // author choosing the positional palette doesn't erase them.
    expect(schema.categoryColors).toEqual(EXPECTED_CATEGORY_COLORS);
  });
});
