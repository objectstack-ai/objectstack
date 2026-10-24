/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Drill-down helpers shared by PivotTable and chart widgets.
 *
 * The functions here implement the **Style A (declarative)** drill-down
 * protocol: a widget schema may carry an optional `drillDown` block, and
 * when a user clicks a cell / bar / segment the widget builds a click
 * payload (`event`) and asks these helpers to derive a filter + title for
 * the drill-down drawer.
 *
 * ```jsonc
 * "drillDown": {
 *   "enabled": true,
 *   "filter": { "stage": "${event.rowKey}", "lead_source": "${event.colKey}" },
 *   "title":  "${event.rowLabel} × ${event.colLabel}"
 * }
 * ```
 *
 * The helpers are intentionally protocol-agnostic — any caller can
 * synthesize an `event` object and rely on the same defaults / templating.
 */

import { parseFilterAST } from '@objectstack/spec/data';
import type { DrillDownConfig } from '@object-ui/types';

import { FilterOperatorError, mergeFilterNodes } from './filter-converter.js';

/**
 * Generic click payload. Pivots provide row/col, charts provide
 * category/series. Extra fields are passed through verbatim so callers
 * can reference them in templates.
 */
export interface DrillEvent {
  /** Pivot: row field raw value. */
  rowKey?: string;
  /** Pivot: column field raw value. */
  colKey?: string;
  /** Pivot: human-readable row label. */
  rowLabel?: string;
  /** Pivot: human-readable column label. */
  colLabel?: string;
  /** Chart: x-axis / category value. */
  category?: string;
  /** Chart: human-readable label for the category (when raw differs from display). */
  categoryLabel?: string;
  /** Chart: series name (multi-series charts). */
  series?: string;
  /** Aggregated value at the click point. */
  value?: number;
  /** Pivot scope: which cell type was clicked. */
  scope?: 'cell' | 'row' | 'column' | 'total';
  /** Free-form pass-through (e.g. raw record reference). */
  [key: string]: unknown;
}

/** Default field hints used to derive a filter when `config.filter` is omitted. */
export interface DrillDefaults {
  rowField?: string;
  columnField?: string;
  /** Chart group-by field (xAxisKey / aggregate.groupBy). */
  groupByField?: string;
}

const TEMPLATE = /\$\{event\.([a-zA-Z0-9_]+)\}/g;

/**
 * Substitute `${event.x}` placeholders in a string with values from the
 * event payload. Unknown keys resolve to an empty string.
 *
 * Non-string values are coerced via `String(...)`. Returns the input
 * unchanged when no placeholder is present.
 */
export function interpolate(template: string, event: DrillEvent): string {
  if (typeof template !== 'string' || template.indexOf('${event.') === -1) {
    return template;
  }
  return template.replace(TEMPLATE, (_match, key: string) => {
    const v = event[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

/**
 * Recursively walk a filter object/value and replace `${event.*}` strings
 * with the event values. Whole-string templates that resolve to a single
 * event field preserve the original (typed) value — e.g. `"${event.value}"`
 * stays a number — so backend filters can compare against the right type.
 */
function interpolateValue(value: unknown, event: DrillEvent): unknown {
  if (typeof value === 'string') {
    // Whole-string template (e.g. "${event.rowKey}") → keep typed value
    const m = value.match(/^\$\{event\.([a-zA-Z0-9_]+)\}$/);
    if (m) {
      const raw = event[m[1]];
      // Convert empty string sentinel back to null for SQL filter friendliness
      if (raw === '') return null;
      return raw === undefined ? null : raw;
    }
    return interpolate(value, event);
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolateValue(v, event));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateValue(v, event);
    }
    return out;
  }
  return value;
}

/**
 * Compute the filter object passed to the drilled list view.
 *
 * Resolution order:
 * 1. `config.filter` (interpolated against the event)
 * 2. Defaults derived from `defaults`:
 *    - `rowField` + event.rowKey  (pivot)
 *    - `columnField` + event.colKey  (pivot)
 *    - `groupByField` + event.category  (chart)
 *
 * Pivot scope shortcuts:
 *   - scope === 'row'    → only rowField filter
 *   - scope === 'column' → only columnField filter
 *   - scope === 'total'  → empty filter (drill-through to the full set)
 */
export function computeDrillFilter(
  config: DrillDownConfig | undefined,
  event: DrillEvent,
  defaults: DrillDefaults = {},
): Record<string, unknown> {
  if (config?.filter) {
    return interpolateValue(config.filter, event) as Record<string, unknown>;
  }

  const out: Record<string, unknown> = {};
  const { rowField, columnField, groupByField } = defaults;
  const scope = event.scope ?? 'cell';

  if (scope === 'total') return out;

  if ((scope === 'cell' || scope === 'row') && rowField && 'rowKey' in event) {
    out[rowField] = event.rowKey === '' ? null : event.rowKey;
  }
  if ((scope === 'cell' || scope === 'column') && columnField && 'colKey' in event) {
    out[columnField] = event.colKey === '' ? null : event.colKey;
  }
  if (groupByField && 'category' in event) {
    out[groupByField] = event.category === '' ? null : event.category;
  }
  return out;
}

/**
 * Compute the drill-down title (for drawer/dialog header).
 *
 * Falls back to the most descriptive non-empty thing we know about the
 * click point. Always returns a non-empty string.
 */
export function resolveDrillTitle(
  config: DrillDownConfig | undefined,
  event: DrillEvent,
  fallback = 'Details',
): string {
  if (config?.title) {
    const t = interpolate(config.title, event).trim();
    if (t) return t;
  }

  const parts: string[] = [];
  if (event.rowLabel) parts.push(event.rowLabel);
  if (event.colLabel) parts.push(event.colLabel);
  if (event.categoryLabel) parts.push(event.categoryLabel);
  else if (event.category) parts.push(event.category);
  if (event.series) parts.push(event.series);
  return parts.length > 0 ? parts.join(' × ') : fallback;
}

/** Whether drill-down is enabled on a config (treats `{}` as enabled too). */
export function isDrillEnabled(config: DrillDownConfig | undefined): boolean {
  if (!config) return false;
  return config.enabled !== false;
}

/**
 * Compose a widget's OWN filter with the filter a drill click derived, into the
 * one filter the drilled list is scoped by.
 *
 * ## The rule: `widget.filter ∧ drill.filter`
 *
 * The two are independent filter SOURCES and a drill must satisfy BOTH. The
 * widget's filter is what scopes the chart; the click context only says WHICH
 * bucket of that scope the user asked to see. So a drill may narrow the widget's
 * scope and may never widen it — which makes the composition a conjunction, not
 * a merge and emphatically not a spread.
 *
 * ⛔ The rule is NOT invented here. It is the contract {@link mergeFilterNodes}
 * already states — "combine filter sources under a single `and`, each as its OWN
 * child" — the sink every other multi-source filter in this repo goes through
 * (`ObjectView`, `RelatedList`, `LineItemsPanel`, `RecordPickerDialog`,
 * `ElementDataSourceGate`, `buildEffectiveFilter`). This function only applies
 * it at the drill seam and names it, so the answer is in one place rather than
 * re-derived per widget.
 *
 * ## Why the two arms needed a sink at all (objectui#8944)
 *
 * `ObjectChartSchema.filter` admits BOTH a spec `FilterArray`
 * (`[['stage','=','won']]`) and the ObjectQL `$filter` object
 * (`{ close_date: { $gte } }`), because both are read — both are forwarded
 * verbatim to `ds.aggregate` / `ds.find`. The drill seam used to compose them by
 * SPREADING the widget's filter into an object literal, which is correct for the
 * object arm and silent nonsense for the array arm: spreading `[['stage','=',
 * 'won']]` yields the index key `{ '0': ['stage','=','won'] }`, so the widget's
 * own conditions were replaced by a key the query layer ignores and the drilled
 * list showed rows the chart itself was scoped to exclude. `toFilterNode` (via
 * `mergeFilterNodes`) already lowers all three shapes in circulation, so routing
 * the pair through it is what makes the array arm survive.
 *
 * ## Why the result is lowered back to the object dialect
 *
 * {@link mergeFilterNodes} answers in the ObjectQL AST
 * (`['and', <widget>, <drill>]`). Both drill sinks take the `FilterCondition`
 * OBJECT dialect instead — the drawer hands the value to `object-data-table`'s
 * `filter` (which becomes `$filter`), and `DrillNavigationContext.openRecordList`
 * declares `Record<string, unknown>` and serializes it to `filter[...]` URL
 * params. `parseFilterAST` is the spec's single lowering sink between the two
 * dialects, so it is what converts, rather than a second local translation.
 *
 * ⭐ A lone surviving source lowers back to exactly the flat object the spread
 * produced (`{ stage: 'won' }`), so a chart with no filter of its own drills
 * identically to before; only a genuinely composed pair gains the `$and`.
 *
 * Returns `undefined` when neither source carries anything, so callers can omit
 * the key rather than send an empty filter.
 *
 * ⚠️ Refusals are the sink's, not this seam's: `mergeFilterNodes` rejects a
 * comparand the wire would also reject (a bare array on `=`, a `RegExp`) with
 * the `INVALID_FILTER` / 400 envelope. Such a filter already fails the widget's
 * OWN query for the same reason, so the drill and the chart now agree instead of
 * the drill quietly sending something the chart could not.
 *
 * ## One refusal type out of this seam (objectui#10789)
 *
 * The seam has TWO refusing steps, and they used to throw two different
 * things. `mergeFilterNodes` throws a {@link FilterOperatorError}. The spec's
 * `parseFilterAST`, which judges comparand shapes the converter passes
 * through, throws a plain `Error` that carries the same envelope as own
 * properties: `code: 'INVALID_FILTER'` and `status: 400`. An array-dialect
 * widget filter holds no rule objects, so the converter never judges it, and
 * `[['stage', 'in', 'won']]` (a scalar on a list operator) is refused only
 * there. So is the object spelling `{ stage: { $in: 'won' } }`.
 *
 * Every caller catches the refusal as a `FilterOperatorError`: the chart,
 * pivot and dataset drills report it and open nothing (never a filter-less
 * drill). So the spec's refusal is re-raised here AS one, with its message
 * verbatim and the same `INVALID_FILTER` / 400 envelope, rather than taught to
 * each caller as a second shape. Only an error whose `code` is
 * `INVALID_FILTER` is re-raised; anything else from `parseFilterAST` is a
 * defect rather than a statement about the author's filter, and passes
 * through untouched.
 */
export function composeDrillFilter(
  widgetFilter: unknown,
  drillFilter: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = mergeFilterNodes(widgetFilter, drillFilter);
  try {
    // `FilterCondition` is the spec's object-dialect filter; the drill sinks
    // type the same value as `Record<string, unknown>`, and this is the one
    // seam where the two names meet.
    return parseFilterAST(merged) as Record<string, unknown> | undefined;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'INVALID_FILTER') throw error;
    throw new FilterOperatorError((error as Error).message);
  }
}
