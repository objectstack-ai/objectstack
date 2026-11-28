// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The static chart node's series refuses the renderer-internal `measureFormat`
// carrier by name, in the posture its `aggregate` sibling already has. A D3
// entry with no D2 conversion: the carrier has no authored equivalent to
// rewrite into, because what it carries is the dataset's own fact.
export const entry: SemanticMigration = {
  id: 'chart-series-measure-format-carrier-refused',
  surface: 'static SDUI `chart` node series — `series[].measureFormat` (`{ format, currency, percentScale }`) '
    + 'on `@object-ui/types` `ChartDataSeriesSchema` and its TS twin `ChartDataSeries`',
  replacement: 'Delete the key. To print a static chart\'s value axis in a unit, write the axis `format` on the '
    + 'chart (`yAxis: [{ field: \'amount\', format: \'$0,0\' }]`), which takes precedence over the carrier. A '
    + 'report or dashboard chart bound to a dataset needs nothing: its producer fills the carrier from the '
    + 'measure the chart plots.',
  reason: 'The report and dashboard chart producers hand the chart renderer each series\' `measureFormat`, '
    + 'copied from the dataset answer\'s field, so a value axis over a dataset measure prints the measure\'s '
    + 'units. The key is internal by declaration, but the static chart node\'s series schema is non-strict and '
    + 'refused only `aggregate` by name, so a hand-written `measureFormat` was kept and honoured: an author, or '
    + 'an AI writing page metadata, could claim a currency or a percent scale the data does not have. It is '
    + 'now a `never` key on both faces: the zod mirror refuses it at `series.N.measureFormat`, and a typed '
    + 'literal fails `tsc`.',
  acceptanceCriteria: 'No static `chart` node carries `measureFormat` on a series; the parse refuses it with one '
    + 'issue at `series.N.measureFormat` naming the key, and a series that also writes `aggregate` is refused '
    + 'at both keys. A chart whose axis must print a unit declares `yAxis[].format`. Report and dashboard '
    + 'charts keep their axis units unchanged, because their producers fill the carrier past this schema.',
};
