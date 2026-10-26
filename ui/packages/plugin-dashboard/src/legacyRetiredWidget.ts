/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE legacy detector and ONE placeholder, shared by every dashboard surface
 * (objectui#4612).
 *
 * framework#3320 retired the pre-ADR-0021 inline-analytics binding — a widget
 * carrying top-level `object` + `categoryField` / `valueField` / `aggregate`
 * (pivot: `rowField` / `columnField`) instead of a semantic-layer `dataset`. No
 * authoring surface emits that shape anymore (`WidgetConfigPanel` actively
 * scrubs it on save via `LEGACY_ANALYTICS_KEYS`), so any widget still carrying
 * it is stale STORED metadata — and stored metadata is exactly what a renderer
 * cannot refuse to receive.
 *
 * The retirement therefore came with a graceful fallback: render a VISIBLE error
 * placeholder naming the fix, never a blank widget. That fallback was applied to
 * `DashboardRenderer` and to nothing else, while `DashboardGridLayout` — a
 * separately exported surface, then also registered as the `dashboard-grid` SDUI
 * component (retired by objectui#10859 batch 8) — kept falling through to its static-data branch with `data: []`. Same stored
 * metadata, same product: a rebind prompt on one surface and a silent blank
 * chart on the other, which is worse for the user than the pre-retirement state
 * (no chart, no diagnostic, no path to fix).
 *
 * The defect existed *because* there were two surfaces and one fix, so the cure
 * is not a second copy of the condition: both surfaces consume this module.
 *
 * ## What this deliberately does NOT match
 *
 * `options.data = { provider: 'object', object, aggregate }` is a DIFFERENT and
 * still-LIVE authoring surface — the async data-provider config, which carries
 * its OWN nested `object`/`aggregate`. Every read of it is on `widgetData`, not
 * on the widget top level (`DashboardRenderer.tsx` / `DashboardGridLayout.tsx`,
 * the `isObjectProvider` branches). Conflating the two would retire a working
 * feature, so the detector requires the absence of any widget-level data before
 * it looks at `object` at all — the same order `DashboardRenderer` has always
 * used.
 *
 * ⚠️ **Dated note, 2026-10-03 — the metric family's nested config is retired —
 * objectui#11525.** When this paragraph was written the nested
 * `provider: 'object'` config was live for every family; it no longer is for the
 * single-value family (`metric`, `gauge`, `solid-gauge`, `kpi`, `bullet`, and a
 * typeless widget, which resolves to `metric` since objectui#11514). By the
 * maintainer's ruling C on objectui#11525, both surfaces' metric arms answer a
 * dataset-less widget whose `options.data` (or widget-level `data`) is
 * `{ provider: 'object', … }` with {@link LEGACY_RETIRED_WIDGET_SCHEMA}, as
 * their pivot arms already did (objectui#10528). The chart and table families
 * stay live. The retirement sits in those family arms, not in this detector: it
 * says what a family may bind, not that a widget carries the retired top-level
 * shape, so {@link isLegacyRetiredWidget} is unchanged and still steps aside
 * for any widget-level data. The rest of this paragraph, and step 2's "live
 * `provider: 'object'` nested config" below, are kept as the reading of
 * objectui#4612.
 */

import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '@object-ui/types';
import type { DashboardWidgetSlotEntry } from './widgetDispatch';

/**
 * The placeholder schema rendered in place of a retired inline-analytics widget.
 *
 * A `text` node rather than a thrown error or an empty box: it has to reach the
 * author *inside the dashboard*, in the tile where the chart used to be, and it
 * has to say what to do next — a placeholder that only signals "something is
 * wrong" is a prettier blank. The wording is contract (one condition, one
 * wording) and is pinned verbatim by both surfaces' `legacyRetired` suites.
 */
export const LEGACY_RETIRED_WIDGET_SCHEMA = {
  type: 'text',
  content: 'This widget uses a retired data format. Edit it to bind a dataset.',
  variant: 'caption',
  align: 'center',
  className: 'flex h-full w-full items-center justify-center rounded border border-dashed border-destructive/40 bg-destructive/5 p-4 text-center text-destructive',
} as const;

/**
 * The four keys this detector reads, and the reason it needs a shape of its own:
 * two of them are not on `DashboardWidgetSchema` at all. `object` was removed
 * from the widget vocabulary by the retirement — reading it is the whole point
 * here — and `data` is a renderer-internal spelling that never had a declaration.
 * Naming them once, here, is what keeps `as any` out of both call sites.
 */
type LegacyRetiredReadKeys = {
  /** Semantic-layer binding (ADR-0021). Its presence means the widget is current. */
  dataset?: unknown;
  /** Renderer-internal inline data array (the widget-level spelling). */
  data?: unknown;
  /** Renderer-internal inline data / nested `provider: 'object'` config. */
  options?: { data?: unknown } | null;
  /** The retired pre-ADR-0021 top-level object binding. */
  object?: unknown;
};

/**
 * Does this widget still carry the retired pre-ADR-0021 inline-analytics shape?
 *
 * True when all three hold, in this order:
 *
 * 1. no `dataset` — a dataset-bound widget is the CURRENT shape and renders
 *    through the governed `queryDataset` path;
 * 2. no renderer-internal data — neither `widget.data` nor `options.data`, which
 *    covers both the static inline array and the live `provider: 'object'`
 *    nested config;
 * 3. a top-level `object` — the retired binding itself.
 *
 * `||` (not `??`) between the two data spellings, preserving `DashboardRenderer`
 * byte for byte.
 *
 * Step 1 is stated here rather than inherited from a caller's render fork:
 * `DashboardRenderer` never reached the placeholder for a dataset-bound widget
 * because `datasetBound` picks `DatasetWidget` at the render site regardless of
 * what `getComponentSchema` returned — so naming the condition costs that
 * surface no observable behavior, and it keeps the predicate true on its own
 * terms for any surface that has no such fork.
 */
export function isLegacyRetiredWidget(widget: DashboardWidgetSlotEntry | null | undefined): boolean {
  if (!widget) return false;
  const w = widget as LegacyRetiredReadKeys;
  if (w.dataset) return false;
  const widgetData = w.data || w.options?.data;
  return !widgetData && !!w.object;
}

/**
 * Is `node`, read from a widget's legacy `component` envelope
 * (`{ id, component, layout }`, objectui's own format, which the spec's widget
 * has no member for), a node the surfaces no longer draw? True for every node
 * but a `metric-card` (objectui#12254).
 *
 * The envelope takes a `metric-card` and nothing else: the 2026-08-14 slot
 * ruling (objectstack#8593) allowed that one node, and since objectui#12163
 * (ruling C) both zod faces and `DashboardWidgetSchema['component']` refuse any
 * other node by name. objectui#12254 retires the draw to match, after a census
 * of stored use found no producer. So the accept set is the authoring one, read
 * from the same closed list, `DASHBOARD_COMPONENT_WIDGET_TYPES`: a node whose
 * `type` is a member draws as before, and anything else in the envelope (a
 * node of another type, a node with no `type`, a string or a number) draws
 * {@link LEGACY_RETIRED_WIDGET_SCHEMA}, the rebind prompt the metric and pivot
 * arms return, and sends no query. The `object-metric` node objectui#11466
 * retired here first is one case of the rule.
 *
 * An empty envelope (`component` absent, or a falsy value) holds no node, so
 * this answers false and the widget draws by its family, as before.
 *
 * ⛔ Read only at the envelope: the same node types authored on a page, or a
 * `metric-card` placed directly in `widgets[]`, are not judged here.
 */
export function isRetiredEnvelopeNode(node: unknown): boolean {
  if (!node) return false;
  const type = typeof node === 'object' ? (node as { type?: unknown }).type : undefined;
  return !(DASHBOARD_COMPONENT_WIDGET_TYPES as readonly unknown[]).includes(type);
}
