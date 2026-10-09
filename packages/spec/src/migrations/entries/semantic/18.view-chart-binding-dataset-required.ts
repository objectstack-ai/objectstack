// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for the list-view chart-binding check (#22491): the enforce arm
// of ADR-0049 enforce-or-remove, applied to the ADR-0021 single form the list
// chart block already required. It narrows a list view's accept set; no key is
// removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There is
// no D2 conversion either: which dataset a chart plots is the author's
// decision, and a fabricated binding is the defect this closes.
export const entry: SemanticMigration = {
  id: 'view-chart-binding-dataset-required',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span.
  surface:
    'A list view whose type is chart and whose effective chart binding names no dataset: no chart block '
    + 'and no options.chart bag, or, on a flattened view overlay saved through the metadata write door, an '
    + 'options.chart bag missing its dataset or its values while no chart block replaces it. Judged at every '
    + 'list-view door: views[].list and views[].listViews, objects[].listViews, a view item config, and the '
    + 'flattened list overlay.',
  replacement:
    'Bind the chart: declare a top-level `chart` block naming the ADR-0021 `dataset` to plot and at least one '
    + 'of its measures in `values` (`dimensions`, the X / group axis, stays optional, and `chartType` defaults '
    + 'to `bar`). A view whose only binding is the legacy `options.chart` bag completes the bag with `dataset` '
    + 'and `values`, or, preferred, moves the binding to the top-level `chart` block, which replaces the bag '
    + 'whole. A view that is not meant to be a chart takes another `type`.',
  reason:
    'ADR-0021 single form, enforced (ADR-0049 enforce-or-remove, the enforce arm; ADR-0078, a view that '
    + 'renders nothing is refused rather than warned). A chart list view plots only the dataset its '
    + 'effective binding names, and the renderer reads that binding as the `chart` block, else the '
    + '`options.chart` bag, the block replacing the bag whole (objectui plugin-list `ListView`, '
    + '`resolveListChartBinding`, at this repo\'s `.objectui-sha` pin and at objectui main alike). The '
    + 'authoring `chart` block already required `dataset` and `values`, but a view with no block at all, or '
    + 'with only the bag, never met that schema. Measured on `origin/main` at `e148ca98`: the flattened '
    + 'overlay member accepted `type: \'chart\'` with no block and an `options.chart` bag holding only '
    + '`chartType`, and both authoring doors accepted the block-less view. What such a view rendered was a '
    + 'dead screen: at the pin the renderer fabricated a binding nobody wrote (an aggregate over a field '
    + 'named name and a measure named value), and objectui#6152 round 15 retired that floor, after which '
    + 'the chart component refuses on screen. Now refused at the view\'s own path, `chart`, or at '
    + '`options.chart.dataset` / `options.chart.values`, with the binding to declare. Ships at once, no '
    + 'grace window and no dual spelling (2026-08-27 maintainer ruling 「短期不考虑渐进」). Not convertible: '
    + 'only the author knows which dataset a chart was meant to show.',
  acceptanceCriteria:
    'WHICH DOOR: the spec schema\'s refusal, so it lands wherever a list view is parsed through '
    + '`@objectstack/spec` — `defineView`, `defineStack`, `os validate` / `os build`, and the metadata write '
    + 'door (`PUT /api/v1/meta/view/:name`, answering `422 INVALID_METADATA`) — as one `custom` issue at '
    + '`chart` for a view with no binding at all, or one per missing key at `options.chart.dataset` / '
    + '`options.chart.values` for an incomplete bag (overlay only; the authoring doors refuse `options` by '
    + 'name). A stored `sys_metadata` view row is neither rewritten nor refused on read: measured, the read '
    + 'door serves it as stored with the same issue in its `_diagnostics`, and it is refused on its next '
    + 'save. Fix each chart view by declaring its binding, then open it: it plots the dataset. A chart view '
    + 'that already declares a complete `chart` block parses byte-identically to before, and every view of '
    + 'another type is untouched, a grid that only offers a chart in `allowedVisualizations` included. '
    + 'Census at the time of the change: the two chart list views in `examples/app-showcase` and the chart '
    + 'list views in the `packages/lint` fixtures all bind a dataset and a measure; the only spec test that '
    + 'parsed a block-less chart view was a type-acceptance pin, re-judged in the same change.',
};
