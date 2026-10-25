// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasetReportRenderer
 *
 * Renders a spec `Report` that binds to a semantic-layer `dataset` (ADR-0021
 * single-form) instead of an inline `objectName` + `columns` query. The report
 * selects dimensions (`rows`, and for matrix also `columns`) and measures
 * (`values`) BY NAME and runs them through `dataSource.queryDataset` — the
 * same governed path dataset-bound dashboard widgets and the dataset preview
 * use, so the numbers (and the server-resolved dimension display labels)
 * match everywhere.
 *
 * - `tabular` → the selection as a simple list (`rows` + `values`), no totals.
 * - `summary` → the same table plus a SERVER-computed grand-total footer
 *   (`totals: { groupings: [[]] }`) — the declared type picks the branch
 *   (#2941), the data shape never does.
 * - `matrix` → a true cross-tab (ADR-0021 D2): `rows` down × `columns`
 *   across, measures in the cells. One dataset query over all dimensions,
 *   pivoted client-side. Totals (per-row subtotals, per-column subtotals,
 *   grand total) are SERVER-supplied: the selection asks for
 *   `totals: { groupings: [rows, columns, []] }` and the renderer only
 *   places the returned pre-aggregated rows. It never re-aggregates bucketed
 *   values client-side — measures like `avg` cannot be recombined without
 *   drifting from the semantic layer (the ADR-0021 governance red line) —
 *   so an older server that returns no `totals` renders the plain cross-tab
 *   with no totals row/column. A matrix without `columns` degrades to the
 *   flat grouped table.
 * - `chart` (any non-joined type) → the embedded chart, its own
 *   `chart.xAxis` × `chart.yAxis` dataset query: above the grouped / flat
 *   table, below the matrix cross-tab (objectui#10964).
 * - `joined` → a vertical stack of blocks, each its own dataset-bound table,
 *   with the report-level `runtimeFilter` merged into every block.
 *
 * Headers and measure cells mirror the dashboard `DatasetWidget` (PR #1825):
 * column headers use the dataset's server-supplied display `label` (run
 * through the i18n field-label convention), and measure values format with
 * the field's declared `currency` (`Intl` symbol) + numeral `format`, never
 * the raw field name or a misleading "$".
 *
 * Ordering (framework#3916): a report's `order` — a list of `{ by, direction }`
 * keys, most significant first — is lowered onto the dataset selection, so the
 * SERVER orders the whole grid (after measure-scoped filters merge and derived
 * measures evaluate) and this renderer only places the rows it is handed. It is
 * never a client-side re-sort: sorting here would order the truncated page
 * rather than the query, and could not sort by a derived measure at all.
 *
 * Declaring NO `order` leaves the grid in the dataset's `GROUP BY` order — the
 * stored values' alphabetical order — which for a select dimension is not the
 * domain order. So, and only then, this renderer lays a select dimension's
 * groups out in its field's DECLARED option order (objectui#12243, the reading
 * objectui#11809 set for grid groups and dashboard charts): the table rows, the
 * matrix headers on both axes and the embedded chart's categories. Declared
 * options first, undeclared values next in the dataset's order, the empty
 * bucket last; a dimension without options keeps its arrival order. It moves
 * nothing the server ordered on the author's behalf (see
 * `arrangeByDeclaredOptions`).
 *
 * For a matrix that also decides the ACROSS axis: `colHeaders` are collected in
 * row-arrival order, so ordering the rows by the across dimension is what makes
 * the columns read left-to-right in that order. Declaring nothing still reads
 * correctly — the server defaults a selected time dimension to ascending, which
 * is what makes month/quarter columns chronological out of the box.
 *
 * Drill-down (ADR-0021 D2): when the report's `drilldown` flag is not `false`
 * and the host supplies `onDrill`, every aggregated row / matrix cell is
 * clickable and emits `{ dataset, groupKey, runtimeFilter }`. The HOST owns
 * navigation — it resolves the dataset's `object` and dimension→field mapping
 * (this renderer only knows dimension NAMES) and routes to the underlying
 * records.
 */

import * as React from 'react';
import { Loader2, AlertTriangle, Table2, ShieldAlert } from 'lucide-react';
import {
  ComponentRegistry,
  formatMeasure,
  formatDimensionValue,
  buildDatasetFieldHelpers,
  buildDatasetDrillFilter,
  FilterOperatorError,
  relabelDimensions,
  // The dataset→chart derivation the dashboard and the chart view have always
  // used, adopted here by objectui#4878: it is where the whole null-category
  // family lives (#4466 / #4497 / #4673 / #4500 / #4508), so routing through it
  // INHERITS those fixes instead of re-deriving them on a third surface.
  buildChartSeries,
  // The authored half of objectui#4229's data/presentation split (objectui#4877):
  // the chrome and the per-series presentation. No axis is lowered, and none
  // needs to be: a report's `chart.xAxis`/`chart.yAxis` are bare
  // dimension/measure NAME strings, i.e. pure data on this surface; see the
  // call site.
  chartConfigPresentation,
  mergeAuthoredSeries,
  pivotBucketId,
  pivotDimensionValue,
  pivotCellKey,
  // objectui#4906 — the report chart's per-category derivation, reusing the
  // exact chain `DatasetWidget` already runs (see the call site below): the
  // category dimension's own option COLOURS (`buildOptionColorMap`) and its
  // declared picklist ORDER (`buildCategoryOrder`, framework#3588), fed
  // LOCALIZED options (`localizeFieldOptions` + `dimensionOptionTranslator`) so
  // they key by the same string the relabeled rows carry.
  buildOptionColorMap,
  buildCategoryOrder,
  localizeFieldOptions,
  dimensionOptionTranslator,
  deriveDimensionLabelMaps,
  // objectui#12243 — the rank reading of that same declared order, the one
  // the funnel and objectui#11809's grid and dashboard chart already use. The
  // report's TABLE rows, its matrix headers and its chart's categories are put
  // in it (see `arrangeByDeclaredOptions`).
  buildCategoryRank,
  type DatasetResultField,
  type DatasetDrillRange,
} from '@object-ui/core';
import { builtinAggregateLabels, useSafeFieldLabel, useSafeTranslate, useDisplayLocale, useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import { useDataInvalidation, classifyLoadError } from '@object-ui/react';
import { mergeFilters } from './mergeFilters';
import { useDatasetDimensionMeta, type DatasetDimensionMeta } from './useDatasetDimensionLabels';

type Row = Record<string, unknown>;

/**
 * One server-computed totals grouping: `dimensions: []` is the grand total.
 *
 * The RESULT side (the response's `totals[]`), named apart from
 * `@objectstack/spec/api`'s `DatasetTotals`, which since 17.5.0 is the REQUEST
 * side (`{ groupings }`, what to compute) — objectui#11073.
 */
interface DatasetResultTotals {
  dimensions: string[];
  rows: Row[];
}

interface DatasetCapableSource {
  queryDataset?: (
    dataset: string,
    selection: unknown,
  ) => Promise<{
    rows: Row[];
    fields?: DatasetResultField[];
    object?: string;
    dimensionFields?: Record<string, string>;
    drillRawRows?: Row[];
    drillRanges?: Array<Record<string, DatasetDrillRange>>;
    totals?: DatasetResultTotals[];
  }>;
}

/** What a drill click means — the host resolves names to a navigation target. */
export interface DatasetDrillArgs {
  /** Dataset the clicked aggregate was computed over. */
  dataset: string;
  /** Dimension NAME → clicked bucket value (row dims, plus across dims for a matrix cell). */
  groupKey: Record<string, unknown>;
  /** The effective render-time scope filter, if any. */
  runtimeFilter?: Record<string, unknown>;
  /** The dataset's base object (records to drill into), when the server supplied it. */
  object?: string;
  /**
   * Exact record-list filter (object FIELD name → RAW stored value) for the
   * clicked bucket, ANDed with `runtimeFilter`. Present only when the server
   * returned the dimension→field mapping + raw grouped values, so the host can
   * filter precisely — including select/lookup dims a display-label `groupKey`
   * would mis-filter — without re-fetching the dataset definition.
   */
  objectFilter?: Record<string, unknown>;
}

/** A report (or joined block) bound to a dataset. Field access is permissive — */
/** the bundled spec types lag the runtime schema across the repo boundary.     */
interface DatasetReportLike {
  name?: string;
  type?: string;
  dataset?: string;
  rows?: string[];
  /** Dimension names across — matrix pivots `rows` × `columns` (ADR-0021 D2). */
  columns?: string[];
  values?: string[];
  runtimeFilter?: Record<string, unknown>;
  /**
   * ⛔ NOT an authorable key, and NEVER applied as a filter (objectui#5137).
   *
   * `ReportSchema` (`@objectstack/spec`) is `z.core.$strict` and rejects
   * `filter` outright, naming the replacement itself
   * (`Did you mean … → runtimeFilter?`) — so a document carrying it did not
   * arrive through the validated path. It stays declared for exactly one reason:
   * so {@link warnOnRejectedFilterAlias} can SEE it on a stored document and
   * say out loud that no filter was applied. Reading it AS a scope filter is
   * the consumer tolerance this card removed. Author `runtimeFilter`.
   */
  filter?: Record<string, unknown>;
  /**
   * Result ordering, most significant key first (framework#3916). Each `by`
   * names a dimension the report groups by (`rows` / `columns`) or a measure it
   * displays (`values`). A `joined` report carries this per BLOCK, never on the
   * container.
   */
  order?: Array<{ by?: unknown; direction?: unknown }>;
  /** Click-through to underlying records (default true). */
  drilldown?: boolean;
  /** Embedded chart visualization (ADR-0021): type + xAxis/yAxis over the dataset. */
  chart?: Record<string, unknown>;
  label?: unknown;
  description?: unknown;
  blocks?: DatasetReportLike[];
}

export interface DatasetReportRendererProps {
  report: DatasetReportLike;
  dataSource?: unknown;
  /** Filter merged into the report (and every joined block) as `runtimeFilter`. */
  runtimeFilter?: Record<string, unknown>;
  /**
   * Drill-down sink. Rows/cells become clickable when provided (and the
   * report doesn't set `drilldown: false`).
   */
  onDrill?: (args: DatasetDrillArgs) => void;
  className?: string;
}

/** `true` when this report should render through the dataset path. */
export function isDatasetReport(value: unknown): value is DatasetReportLike {
  if (!value || typeof value !== 'object') return false;
  const v = value as DatasetReportLike;
  if (typeof v.dataset === 'string' && v.dataset.length > 0) return true;
  // A joined report whose blocks are dataset-bound.
  return v.type === 'joined' && Array.isArray(v.blocks) && v.blocks.some((b) => typeof b?.dataset === 'string');
}

// Warn-once memo for the rejected `filter` key. Keyed by SITE (which already
// carries the report / block name) plus the offending value's key set, so two
// different stale filters on one page both report — the author has to fix every
// producer, not just the first one seen, and a bare site key would mute the
// second. The key set rather than a full serialization because this reads
// stored JSON that crosses the repo boundary: a warning must not be able to
// throw on its way out.
const warnedFilterAliases = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetReportFilterAliasWarnings(): void {
  warnedFilterAliases.clear();
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

/**
 * Dev-mode only: say out loud that a stored document's `filter` was NOT applied.
 *
 * objectui#5137 removed the `report.runtimeFilter ?? report.filter` alias read
 * (and its per-block twin). `filter` is not an authorable key — `ReportSchema`
 * (`@objectstack/spec`) is `z.core.$strict` and refuses it, naming the
 * replacement itself — so honouring it here made the runtime looser than the
 * contract the spec publishes, and which message an author met was a function
 * of which path their document travelled.
 *
 * Deleting the read ALONE would have been a silent narrowing: a stored document
 * still carrying `filter` renders **unfiltered**, which for a scoped report is
 * worse than an error. (Server-side permissions still apply, so this is not an
 * access-control hole — it is rows the AUTHOR meant to exclude, shown without
 * anyone being told.) So the key does not go quiet: it is said out loud, once
 * per offending document.
 *
 * The rename hint is copied verbatim from the spec's own `unrecognized_keys`
 * message (`@objectstack/spec` 17.0.0) so an author meets one message rather
 * than two dialects of one message.
 *
 * Non-breaking by construction: changes no types, rejects nothing, renders
 * everything it rendered before, and is a no-op under `NODE_ENV=production`.
 */
function warnOnRejectedFilterAlias(node: DatasetReportLike, site: string): void {
  if (!isDev()) return;
  const rejected = node.filter;
  if (rejected === undefined) return;
  const shape =
    rejected && typeof rejected === 'object'
      ? Object.keys(rejected as Record<string, unknown>).sort().join(',')
      : String(rejected);
  const memo = `${site}:${shape}`;
  if (warnedFilterAliases.has(memo)) return;
  warnedFilterAliases.add(memo);
  console.warn(
    `[ObjectUI] ${site} carries \`filter\`, which is not an authorable key. ` +
      'Did you mean `filter` → `runtimeFilter`? ' +
      'NO filter was applied — it renders UNFILTERED, showing rows the report ' +
      'was scoped to exclude. `ReportSchema` (`@objectstack/spec`) is strict and ' +
      'rejects `filter`, so this document did not come through the validated ' +
      'path; the renderer no longer reads it either. Fix the producer: rename ' +
      '`filter` to `runtimeFilter`. (objectui#5137)',
  );
}

/** How a report / block names itself in the warning above. */
function describeReportSite(report: DatasetReportLike): string {
  return `Report \`${report.name ?? '(unnamed)'}\``;
}

function resolveText(label: unknown, fallback: string): string {
  if (!label) return fallback;
  if (typeof label === 'string') return label;
  if (typeof label === 'object' && typeof (label as { default?: unknown }).default === 'string') {
    return (label as { default: string }).default;
  }
  return fallback;
}

function readNames(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string' && !!v) : [];
}

/** A lowered ordering, keyed in significance order (first key = primary sort). */
type SelectionOrder = Record<string, 'asc' | 'desc'>;

/**
 * Lower a report's authored `order` list into the `DatasetSelection.order` the
 * dataset query takes (framework#3916).
 *
 * The array's element order becomes the object's key insertion order, which is
 * how `DatasetSelection.order` expresses sort significance. Returns `undefined`
 * for an absent / empty / entirely-unusable list, so the caller OMITS the field
 * and the server's own defaults still apply — a selected time dimension comes
 * back chronological without the author declaring anything.
 *
 * Deliberately permissive about the input, like `readNames` above: this reads
 * stored report JSON, which crosses the repo boundary and may predate (or lag)
 * the schema. An entry with no usable `by` is dropped rather than throwing —
 * the authoring-time schema is where a malformed `order` is meant to be caught.
 *
 * Mirrors `reportSelectionOrder` in `@objectstack/spec/ui`; kept local because
 * the pinned spec (`^17.0.0-rc.0`) predates that export. Swap this for the
 * import once the dependency bump lands.
 */
function readOrder(value: unknown): SelectionOrder | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: SelectionOrder = {};
  for (const entry of value as Array<{ by?: unknown; direction?: unknown }>) {
    const by = entry && typeof entry === 'object' ? entry.by : undefined;
    if (typeof by !== 'string' || !by) continue;
    out[by] = entry.direction === 'desc' ? 'desc' : 'asc';
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Narrow an ordering to the keys a given selection actually projects.
 *
 * The server REJECTS an order key that names nothing the selection selected
 * (a deliberate 400 — a mistyped sort key that silently returns arbitrary rows
 * is worse than a loud failure). But one report's `order` is validated against
 * its WHOLE selection, while this renderer issues narrower sub-selections from
 * it: the embedded chart queries only `chart.xAxis` × `chart.yAxis`, and the
 * flat table path drops the matrix across-dimensions. Forwarding the full list
 * to those would turn a perfectly valid report into a failed query.
 *
 * So keys outside a sub-selection are dropped HERE rather than sent and
 * rejected. This cannot mask an authoring mistake: the report's own schema
 * already validated every key against `rows` ∪ `columns` ∪ `values`, so the
 * only keys that can be lost are ones the narrower query genuinely has no
 * column for.
 */
function scopeOrder(
  order: SelectionOrder | undefined,
  dimensions: string[],
  measures: string[],
): SelectionOrder | undefined {
  if (!order) return undefined;
  const selectable = new Set<string>([...dimensions, ...measures]);
  const out: SelectionOrder = {};
  for (const [key, direction] of Object.entries(order)) {
    if (selectable.has(key)) out[key] = direction;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Per dimension, the rank of each value in its field's DECLARED option order
 * (objectui#12243), or `null` for a dimension whose field declares no options.
 */
type DimensionRanks = Record<string, ReadonlyMap<string, number> | null>;

/**
 * The display-label maps AND the declared-order ranks of one selection's
 * dimensions, both derived from the ONE metadata read (`useDatasetDimensionMeta`).
 *
 * The labels are exactly what `useDatasetDimensionLabels` derives from that read
 * (`deriveDimensionLabelMaps`, same arguments). The ranks run the chain the
 * report chart already runs for its own `categoryOrder` (objectui#4906):
 * `localizeFieldOptions` → `buildCategoryOrder` → `buildCategoryRank`, so they
 * key the stored value AND the localized label — the spelling the RELABELED
 * rows carry — and rank them identically.
 */
function deriveDimensionDisplay(
  meta: DatasetDimensionMeta | null,
  fieldOptionLabel: Parameters<typeof dimensionOptionTranslator>[1],
): { dimensionLabels: Record<string, Record<string, string>> | null; dimensionRanks: DimensionRanks | null } {
  const dimensionLabels = deriveDimensionLabelMaps(meta?.metaByPath, meta?.relabel, fieldOptionLabel);
  if (!meta) return { dimensionLabels, dimensionRanks: null };
  const dimensionRanks: DimensionRanks = {};
  let any = false;
  for (const { dim, path } of meta.relabel) {
    const fieldMeta = meta.metaByPath[path];
    const options = localizeFieldOptions(fieldMeta?.options, dimensionOptionTranslator(fieldMeta, fieldOptionLabel));
    const rank = buildCategoryRank(buildCategoryOrder(options));
    dimensionRanks[dim] = rank;
    if (rank) any = true;
  }
  return { dimensionLabels, dimensionRanks: any ? dimensionRanks : null };
}

/**
 * Where one value of a select dimension sits in its field's declared option
 * order (objectui#12243, the reading objectui#11809 set for grid groups and
 * dashboard charts): a declared option at its declared position, then any value
 * the options do not declare, then the empty bucket last.
 */
function declaredOptionPosition(value: unknown, rank: ReadonlyMap<string, number>): number {
  if (value == null || value === '') return Number.MAX_SAFE_INTEGER;
  return rank.get(String(value)) ?? Number.MAX_SAFE_INTEGER - 1;
}

/**
 * The order to LAY OUT a report's grouped items in, as a list of indices into
 * `items` — or `null` to keep them exactly as the dataset answered them
 * (objectui#12243).
 *
 * The dataset answers its groups in `GROUP BY` order, which is the STORED
 * values' alphabetical order, so a stage dimension read Closed Won, Needs
 * Analysis, Negotiation, Proposal, Prospecting, Qualification. A select field's
 * declared option order is the domain order (the Kanban lanes, the grid's
 * groups and the dashboard's charts already follow it), so the items are put in
 * it here, one dimension level at a time, outermost first:
 *
 * - the items are bucketed by the level's value, the buckets kept in the order
 *   they first arrive (so each outer group's inner rows stay together);
 * - a dimension with declared options orders its buckets by
 *   {@link declaredOptionPosition} (a STABLE sort, so undeclared values keep the
 *   dataset's order among themselves); a dimension without keeps arrival order;
 * - each bucket is then laid out by the next level.
 *
 * `null` — nothing moves — when no dimension declares options, and the caller
 * passes `null` ranks when the report declares its own `order`: an author's
 * explicit order is the author's, and the server already applied it.
 *
 * Indices, never a reordered copy of the rows: the drill payload is read off
 * `state.rows[i]` / `drillRawRows[i]` / `drillRanges[i]`, which stay aligned
 * with the dataset's own order.
 */
function arrangeByDeclaredOptions<T>(
  items: readonly T[],
  dims: readonly string[],
  valueOf: (item: T, dim: string) => unknown,
  ranks: DimensionRanks | null,
): number[] | null {
  if (!ranks || !dims.some((d) => ranks[d])) return null;
  const arrange = (indices: number[], level: number): number[] => {
    if (level >= dims.length || indices.length < 2) return indices;
    const dim = dims[level];
    const buckets = new Map<string, number[]>();
    for (const i of indices) {
      const id = pivotBucketId([pivotDimensionValue(valueOf(items[i], dim))]);
      const bucket = buckets.get(id);
      if (bucket) bucket.push(i);
      else buckets.set(id, [i]);
    }
    const groups = [...buckets.values()];
    const rank = ranks[dim];
    if (rank) {
      groups.sort(
        (a, b) =>
          declaredOptionPosition(valueOf(items[a[0]], dim), rank) -
          declaredOptionPosition(valueOf(items[b[0]], dim), rank),
      );
    }
    return groups.flatMap((group) => arrange(group, level + 1));
  };
  return arrange(items.map((_, i) => i), 0);
}

/**
 * Shared fetch for one dataset selection.
 *
 * `order` (framework#3916) is scoped to what THIS selection projects before it
 * is sent — see {@link scopeOrder}. Every report path funnels through here, so
 * scoping once is what keeps the chart's narrow x/y sub-selection from posting
 * an order key it never selected.
 */
function useDatasetRows(
  dataset: string,
  dimensions: string[],
  measures: string[],
  runtimeFilter: Record<string, unknown> | undefined,
  dataSource: unknown,
  totalsGroupings?: string[][],
  order?: SelectionOrder,
) {
  const [state, setState] = React.useState<{
    status: 'idle' | 'loading' | 'ok' | 'error';
    rows: Row[];
    fields?: DatasetResultField[];
    object?: string;
    dimensionFields?: Record<string, string>;
    drillRawRows?: Row[];
    drillRanges?: Array<Record<string, DatasetDrillRange>>;
    totals?: DatasetResultTotals[];
    error?: string;
    /** The query was refused because this viewer may not read the data (objectui#12330). */
    forbidden?: boolean;
  }>({
    status: 'idle',
    rows: [],
  });

  const scopedOrder = scopeOrder(order, dimensions, measures);
  const rfKey = JSON.stringify(runtimeFilter ?? null);
  const totalsKey = JSON.stringify(totalsGroupings ?? null);
  // The ordering is part of the signature: it changes the ROWS the server
  // returns (and, for a matrix, the arrival order the pivot builds its column
  // headers from), so a report edited from asc to desc must refetch, not
  // re-render the previous grid. `JSON.stringify` preserves key order, which is
  // exactly the sort significance that must invalidate the cache.
  const orderKey = JSON.stringify(scopedOrder ?? null);
  const signature = `${dataset}|${dimensions.join(',')}|${measures.join(',')}|${rfKey}|${totalsKey}|${orderKey}`;

  // objectui#10814 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 way: the nonce moves when a
  // write to the object this selection QUERIES is declared, and the fetch effect
  // below names it, so the report re-reads in place. Without it a page action
  // over raw HTTP left the report stale unless its host remounted it, and
  // `PageView` is to stop doing that (objectui#10519).
  //
  // A dataset selection names no object of its own: the object is the dataset's
  // base object, which only the query's ANSWER names, the key `ObjectChart`'s
  // dataset arm reads (objectui#10035). It is held apart from `state`, as
  // `ObjectChart` holds its `datasetObject`, because the two outlive different
  // things: `state` is replaced by every outcome, while the subscription must
  // survive a FAILED re-read of the same selection. Otherwise one failed bus
  // re-read would unsubscribe the block, and nothing would ever re-read it again
  // (not even `'*'`) until its selection changed. So: set by an answer; kept by
  // a failure of the same selection (the next bus event re-reads it); cleared by
  // a new selection (it never subscribes on the previous dataset's object), and
  // by a selection that queries nothing (idle, or no `queryDataset`). A first
  // load that fails therefore subscribes to nothing. Every presentation (the
  // table, the matrix, the embedded chart, each joined block) funnels through
  // this hook, and so does a `drillDown.report` a drill-down drawer renders.
  const [datasetObject, setDatasetObject] = React.useState<string | undefined>(undefined);
  const invalidationNonce = useDataInvalidation(datasetObject);
  // The signature whose query last ran. A run for the SAME signature is a
  // re-read of the rows already on screen (the nonce moved), so it keeps them
  // and swaps them for the answer when it lands; it does not blank the block
  // back to "Running report…". A new signature is another selection, whose
  // previous rows would be wrong under it, so it still starts from loading.
  const lastQueriedSignatureRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const src = dataSource as DatasetCapableSource | undefined;
    if (!src || typeof src.queryDataset !== 'function') {
      lastQueriedSignatureRef.current = null;
      setDatasetObject(undefined);
      setState({ status: 'error', rows: [], error: 'This data source does not support dataset queries.' });
      return;
    }
    if (!dataset || measures.length === 0) {
      lastQueriedSignatureRef.current = null;
      setDatasetObject(undefined);
      setState({ status: 'idle', rows: [] });
      return;
    }
    let cancelled = false;
    const inPlace = lastQueriedSignatureRef.current === signature;
    lastQueriedSignatureRef.current = signature;
    if (!inPlace) {
      setDatasetObject(undefined);
      setState({ status: 'loading', rows: [] });
    }
    src
      .queryDataset(dataset, {
        dimensions,
        measures,
        ...(runtimeFilter && Object.keys(runtimeFilter).length > 0 ? { runtimeFilter } : {}),
        ...(totalsGroupings ? { totals: { groupings: totalsGroupings } } : {}),
        ...(scopedOrder ? { order: scopedOrder } : {}),
      })
      .then((res) => {
        if (!cancelled) {
          setDatasetObject(typeof res?.object === 'string' && res.object ? res.object : undefined);
          setState({
            status: 'ok',
            rows: Array.isArray(res?.rows) ? res.rows : [],
            fields: Array.isArray(res?.fields) ? res.fields : [],
            object: res?.object,
            dimensionFields: res?.dimensionFields,
            drillRawRows: Array.isArray(res?.drillRawRows) ? res.drillRawRows : undefined,
            drillRanges: Array.isArray(res?.drillRanges) ? res.drillRanges : undefined,
            totals: Array.isArray(res?.totals) ? res.totals : undefined,
          });
        }
      })
      .catch((e) => {
        // The error replaces the rows, on a first load and on a failed re-read
        // alike: the table's error branch draws the error INSTEAD of a table, so
        // no rows are kept under it. `datasetObject` is deliberately left as it
        // is, so a failed re-read stays subscribed (see above).
        if (cancelled) return;
        // objectui#12330 — a READ refusal (403 / `PERMISSION_DENIED`, the
        // analytics read admission) is not a failure to explain: the viewer may
        // not see this data. It is classified by the shared, adapter-agnostic
        // `classifyLoadError`, the branch `DatasetWidget` takes for the same
        // refusal, never by matching the message text. It keeps no `error`
        // text, so the adapter's message (which quotes the server and names
        // the object) cannot reach the page. Every other failure keeps it.
        if (classifyLoadError(e) === 'forbidden') {
          setState({ status: 'error', rows: [], forbidden: true });
          return;
        }
        setState({ status: 'error', rows: [], error: String((e as Error)?.message ?? e) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, invalidationNonce]);

  return state;
}

/**
 * `buildDatasetDrillFilter`, with a refused filter REPORTED instead of thrown —
 * objectui#10789. `null` means refused, and the caller then emits no drill.
 *
 * Composing the report's `runtimeFilter` with the clicked bucket lowers both
 * through the throwing converter form. A `runtimeFilter` the dataset query
 * carried to the server can still be one this layer refuses (a spec `$not`),
 * and the click then threw out of its handler uncaught.
 *
 * ⛔ Not answered with `objectFilter: undefined`. The host reads an absent
 * `objectFilter` as "older server" and rebuilds the filter from the clicked
 * group ALONE (`ReportView`'s fallback), which would drop the `runtimeFilter`
 * and drill into records the report is scoped to exclude. So the drill does
 * not happen, and the refusal is logged, naming the operator — the channel the
 * host's own drill failure reports on. Only a `FilterOperatorError` is caught,
 * the rule `toFilterNodeSafely` states.
 */
function drillFilterOrRefusal(
  ...args: Parameters<typeof buildDatasetDrillFilter>
): Record<string, unknown> | null {
  try {
    return buildDatasetDrillFilter(...args);
  } catch (error) {
    if (!(error instanceof FilterOperatorError)) throw error;
    console.warn(`[DatasetReportRenderer] drill-down refused — the drilled list cannot be scoped: ${error.message}`);
    return null;
  }
}

function EmptyMeasures({ dataset }: { dataset: string }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
      This report binds the “{dataset}” dataset — choose at least one measure (values) to render.
    </div>
  );
}

/**
 * The report's no-access state (objectui#12330): the same title a dataset
 * widget shows for the same refusal (`dashboard.widgetForbiddenTitle`), and a
 * message that names the report. No server text, no object name.
 */
function NoAccess() {
  const tt = useSafeTranslate();
  return (
    <div
      role="alert"
      data-testid="dataset-report-forbidden"
      className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/20 p-6 text-center text-xs text-muted-foreground"
    >
      <ShieldAlert className="h-5 w-5 text-muted-foreground/70" aria-hidden="true" />
      <span className="font-medium text-foreground/80">
        {tt('dashboard.widgetForbiddenTitle', 'You don’t have access')}
      </span>
      <span>{tt('report.forbiddenMessage', 'You don’t have permission to view the data behind this report.')}</span>
    </div>
  );
}

function FetchStates({
  status,
  error,
  forbidden,
}: {
  status: 'idle' | 'loading' | 'error';
  error?: string;
  forbidden?: boolean;
}) {
  if (status === 'error' && forbidden) return <NoAccess />;
  if (status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span className="break-words">{error}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Running report…
    </div>
  );
}

function NoRows() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 p-6 text-xs text-muted-foreground">
      <Table2 className="h-6 w-6" /> The dataset returned no rows for this report’s scope.
    </div>
  );
}

const DRILL_CLASS = 'cursor-pointer hover:bg-accent/40';

/**
 * One dataset-bound table: fetch via `queryDataset`, render `rows` + `values`.
 *
 * `withTotals` is what tells a `summary` report ("grouped by row") apart from
 * a `tabular` one ("simple list") at the same selection (#2941): a summary
 * additionally asks the SAME query for its grand total
 * (`totals: { groupings: [[]] }`) and renders it as a footer row. The total is
 * server-aggregated — never recombined from the bucket rows here, which the
 * ADR-0021 governance red line forbids (an `avg` cannot be recombined) — so an
 * older server that returns no `totals` renders the plain table, exactly like
 * the matrix path.
 */
function DatasetReportTable({
  dataset,
  rows,
  values,
  runtimeFilter,
  dataSource,
  onDrill,
  order,
  withTotals,
}: {
  dataset: string;
  rows: string[];
  values: string[];
  runtimeFilter?: Record<string, unknown>;
  dataSource?: unknown;
  onDrill?: (args: DatasetDrillArgs) => void;
  order?: SelectionOrder;
  withTotals?: boolean;
}) {
  // With no grouping dimensions the single result row already IS the grand
  // total — requesting totals would only duplicate it.
  const state = useDatasetRows(
    dataset,
    rows,
    values,
    runtimeFilter,
    dataSource,
    withTotals && rows.length > 0 ? [[]] : undefined,
    order,
  );
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  const tt = useSafeTranslate();
  // The display locale every measure and dimension value below is formatted in
  // (objectui#4575, completing objectui#4566's channel). `formatMeasure` /
  // `formatDimensionValue` are pure functions in `@object-ui/core`, which is
  // React-free, so the tag has to arrive as an argument. Nothing in this
  // component formats inside a `useMemo` — every site is in the render body —
  // so there is no dependency array to add it to here (the matrix below is the
  // one place in this file where there is).
  const displayLocale = useDisplayLocale();
  // objectui#4330 — the option list this report's select dimensions are
  // localized against. Null (and free) for a report whose dimensions own no
  // options, or before the read lands. objectui#12243 reads the SAME list for
  // its declared ORDER too, so the read is the locale-free metadata itself and
  // the labels are derived from it here, exactly as `useDatasetDimensionLabels`
  // derived them — one read, as before.
  const dimensionMeta = useDatasetDimensionMeta(state.object, state.dimensionFields, rows);
  const { dimensionLabels, dimensionRanks } = React.useMemo(
    () => deriveDimensionDisplay(dimensionMeta, fieldOptionLabel),
    [dimensionMeta, fieldOptionLabel],
  );

  if (values.length === 0) return <EmptyMeasures dataset={dataset} />;
  if (state.status === 'loading' || state.status === 'idle') return <FetchStates status={state.status} />;
  if (state.status === 'error') return <FetchStates status="error" error={state.error} forbidden={state.forbidden} />;
  if (state.rows.length === 0) return <NoRows />;

  // Drilling needs at least one dimension to scope by.
  const canDrill = !!onDrill && rows.length > 0;
  // Dims the server can map to object fields → raw-value (drill-correct) filter.
  const drillDims = state.dimensionFields ? rows.filter((d) => d in state.dimensionFields!) : [];
  const drill = (row: Row, index: number) => {
    const groupKey: Record<string, unknown> = {};
    for (const dim of rows) groupKey[dim] = row[dim];
    // ADR-0021 D2: when the server returned the object + raw grouped values,
    // emit an exact field→raw filter (correct for select/lookup dims, which a
    // display-label groupKey would mis-filter); the host then filters with no
    // extra metadata round-trip. Older server → groupKey-only fallback.
    // objectstack-ai/objectstack#1752: a time-bucketed date dim contributes a RANGE (not an equality dim),
    // so the fast path also fires when the server sent a range for this row —
    // covering a date-ONLY report that has no equality drill dim at all.
    const rowRanges = state.drillRanges?.[index];
    const hasRange = !!rowRanges && Object.keys(rowRanges).length > 0;
    let objectFilter: Record<string, unknown> | undefined;
    if (state.object && (drillDims.length > 0 || hasRange)) {
      const built = drillFilterOrRefusal(state.drillRawRows?.[index], drillDims, state.dimensionFields ?? {}, runtimeFilter, rowRanges);
      // Refused: no drill at all — see `drillFilterOrRefusal`.
      if (built === null) return;
      objectFilter = built;
    }
    onDrill!({ dataset, groupKey, runtimeFilter, object: state.object, objectFilter });
  };

  // objectui#7534 — resolve a BUILT-IN default measure's caption through the
  // same seam the report chart already uses for its legend (#7258), so the
  // summary header / metric caption / pivot header cannot say `Count` while the
  // chart beside them says `计数`.
  const { measureField, headerLabel } = buildDatasetFieldHelpers(
    state.fields,
    state.object,
    fieldLabel,
    builtinAggregateLabels(tt),
  );
  const columns = [...rows, ...values];
  // The rows as DISPLAYED (objectui#4330). Order and count are preserved, so
  // `state.rows[i]` / `drillRawRows[i]` stay index-aligned — which is what
  // keeps the drill payload below on the untranslated values. With no label
  // map this is `state.rows` ITSELF, the same array identity as before.
  const displayRows = relabelDimensions(state.rows, dimensionLabels);
  // objectui#12243 — the order the rows are LAID OUT in: each select dimension
  // in its field's declared option order, outermost dimension first (see
  // `arrangeByDeclaredOptions`). A report that declares its own `order` for
  // this selection keeps the server's answer untouched. Indices into the
  // dataset's own order, so `state.rows[i]` / `drillRawRows[i]` still address
  // the row that was drawn.
  const authoredOrder = scopeOrder(order, rows, values);
  const layout =
    arrangeByDeclaredOptions(displayRows, rows, (row, dim) => row[dim], authoredOrder ? null : dimensionRanks) ??
    displayRows.map((_, i) => i);
  // Server-supplied grand total (`dimensions: []`); absent → no totals row.
  const grandTotal = withTotals
    ? state.totals?.find((t) => Array.isArray(t.dimensions) && t.dimensions.length === 0)?.rows?.[0]
    : undefined;
  const totalText = tt('report.total', 'Total');
  return (
    <div className="overflow-auto max-h-[70vh] rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                {headerLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {layout.map((i) => (
            <tr
              key={i}
              className={`border-t${canDrill ? ` ${DRILL_CLASS}` : ''}`}
              data-testid={canDrill ? 'dataset-drill-row' : undefined}
              // The drill payload is built from the row AS THE SERVER SENT IT
              // (`state.rows[i]`), never from the displayed one: `groupKey` and
              // `objectFilter` are identity keys the host filters records with,
              // and translating those would address nothing (objectui#4263 /
              // #4273's convention, restated for #4330).
              onClick={canDrill ? () => drill(state.rows[i], i) : undefined}
            >
              {columns.map((c) => (
                <td key={c} className="px-2 py-1 tabular-nums whitespace-nowrap">
                  {values.includes(c)
                    ? formatMeasure(displayRows[i][c], measureField(c)?.format, measureField(c)?.currency, measureField(c)?.percentScale, displayLocale)
                    : formatDimensionValue(displayRows[i][c], displayLocale)}
                </td>
              ))}
            </tr>
          ))}
          {grandTotal && (
            <tr className="border-t bg-muted/30 font-medium" data-testid="dataset-report-total-row">
              {rows.length > 0 && (
                <td colSpan={rows.length} className="px-2 py-1 whitespace-nowrap">
                  {totalText}
                </td>
              )}
              {values.map((measure) => (
                <td key={measure} className="px-2 py-1 tabular-nums whitespace-nowrap">
                  {formatMeasure(grandTotal[measure], measureField(measure)?.format, measureField(measure)?.currency, measureField(measure)?.percentScale, displayLocale)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Resolve a report's declared `type` — the spec's `ReportType`
 * (`ui/report.zod.ts`: `tabular | summary | matrix | joined`) — to the
 * presentation it renders. The DECLARED type picks the branch; it is never
 * inferred from the data shape. Before this, `tabular` and `summary` shared
 * one branch and the visual difference was read off whether `rows` happened
 * to be non-empty — a `tabular` report that declared `rows` silently rendered
 * exactly like a `summary` (#2941). An absent/out-of-spec value falls back to
 * `tabular`, the spec's own declared default.
 *
 * Exported for the spec-parity test, which fails the moment `ReportType` and
 * this dispatch drift in either direction.
 */
export function resolveReportPresentation(type: unknown): 'tabular' | 'summary' | 'matrix' | 'joined' {
  switch (type) {
    case 'summary':
      return 'summary';
    case 'matrix':
      return 'matrix';
    case 'joined':
      return 'joined';
    case 'tabular':
    default:
      return 'tabular';
  }
}

/** How a report renders its embedded chart for one spec `ChartTypeSchema` value. */
export type ReportChartPlan =
  /** A categorical series the generic chart component draws distinctly. */
  | { kind: 'series'; chartType: string }
  /** Single-value family — one dimensionless dataset query, shown as a number. */
  | { kind: 'single_value' }
  /** Tabular family — the report's own table beside it IS the rendering; no duplicate chart. */
  | { kind: 'tabular' }
  /** Out-of-spec value (stored dialect / typo) — surfaced, never a silent bar. */
  | { kind: 'unsupported'; type: string };

/**
 * Classify a report chart type into its rendering plan — every value of the
 * spec's `ChartTypeSchema` (`ui/chart.zod.ts`, 19 names), each on the branch
 * its family demands. The old mapping collapsed 10 of the 19 to a BAR — a
 * plausible wrong picture with no warning (#2941). Now:
 *
 * - the 12 series families reach the generic chart component verbatim
 *   (`column` is its documented vertical-bar alias; `horizontal-bar` stays
 *   horizontal instead of silently flipping vertical);
 * - the single-value families (`gauge` / `solid-gauge` / `metric` / `kpi` /
 *   `bullet`) render the measure as a number — the spec's own comment calls
 *   them "honest single-value variants pending a real dial/target renderer";
 * - `table` / `pivot` add no duplicate chart: the table that always renders
 *   beside the chart slot is exactly the tabular presentation;
 * - anything else is out-of-spec and gets a visible notice.
 *
 * `combo` joined `ChartTypeSchema` in spec 17.0.0-rc.1 and routes as a series
 * chart. It was renderer-local until then — the chart renderer derives the base
 * family from the series — so nothing here classified it, and a spec-valid combo
 * report hit the out-of-spec notice the moment the spec started accepting one.
 *
 * Exported for the spec-parity test, which fails the moment `ChartTypeSchema`
 * and this classification drift in either direction.
 */
export function planReportChart(t: unknown): ReportChartPlan {
  switch (t) {
    case 'bar':
    case 'column':
    case 'horizontal-bar':
    case 'line':
    case 'area':
    case 'pie':
    case 'donut':
    case 'funnel':
    case 'scatter':
    case 'treemap':
    case 'sankey':
    case 'radar':
    case 'combo':
      return { kind: 'series', chartType: t };
    case 'gauge':
    case 'solid-gauge':
    case 'metric':
    case 'kpi':
    case 'bullet':
      return { kind: 'single_value' };
    case 'table':
    case 'pivot':
      return { kind: 'tabular' };
    default:
      return { kind: 'unsupported', type: String(t) };
  }
}

/**
 * Resolve a registered component by type, triggering its LAZY loader and
 * re-rendering once it registers. The generic `chart` component is registered
 * via `registerLazy`, so a plain `ComponentRegistry.get` returns undefined
 * until the plugin-charts chunk loads — this hook kicks off `loadLazy` and
 * subscribes so the chart appears as soon as the chunk resolves. Kept decoupled
 * (no static import of plugin-charts, and no `SchemaRenderer` dispatch through
 * @object-ui/react) so plugin-report stays dependency-light and its test module
 * graph doesn't duplicate React.
 */
function useRegistryComponent(
  type: string,
): React.ComponentType<{ schema: Record<string, unknown> }> | undefined {
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (ComponentRegistry.get(type)) return;
    const unsub =
      typeof ComponentRegistry.subscribe === 'function'
        ? ComponentRegistry.subscribe(() => {
            if (ComponentRegistry.get(type)) bump();
          })
        : undefined;
    const pending = ComponentRegistry.loadLazy?.(type);
    if (pending && typeof pending.then === 'function') {
      pending.then(() => bump()).catch(() => {});
    }
    return unsub;
  }, [type]);
  return ComponentRegistry.get(type) as
    | React.ComponentType<{ schema: Record<string, unknown> }>
    | undefined;
}

/**
 * The author's per-chart override for ONE measure's display name — the entry of
 * `chart.series[]` whose `name` IS that measure (objectui#4020, level ①).
 *
 * `ReportChartSchema.series[]` has declared `{ name, label? }` since rc.1, but
 * the renderer never read it: the chart was handed `series: [{ dataKey }]` with
 * no label at all, so an authored `label` was inert metadata and the measure
 * printed as its raw `name`. Declared is now enforced.
 *
 * The FIRST entry naming the measure wins, the same ruling `mergeAuthoredSeries`
 * (`@object-ui/core`) makes over this same `chart.series` — a later duplicate
 * cannot silently re-label a series the author already described.
 *
 * `label` is the spec's `I18nLabel` (`string | { en, 'zh-CN', … }`), so it goes
 * through `pickLocalized`, the repo's one resolver for that shape — a
 * first-string-wins pick would put the English limb of a translated label on a
 * zh-CN console, which is the very defect class this card closes. An entry that
 * names the measure but carries no usable `label` returns `undefined` and falls
 * through to the dataset's own measure label, exactly as an absent entry does.
 */
function authoredSeriesLabel(series: unknown, measure: string, language: string | undefined): string | undefined {
  if (!Array.isArray(series) || !measure) return undefined;
  for (const entry of series as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, label } = entry as { name?: unknown; label?: unknown };
    if (name !== measure) continue;
    return pickLocalized(label, language) || undefined;
  }
  return undefined;
}

/**
 * Render a report's embedded `chart` (ADR-0021) by running its OWN dataset
 * query — the `xAxis` dimension grouped, the `yAxis` measure aggregated — and
 * feeding the rows to the registered generic chart component (plugin-charts).
 *
 * Decoupled via {@link ComponentRegistry} (same approach as the legacy
 * renderer) so plugin-report keeps no hard dependency on plugin-charts: if the
 * chart plugin isn't loaded, or the chart is incomplete, we render nothing and
 * let the grouped table stand alone. Before this, a dataset-bound report's
 * `chart` config was authorable in Studio but never rendered anywhere.
 *
 * ## What reaches the chart component (objectui#4877 / objectui#4878)
 *
 * This slot forwarded exactly six keys — `chartType`, `data`, `height`,
 * `isAnimationActive`, `series`, `xAxisKey` — which made it the one dataset
 * chart surface that shared neither half of the ruled split:
 *
 *  - the DATA half now routes through `buildChartSeries` (objectui#4878), so the
 *    null-category family it owns is inherited rather than re-derived; the rows
 *    used to reach the renderer with a raw null category, which draws no mark;
 *  - the PRESENTATION half now routes through `chartConfigPresentation` +
 *    `mergeAuthoredSeries` (objectui#4877), so the chrome and per-series keys
 *    `ReportChartSchema` declares stop being inert metadata. `showLegend: false`
 *    was the sharpest of those: dropped, it read as absent, and absent means the
 *    legend is ON — the author's explicit value inverted in effect.
 *
 * Both helpers live in `@object-ui/core` beside each other, which is what keeps
 * this surface and the dashboard widget lowering ONE vocabulary once.
 *
 * ## The category dimension's own colours + declared order (objectui#4906)
 *
 * `chartConfigPresentation` takes a SECOND argument — the category dimension's
 * own option colours, resolved from its select/lookup field metadata — and
 * merges it UNDER an explicit author `colors` map, never over it (the
 * precedence `chartConfigPresentation`'s own doc comment states). Until this
 * card the report chart called it with no second argument at all, so a
 * dimension like `health` never painted its own green/amber/red the way the
 * SAME dimension does on a dashboard chart — only an authored `colors` record
 * ever reached the renderer, and with none authored the chart fell to the
 * positional palette.
 *
 * `categoryOrder` (framework#3588 — a picklist's declared option order IS the
 * domain order) is the same story: derived below from the SAME field metadata
 * and spread onto the chart schema, so a funnel's stages render in the
 * declared pipeline order instead of sorting by value.
 *
 * Both are derived through `useDatasetDimensionMeta` — the exact hook and the
 * exact `localizeFieldOptions` → `buildOptionColorMap` / `buildCategoryOrder`
 * chain `DatasetWidget` (plugin-dashboard) already runs for its own chart —
 * reused here rather than re-derived, which is the whole point: a second,
 * independently-written copy of the same rule is the defect shape this repo
 * keeps paying for (objectui#5301's four-copy resolver, one of them inverted).
 */
function DatasetReportChart({
  dataset,
  chart,
  runtimeFilter,
  dataSource,
  order,
}: {
  dataset: string;
  chart: Record<string, unknown>;
  runtimeFilter?: Record<string, unknown>;
  dataSource?: unknown;
  order?: SelectionOrder;
}) {
  const xAxis = typeof chart.xAxis === 'string' ? chart.xAxis : '';
  const yAxis = typeof chart.yAxis === 'string' ? chart.yAxis : '';
  const plan = planReportChart(chart.type);
  // The chart plots a NARROWER selection than the table beside it (one
  // dimension × one measure), so `useDatasetRows` scopes the report's order to
  // those two columns — a "biggest first" on the plotted measure still sorts
  // the bars; a key naming some other row dimension is simply not applicable
  // here and is dropped rather than posted and rejected.
  //
  // A single-value chart (metric / kpi / gauge…) instead queries the measure
  // with NO dimension: the server hands back its one pre-aggregated grand
  // total, so the number shown is governed by the semantic layer, never a
  // client-side recombination (the ADR-0021 red line). Plans that render no
  // chart at all select no measures, which parks the hook in `idle`.
  const wantsQuery = plan.kind === 'series' || plan.kind === 'single_value';
  const queryDimensions = plan.kind === 'series' && xAxis ? [xAxis] : [];
  const queryMeasures = wantsQuery && yAxis ? [yAxis] : [];
  const state = useDatasetRows(
    dataset,
    queryDimensions,
    queryMeasures,
    runtimeFilter,
    dataSource,
    undefined,
    order,
  );
  const ChartComponent = useRegistryComponent('chart');
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  // objectui#4878 — the null-category bucket's LABEL. `@object-ui/core` is
  // React-free and cannot read the locale bundle, so `buildChartSeries` falls
  // back to the English `NULL_CATEGORY_LABEL`; the resolved string has to come
  // from HERE, the layer that holds the provider (objectui#4500 made exactly
  // this division on the dashboard, and ObjectChart makes it too). Without it a
  // zh console would draw the bar — and label it `(None)`.
  const tt = useSafeTranslate();
  // objectui#4575 — the single-value metric below is a MEASURE like any other
  // and follows the display locale. (The series charts render their own labels
  // through the chart component, not through `formatMeasure`.)
  const displayLocale = useDisplayLocale();
  // objectui#4020 — the UI LANGUAGE an authored `series[].label` is picked in.
  // Deliberately not `displayLocale`: that one prefers the tenant's REGIONAL
  // locale (ADR-0053) because it feeds `Intl` number formatting, and a workspace
  // formatting numbers as `de-DE` while its console runs zh must still read the
  // zh limb of a translated label.
  const { language } = useObjectTranslation();
  // objectui#4330 — the embedded chart plots the SAME dimension the table
  // beside it groups by, so it takes the same label map. Leaving it out would
  // put the two spellings of one value on one screen, which is the defect this
  // family exists to close.
  const chartDimensions = React.useMemo(() => (xAxis ? [xAxis] : []), [xAxis]);
  // objectui#4906 — `useDatasetDimensionMeta`, NOT the label-only
  // `useDatasetDimensionLabels`: this chart derives more from the resolved
  // field metadata than label maps (see the file-level doc comment above this
  // component). Mirrors `DatasetWidget`'s own call exactly. (Since
  // objectui#12243 the tables above read the same hook, for the declared order.)
  const dimensionMeta = useDatasetDimensionMeta(state.object, state.dimensionFields, chartDimensions);
  const { categoryColors, dimensionLabels, categoryOrder } = React.useMemo(() => {
    if (!dimensionMeta) return { categoryColors: null, dimensionLabels: null, categoryOrder: null };
    const { metaByPath, relabel } = dimensionMeta;
    // Colours and declared order read `option.label`, so they are fed the
    // LOCALIZED options — the same "translate the options, then render them"
    // shape `DatasetWidget` uses — which is what keeps them keyed by the
    // string the relabeled rows below actually carry. `relabel[0]` is the
    // chart's one x-axis dimension: `chartDimensions` above is at most one
    // entry, so `relabel` never has a second.
    const firstDimPath = relabel[0]?.path;
    const firstDimMeta = firstDimPath ? metaByPath[firstDimPath] : undefined;
    const firstDimOptions = firstDimPath
      ? localizeFieldOptions(firstDimMeta?.options, dimensionOptionTranslator(firstDimMeta, fieldOptionLabel))
      : undefined;
    return {
      categoryColors: buildOptionColorMap(firstDimOptions),
      dimensionLabels: deriveDimensionLabelMaps(metaByPath, relabel, fieldOptionLabel),
      categoryOrder: buildCategoryOrder(firstDimOptions),
    };
  }, [dimensionMeta, fieldOptionLabel]);

  // objectui#9150 — the heading BOTH branches below paint, resolved through
  // `pickLocalized`, this repo's one resolver for the `I18nLabel` union.
  //
  // `ReportChartSchema.title` is that union — a plain string OR an inline
  // locale map — and the plain-string narrowing this replaced dropped the map
  // arm silently: a title authored `{ en: 'Pricing', 'zh-CN': <the zh limb> }`
  // is metadata the contract ACCEPTS, and the `h3` simply did not render, in
  // every language, with no diagnostic. Not the wrong language — NO heading at
  // all, which is why no "does the heading match the locale" check could see
  // it. `subtitle` and `description` on this same surface were fixed by
  // objectui#9038; `title` was not, because it is read HERE and not through
  // that lowering.
  //
  // `language` is the UI language (`useObjectTranslation` above), deliberately
  // not `displayLocale` — the same division `authoredSeriesLabel` makes, for
  // the same reason. The `|| undefined` keeps the `{title ? … : null}` guards
  // below meaningful: `pickLocalized` spells a miss `''`, and an empty heading
  // element is not the absence those guards encode. The resolution order
  // (exact tag -> base -> region-qualified sibling -> `default` -> `en` ->
  // first entry) is the RESOLVER's and is not re-decided here, so a map with no
  // limb for the active language falls back to another limb rather than
  // vanishing, and only a map with no usable string at all draws nothing.
  //
  // ⚠️ `chart.title` is still DROPPED from the lowered chrome (see
  // `_chartOwnTitle` below): the chart must not draw a SECOND heading inside
  // its own frame.
  const title = pickLocalized(chart.title, language) || undefined;

  // `table` / `pivot`: the report's own table rendered beside this slot IS the
  // tabular presentation — a duplicate chart would say nothing new.
  if (plan.kind === 'tabular') return null;
  if (plan.kind === 'unsupported') {
    // Out-of-spec chart type in stored metadata: say so instead of drawing a
    // silently wrong bar (#2941). The report's table still carries the numbers.
    // The notice names no position: this slot sits ABOVE a grouped table and
    // BELOW a matrix cross-tab (objectui#10964).
    return (
      <div
        className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        data-testid="dataset-report-chart-unsupported"
      >
        Chart type &ldquo;{plan.type}&rdquo; is not a spec chart type — the report&rsquo;s table carries its numbers.
      </div>
    );
  }

  // A series chart needs both an x (dimension) and y (measure); a
  // single-value chart needs only the measure. Without them, skip.
  if (plan.kind === 'series' ? !xAxis || !yAxis : !yAxis) return null;
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading chart…
      </div>
    );
  }
  // On error or empty, fall back silently to the report's table. A read
  // refusal is an error here too: the table beside this slot reads the same
  // dataset and draws the one no-access state, so the chart draws no second
  // one (objectui#12330).
  if (state.status === 'error' || state.rows.length === 0) return null;

  // objectui#7534 — resolve a BUILT-IN default measure's caption through the
  // same seam the report chart already uses for its legend (#7258), so the
  // summary header / metric caption / pivot header cannot say `Count` while the
  // chart beside them says `计数`.
  const { measureField, headerLabel } = buildDatasetFieldHelpers(
    state.fields,
    state.object,
    fieldLabel,
    builtinAggregateLabels(tt),
  );
  // The measure's display name, resolved ONCE for every branch below
  // (objectui#4020). Three levels, highest first:
  //
  //  1. `chart.series[]`'s entry naming this measure — the spec's own per-chart
  //     override (see `authoredSeriesLabel`);
  //  2. the bound dataset's `measures[].label`, which reaches the client as the
  //     result field's `label` — `headerLabel` reads exactly that (then the i18n
  //     field-label convention), so the chart and the summary table BENEATH IT
  //     print one string for one measure instead of two;
  //  3. the measure NAME, `headerLabel`'s own last resort.
  //
  // Level ② is what the dashboard's `buildChartSeries` already did for its own
  // chart series (`fields[].label`), and what the table here has always done;
  // the report chart was the one surface that consulted neither and shipped the
  // raw `name` to a fully-translated console.
  const measureLabel = authoredSeriesLabel(chart.series, yAxis, language) ?? headerLabel(yAxis);

  if (plan.kind === 'single_value') {
    const mf = measureField(yAxis);
    return (
      <div className="rounded-md border bg-card p-3" data-testid="dataset-report-metric">
        {title ? <h3 className="mb-2 text-sm font-semibold">{title}</h3> : null}
        <div className="flex flex-col gap-0.5 py-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatMeasure(state.rows[0]?.[yAxis], mf?.format, mf?.currency, mf?.percentScale, displayLocale)}
          </span>
          <span className="text-xs text-muted-foreground">{measureLabel}</span>
        </div>
      </div>
    );
  }

  // The chart component is registered lazily; until it resolves render nothing
  // (the report's table beside it still shows the exact numbers).
  if (!ChartComponent) return null;

  // ── The DATA half: derived from the selection, never authored (#4229) ─────
  //
  // objectui#4878 — the rows and the series binding come from the SHARED
  // derivation every other dataset chart surface uses. This path used to hand
  // `relabelDimensions(state.rows, …)` straight to the renderer, which is the
  // pre-#4466 answer: a null dimension value reached the chart raw and drew NO
  // MARK, so the report silently understated its own data (#4466 measured the
  // dominant group vanishing while the y-axis still accommodated it). Every
  // property of that family — the bucket itself (#4466), its localized label
  // (#4500), and the identity that keeps a stored `'(None)'` apart from the
  // null group (#4508) — is a property of `buildChartSeries`, so it arrives
  // here by inheritance rather than by a third re-derivation.
  //
  // The selection is exactly one dimension × one measure, so this takes the
  // helper's single-dimension branch and returns ONE series; the pivot branch
  // (2+ dimensions) is unreachable from a report chart, whose schema declares a
  // single `xAxis`/`yAxis` pair.
  //
  // `builtinAggregateLabels` (objectui#7258): a measure the server minted as a
  // built-in default (`builtinAggregate: 'count'`, objectstack#14492) reads its
  // series label from the locale bundle; an author-declared measure carries no
  // discriminator and keeps its wire `label` verbatim (objectui#4106).
  //
  // objectui#12243 — the categories in the dimension's DECLARED option order.
  // The dataset answers in `GROUP BY` order, the stored values' alphabetical
  // order, and a bar, line or pie draws its categories in the order of its
  // rows: `categoryOrder` below reorders a FUNNEL only, and widening that
  // published prop would override an explicit report `order` on every chart
  // (objectui#11809 measured this). So the rows are put in the declared order
  // here, by the same rule the table beside it follows: declared options first,
  // undeclared values next in the dataset's order, the empty bucket last. A
  // report whose `order` reaches this chart's selection keeps the server's
  // order. No drill reads these rows by index, so the reordered copy is safe.
  const displayRows = relabelDimensions(state.rows, dimensionLabels);
  const categoryRank = scopeOrder(order, queryDimensions, queryMeasures) ? null : buildCategoryRank(categoryOrder);
  const plotLayout = arrangeByDeclaredOptions(
    displayRows,
    [xAxis],
    (row, dim) => row[dim],
    categoryRank ? { [xAxis]: categoryRank } : null,
  );
  const plotRows = plotLayout ? plotLayout.map((i) => displayRows[i]) : displayRows;
  const { data: chartData, xAxisKey, series: derivedSeries } = buildChartSeries(
    plotRows,
    [xAxis],
    [yAxis],
    state.fields,
    {
      nullCategoryLabel: tt('chart.nullCategory', '(None)'),
      builtinAggregateLabels: builtinAggregateLabels(tt),
    },
  );

  // ── The PRESENTATION half: authored, merged forward (#4229) ──────────────
  //
  // objectui#4877 — `ReportChartSchema` declares per-series `color`/`stack`/
  // `type`/`yAxis`/`dashArray`/`opacity`/`variant`, and this path forwarded
  // none of them. `mergeAuthoredSeries` merges them, matched by
  // `series[].name` → derived `dataKey`, so membership stays with the dataset:
  // an entry naming a measure this chart does not plot is ignored. (The
  // dashboard made the same series merge until `@objectstack/spec` 17.5.0
  // refused `chartConfig.series` on a dashboard widget, objectui#11315.)
  //
  // No axis is lowered here, and none needs to be: on THIS surface
  // `xAxis`/`yAxis` are bare dimension/measure name strings — the selection
  // itself — not spec `ChartAxis` objects, so there is no axis presentation to
  // merge. (`@object-ui/core`'s object-axis lowering, `mergeAuthoredPresentation`,
  // was deliberately not used here and was removed by objectui#11372.)
  const authoredSeries = mergeAuthoredSeries(derivedSeries, chart.series);
  // #4020's three-level display name OUTRANKS both of the labels above: the
  // derivation's `fields[].label` (level ② without the i18n field-label
  // convention `headerLabel` applies) and `mergeAuthoredSeries`' own pick,
  // which resolves an `{ en, 'zh-CN' }` label first-string-wins because core
  // holds no provider — the very thing that would paint English on a zh
  // console. `measureLabel` already resolved ① through `pickLocalized` and ②
  // through `headerLabel`, so it wins outright.
  const chartSeries = authoredSeries.map((s) =>
    s.dataKey === yAxis ? { ...s, label: measureLabel } : s,
  );

  // The authored CHROME — `showLegend`, `showDataLabels`, `colors`, `subtitle`,
  // `description`, `annotations`, `interaction`, `height` — lowered by the same
  // whitelist the dashboard uses (objectui#4877). `showLegend: false` was not
  // merely dropped before but INVERTED in effect: `AdvancedChartImpl` computes
  // `legendVisible = showLegend !== false`, so an absent value means the legend
  // is on and the author's explicit `false` drew one anyway.
  //
  // `title` is dropped from the result on purpose: this renderer paints the
  // report chart's title itself, as the `h3` below, and forwarding it as well
  // would draw a SECOND one inside the chart's own frame. `aria` is not lowered
  // by the whitelist at all — nothing on this path reads it (see that helper's
  // header for the ruling and where it is tracked).
  //
  // objectui#4906 — `categoryColors` (derived above) is the SECOND argument,
  // exactly as `DatasetWidget` passes its own. `chartConfigPresentation` merges
  // it UNDER any explicit author `colors` map found on `chart`, so an authored
  // colour still wins per category (objectui#4877's precedence, preserved).
  const { title: _chartOwnTitle, ...chrome } = chartConfigPresentation(chart, categoryColors);

  return (
    <div className="rounded-md border bg-card p-3" data-testid="dataset-report-chart">
      {title ? <h3 className="mb-2 text-sm font-semibold">{title}</h3> : null}
      {/* eslint-disable-next-line react-hooks/static-components -- ChartComponent is a stable registry lookup (useRegistryComponent), not a component created during render */}
      <ChartComponent
        schema={{
          chartType: plan.chartType,
          data: chartData,
          xAxisKey,
          // One series, carrying its display name. `ChartRenderer` turns a
          // series `label` into `config[dataKey].label`, which is the single
          // input the legend, the mark's tooltip name and the single-value
          // caption all read — so legend and tooltip follow this by
          // construction rather than by a second resolution.
          series: chartSeries,
          // The default plot height, kept beneath the spread so an authored
          // `height` wins. A non-positive one never reaches here (the whitelist
          // drops it), which leaves this default rather than an invisible plot.
          height: 280,
          // Render deterministically (no rAF entrance animation): reports are
          // often viewed in a background tab or exported, where an animated
          // chart freezes at frame 0 (pie/donut would show no ring).
          isAnimationActive: false,
          ...chrome,
          // objectui#4906 — the category dimension's DECLARED picklist order
          // (framework#3588), derived above. Omitted (rather than `undefined`)
          // when the dimension carries no options, so an ordered-sequence
          // chart's own default (value-descending) still applies.
          ...(categoryOrder ? { categoryOrder } : {}),
        }}
      />
    </div>
  );
}

/**
 * Stable bucket id for a dimension-value tuple — the id every lookup in the
 * cross-tab below is keyed by (row headers, column headers, and both subtotal
 * maps), so they all agree by construction.
 *
 * The values go through `pivotBucketId` (shared with the dashboard's pivot)
 * rather than being concatenated: this used to `join('')`, which left NO
 * boundary at all between adjacent values, so `'x'` + `'yz'` and `'xy'` + `'z'`
 * were one bucket and the later row overwrote the earlier one
 * (objectstack#5665; objectstack#5473 is the same defect in the dashboard).
 *
 * Each value is normalized by `pivotDimensionValue`, so an absent one encodes
 * as JSON `null`. It used to be spelled `String(row[d] ?? '∅')`, which put an
 * ordinary string in the tuple and merged a null value with a value that
 * literally IS that character — the encoder's own assumption ("no value spells
 * this") reintroduced by its caller (objectui#4056).
 */
function bucketId(dims: string[], row: Row): string {
  return pivotBucketId(dims.map((d) => pivotDimensionValue(row[d])));
}

/**
 * `locale` is the display-locale tag the bucket's numeric values are formatted
 * in (objectui#4575) — this is a plain function, not a component, so it cannot
 * read `useDisplayLocale()` itself and the caller threads it. It affects the
 * human-readable LABEL only; the matching bucket `id` comes from
 * {@link bucketId}, which is built from the RAW values and is deliberately
 * untouched by the locale, so a locale change can never re-key a cell (which
 * would break the `cells` lookup and drill-through with it).
 */
function bucketLabel(dims: string[], row: Row, locale?: string): string {
  return dims.map((d) => formatDimensionValue(row[d], locale)).join(' / ');
}

/**
 * True cross-tab for `type: 'matrix'` — one dataset query over
 * `[...rows, ...columns]`, pivoted client-side. Cells show every measure
 * (single measure → one column per across-bucket; multiple → one column per
 * across-bucket × measure). Totals come from the SAME query via
 * `totals: { groupings: [rows, columns, []] }` — pre-aggregated server-side,
 * never recombined here; a response without `totals` renders no totals UI.
 */
function DatasetMatrixTable({
  dataset,
  rows,
  columnsAcross,
  values,
  runtimeFilter,
  dataSource,
  onDrill,
  order,
}: {
  dataset: string;
  rows: string[];
  columnsAcross: string[];
  values: string[];
  runtimeFilter?: Record<string, unknown>;
  dataSource?: unknown;
  onDrill?: (args: DatasetDrillArgs) => void;
  order?: SelectionOrder;
}) {
  // Row subtotals, column subtotals, and the grand total ([]), in that order.
  //
  // objectstack-ai/objectstack#3916: the ordering rides on the PRIMARY query only — the server drops it
  // for the totals sub-queries by design (a total covers the whole selection,
  // and an order key may name a dimension the totals grouping doesn't have).
  // The across-axis header sequence follows from it: `pivot` below collects
  // `colHeaders` in row-ARRIVAL order, so ordering the rows by the across
  // dimension is what makes the columns read left-to-right in that order.
  const state = useDatasetRows(
    dataset,
    [...rows, ...columnsAcross],
    values,
    runtimeFilter,
    dataSource,
    [rows, columnsAcross, []],
    order,
  );
  const tt = useSafeTranslate();
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  // objectui#4575 — the display locale every measure and dimension value here
  // is formatted in. Unlike the flat table above, this component formats inside
  // a `useMemo` (the header labels `bucketLabel` builds), so the locale also
  // joins that memo's dependency array — threading it into the call alone would
  // leave the headers frozen in the locale they were first built with.
  const displayLocale = useDisplayLocale();
  // objectui#4330 — both axes' dimensions, one read (see the flat table above),
  // which objectui#12243 also reads for each select dimension's declared order.
  const dimensionMeta = useDatasetDimensionMeta(state.object, state.dimensionFields, [
    ...rows,
    ...columnsAcross,
  ]);
  const { dimensionLabels, dimensionRanks } = React.useMemo(
    () => deriveDimensionDisplay(dimensionMeta, fieldOptionLabel),
    [dimensionMeta, fieldOptionLabel],
  );
  // objectui#12243 — a report that declares its own `order` for this selection
  // keeps the server's arrival order on both axes; otherwise each axis is laid
  // out in its select dimensions' declared option order.
  const hasAuthoredOrder = scopeOrder(order, [...rows, ...columnsAcross], values) !== undefined;

  const pivot = React.useMemo(() => {
    if (state.status !== 'ok') return null;
    // `key` is the RAW bucket (drill identity); `display` is the same bucket as
    // it reads on screen, per dimension — the two are deliberately separate
    // (objectui#4330).
    const rowHeaders: Array<{ id: string; label: string; key: Row; display: Row }> = [];
    const colHeaders: Array<{ id: string; label: string; key: Row; display: Row }> = [];
    const seenRow = new Set<string>();
    const seenCol = new Set<string>();
    const cells = new Map<string, { row: Row; index: number }>();
    // Bucket ids and header labels come from the DISPLAY rows so both axes read
    // the localized label; the `key` a drill click carries comes from the RAW
    // row beside it, because that one addresses records (objectui#4263/#4273).
    // Index alignment across the two arrays is guaranteed by
    // `relabelDimensions`, which preserves order and count.
    const displayRows = relabelDimensions(state.rows, dimensionLabels);
    displayRows.forEach((r, index) => {
      const raw = state.rows[index];
      const rid = bucketId(rows, r);
      const cid = bucketId(columnsAcross, r);
      if (!seenRow.has(rid)) {
        seenRow.add(rid);
        const key: Row = {};
        const display: Row = {};
        for (const d of rows) { key[d] = raw[d]; display[d] = r[d]; }
        rowHeaders.push({ id: rid, label: bucketLabel(rows, r, displayLocale), key, display });
      }
      if (!seenCol.has(cid)) {
        seenCol.add(cid);
        const key: Row = {};
        const display: Row = {};
        for (const d of columnsAcross) { key[d] = raw[d]; display[d] = r[d]; }
        colHeaders.push({ id: cid, label: bucketLabel(columnsAcross, r, displayLocale), key, display });
      }
      // Keyed by pivotCellKey, not `${rid} ${cid}`: a plain space is a boundary
      // only while no dimension value contains one, and they do constantly
      // ("New York", "In Progress"). `index` is also what drill-through reads
      // `drillRawRows` by, so a merged key drilled to the wrong records too.
      // The cell holds MEASURES, which no relabel touches — so it keeps the
      // server's own row.
      cells.set(pivotCellKey(rid, cid), { row: raw, index });
    });
    // objectui#12243 — the headers were collected in row-ARRIVAL order, which
    // with no authored `order` is the dataset's `GROUP BY` order (alphabetical
    // by stored value). Each axis is laid out by its own dimensions' declared
    // option order, read off the DISPLAY values the headers carry, so a
    // `priority` column axis reads Low, Medium, High as a `status` row axis
    // reads New, In Progress, Closed. A time or text dimension keeps its
    // arrival order (the server's chronological default for a time axis).
    // Only the header lists move: every cell is still looked up by bucket id.
    const ranks = hasAuthoredOrder ? null : dimensionRanks;
    const rowLayout = arrangeByDeclaredOptions(rowHeaders, rows, (h, d) => h.display[d], ranks);
    const colLayout = arrangeByDeclaredOptions(colHeaders, columnsAcross, (h, d) => h.display[d], ranks);
    return {
      rowHeaders: rowLayout ? rowLayout.map((i) => rowHeaders[i]) : rowHeaders,
      colHeaders: colLayout ? colLayout.map((i) => colHeaders[i]) : colHeaders,
      cells,
    };
    // `displayLocale` is load-bearing here, not decorative: the header labels
    // above are built inside this memo (objectui#4575). Measured — with the
    // locale threaded into `bucketLabel` but absent from these deps, a session
    // that switches locale without refetching keeps the previous locale's
    // headers, and the pin for that is the "re-labels the across header when
    // only the locale changes" case in DatasetReportRenderer.measureLocale.test.tsx.
  }, [state, rows, columnsAcross, dimensionLabels, dimensionRanks, hasAuthoredOrder, displayLocale]);

  if (values.length === 0) return <EmptyMeasures dataset={dataset} />;
  if (state.status === 'loading' || state.status === 'idle') return <FetchStates status={state.status} />;
  if (state.status === 'error') return <FetchStates status="error" error={state.error} forbidden={state.forbidden} />;
  if (!pivot || pivot.rowHeaders.length === 0) return <NoRows />;

  // objectui#7534 — resolve a BUILT-IN default measure's caption through the
  // same seam the report chart already uses for its legend (#7258), so the
  // summary header / metric caption / pivot header cannot say `Count` while the
  // chart beside them says `计数`.
  const { measureField, headerLabel } = buildDatasetFieldHelpers(
    state.fields,
    state.object,
    fieldLabel,
    builtinAggregateLabels(tt),
  );
  const totalText = tt('report.total', 'Total');
  const canDrill = !!onDrill;
  // Down + across dims the server can map to object fields → raw-value filter.
  const drillDims = state.dimensionFields
    ? [...rows, ...columnsAcross].filter((d) => d in state.dimensionFields!)
    : [];
  const drillCell = (rowKey: Row, colKey: Row, index: number) => {
    // objectstack-ai/objectstack#1752: include the date-bucket range sidecar so an "X by time" cell scopes
    // to the clicked time bucket, not every bucket in that row/column.
    const cellRanges = state.drillRanges?.[index];
    const hasRange = !!cellRanges && Object.keys(cellRanges).length > 0;
    let objectFilter: Record<string, unknown> | undefined;
    if (state.object && (drillDims.length > 0 || hasRange)) {
      const built = drillFilterOrRefusal(state.drillRawRows?.[index], drillDims, state.dimensionFields ?? {}, runtimeFilter, cellRanges);
      // Refused: no drill at all — see `drillFilterOrRefusal`.
      if (built === null) return;
      objectFilter = built;
    }
    onDrill!({ dataset, groupKey: { ...rowKey, ...colKey }, runtimeFilter, object: state.object, objectFilter });
  };

  // Single measure → one column per across-bucket; multiple → bucket × measure.
  const cellCols = pivot.colHeaders.flatMap((col) =>
    values.map((measure) => ({
      col,
      measure,
      header: values.length === 1 ? col.label : `${col.label} · ${headerLabel(measure)}`,
    })),
  );

  // Server-supplied totals: match each grouping by its `dimensions` array,
  // then match its rows to the pivot headers via the same bucketId. Absent
  // (older server) → every map stays empty and no totals UI renders.
  //
  // The totals carry dimension values too, so they take the SAME relabel the
  // display rows took (objectui#4330 — the dashboard pivot does this for the
  // same reason, #4263): both sides of the lookup must speak one vocabulary,
  // or a zh-CN matrix would read 国内 down the side while the row-total lookup
  // still asked for `Domestic` and every total cell fell back to blank.
  const findTotals = (dims: string[]) => {
    const totalRows = state.totals?.find(
      (t) => Array.isArray(t.dimensions) && t.dimensions.join(',') === dims.join(','),
    )?.rows;
    return totalRows ? relabelDimensions(totalRows, dimensionLabels) : totalRows;
  };
  const rowTotalById = new Map<string, Row>();
  for (const r of findTotals(rows) ?? []) rowTotalById.set(bucketId(rows, r), r);
  const colTotalById = new Map<string, Row>();
  for (const r of findTotals(columnsAcross) ?? []) colTotalById.set(bucketId(columnsAcross, r), r);
  const grandTotal = findTotals([])?.[0];
  const showTotalCol = rowTotalById.size > 0;
  const showTotalRow = colTotalById.size > 0;

  return (
    <div className="overflow-auto max-h-[70vh] rounded-md border" data-testid="dataset-matrix">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            {rows.map((d) => (
              <th key={d} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                {headerLabel(d)}
              </th>
            ))}
            {cellCols.map((cc) => (
              <th key={`${cc.col.id}-${cc.measure}`} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                {cc.header}
              </th>
            ))}
            {showTotalCol &&
              values.map((measure) => (
                <th
                  key={`total-${measure}`}
                  className="px-2 py-1.5 text-right font-medium whitespace-nowrap"
                  data-testid="matrix-total-col-header"
                >
                  {values.length === 1 ? totalText : `${totalText} · ${headerLabel(measure)}`}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {pivot.rowHeaders.map((rh) => (
            <tr key={rh.id} className="border-t">
              {rows.map((d) => (
                <td key={d} className="px-2 py-1 whitespace-nowrap font-medium">
                  {formatDimensionValue(rh.display[d], displayLocale)}
                </td>
              ))}
              {cellCols.map((cc) => {
                const entry = pivot.cells.get(pivotCellKey(rh.id, cc.col.id));
                const value = entry?.row[cc.measure];
                const clickable = canDrill && entry != null;
                return (
                  <td
                    key={`${cc.col.id}-${cc.measure}`}
                    className={`px-2 py-1 text-right tabular-nums whitespace-nowrap${clickable ? ` ${DRILL_CLASS}` : ''}`}
                    data-testid={clickable ? 'dataset-drill-cell' : undefined}
                    onClick={clickable ? () => drillCell(rh.key, cc.col.key, entry!.index) : undefined}
                  >
                    {formatMeasure(value, measureField(cc.measure)?.format, measureField(cc.measure)?.currency, measureField(cc.measure)?.percentScale, displayLocale)}
                  </td>
                );
              })}
              {showTotalCol &&
                values.map((measure) => (
                  <td
                    key={`total-${measure}`}
                    className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-medium"
                    data-testid="matrix-row-total"
                  >
                    {formatMeasure(rowTotalById.get(rh.id)?.[measure], measureField(measure)?.format, measureField(measure)?.currency, measureField(measure)?.percentScale, displayLocale)}
                  </td>
                ))}
            </tr>
          ))}
          {showTotalRow && (
            <tr className="border-t bg-muted/30 font-medium" data-testid="matrix-total-row">
              {rows.length > 0 && (
                <td colSpan={rows.length} className="px-2 py-1 whitespace-nowrap">
                  {totalText}
                </td>
              )}
              {cellCols.map((cc) => (
                <td key={`${cc.col.id}-${cc.measure}`} className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                  {formatMeasure(colTotalById.get(cc.col.id)?.[cc.measure], measureField(cc.measure)?.format, measureField(cc.measure)?.currency, measureField(cc.measure)?.percentScale, displayLocale)}
                </td>
              ))}
              {showTotalCol &&
                values.map((measure) => (
                  <td
                    key={`grand-${measure}`}
                    className="px-2 py-1 text-right tabular-nums whitespace-nowrap"
                    data-testid="matrix-grand-total"
                  >
                    {formatMeasure(grandTotal?.[measure], measureField(measure)?.format, measureField(measure)?.currency, measureField(measure)?.percentScale, displayLocale)}
                  </td>
                ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const DatasetReportRenderer: React.FC<DatasetReportRendererProps> = ({
  report,
  dataSource,
  runtimeFilter,
  onDrill,
  className,
}) => {
  // objectui#5137 — `runtimeFilter` ONLY. `filter` is rejected by the strict
  // spec, so it is not read here either; it is reported instead of applied.
  const reportSite = describeReportSite(report);
  warnOnRejectedFilterAlias(report, reportSite);
  const outerFilter = mergeFilters(report.runtimeFilter, runtimeFilter);
  // ADR-0021 D2: `drilldown` defaults on; the host must still supply a sink.
  const drillSink = report.drilldown === false ? undefined : onDrill;
  // The DECLARED type drives the branch (#2941) — never the data shape.
  const presentation = resolveReportPresentation(report.type);

  // Joined → a vertical stack of dataset-bound blocks.
  if (presentation === 'joined' && Array.isArray(report.blocks)) {
    return (
      <div
        className={className}
        data-testid="dataset-joined-report"
        data-report-name={report.name}
        style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
      >
        {report.blocks.map((block, index) => {
          // objectui#5137 — same rule per block: `runtimeFilter` only.
          warnOnRejectedFilterAlias(block, `${reportSite} block \`${block.name ?? index}\``);
          const blockFilter = mergeFilters(outerFilter, block.runtimeFilter);
          const blockAcross = readNames(block.columns);
          // objectstack-ai/objectstack#3916 — each block orders ITSELF. A joined container selects nothing
          // of its own (the schema rejects `order` on it), and every block is an
          // independent query over its own dataset, so there is no report-level
          // ordering to inherit here.
          const blockOrder = readOrder(block.order);
          // Same type-driven dispatch as the top level: a block's declared
          // type picks its presentation (`JoinedReportBlockSchema.type`
          // defaults to `tabular`). A grouped block (summary, or a matrix
          // without across-dimensions) carries the totals footer.
          const blockPresentation = resolveReportPresentation(block.type);
          const blockTable = blockPresentation === 'matrix' && blockAcross.length > 0 ? (
            <DatasetMatrixTable
              dataset={String(block.dataset ?? '')}
              rows={readNames(block.rows)}
              columnsAcross={blockAcross}
              values={readNames(block.values)}
              runtimeFilter={blockFilter}
              dataSource={dataSource}
              onDrill={drillSink}
              order={blockOrder}
            />
          ) : (
            <DatasetReportTable
              dataset={String(block.dataset ?? '')}
              rows={readNames(block.rows)}
              values={readNames(block.values)}
              runtimeFilter={blockFilter}
              dataSource={dataSource}
              onDrill={drillSink}
              order={blockOrder}
              withTotals={blockPresentation === 'summary' || blockPresentation === 'matrix'}
            />
          );
          return (
            <section
              key={block.name ?? `block-${index}`}
              data-testid="dataset-report-block"
              data-block-id={block.name ?? `block-${index}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4"
            >
              <header className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold">{resolveText(block.label, block.name ?? `Block ${index + 1}`)}</h3>
                {block.description ? (
                  <p className="text-xs text-muted-foreground">{resolveText(block.description, '')}</p>
                ) : null}
              </header>
              {blockTable}
            </section>
          );
        })}
      </div>
    );
  }

  const across = readNames(report.columns);
  const reportOrder = readOrder(report.order);
  // Matrix with an across dimension → true cross-tab; without one it
  // degrades to the grouped (summary) table (pre-`columns` stored JSON).
  const crossTab = presentation === 'matrix' && across.length > 0;

  // The embedded chart visualization, when the report declares one (ADR-0021:
  // the chart plots the dataset's yAxis measure across the xAxis dimension;
  // the table always carries the exact numbers). ONE slot for every non-joined
  // presentation, the cross-tab included: `DatasetReportChart` runs its OWN
  // `chart.xAxis` × `chart.yAxis` dataset query, so it binds the same way
  // whichever table sits next to it — a matrix's rows and columns are dataset
  // dimensions like a summary's rows, and the chart's axes name them.
  //
  // objectui#10964 — the cross-tab used to RETURN before this read, so a matrix
  // report with `columns` parsed its `chart` and drew nothing. The spec accepts
  // that shape, so the renderer now draws it (ENFORCE, objectstack-ai/objectstack#20293).
  const chartCfg =
    report.chart && typeof report.chart === 'object' && (report.chart as { type?: unknown }).type
      ? (report.chart as Record<string, unknown>)
      : null;
  const chart = chartCfg ? (
    <DatasetReportChart
      dataset={String(report.dataset ?? '')}
      chart={chartCfg}
      runtimeFilter={outerFilter}
      dataSource={dataSource}
      order={reportOrder}
    />
  ) : null;

  // summary → grouped table with the server-computed totals footer;
  // tabular → the same selection as a simple list, no totals (the declared
  // type is what separates them, #2941). A matrix without `columns` degrades
  // to the summary presentation — it is a grouped type.
  const table = crossTab ? (
    <DatasetMatrixTable
      dataset={String(report.dataset ?? '')}
      rows={readNames(report.rows)}
      columnsAcross={across}
      values={readNames(report.values)}
      runtimeFilter={outerFilter}
      dataSource={dataSource}
      onDrill={drillSink}
      order={reportOrder}
    />
  ) : (
    <DatasetReportTable
      dataset={String(report.dataset ?? '')}
      rows={readNames(report.rows)}
      values={readNames(report.values)}
      runtimeFilter={outerFilter}
      dataSource={dataSource}
      onDrill={drillSink}
      order={reportOrder}
      withTotals={presentation === 'summary' || presentation === 'matrix'}
    />
  );

  // The chart precedes the grouped / flat table, and follows the cross-tab:
  // the ruling on objectstack-ai/objectstack#20293 draws a matrix's chart
  // "beside or below the cross-tab", and below is the one placement that needs
  // no new layout option.
  return (
    <div
      className={`${className ?? ''} flex flex-col gap-3`}
      data-testid="dataset-report"
      data-report-name={report.name}
      data-report-presentation={presentation}
    >
      {crossTab ? table : chart}
      {crossTab ? chart : table}
    </div>
  );
};
