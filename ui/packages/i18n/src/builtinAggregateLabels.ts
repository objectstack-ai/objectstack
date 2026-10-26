/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7258 — the locale labels for the analytics service's BUILT-IN
 * default measures, keyed by the wire discriminator a result field carries as
 * `builtinAggregate` (producer half: objectstack#14492).
 *
 * `@object-ui/core`'s `buildChartSeries` cannot read the locale bundle (that
 * package is React-free and i18n-free by design), so this is the seam: the
 * renderer that holds the provider resolves the six strings ONCE through its
 * `useSafeTranslate()` and hands the map to core as
 * `ChartSeriesOptions.builtinAggregateLabels` — the same division of labour
 * `chart.nullCategory` already makes for the null bucket's label.
 *
 * The keys are the `report.aggregate.*` family the matrix report and the
 * dashboard's aggregate charts already read, not a second namespace: the
 * vocabulary (Count / Sum / Average / …) is the same on every surface, so ten
 * packs already carry it and a new key would only add drift surface. The only
 * mapping done here is spelling — the wire enum says `count_distinct`, the
 * bundle key says `countDistinct`.
 *
 * The English fallbacks are byte-equal to the `en` pack's values, so a
 * provider-less host renders exactly what an `en` session renders (pinned in
 * `__tests__/builtinAggregateLabels-locale-parity-7258.test.ts`).
 */
import type { BuiltinAggregate } from '@object-ui/core';

/** The per-call translate shape `useSafeTranslate()` returns: first real translation, else the English fallback. */
export type SafeTranslate = (key: string, fallback: string) => string;

/**
 * Resolve the display label of every built-in aggregate through the locale
 * bundle. Typed as the FULL record on purpose: a member added to core's
 * `BUILTIN_AGGREGATES` without a line here is a compile error, not a legend
 * that silently falls back to the server's English.
 */
export function builtinAggregateLabels(tt: SafeTranslate): Record<BuiltinAggregate, string> {
  return {
    count: tt('report.aggregate.count', 'Count'),
    count_distinct: tt('report.aggregate.countDistinct', 'Distinct Count'),
    sum: tt('report.aggregate.sum', 'Sum'),
    avg: tt('report.aggregate.avg', 'Average'),
    min: tt('report.aggregate.min', 'Min'),
    max: tt('report.aggregate.max', 'Max'),
  };
}
