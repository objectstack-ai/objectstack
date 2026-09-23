// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The judgement half of `dashboard-widget-chart-config-structure-removed`. The
// D2 conversion strips the four keys mechanically; what they CARRIED cannot be
// moved by a walker, because the intent lands one level up in a selection the
// stripped widget may not hold — an authored `xAxis.field` can name a dataset
// dimension the widget never selected, and a `series[]` entry can name a
// measure outside `values` entirely.
export const entry: SemanticMigration = {
  id: 'dashboard-widget-chart-config-structure-refused',
  surface:
    '`dashboard.widgets[].chartConfig.type` / `.xAxis` / `.yAxis` / `.series` — the four keys '
    + 'that said which chart family to draw, which series exist and which column each one reads '
    + 'on a DATASET-BOUND widget (REMOVED)',
  replacement:
    'the widget’s own `type` and its ADR-0021 dataset selection. `chartConfig.type` becomes the '
    + 'widget’s `type` (the chart family has always been the widget’s — the dashboard renderer '
    + 'maps the widget type to the chart family and never read the chart config’s). '
    + '`chartConfig.xAxis.field` becomes an entry in the widget’s `dimensions`: the dataset '
    + 'dimension the category axis plots. Each `chartConfig.yAxis[].field` becomes an entry in '
    + 'the widget’s `values`: the dataset measure that axis plots, one entry per mark, and a '
    + 'second axis is a second measure rather than a second axis declaration. Each '
    + '`chartConfig.series[].name` is the same measure name, so a series list that matched '
    + '`values` needs nothing and one that did not was already being ignored. What has NO '
    + 'replacement, and is the reason this is a TODO rather than a rewrite: the PRESENTATION '
    + 'those objects carried alongside the binding — `ChartAxis.title` / `format` / `min` / '
    + '`max` / `stepSize` / `showGridLines` / `position` / `logarithmic`, and '
    + '`ChartSeries.label` / `color` / `type` / `yAxis` / `stack` / `dashArray` / `opacity`. '
    + 'The dataset’s own dimension and measure declarations are what label and format a '
    + 'dataset-bound chart now; `colors` on the same chart config remains the palette channel, '
    + 'and a per-series mark type (the combo chart a widget could author through '
    + '`series[].type`) has no authoring channel on this face at all.',
  reason:
    'Maintainer ruling 2026-09-12, decision batch #121 item 1, verbatim 「同意」, on options '
    + 'C+D together: the protocol states the ownership split AND refuses the structural keys by '
    + 'name, because stating it without refusing them leaves the declared-but-inert shape '
    + 'ADR-0049 exists to end, and refusing them without stating it leaves an author with no '
    + 'reason. The defect being closed is not cosmetic: an authored `yAxis[].field` was a LIVE '
    + 'MEMBERSHIP CHANNEL — the renderer synthesised a series from the authored axes when the '
    + 'chart declared none — so one authored axis could silently re-point a dataset-bound '
    + 'series at a different column while the chart still drew, which reads as a true statement '
    + 'about the data. ⛔ Not mechanically convertible: the D2 conversion can delete the keys '
    + 'from a stored widget, but moving what they MEANT into the dataset selection needs facts '
    + 'the item does not carry — whether the dataset declares a dimension by that name, whether '
    + 'the measure is in the dataset at all, and whether the author wanted the axis they wrote '
    + 'or the one the selection derives. An authored field naming a column outside the '
    + 'selection is exactly the case where a walker guessing would produce a different chart '
    + 'rather than a refused one. The keys are NOT retired from the chart config itself: '
    + '`ReportChartSchema` keeps its own `xAxis`/`yAxis` (narrowed to its bound dataset’s '
    + 'dimension and measure names), and the react `<ObjectChart data={…}>` tier keeps all '
    + 'four, because an inline-data chart has no dataset to derive structure from and the '
    + 'author’s axes are the only ones there are.',
  acceptanceCriteria:
    'Measured against the shipped schema, not restated from the card. (1) No dashboard widget '
    + 'carries `chartConfig.type`, `.xAxis`, `.yAxis` or `.series`: the D2 conversion '
    + '`dashboard-widget-chart-config-structure-removed` strips them from authored sources on a '
    + 'chain replay and `os migrate meta --stored --apply` covers rows already at rest, and a '
    + 'value that reaches a parse is refused at that key’s own path with the prescription '
    + 'naming the dataset selection. (2) For every widget that carried one, the chart it draws '
    + 'after the migration is the chart the author meant: the family is the widget’s `type`, '
    + 'the category axis plots the dimension named in `dimensions`, and there is one mark per '
    + 'measure named in `values` — verified by rendering the dashboard, not by reading the '
    + 'metadata, because the pre-migration chart may have been plotting a column the selection '
    + 'never named. (3) A widget whose authored axes AGREED with its selection renders '
    + 'identically before and after, and that is the expected case; a widget that renders '
    + 'differently was relying on the membership channel this removes and is the case the '
    + 'ruling was made about. (4) Axis titles, number formats, axis bounds, grid lines and '
    + 'per-series labels/colours/mark types are gone from the widget and are NOT expected back: '
    + 'a dataset-bound chart takes them from the dataset’s dimension and measure declarations. '
    + 'A combo chart that was authored through `series[].type` on a dataset-bound widget has no '
    + 'authoring channel on this face after the change — that capability loss is ruled, not '
    + 'incidental, and an inline-data react `<ObjectChart>` is where a per-series mark type is '
    + 'still authored.',
};
