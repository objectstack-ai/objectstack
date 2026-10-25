/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import { ElementDataSourceGate, type ElementDataSourceMapping } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { DashboardRenderer } from './DashboardRenderer';
import { DashboardGridLayout } from './DashboardGridLayout';
import { MetricWidget } from './MetricWidget';
import { MetricCard } from './MetricCard';
import { ObjectMetricWidget } from './ObjectMetricWidget';
import { PivotTable } from './PivotTable';
import { ObjectPivotTable } from './ObjectPivotTable';
import { ObjectDataTable } from './ObjectDataTable';
import { DashboardConfigPanel } from './DashboardConfigPanel';
import { WidgetConfigPanel } from './WidgetConfigPanel';
import { DashboardWithConfig } from './DashboardWithConfig';
import { DrillDownDrawer } from './DrillDownDrawer';
import {
  RETIRED_DASHBOARD_NODE_TYPES,
  RetiredDashboardNodeTombstone,
} from './retired-node-types';

export { DashboardRenderer, DashboardGridLayout, MetricWidget, MetricCard, ObjectMetricWidget, PivotTable, ObjectPivotTable, ObjectDataTable, DashboardConfigPanel, WidgetConfigPanel, DashboardWithConfig, DrillDownDrawer };
export type { WidgetConfigPanelProps } from './WidgetConfigPanel';
// objectui#4748 — the config sidebar's provider-less English, exported for the
// same reason the sibling plugins export theirs: a defaults map that disagrees
// with the `en` pack renders two labels for one control, and the assertion that
// it does not needs to be able to import it.
export {
  CONFIG_PANEL_DEFAULT_TRANSLATIONS,
  useConfigPanelTranslation,
  type ConfigPanelTranslate,
} from './useConfigPanelTranslation';
export type {
  WidgetDatasetCatalogEntry,
  WidgetDatasetDimension,
  WidgetDatasetMeasure,
} from './dataset-catalog';
// objectui#11466 — the `plugin-dashboard:metric` node type, which
// `./widgetDispatch` declares in `@object-ui/types`' `CustomNodeRegistry`.
// Exported from the entry so the published typings load that declaration for
// every consumer of this package, not only for this package's own program.
export type { DashboardMetricNodeSchema } from './widgetDispatch';
// objectui#9533 — the retirement table and the widget it renders. Exported for
// the same reason the sibling packages export their tombstones: the assertion
// that an authored `view:dashboard` is refused BY NAME, with the migration in
// the refusal's own text, has to be able to import the text it asserts rather
// than restate it.
export {
  RETIRED_DASHBOARD_NODE_TYPES,
  RetiredDashboardNodeTombstone,
  reportRetiredDashboardNodeType,
  resetRetiredDashboardNodeTypeReports,
} from './retired-node-types';

// Register dashboard component
//
// objectui#5742 — `inputs` is the published authoring surface (serialized into
// `sdui.manifest.json` and `sdui-intrinsics.d.ts`; `dashboard` is in
// `PUBLIC_BLOCKS`), and it used to publish only `columns`/`gap`/`className`
// while `DashboardRenderer` honoured far more, so `validateTree` warned
// authors off keys that work — `widgets` included, the very key the
// `8d58f46b4` unconsumed-options warning descends into. The keys below are
// the per-key triage (#4668 / #5091 class), each declared because BOTH hold:
// the renderer reads it AND `@objectstack/spec`'s strict `DashboardSchema`
// accepts it, so the manifest never offers a key the save gate refuses.
//
// Deliberately NOT declared, pinned in
// `__tests__/dashboardAuthoredInputs.test.tsx`:
//   - `title`  — legacy spelling of `label`; the spec rejects it by name.
//     The `schema.title || schema.label` read STAYS (documents in the wild).
//   - `aria`   — spec tombstone (objectstack-ai/objectstack#3896 audit close-out): no dashboard
//     renderer ever applied it, and this package has no read site either.
//
// `name` is honoured too (the `schema.name` read keys the
// `dashboards.{name}.*` translation lookups) and is likewise NOT declared —
// objectui#5742 ruled it non-author for the INLINE node. Its reason is NOT
// the one above, and the difference is load-bearing: the spec ACCEPTS
// `name` — but on the DOCUMENT form, where it is required, not on this
// inline node. So the "spec accepts + renderer reads" line never fires here
// at all; its premise is about a different shape. Do not carry `title`'s
// "the spec rejects it" over to this key — the spec does not reject `name`.
// The `schema.name` read STAYS untouched.
// The evidence is the PRODUCER alone — `DashboardView` / the document loader
// hands the loaded document to the renderer, so an inline author is not the
// one who writes this key. That makes it a WEAKER exclusion than `title` /
// `aria`, each of which asserts a spec verdict a reader can re-check, and is
// why `name` carries no row in the pin test's table: there is no verdict for
// it to assert. Supporting reason: publishing `name` inline would teach
// authors — AI authors especially — to fabricate a dashboard identity that
// resolves NO translations and fails silently, minting a fresh
// silently-inert key, the exact defect class this card removes.
//
// ⛔ THE NAMESPACE IS `plugin-dashboard`, NOT `view` (objectui#9533, director
// summon #24 / batch #152 item 5, letter 1, maintainer-approved). This
// registration used to declare `view`, while `apps/console`'s two `registerLazy`
// loops declared `plugin-dashboard` for the same bare `dashboard` key. Two
// consequences followed, and both are pinned in
// `__tests__/dashboardBareKeyOwnership.test.tsx`:
//   1. bare `dashboard` declared one namespace before the chunk loaded and the
//      other after it — which answer a host got depended on when it asked;
//   2. `register()` clears the lazy stub of the type IT registers, and the type
//      it registered was `view:dashboard`, so `plugin-dashboard:dashboard` was
//      never cleared: no component was ever stored under it,
//      `hasLazy('dashboard', 'plugin-dashboard')` stayed true forever, and the
//      generated CLI whitelist advertised a spelling that could never resolve.
// Converging on the namespace the consumers already declare makes the bare key
// have ONE owner by construction rather than by whichever phase was observed.
// ⛔ Do not move it back; the retired `view:dashboard` spelling is answered by
// the tombstone registered at the bottom of this file.
ComponentRegistry.register(
  'dashboard',
  DashboardRenderer,
  {
    namespace: 'plugin-dashboard',
    label: 'Dashboard',
    category: 'Complex',
    icon: 'layout-dashboard',
    inputs: [
      { name: 'widgets', type: 'array', description: 'The widget tree — the spec’s DashboardWidget[]. Each widget binds a dataset (ADR-0021) and may carry a layout ({ x, y, w, h }) and filterBindings. When omitted the dashboard renders an empty grid.' },
      { name: 'label', type: ['string', 'object'], description: 'Display name, shown as the header title when `header` is declared — a string or an inline per-locale map such as { en, "zh-CN" }. Spec-canonical spelling; the legacy `title` spelling is not authoring surface.' },
      { name: 'description', type: ['string', 'object'], description: 'Header description shown under the title — a string or an inline per-locale map. Rendered only when `header` is declared and `header.showDescription` is not false.' },
      { name: 'header', type: 'object', description: 'Header block: { showTitle?, showDescription?, actions? }. Strict — the contract rejects any other key. Renders nothing (zero pixels) when everything it would show is suppressed.' },
      { name: 'globalFilters', type: 'array', description: 'Dashboard-level filter bar — the spec’s GlobalFilter[]. Filter values live as dashboard variables (readable in widget expressions as page.<name>) and are AND-merged into each bound widget’s query per its filterBindings.' },
      { name: 'dateRange', type: 'object', description: 'Built-in date-range filter: { field?, defaultRange?, allowCustomRange? }. `defaultRange` takes the spec’s date presets plus "custom"; the bound field defaults to created_at.' },
      { name: 'refreshIntervalSeconds', type: 'number', description: 'Auto-refresh period in seconds. Zero or a negative value disables the timer, and it only runs when the host wires an onRefresh handler.' },
      { name: 'columns', type: 'number' },
      { name: 'gap', type: 'number' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
        columns: 3,
        widgets: []
    }
  }
);

// Register metric widget (legacy)
//
// ⛔ `skipFallback: true` — the bare `metric` NODE key is RETIRED
// (objectui#10859 batch 8, phase 2b, seat ruling M3 option A). Both dashboard
// surfaces emit `plugin-dashboard:metric` through `DASHBOARD_NODE_TYPES`
// (`./widgetDispatch`), so the bare fallback had no emitter left, only a
// spelling `objectui validate` refuses at `type` while the registry mounted it.
// The dashboard WIDGET type `metric` (the spec's `ChartTypeSchema` value) is a
// different vocabulary and is untouched.
//
// The NODE key is a declared node type (objectui#11466):
// `DashboardMetricNodeSchema` in `./widgetDispatch`, entered in
// `CustomNodeRegistry` under `plugin-dashboard:metric`, so both surfaces hand
// `SchemaRenderer` a declared node with no cast.
ComponentRegistry.register(
  'metric',
  MetricWidget,
  {
    namespace: 'plugin-dashboard',
    skipFallback: true,
    label: 'Metric Widget',
    category: 'Dashboard',
    inputs: [
        { name: 'label', type: 'string' },
        { name: 'value', type: 'string' },
    ]
  }
);

// Register metric card (new standalone component)
//
// ⛔ `skipFallback: true` — the bare `metric-card` NODE key is RETIRED
// (objectui#10859 batch 8, phase 2b, seat ruling M3 option A), for the reason
// the `metric` registration above gives. The 2026-08-14 slot ruling
// (objectstack#8593) is untouched: `{ type: 'metric-card', ... }` placed in a
// dashboard's `widgets[]` is still the widget-slot spelling, and the surfaces
// hand it to `SchemaRenderer` as `plugin-dashboard:metric-card`.
ComponentRegistry.register(
  'metric-card',
  MetricCard,
  {
    namespace: 'plugin-dashboard',
    skipFallback: true,
    label: 'Metric Card',
    category: 'Dashboard',
    inputs: [
        { name: 'title', type: 'string' },
        { name: 'value', type: 'string', required: true },
        { name: 'icon', type: 'string' },
        { name: 'trend', type: 'enum', enum: [
          { label: 'Up', value: 'up' },
          { label: 'Down', value: 'down' },
          { label: 'Neutral', value: 'neutral' }
        ]},
        { name: 'trendValue', type: 'string' },
        { name: 'description', type: 'string' },
    ],
    defaultProps: {
      title: 'Metric',
      value: '0'
    }
  }
);

/**
 * What `ObjectMetricWidget` reads for its own query: the object it aggregates
 * and the filter it aggregates over. A metric is ONE aggregated number — there
 * is no projection, no ordering and no page — so `columns` / `sort` / `limit`
 * have no read site here and are left unmapped rather than written to a key the
 * widget ignores.
 */
const OBJECT_METRIC_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
};

/**
 * Registry shell for `object-metric` — the spec's per-element `dataSource`
 * binding onto the props {@link ObjectMetricWidget} reads (objectstack#6953).
 *
 * This widget is registered directly and takes `objectName` / `filter` as PROPS
 * (`SchemaRenderer` spreads the schema's own keys onto it), so the binding had
 * no path in at all: a metric authored with `dataSource: { object, view }` and
 * no flat `objectName` fell through to the widget's no-object branch and showed
 * its static fallback value — a number that looks real and answers nothing.
 *
 * The props keep their standing when there is no binding: `bound` IS the schema
 * by reference in that case, so `bound?.x ?? props.x` resolves to what the
 * spread already provided, and a host that renders this component with explicit
 * props and no schema at all is untouched. (This sentence named "the dashboard
 * grid path" as such a host until objectui#11525 retired the dashboards'
 * inline `object-metric` node; that path builds none now.)
 */
const ObjectMetricBlock: React.FC<{ schema?: any; [key: string]: any }> = elementDataSourceBlock(({ schema, ...props }) => {
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_METRIC_DATA_SOURCE}
      dataSource={props.dataSource}
      testId="object-metric"
      errorTitle={t('element.number.sourceUnresolved', {
        defaultValue: 'This metric’s data source could not be resolved',
      })}
      // A metric that names its object in neither place has nothing to
      // aggregate, and drew a bare dash, which reads as a value (objectui#11605).
      // A host rendering this widget with explicit props and no schema is not a
      // node and is left alone, and an authored `fallbackValue` is a static tile
      // the author chose.
      requiresObject={schema != null && schema.fallbackValue === undefined}
    >
      {(bound) => (
        <ObjectMetricWidget
          {...(props as any)}
          objectName={bound?.objectName ?? props.objectName}
          filter={bound?.filter ?? props.filter}
        />
      )}
    </ElementDataSourceGate>
  );
});

// Register object-aware metric widget (async data loading with error states)
ComponentRegistry.register(
  'object-metric',
  ObjectMetricBlock,
  {
    namespace: 'plugin-dashboard',
    label: 'Object Metric',
    category: 'Dashboard',
    inputs: [
        // NOT required, as on the spec row (objectui#11605): `ComponentPropsMap
        // ['object-metric']` leaves `objectName` optional "because the
        // component-level `dataSource` binding can supply the object instead",
        // and `ObjectMetricBlock` lands `dataSource.object` here. The page
        // compile reads this list, so `required: true` refused a bound node the
        // row and the renderer accept. A node with neither is answered by the
        // gate's "no object named" hint.
        {
          name: 'objectName',
          type: 'string',
          description:
            'Object this metric aggregates. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, and no `fallbackValue`, the tile shows a hint naming this key instead of a value.',
        },
        // The row's three `I18nLabel` members (`ComponentPropsMap['object-metric']`):
        // `label`, `description` and `title`. `MetricWidget` resolves `label` and
        // `description` with `pickLocalized` against the active UI language, and
        // `ObjectMetricWidget` resolves `title` (and `label` as its fallback) the
        // same way for the drill-down panel's heading. So both arms are declared,
        // as `ComponentInput.type` prescribes for a key whose render site resolves
        // the map: a `'string'`-only declaration made the manifest gate report
        // `type-mismatch` on a legal map (objectui#10993). The render is pinned by
        // `ObjectMetric.i18nLabel-10993.test.tsx`, the manifest by the console's
        // `i18nLabelInputsManifest-10993.test.ts`.
        {
          name: 'label',
          type: ['string', 'object'],
          description:
            'Heading of the tile, and of the drill-down panel when `title` is not set. Accepts either a plain string or an inline per-locale map (`{ en: "Pipeline", "zh-CN": "销售管道" }`) — the `I18nLabel` union the contract admits on this key — and the tile resolves the map against the active UI language, falling back through base language, a region-qualified sibling, `default`, then `en`, and finally to any remaining entry.',
        },
        { name: 'aggregate', type: 'object', description: 'Aggregation config: { field, function, groupBy }' },
        { name: 'icon', type: 'string' },
        {
          name: 'description',
          type: ['string', 'object'],
          description:
            'Helper text rendered under the value. Accepts either a plain string or an inline per-locale map (`{ en: "This quarter", "zh-CN": "本季度" }`), resolved against the active UI language with the same fallback chain as `label`.',
        },
        {
          name: 'title',
          type: ['string', 'object'],
          description:
            'Heading of the drill-down panel. Defaults to `label` — set it only when the records list wants a different name from the tile. Accepts either a plain string or an inline per-locale map (`{ en: "Open deals", "zh-CN": "进行中的商机" }`), resolved against the active UI language with the same fallback chain as `label`.',
        },
        { name: 'filter', type: 'array', description: 'Criteria the aggregation is scoped by. The same filter narrows the drill-down list, so the number and the records behind it always agree.' },
        { name: 'colorVariant', type: 'enum', enum: ['default', 'blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger'], description: 'Colour of the icon container. Semantic, not decorative: `success` / `warning` / `danger` should track what the number means.' },
        { name: 'variant', type: 'enum', enum: ['card', 'bare'], description: '`card` draws the tile’s own surface; `bare` drops it, for a metric already sitting inside a card.' },
        { name: 'format', type: 'string', description: 'Numeral-style format pattern, e.g. `0,0`, `$0,0`, `0%`. Use `currency` instead of hard-coding a currency symbol here.' },
        { name: 'currency', type: 'string', description: 'ISO 4217 code, e.g. `USD`. Enables locale-aware currency formatting of the value.' },
        { name: 'prefix', type: 'string', description: 'Static text placed before the formatted value.' },
        { name: 'suffix', type: 'string', description: 'Static text placed after the formatted value.' },
        { name: 'invert', type: 'boolean', description: 'Display `1 - value` — for gauges whose good direction is down, such as error rate shown as uptime.' },
        { name: 'fallbackValue', type: 'string', description: 'Value shown when no data source resolves. For static/demo tiles; a bound metric should not need it.' },
        { name: 'trend', type: 'object', description: 'Static trend badge: `{ value, label, direction }`. Use `compareTo` instead when the trend should be computed from data.' },
        { name: 'compareTo', type: 'object', description: 'Period-over-period comparison, `{ kind: "previousPeriod" }` or `{ kind: "previousYear" }` — the computed alternative to a static `trend`.' },
        { name: 'drillDown', type: 'object', description: 'Click-through config that opens the records behind the number. `drillDown.filter` and `drillDown.mode` do not apply to a metric, which has no clicked point to filter by and no row to open, so the list is always scoped by this block’s own `filter`; a drill `filter` belongs on `object-chart` or `object-pivot`, and `mode` on `object-data-table`.' },
    ],
    defaultProps: {
      label: 'Metric',
    }
  }
);

// Register pivot table component
ComponentRegistry.register(
  'pivot',
  PivotTable,
  {
    namespace: 'plugin-dashboard',
    label: 'Pivot Table',
    category: 'Dashboard',
    icon: 'table-2',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'rowField', type: 'string', required: true },
      { name: 'columnField', type: 'string', required: true },
      { name: 'valueField', type: 'string', required: true },
      { name: 'aggregation', type: 'enum', enum: [
        { label: 'Sum', value: 'sum' },
        { label: 'Count', value: 'count' },
        { label: 'Average', value: 'avg' },
        { label: 'Min', value: 'min' },
        { label: 'Max', value: 'max' },
      ]},
      { name: 'showRowTotals', type: 'boolean' },
      { name: 'showColumnTotals', type: 'boolean' },
      { name: 'format', type: 'string' },
    ],
    defaultProps: {
      rowField: '',
      columnField: '',
      valueField: '',
      aggregation: 'sum',
      data: [],
    }
  }
);

/**
 * What `ObjectPivotTable` reads for its own query: the object it cross-tabs and
 * the filter it cross-tabs over (`ObjectPivotTable.tsx` —
 * `dataSource.find(schema.objectName, { $filter: resolveFilterPlaceholders(schema.filter, …) })`).
 *
 * `sort` / `limit` / `columns` are deliberately unmapped, none of them having a
 * read site here: a pivot's ordering comes out of its own row/column grouping
 * (`rowField` / `columnField`), its fetch issues no `$top` because a cross-tab
 * over a truncated page would report wrong totals, and its "columns" are the
 * `columnField` VALUES, not a field projection a saved view could supply.
 */
const OBJECT_PIVOT_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
};

/**
 * Registry shell for `object-pivot` — the spec's per-element `dataSource`
 * binding onto the schema keys {@link ObjectPivotTable} reads (objectstack#7121).
 *
 * Without it a pivot authored the way the spec documents (`dataSource: { object,
 * view }`, no flat `objectName`) fell through the `if (!dataSource ||
 * !schema.objectName) return;` guard in its fetch effect: an empty cross-tab, no
 * request, no diagnostic. Same shape the sibling `object-metric` above had.
 *
 * Props pass through untouched, and `bound` IS the schema by reference when there
 * is no binding — so the dashboard/manual paths that render this component with a
 * plain schema behave exactly as before.
 */
const ObjectPivotBlock: React.FC<{ schema?: any; [key: string]: any }> = elementDataSourceBlock(({ schema, ...props }) => {
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_PIVOT_DATA_SOURCE}
      dataSource={props.dataSource}
      testId="object-pivot"
      errorTitle={t('element.pivotTable.sourceUnresolved', {
        defaultValue: 'This pivot table’s data source could not be resolved',
      })}
      // A pivot that names its object in neither place has nothing to fetch, and
      // drew the empty state that says its query "returned no records yet" — a
      // query it never ran (objectui#11605). Inline `data` rows and a `bind`
      // path are this table's other record sources, and a host rendering it with
      // no schema is not a node.
      requiresObject={schema != null && schema.data == null && schema.bind == null}
    >
      {(bound) => <ObjectPivotTable {...(props as any)} schema={bound as any} />}
    </ElementDataSourceGate>
  );
});

// Register object-aware pivot table (async data loading)
ComponentRegistry.register(
  'object-pivot',
  ObjectPivotBlock,
  {
    namespace: 'plugin-dashboard',
    label: 'Object Pivot Table',
    category: 'Dashboard',
    icon: 'table-2',
    inputs: [
      // NOT required (objectui#11605). This block has no `ComponentPropsMap`
      // row; the contract is the binding doc (`content/docs/guide/data-source.md`,
      // "a node bound this way needs no `objectName` of its own"), and
      // `ObjectPivotBlock` lands `dataSource.object` here. The page compile reads
      // this list, so `required: true` refused a bound node the renderer
      // accepts. A node with neither is answered by the gate's hint.
      {
        name: 'objectName',
        type: 'string',
        description:
          'Object this pivot table cross-tabulates. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, the table shows a hint naming this key and fetches nothing.',
      },
      { name: 'title', type: 'string' },
      { name: 'rowField', type: 'string', required: true },
      { name: 'columnField', type: 'string', required: true },
      { name: 'valueField', type: 'string', required: true },
      { name: 'aggregation', type: 'enum', enum: [
        { label: 'Sum', value: 'sum' },
        { label: 'Count', value: 'count' },
        { label: 'Average', value: 'avg' },
        { label: 'Min', value: 'min' },
        { label: 'Max', value: 'max' },
      ]},
      { name: 'showRowTotals', type: 'boolean' },
      { name: 'showColumnTotals', type: 'boolean' },
      { name: 'filter', type: 'array' },
      { name: 'format', type: 'string' },
      // objectui#11440: read by `ObjectPivotTable` (`isDrillEnabled`,
      // `computeDrillFilter`, the `DrillDownDrawer` it opens) and declared by the
      // block's zod arm in `@object-ui/types`, so it is published here too.
      { name: 'drillDown', type: 'object', description: 'Click-through config that opens the records behind a clicked cell, header or total — in a drawer, a dialog, the object’s list page (`target: "navigate"`), or an analytical report (`report`). The drilled list is this block’s `filter` narrowed by the clicked value. `drillDown.mode` does not apply: every click point on a pivot is an aggregated bucket, so it always drills through; `mode` belongs on `object-data-table`.' },
    ],
    defaultProps: {
      rowField: '',
      columnField: '',
      valueField: '',
      aggregation: 'sum',
    }
  }
);

/**
 * ⛔ The `dashboard-grid` node type key is RETIRED (objectui#10859 batch 8,
 * phase 2b, the seat's ruling on that card, by the objectui#10393 /
 * objectui#8760 route). `DashboardGridLayout` stays exported: a host that wants
 * the drag/resize grid mounts the React component directly, as the README's
 * "DashboardGridLayout — persisting drag / resize edits" section shows.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('dashboard-grid', DashboardGridLayout, {
 * namespace: 'plugin-dashboard', ... })` — builder chrome published as a node
 * key, storing both `plugin-dashboard:dashboard-grid` and the bare
 * `dashboard-grid` fallback. No `@object-ui/types` arm claims it, so
 * `objectui validate` refused a node authored `type: 'dashboard-grid'` at
 * `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples or the catalog
 * and 0 runtime emission, re-measured for phase 2b (objectstack names it only
 * as a host type in its own `sdui-parser` widget-options lint, a reader). The
 * key leaves `dashboardComponents` below and the console's lazy stubs
 * (`apps/console/src/register-plugins.ts`, `apps/console/src/preview-gallery.tsx`)
 * in the same change, so no map or host keeps it alive. The dashboard's
 * authorable node is `dashboard` (`DashboardRenderer`).
 */

// Register object-aware data table (async data loading)
ComponentRegistry.register(
  'object-data-table',
  ObjectDataTable,
  {
    namespace: 'plugin-dashboard',
    label: 'Object Data Table',
    category: 'Dashboard',
    icon: 'table',
    inputs: [
      { name: 'objectName', type: 'string', required: true },
      { name: 'columns', type: 'array' },
      { name: 'filter', type: 'array' },
      { name: 'searchable', type: 'boolean' },
      { name: 'pagination', type: 'boolean' },
    ],
    defaultProps: {
      searchable: false,
      pagination: false,
    }
  }
);

// RETIRED SPELLINGS, registered LAST (objectui#9533).
//
// `view:dashboard` was this package's own full type until the bare `dashboard`
// key was converged onto `plugin-dashboard` above. The key stays registered and
// answers with `RetiredDashboardNodeTombstone` — a visible refusal that names
// the spelling the author wrote and the spelling that replaces it — because the
// ruling requires the refusal to be BY NAME and ⛔ not a silent fall-through.
//
// ⛔ `skipFallback: true` is load-bearing twice over: a tombstone must not claim
// the bare `dashboard` key (`plugin-dashboard:dashboard` owns it), and without
// it this call would re-contest the very key the card converged.
//
// LAST, for the same reason `registerAllFields()` registers its tombstones last:
// `register()` clears the lazy stub of the bare name as well as of its own full
// type, so a tombstone running BEFORE the real registration would drop a stub
// the real registration is about to satisfy.
//
// The loop shape is what the key derivation reads: `deriveRegistryKeys` pairs an
// unresolvable key argument with the collection that supplies it, and
// `INDIRECT_REGISTRATIONS` in `scripts/check-doc-component-types.mjs` declares
// this collection WITHHELD — so a retired spelling is refused by `objectui
// check` instead of being blessed by the generated whitelist, which is the whole
// point of retiring it.
for (const retired of Object.keys(RETIRED_DASHBOARD_NODE_TYPES)) {
  ComponentRegistry.register(retired, RetiredDashboardNodeTombstone, {
    namespace: 'view',
    skipFallback: true,
  });
}

// Standard Export Protocol - for manual integration. Keyed by the schema
// `type` each entry serves (objectui#5064 — aligned with the four sibling
// `*Components` maps); every value is the exact component the side-effect
// import registers for that type, including the two internal
// data-source-gate wrappers for the `object-*` types.
//
// objectui#10859 batch 8 (phase 2b): `metric` and `metric-card` register with
// `skipFallback: true`, so the type each serves is its NAMESPACED key, and the
// map says so — iterating it must not re-create the retired bare keys.
// `dashboard-grid` is retired and gone from the map; `DashboardGridLayout`
// stays a named export.
export const dashboardComponents = {
  'dashboard': DashboardRenderer,
  'plugin-dashboard:metric': MetricWidget,
  'plugin-dashboard:metric-card': MetricCard,
  'object-metric': ObjectMetricBlock,
  'pivot': PivotTable,
  'object-pivot': ObjectPivotBlock,
  'object-data-table': ObjectDataTable,
};
