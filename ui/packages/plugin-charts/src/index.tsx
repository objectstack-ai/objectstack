/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { ChartBarRenderer, ChartRenderer } from './ChartRenderer';
import { ObjectChartBlock } from './ObjectChart';

// Export types for external use
export type { BarChartSchema } from './types';
export { ChartBarRenderer, ChartRenderer };
export { ObjectChart, ObjectChartBlock } from './ObjectChart';
// objectui#7946 — the prop type is part of the published surface, exactly as
// `plugin-list` exports `ObjectGalleryProps` (objectui#6576). A prop type that
// anchors a schema but is not exported cannot be asserted against by a consumer.
export type { ObjectChartProps } from './ObjectChart';

// The ONE place the author-facing chart schema is translated into the
// renderer's internal pipeline contract (#2880 S1). Published from this entry
// — the package's only door — because a consumer that wants to know what
// `AdvancedChartImpl` is actually handed has to run the schema through the SAME
// translation the runtime applies; restating the translation instead would make
// the assertion a copy of the thing under test (objectui#4529, #4471).
//
// Costs nothing to ship: `ChartRenderer` above already imports this module
// statically, so it is in this entry's eager graph either way. This adds a
// name, not a byte.
export { normalizeChartSchema } from './normalizeChartSchema';
export type { NormalizedChartSchema } from './normalizeChartSchema';

// Standard Export Protocol - for manual integration
export const chartComponents = {
  'bar-chart': ChartBarRenderer,
  'chart': ChartRenderer,
};

// Register the component with the ComponentRegistry
ComponentRegistry.register(
  'bar-chart',
  ChartBarRenderer,
  {
    namespace: 'plugin-charts',
    label: 'Bar Chart',
    category: 'plugin',
    inputs: [
      { name: 'data', type: 'array', required: true },
      { name: 'dataKey', type: 'string' },
      { name: 'xAxisKey', type: 'string' },
      { name: 'height', type: 'number' },
      { name: 'color', type: 'color' },
    ],
    defaultProps: {
      data: [
        { name: 'Jan', value: 400 },
        { name: 'Feb', value: 300 },
        { name: 'Mar', value: 600 },
        { name: 'Apr', value: 800 },
        { name: 'May', value: 500 },
      ],
      dataKey: 'value',
      xAxisKey: 'name',
      height: 400,
      color: '#8884d8',
    },
  }
);
// Alias for generic view. `chart` collides with the raw data
// `plugin-charts:chart` (ChartRenderer) registered below, which owns the bare
// `type: 'chart'` schema keyword; this object/aggregate-query variant is
// reached via `view:chart` only.
// `ObjectChartBlock` (not the bare `ObjectChart`) so this alias consumes the
// spec's per-element `dataSource` binding exactly as `object-chart` does —
// one block reached under two keys must not be bound under only one of them
// (objectstack#6953).
ComponentRegistry.register('chart', ObjectChartBlock, {
  namespace: 'view',
  category: 'view',
  label: 'Chart',
  skipFallback: true,
  inputs: [
    // NOT required, for `object-chart`'s reason (objectui#11605): the same
    // `ObjectChartBlock` lands `dataSource.object` here.
    {
      name: 'objectName',
      type: 'string',
      description:
        'Object this chart aggregates. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, and no inline `data`, the chart shows a hint naming this key instead of an empty frame.',
    },
    { name: 'type', type: 'string' },
    { name: 'categoryField', type: 'string' },
    { name: 'valueField', type: 'string' },
  ]
});
// Register the advanced chart component
ComponentRegistry.register(
  'chart',
  ChartRenderer,
  {
    namespace: 'plugin-charts',
    label: 'Chart',
    category: 'plugin',
    inputs: [
      { 
        name: 'chartType', 
        type: 'enum', 
        enum: [
          { label: 'Bar', value: 'bar' },
          { label: 'Line', value: 'line' },
          { label: 'Area', value: 'area' },
          { label: 'Pie', value: 'pie' },
          { label: 'Donut', value: 'donut' },
          { label: 'Radar', value: 'radar' },
          { label: 'Scatter', value: 'scatter' }
        ]      },
      { name: 'data', type: 'code', required: true },
      { name: 'config', type: 'code' },
      { name: 'xAxisKey', type: 'string' },
      { name: 'series', type: 'code', required: true },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      chartType: 'bar',
      data: [
        { name: 'Jan', sales: 400, revenue: 240 },
        { name: 'Feb', sales: 300, revenue: 139 },
        { name: 'Mar', sales: 600, revenue: 380 },
        { name: 'Apr', sales: 800, revenue: 430 },
        { name: 'May', sales: 500, revenue: 220 },
      ],
      config: {
        sales: { label: 'Sales', color: '#8884d8' },
        revenue: { label: 'Revenue', color: '#82ca9d' }
      },
      xAxisKey: 'name',
      series: [
        { dataKey: 'sales' },
        { dataKey: 'revenue' }
      ]
    }
  }
);

/**
 * ⭐ The chart-family registration below (`chart:bar`; `pie-chart`,
 * `donut-chart`, `radar-chart` and `scatter-chart` were retired by
 * objectui#10859 batch 8) declares its family in ONE
 * place, and it is not here: `CHART_TYPE_KEYWORD_FAMILIES` in
 * `normalizeChartSchema.ts`, which `ChartRenderer` resolves through on every
 * render.
 *
 * Until objectui#7401 each of them carried a second declaration —
 * `defaultProps: { chartType: … }` — that **nothing on the SDUI path has ever
 * read**. `SchemaRenderer` does not read a registration's `defaultProps`; the
 * tree's one consumer (`core/src/registry/WidgetRegistry.ts`) WRITES manifest
 * defaults into the registry and never reads these back. So all four of the
 * families below rendered as BAR charts — `AdvancedChartImpl`'s default — on
 * valid data, with no refusal that could fire. Ruled route C: derive the
 * family from the schema's own `type`, and the inert declaration goes with it
 * rather than sitting beside a mechanism that works (`AGENTS.md` #0.1).
 *
 * ⛔ Do not re-add `defaultProps: { chartType: … }` to a registration here. It
 * would read as the family's declaration while changing nothing, which is the
 * exact state this card removed. A NEW chart-family keyword is added to
 * `CHART_TYPE_KEYWORD_FAMILIES` in the same edit as its `register()` call —
 * `__tests__/chart-family-from-type-7401.test.tsx` fails on either half alone.
 *
 * ⚠️ `bar-chart` above is NOT one of these: it is registered to
 * `ChartBarRenderer`, a wrapper that sets the family itself and never reaches
 * `normalizeChartSchema`. Its own `defaultProps` is a sample-data seed, not a
 * family declaration, and stays.
 */
// Alias for CRM App compatibility
ComponentRegistry.register(
  'chart:bar',
  ChartRenderer, 
  {
    namespace: 'plugin-charts',
    label: 'Bar Chart (Alias)',
    category: 'plugin'
  }
);

/**
 * ⛔ The `pie-chart`, `donut-chart` and `radar-chart` node type keys are
 * RETIRED (objectui#10859 batch 8, phase 2c, the seat's fork ruling on that
 * card, by the objectui#10393 / objectui#8760 route). Each family is reached as
 * `{ type: 'chart', chartType: 'pie' | 'donut' | 'radar' }`, the spelling that
 * draws ("chartType is the spelling that draws", objectui#8760).
 *
 * ## What was here, and why it went
 *
 * Three registrations of the generic `ChartRenderer`, one per key, each in the
 * `plugin-charts` namespace, so each stored `plugin-charts:KEY` and the bare
 * `KEY` fallback; their families came from `CHART_TYPE_KEYWORD_FAMILIES` rows
 * (objectui#7401), which went in the same change. No `@object-ui/types` arm
 * claims any of the three, so `objectui validate` refused such a node at
 * `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Phase 2b found one producer and reported the three as a fork:
 * `examples/chart-examples.ts` in this package authored all three, pinned by
 * objectui#7401's "the in-repo examples draw what they say". The fork ruling
 * moved those examples to `chart` + `chartType` first; the 7401 pin still
 * asserts each draws its family and no bar. Re-measured for phase 2c after that
 * move: 0 producers in source, docs, examples, the catalog or objectstack, and
 * 0 runtime emission. The console's lazy stubs went in the same change, so no
 * table or host keeps a key alive. The pie, donut and radar FAMILIES are
 * untouched.
 */

/**
 * ⛔ The `scatter-chart` node type key is RETIRED (objectui#10859 batch 8,
 * phase 2b, the seat's ruling on that card, by the objectui#10393 /
 * objectui#8760 route). The scatter family is reached the way every other
 * family is: `{ type: 'chart', chartType: 'scatter' }`, the spelling that
 * draws ("chartType is the spelling that draws", objectui#8760).
 *
 * ## What was here, and why it went
 *
 * A registration of the generic `ChartRenderer` under `scatter-chart` in the
 * `plugin-charts` namespace (described, not quoted: source readers such as
 * `@object-ui/types`' node-slot test take a quoted call in a comment for a live
 * one) — a second key on the generic renderer, which stored
 * both `plugin-charts:scatter-chart` and the bare `scatter-chart` fallback, and
 * whose family came from its `CHART_TYPE_KEYWORD_FAMILIES` row (objectui#7401).
 * No `@object-ui/types` arm claims it, so `objectui validate` refused a node
 * authored `type: 'scatter-chart'` at `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples, the catalog
 * or objectstack, and 0 runtime emission, re-measured for phase 2b. Its
 * `CHART_TYPE_KEYWORD_FAMILIES` row and the console's lazy stub
 * (`apps/console/src/register-plugins.ts`) went in the same change, so no table
 * or host keeps the key alive. The `scatter` FAMILY is untouched.
 *
 * `pie-chart`, `donut-chart` and `radar-chart` were ruled the same way. Phase
 * 2b kept them registered as a fork, because `examples/chart-examples.ts` still
 * authored them; phase 2c retired them once those examples had moved (the note
 * above).
 */
