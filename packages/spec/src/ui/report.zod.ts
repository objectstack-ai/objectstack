// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { analyticsCarrierFilter } from './analytics-carrier-filter';
import { ChartConfigSchema } from './chart.zod';
import { DATE_RANGE_DEFAULT_RANGES } from './dashboard.zod';
import { ReportExportOptionsSchema } from './list-view-export-options';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema } from './i18n.zod';

/**
 * Report Type Enum
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
export const ReportType = z.enum([
  'tabular',   // Simple list
  'summary',   // Grouped by row
  'matrix',    // Grouped by row and column
  'joined'     // Joined multiple blocks
]);

/**
 * Report Chart Schema
 *
 * A dataset-bound report chart (ADR-0021): `xAxis`/`yAxis` name the report's
 * bound-dataset **dimension** and **measure** (NOT raw object fields) — the
 * Studio inspector picks them from the dataset's dimension/measure catalogs
 * and objectui's `DatasetReportRenderer` plots them via `useDatasetRows`.
 */
export const ReportChartSchema = lazySchema(() => ChartConfigSchema.extend({
  /** Dataset **dimension** name for the X-axis (from the report's bound dataset). */
  xAxis: z.string().describe('Dataset dimension name for the X-axis (bound-dataset dimension, not a raw field)'),
  /** Dataset **measure** name for the Y-axis (from the report's bound dataset). */
  yAxis: z.string().describe('Dataset measure name for the Y-axis (bound-dataset measure, not a raw field)'),
}));

/**
 * Report Sort Schema (framework#3916)
 *
 * One ordering key of a report's `order` list. `by` names something the report
 * actually SELECTS — a `rows`/`columns` dimension or a `values` measure — which
 * is validated at authoring time rather than at render time, because a mistyped
 * sort key that quietly returns arbitrarily-ordered rows is the exact failure
 * this exists to remove.
 *
 * An ARRAY (not a `Record<string, direction>`) because a report's ordering is
 * multi-key and its key order is significant, and JSON object key order is not
 * a contract an author should have to rely on. The renderer lowers the list to
 * `DatasetSelection.order` in list order — see {@link reportSelectionOrder}.
 */
export const ReportSortSchema = lazySchema(() => strictObject({
  surface: 'this report order key',
  history:
    'Until this shape was closed these were dropped silently — the key still parsed, '
    + '`direction` fell back to `asc`, and the report rendered in an order nobody asked for '
    + '(the same `SortNodeSchema` failure, one layer up).',
  // Anchored on the two named sibling ordering contracts, not on edit distance.
  // A report's `order` is the THIRD spelling of "sort" an author meets, and the
  // other two are both correct where they live:
  //   • `data/query.zod.ts` `SortNodeSchema` — `{ field, order }` (closed by
  //     #4721, whose own alias table maps `direction` → `order`; the mapping
  //     runs the OTHER way here, which is exactly why neither can be inferred).
  //   • `dashboard.zod.ts` `DashboardWidget` — flat `sortBy` / `sortOrder`.
  // `asc` / `desc` as a bare boolean-ish key is the Mongo/objectql habit.
  aliases: {
    field: 'by',
    key: 'by',
    column: 'by',
    dimension: 'by',
    measure: 'by',
    name: 'by',
    sortBy: 'by',
    order: 'direction',
    sortOrder: 'direction',
    dir: 'direction',
    sort: 'direction',
    desc: 'direction',
    descending: 'direction',
    ascending: 'direction',
  },
}, {
  /** A dimension (`rows`/`columns`) or measure (`values`) name this report selects. */
  by: z.string().describe('Dimension or measure name to order by (must be selected by this report)').meta({ title: 'Order By' }),
  /** Sort direction. Null/empty cells sort LAST in both directions. */
  direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction (default ascending)').meta({ title: 'Direction' }),
}));

/**
 * Validate a report/block's `order` against what it selects, in place.
 *
 * Shared by `ReportSchema` and `JoinedReportBlockSchema` so a block's ordering
 * is held to the same contract as a top-level report's.
 */
function checkReportOrder(
  r: { order?: Array<{ by: string }>; rows?: string[]; columns?: string[]; values?: string[] },
  ctx: z.RefinementCtx,
): void {
  if (!r.order?.length) return;
  const selectable = new Set<string>([...(r.rows ?? []), ...(r.columns ?? []), ...(r.values ?? [])]);
  const seen = new Set<string>();
  for (const key of r.order) {
    if (seen.has(key.by)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate order key "${key.by}" — each dimension/measure may be ordered once.`,
        path: ['order'],
      });
    }
    seen.add(key.by);
    if (!selectable.has(key.by)) {
      ctx.addIssue({
        code: 'custom',
        message:
          `order key "${key.by}" is not selected by this report — ` +
          `name a \`rows\`/\`columns\` dimension or a \`values\` measure. ` +
          `Selectable here: ${[...selectable].join(', ') || '(none)'}.`,
        path: ['order'],
      });
    }
  }
}

/**
 * Lower a report's authored `order` into the `DatasetSelection.order` a
 * preview/query request posts (framework#3916).
 *
 * The array's element order becomes the object's key insertion order, which is
 * how `DatasetSelection.order` expresses sort significance (first key = primary
 * sort). Returns `undefined` for an absent or empty list so the caller omits
 * the field entirely and the runtime's own defaults apply — a selected time
 * dimension still comes back chronological without the author asking.
 *
 * Duplicate keys are rejected by the schema, so the last-write-wins collapse an
 * object build would otherwise hide cannot reach here from validated metadata.
 */
export function reportSelectionOrder(
  order?: Array<{ by: string; direction?: 'asc' | 'desc' }>,
): Record<string, 'asc' | 'desc'> | undefined {
  if (!order?.length) return undefined;
  const out: Record<string, 'asc' | 'desc'> = {};
  for (const key of order) out[key.by] = key.direction ?? 'asc';
  return out;
}

/**
 * The prescription a `joined` report's `chart` carries, at both of its
 * coordinates (#20161, ADR-0049 enforce-or-remove). Measured on the renderer
 * (recorded in `packages/spec/liveness/report.json`, row `chart`): the report
 * renderer's joined branch draws each block as a
 * `DatasetMatrixTable` / `DatasetReportTable` and returns before the one
 * `report.chart` read below it, and no renderer reads a block's `chart` at all
 * — so a chart on a joined report, container or block, parsed and plotted
 * nothing, while `validate-chart-bindings` checked its axes as if it would.
 *
 * - On a BLOCK the key is removed from the closed shape; `strictObject`'s
 *   `guidance` slot answers it with the prescription below.
 * - On the CONTAINER the key stays declared — it is the live embedded chart of
 *   every non-joined report — and the joined arm of `ReportSchema`'s
 *   refinement refuses it, beside the selection keys it already refuses.
 *
 * The ADR-0087 conversion `report-joined-chart-removed` strips both from old
 * sources and stored rows; it is retired from the load path, so a live author
 * is refused here rather than rewritten.
 *
 * ⚠️ The version sentence names the npm release this ships in, never the
 * protocol major the migration entries are numbered at (ADR-0087, the level
 * half of its 2026-09-13 amendment).
 */
const JOINED_BLOCK_CHART_RETIRED =
  '`report.blocks[].chart` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) '
  + '— no renderer ever drew it: a joined report draws each block as a table and never reads a '
  + 'block `chart`, so the chart parsed and nothing was plotted. Delete the key. A chart is drawn '
  + 'from a non-joined report\'s own top-level `chart`: to plot one of these slices, give it a '
  + 'report of its own with that `chart`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const JOINED_CONTAINER_CHART_REFUSED =
  'a `joined` report draws no chart — it draws each block as a table and never reads `chart`, '
  + 'on the container or on a block. Delete `chart`; to plot one of these slices, give it a '
  + 'non-joined report of its own with that `chart`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * The refusals a `joined` report's `dateRange` and `exportOptions` carry, on
 * the container (ruling 6408567749 on #25873, letter B; #26548). Both are
 * keys of ONE table over ONE dataset, and a joined report is neither: its
 * blocks may bind different datasets, so a single `dateRange.dimension`
 * cannot name a date column in every one of them, and it draws one table per
 * block where a report exports the table it draws. A block declares neither
 * key — its `guidance` entries below say so — so, like the container `chart`,
 * the refusal carries no pointer onto `blocks[]`. A per-block or
 * conformed-dimension date range (ADR-0021 Q3) and a multi-table export are
 * later widenings, not this shape.
 */
const JOINED_CONTAINER_DATE_RANGE_REFUSED =
  'a `joined` report takes no `dateRange`: its blocks may bind different datasets, so one '
  + '`dimension` cannot name a date column in every block, and a block has no `dateRange` of its '
  + 'own. Delete `dateRange`; to window one of these slices by period, give it a non-joined report '
  + 'of its own with that `dateRange`.';

const JOINED_CONTAINER_EXPORT_OPTIONS_REFUSED =
  'a `joined` report offers no export: it draws one table per block, and a report exports the one '
  + 'table it draws. Delete `exportOptions`; to export one of these slices, give it a non-joined '
  + 'report of its own.';

/**
 * The answer to `subscription` / `schedule` on a report (#26548). A scheduled
 * delivery of a report was weighed beside its date range and export and not
 * adopted (ruling 6408567749 on #25873: letter C waits for a customer who asks
 * for it), so nothing in the platform delivers a report on a timetable — and a
 * key that parsed would promise exactly that.
 */
const REPORT_SUBSCRIPTION_NOT_OFFERED =
  'a report declares no subscription or scheduled delivery: the platform does not send reports on a '
  + 'schedule, so there is no key for it. Delete the key. The period a report covers is its '
  + '`dateRange`, and the download of its table is `exportOptions`.';

/** A block's answer to `dateRange` / `exportOptions`: the container's keys, refused there too. */
const BLOCK_NON_JOINED_REPORT_KEY = (key: 'dateRange' | 'exportOptions'): string =>
  `\`${key}\` is a key of a non-joined report, not of a block, and a \`joined\` container refuses it `
  + 'as well. Give the slice a non-joined report of its own and declare it there.';

/**
 * The refusal a `joined` report's block with no `dataset` earns, at
 * `blocks[i].dataset` (#21702; ADR-0021 single-form, ADR-0049 enforce-or-remove,
 * the enforce arm). A block is an independent dataset query, and nothing else
 * feeds it: the container selects nothing (its `dataset` is refused below).
 * Measured on the renderer (recorded in `packages/spec/liveness/report.json`,
 * row `blocks`): the report renderer's joined branch hands each block's `dataset` to its table as
 * `String(block.dataset ?? '')`, and the table's query hook goes idle on an
 * empty name, so an unbound block draws an empty table and queries nothing; a
 * report whose blocks ALL lack one fails `isDatasetReport` and falls through to
 * the pre-9.0 presentation bridge, which queries nothing either.
 *
 * The key stays `.optional()` on `JoinedReportBlockSchema` itself: `blocks` is
 * read only on a `joined` report, so the requirement lives on the arm of
 * `ReportSchema`'s refinement that reads it. `block` is how the refusal names
 * the block — by its `name`, or by its `blocks[i]` position when the name is
 * empty (an empty name is its own issue, and does not stop this one).
 */
function joinedBlockDatasetRequired(block: string): string {
  return `a \`joined\` report draws each block from that block's own \`dataset\`, and ${block} binds none, `
    + 'so nothing queries it and it draws no rows. Bind the block to a dataset: set its `dataset` to the '
    + 'dataset whose measures (`values`) and dimensions (`rows`) it shows.';
}

/**
 * Joined Report Block Schema
 *
 * Represents a single sub-report inside a `type: 'joined'` report. Each block
 * is a self-contained, independently-queried report stacked vertically (or
 * arranged in a grid) inside the joined container. Blocks are used for
 * comparative dashboards where each panel is a different slice of the same
 * domain — e.g. "new customers / churned / silent" in a customer-churn
 * report, or "new / qualified / closed" in a lead-funnel report.
 *
 * Blocks may declare their own `runtimeFilter` (ANDed with the container's
 * `runtimeFilter` at query time) and their own `rows` / `columns` / `values`
 * selection and `order`.
 *
 * Notes for implementers:
 * - `type` defaults to `tabular` — leave a block's type implicit if the
 *   sub-report is just a list. Set explicitly to `summary` or `matrix` for
 *   aggregated blocks.
 * - Blocks are not allowed to be themselves `joined` (no recursion).
 * - A block is drawn as a table and has no `chart` key: #20161 removed it,
 *   because nothing ever drew it. Writing it is refused with the upgrade
 *   prescription (the `guidance` entry below).
 *
 * [#19920] Carries its inferred type, not a `z.ZodTypeAny` annotation. That
 * annotation erased the block's shape, so {@link JoinedReportBlock} and every
 * `blocks[]` element of {@link Report} / {@link ReportParsed} were `unknown`
 * and any value type-checked against them. It dodged no TS7056 (measured: none
 * without it); what it bought was declaration size, the block's shape being
 * emitted once here and once inside `ReportSchema`'s `blocks`.
 */
export const JoinedReportBlockSchema = lazySchema(() => strictObject({
  surface: 'this joined report block',
  history:
    'Until this shape was closed these were dropped silently — the block still rendered, '
    + 'minus whatever the key was meant to select, scope or order.',
  // A block is a sub-report, so the vocabulary an author brings is the CONTAINER's
  // (`ReportSchema`, thirty lines below) — and the two shapes deliberately differ:
  // a block has no `drilldown`, no `protection`, no nested `blocks`, and its type
  // enum excludes `joined` (no recursion). Those are the entries below: each one
  // is a key that is correct one level up and wrong here, which edit distance
  // reads as a near-match to something unrelated rather than as a layer mistake.
  aliases: {
    // ADR-0021 single-form: the legacy inline query was removed in the cutover.
    // These are the spellings that cutover retired, aimed at their successors.
    objectName: 'dataset',
    object: 'dataset',
    dataSet: 'dataset',
    source: 'dataset',
    // A block selects measures by name; `columns` is a real key here (the matrix
    // across-axis), so the value list cannot borrow it — hence the explicit map.
    fields: 'values',
    measures: 'values',
    metrics: 'values',
    groupings: 'rows',
    groupBy: 'rows',
    dimensions: 'rows',
    // Scope filter. `runtimeFilter` is camelCase, so the fallback under-reaches
    // every one of these (#4990).
    filter: 'runtimeFilter',
    filters: 'runtimeFilter',
    where: 'runtimeFilter',
    criteria: 'runtimeFilter',
    // Ordering, spelled as the container/objectql/dashboard surfaces spell it.
    sort: 'order',
    orderBy: 'order',
    sortBy: 'order',
  },
  guidance: {
    // Wrong-layer pointers, all three verified against this schema's own shape
    // and the container's: writing them here is not a typo, it is a level
    // mistake, and a rename suggestion would send the author somewhere worse.
    blocks:
      'a block cannot contain blocks — `type: \'joined\'` is excluded from a block\'s type enum on purpose (no recursion). Declare sibling blocks on the CONTAINER report\'s `blocks` list instead.',
    drilldown:
      '`drilldown` is a container-level key on the report, not per block — move it to the top-level report. A joined report drills through from the container.',
    protection:
      '`protection` is the ADR-0010 package-author lock policy, declared once on the REPORT — a block is not separately lockable. Move it to the top-level report.',
    // #20161 — a retired key, not a wrong-layer pointer: removed from this
    // closed shape, so the prescription is what an author who keeps writing it
    // is answered with (build-schemas check (c) proof 4 reads it from here).
    chart: JOINED_BLOCK_CHART_RETIRED,
    // #26548 — two keys of a NON-joined report: one dataset's date window and
    // the export of the one table it draws. A joined container refuses both
    // (see `JOINED_CONTAINER_DATE_RANGE_REFUSED`), so there is no layer above
    // to point at either.
    dateRange: BLOCK_NON_JOINED_REPORT_KEY('dateRange'),
    exportOptions: BLOCK_NON_JOINED_REPORT_KEY('exportOptions'),
  },
}, {
  /** Stable id for the block (used as react key, telemetry, deeplinks). */
  name: SnakeCaseIdentifierSchema.meta({ title: 'Name' }),
  /** Human label shown above the block. Falls back to `name`. */
  label: I18nLabelSchema.optional().meta({ title: 'Label' }),
  /** Optional description rendered below the label. */
  description: I18nLabelSchema.optional().meta({ title: 'Description' }),
  /** Block report type — `joined` is intentionally excluded (no recursion). */
  type: z.enum(['tabular', 'summary', 'matrix']).default('tabular').meta({ title: 'Block Type' }),
  // `chart` was declared here until #20161 and nothing ever drew it; it is
  // answered by the `guidance` entry above (ADR-0087 `report-joined-chart-removed`).

  /**
   * ADR-0021 — the dataset this block binds to (single-form). The block selects
   * the dataset's measures by name; the legacy inline `objectName` + `columns` +
   * `groupings` query was removed in the cutover.
   *
   * Every block of a `joined` report binds one: `ReportSchema`'s refinement
   * refuses a block without it at `blocks[i].dataset` (#21702), because nothing
   * else would feed the block's query. It stays optional on this shape only
   * because `blocks` is read on a `joined` report alone.
   */
  dataset: SnakeCaseIdentifierSchema.optional().describe('Dataset name to bind (ADR-0021); a joined report refuses a block without one').meta({ title: 'Dataset' }),
  /** Dimension names (from the dataset) to group rows by. Dataset-bound only. */
  rows: z.array(z.string()).optional().describe('Dimension names down (dataset-bound)').meta({ title: 'Rows' }),
  /** Dimension names across — matrix blocks pivot rows × columns (ADR-0021 D2). */
  columns: z.array(z.string()).optional().describe('Dimension names across (matrix, dataset-bound)').meta({ title: 'Columns' }),
  /** Measure names (from the dataset) to display. Dataset-bound only. */
  values: z.array(z.string()).optional().describe('Measure names to show (dataset-bound)').meta({ title: 'Values' }),
  /**
   * Render-time scope filter, ANDed at query time. Dataset-bound only.
   * [#20116] Charted through the analytics `where` door, so it is an analytics
   * carrier: a comparand that door refuses INSIDE a nested relation is refused
   * on save too — see {@link analyticsCarrierFilter}
   * (`./analytics-carrier-filter.ts`).
   */
  runtimeFilter: analyticsCarrierFilter().describe('Render-time scope filter (dataset-bound)').meta({ title: 'Runtime Filter' }),
  /** Result ordering for this block, most significant key first (framework#3916). */
  order: z.array(ReportSortSchema).optional().describe('Result ordering, most significant key first').meta({ title: 'Order' }),
}).superRefine(checkReportOrder));

/**
 * The top-level keys a `type: 'joined'` report refuses, each with a pointer
 * onto `blocks[]`: every one of them SELECTS data, and a joined container
 * selects nothing itself — each block binds its own `dataset` and picks its own
 * `rows` / `columns` / `values`. `order` is refused beside them, by its own
 * message, for the same reason, and so is `chart` (#20161) — with no pointer
 * onto `blocks[]`, because a block draws no chart either. Not exported: the
 * refinement below is the only reader, and `report.test.ts` pins the list by
 * parse.
 */
const JOINED_CONTAINER_SELECTION_KEYS = ['dataset', 'rows', 'columns', 'values'] as const;

/**
 * Report Schema
 * Deep data analysis definition.
 */
export const ReportSchema = lazySchema(() => strictObject({
  surface: 'this report',
  history:
    'Until this shape was closed these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  // Kept deliberately parallel to `JoinedReportBlockSchema` above: a block is a
  // sub-report, so an author who learns one vocabulary must not be corrected
  // differently on the other. Every block entry whose target this schema also
  // declares is carried here, to the same target — today, every one of them —
  // and `report.test.ts` derives that parity from the two tables at runtime. A
  // key that must NOT route here gets a `guidance` line saying why, never
  // silence. The `guidance` tables do differ, on purpose: the block's three are
  // wrong-layer pointers to keys this schema declares, and `drillDown` below
  // disambiguates this schema's own `drilldown` boolean, which a block lacks.
  //
  // #5013 — `filter` used to point at `filters`, a key `ReportSchema` does not
  // declare either, so taking the advice earned a SECOND rejection and that one
  // carried no suggestion at all. Three entries are gone with it: `columns` and
  // `chart` are both declared here (the matrix across-axis and the embedded
  // chart), so an alias filed under them could never run — an alias is consulted
  // only from the `unrecognized_keys` path — and `chartConfig` was not a key
  // either. `alias-integrity.test.ts` now proves both halves for every table in
  // the package.
  //
  // The parallel claim above was not true when it was first written: the ten
  // selection and ordering spellings below existed only on the block, so
  // `measures:` on a plain report was refused with no suggestion while the
  // same key one level down was told `values`. Of the ten, only `orderBy`
  // reached its target by edit distance alone.
  aliases: {
    // ADR-0021 single-form: the legacy inline query was removed in the cutover.
    // These are the spellings that cutover retired, aimed at their successors.
    objectName: 'dataset',
    object: 'dataset',
    dataSet: 'dataset',
    source: 'dataset',
    // A report selects measures by name; `columns` is a real key here (the
    // matrix across-axis), so the value list cannot borrow it — hence the
    // explicit map.
    fields: 'values',
    measures: 'values',
    metrics: 'values',
    groupings: 'rows',
    groupBy: 'rows',
    dimensions: 'rows',
    // Scope filter. `runtimeFilter` is camelCase, so the edit-distance fallback
    // under-reaches every one of these (#4990) — same as on a block.
    filter: 'runtimeFilter',
    filters: 'runtimeFilter',
    where: 'runtimeFilter',
    criteria: 'runtimeFilter',
    // Ordering, spelled as the objectql/dashboard surfaces spell it. On a
    // `joined` report the prescribed `order` is itself refused, with the
    // pointer onto `blocks[]` — the same answer the author would get for
    // writing `order` directly.
    sort: 'order',
    orderBy: 'order',
    sortBy: 'order',
    // #26548 — the dashboard's own top-level spellings for its date range
    // (`DashboardSchema`), aimed at the same key here. A block declares no
    // `dateRange`, so these have no block twin to keep in parity with.
    dateFilter: 'dateRange',
    timeRange: 'dateRange',
  },
  guidance: {
    // #26548 — the export PERMISSION is not report metadata. Writing it here
    // reads as "allow exporting this report", which is the question the
    // permission-set axis answers for the dataset's base object; edit distance
    // would offer nothing, and silence would leave the author guessing.
    allowExport:
      '`allowExport` is a permission, not a report key: it is `ObjectPermission.allowExport` on a permission set, granted per object. A report offers its export control to a viewer whose permissions allow export of the report\'s dataset base object, and declares only what is exported, in `exportOptions` (`formats`, `includeHeaders`, `fileNamePrefix`). To turn the control off for everyone, write `exportOptions: { formats: [] }`.',
    // #26548 — a subscription / scheduled delivery was not adopted with the
    // date range and export (ruling 6408567749 on #25873 deferred letter C).
    subscription: REPORT_SUBSCRIPTION_NOT_OFFERED,
    schedule: REPORT_SUBSCRIPTION_NOT_OFFERED,
    // #5022 — the reverse half of a two-way disambiguation. The forward half
    // lives on `ChartDrillDownSchema` in `ui/chart.zod.ts`, which tells an
    // author who writes `drilldown` on a CHART that they want the report's
    // boolean. This one catches the opposite mistake, and it is the one edit
    // distance cannot help with: `drillDown` → `drilldown` is a distance of 1,
    // so the suggester would cheerfully propose the rename and the author would
    // write `drilldown: { target: 'dialog' }` — a config object into a boolean
    // slot, rejected a second time. Naming the TYPE difference is what makes
    // the difference actionable (批 10's lesson, applied to a case-only twin).
    drillDown:
      '`drillDown` (camelCase) is a different capability on a different surface: it is the react-tier `<ObjectChart drillDown={…}>` prop, a configuration OBJECT (`ChartDrillDownSchema` — `enabled`/`filter`/`title`/`target`/`columns`/`maxRows`) that configures a CHART segment drill. A report\'s drill switch is `drilldown` — all lowercase, and a plain BOOLEAN (ADR-0021 D2, on by default), which turns row/cell drill on a `summary`/`matrix` report on or off. If you meant this report, write `drilldown: true` or `drilldown: false`; if you meant a chart, the prop belongs on a react page, not in report metadata.',
  },
}, {
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Report unique name'),
  label: I18nLabelSchema.describe('Report label'),
  description: I18nLabelSchema.optional(),

  /** Report Configuration */
  type: ReportType.default('tabular').describe('Report format type'),

  /**
   * ADR-0021 — the semantic-layer `dataset` this report binds to. The report
   * renders the dataset's named measures grouped by the chosen `rows`
   * dimensions — numbers stay consistent with every other surface using the
   * same dataset. This is the single author-facing analytics shape (the legacy
   * inline `objectName` + `columns` + `groupings` query was removed in the
   * single-form cutover). For a `joined` report, the data lives on `blocks`:
   * a top-level `dataset` on one is refused — each block binds its own.
   */
  dataset: SnakeCaseIdentifierSchema.optional().describe('Dataset name to bind (ADR-0021)'),
  /**
   * Dimension names (from the dataset) to group rows by (down axis). A
   * non-empty list on a `joined` report is refused — see `blocks[].rows`.
   */
  rows: z.array(z.string()).optional().describe('Dimension names down'),
  /**
   * Dimension names across (ADR-0021 D2) — a `matrix` report pivots
   * `rows` × `columns` with `values` in the cells. Ignored for the other
   * non-joined types; a non-empty list on a `joined` report is refused — see
   * `blocks[].columns`.
   */
  columns: z.array(z.string()).optional().describe('Dimension names across (matrix)'),
  /**
   * Measure names (from the dataset) to display. A non-empty list on a
   * `joined` report is refused — see `blocks[].values`.
   */
  values: z.array(z.string()).optional().describe('Measure names to show'),
  /**
   * Render-time scope filter, ANDed at query time. [#20116] An analytics
   * carrier, like a block's — see {@link analyticsCarrierFilter}
   * (`./analytics-carrier-filter.ts`).
   */
  runtimeFilter: analyticsCarrierFilter().describe('Render-time scope filter'),
  /**
   * Result ordering — most significant key first (framework#3916).
   *
   * Each key names a dimension this report groups by (`rows` or `columns`) or a
   * measure it displays (`values`); anything else is an authoring-time error.
   * The renderer lowers this to `DatasetSelection.order` via
   * {@link reportSelectionOrder}, so the ordering is applied SERVER-SIDE over
   * the whole grid — after measure-scoped filters merge and derived measures
   * evaluate — not by the pivot over whatever rows happened to arrive.
   *
   * For a `matrix` report the ordering drives BOTH axes: a key naming a
   * `columns` dimension orders the across-axis headers, a key naming a `rows`
   * dimension orders the down-axis groups. List the columns key first when the
   * across-axis order is the one that matters (the header sequence then follows
   * the primary sort exactly).
   *
   * Ordering is OPTIONAL, not required for a sane result: a selected date/time
   * dimension already defaults to ascending (chronological) server-side, so a
   * month-bucketed matrix reads left-to-right in time without this field.
   * Declare `order` to sort by a measure ("biggest region first"), to reverse a
   * time axis (newest first), or to order a non-time dimension.
   *
   * A `joined` report orders per block — see `blocks[].order`.
   */
  order: z.array(ReportSortSchema).optional().describe('Result ordering, most significant key first'),
  /**
   * ADR-0021 D2 — click an aggregated row/cell to open the underlying
   * records (dataset-backed; the host resolves the dataset's object and
   * dimension→field mapping). Default on; set `false` to disable.
   */
  drilldown: z.boolean().default(true).describe('Click-through to underlying records'),

  /**
   * Visualization — an embedded chart plotted from the bound dataset
   * (`xAxis` names a dimension, `yAxis` a measure) above the report's table,
   * or below it for a `matrix` report with `columns`.
   *
   * Refused on a `joined` report (#20161), which draws each block as a table
   * and never reads `chart`; a block has no `chart` key.
   */
  chart: ReportChartSchema.optional().describe('Embedded chart configuration (refused on a joined report, which draws tables only)'),

  /**
   * The report's period: a date window over ONE dataset date dimension, with
   * a default preset and an optional custom pick (ruling 6408567749 on
   * #25873, letter B; #26548).
   *
   * `defaultRange` and `allowCustomRange` are the dashboard's
   * (`DashboardSchema.dateRange`) verbatim: the same preset table
   * (`DATE_RANGE_DEFAULT_RANGES` — every `DATE_RANGE_PRESETS` member plus the
   * `custom` "open the picker, no window" sentinel), the same defaults and the
   * same rename hints. `report-date-range-export.test.ts` holds the two declarations
   * equal, so the vocabulary cannot drift into a second preset table.
   *
   * `dimension` is where the two differ, on purpose. The dashboard's `field`
   * names a raw object FIELD; a report names a dataset DIMENSION (ADR-0021 —
   * a report selects by name, and a dimension carries its own relationship
   * path, so `account.created_at` needs no new grammar). The dimension must
   * declare `type: 'date'`: the analytics compiler types any other dimension
   * as a string axis, not a time one. Omitted, the dataset's ONE `type: 'date'`
   * dimension is used; zero or several is an authoring error naming what it
   * found — the rule the dashboard executor applies to an omitted
   * `compareTo.dimension`. `ReportSchema` parses without the dataset, so this
   * shape checks only itself; the dataset-aware half is the `@objectstack/lint`
   * rule `validate-report-date-range.ts` (`os validate`, `os build`, and the
   * report publish door).
   *
   * Lowering (the renderer's contract): the active window rides the dataset
   * query as `selection.timeDimensions: [{ dimension, dateRange }]` with NO
   * `granularity` — a filter window, not a bucket, ANDed with `runtimeFilter`
   * and the dataset's own filter. A preset goes on the wire by name; a custom
   * pick as `[start, end]`. Bucketing stays on the dimension's
   * `dateGranularity` and the report's `rows` / `columns`.
   *
   * Refused on a `joined` report — see {@link JOINED_CONTAINER_DATE_RANGE_REFUSED}.
   *
   * Absent = no window, every period — exactly as a report has always
   * rendered. The window selects which rows the table shows and grants
   * nothing: what a viewer may read stays with the dataset object's access.
   */
  dateRange: strictObject({
    surface: 'this report date range',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      // The dashboard's own rename hints for these two members, verbatim.
      preset: 'defaultRange',
      range: 'defaultRange',
      default: 'defaultRange',
      allowCustom: 'allowCustomRange',
      custom: 'allowCustomRange',
      // "Which date column": the dashboard's `field` and its two spellings,
      // and the wire's `timeDimensions[].dimension` — the same words the
      // dashboard's `compareTo` routes onto its own `dimension`.
      field: 'dimension',
      dateField: 'dimension',
      fieldName: 'dimension',
      timeDimension: 'dimension',
    },
  }, {
    dimension: z.string().optional()
      .describe('Dataset dimension (declared `type: \'date\'`) the window applies to; omitted = the dataset\'s one date dimension'),
    defaultRange: z.enum(DATE_RANGE_DEFAULT_RANGES).default('this_month').describe('Default date range preset'),
    allowCustomRange: z.boolean().default(true).describe('Allow users to pick a custom date range'),
  }).optional().describe('Report date range: a window over one dataset date dimension (refused on a joined report)'),

  /**
   * What the report's export control offers (ruling 6408567749 on #25873,
   * letter B; #26548). The members are the list export block's
   * (`view.exportOptions`), narrowed to what a report table needs — see
   * {@link ReportExportOptionsSchema} for what is and is not carried over.
   *
   * Default ON: absent, a report offers `['csv', 'xlsx']`, as a list offers
   * its default formats unasked; `formats: []` turns the control off.
   *
   * Who may export is NOT declared here — there is no report permission key.
   * The control is offered to a viewer whose effective API operations on the
   * dataset's base object include `export`: the `ObjectPermission.allowExport`
   * axis, through the same predicate the list toolbar uses.
   *
   * What is exported (the renderer's contract): the report table as drawn,
   * within the active `dateRange` and `runtimeFilter` — the selected rows ×
   * values, the matrix pivot and the server totals — with headers from the
   * dimension and measure labels. The file is named for the report label and
   * the period; `fileNamePrefix` replaces the label.
   *
   * Refused on a `joined` report — see {@link JOINED_CONTAINER_EXPORT_OPTIONS_REFUSED}.
   */
  exportOptions: ReportExportOptionsSchema.optional().describe(
    'Report export control: `{ formats?, includeHeaders?, fileNamePrefix? }`, csv / xlsx, on by default; who may export is the base object\'s export permission (refused on a joined report)',
  ),

  /**
   * Joined report blocks — only meaningful when `type: 'joined'`.
   *
   * A joined report renders multiple independent sub-reports stacked
   * vertically in the same view, each drawn as a table. Each block binds its
   * own `dataset` and selects its own `rows` / `columns` / `values`, with its
   * own `runtimeFilter` and `order`. The container-level `runtimeFilter` is
   * ANDed into every block at query time so a top-level scope (e.g. "this
   * quarter") flows down without per-block duplication. Neither the container
   * nor a block carries a `chart`.
   *
   * Renderers must ignore `blocks` when `type !== 'joined'`.
   */
  blocks: z.array(JoinedReportBlockSchema).optional().describe('Sub-reports for type=joined'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here, in a code package's source;
   * the loader translates it into the private `_lock` envelope at
   * registration time and strips this block. The metadata API's
   * save door does not translate it and refuses it (`400
   * VALIDATION_ERROR`), so that door never stores it. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this report.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}).superRefine((r, ctx) => {
  // ADR-0021 single-form: a report is dataset-bound. A `joined` report carries
  // its data on `blocks` (each block dataset-bound); every other type needs a
  // top-level `dataset` + `values`.
  if (r.type === 'joined') {
    if (!r.blocks || r.blocks.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'a `joined` report needs `blocks`.', path: ['blocks'] });
    }
    // #21702 — "each block dataset-bound" is enforced here, not only stated: a
    // block with no `dataset` is refused at its own `dataset` path, by name
    // (see `joinedBlockDatasetRequired`). Until this arm it parsed, passed
    // `objectstack validate` and every save door, and drew nothing.
    r.blocks?.forEach((block, i) => {
      if (!block || typeof block !== 'object' || block.dataset !== undefined) return;
      const name = typeof block.name === 'string' && block.name.length > 0 ? `block \`${block.name}\`` : `\`blocks[${i}]\``;
      ctx.addIssue({ code: 'custom', message: joinedBlockDatasetRequired(name), path: ['blocks', i, 'dataset'] });
    });
  } else if (!r.dataset || !r.values || r.values.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'a report needs `dataset` + `values` (measure names).',
      path: ['dataset'],
    });
  }
  // A `joined` report selects nothing itself — its selection and its ordering
  // live per block. The renderer's joined branch reads `blocks` (plus the
  // container's `runtimeFilter` and `drilldown`) and returns before it reads
  // any top-level selection key, so a container `dataset` / `rows` / `columns`
  // / `values` was accepted here and then dropped without a word — the exact
  // experience the `order` refusal below already existed to prevent, one key
  // over. The threshold is `order`'s: a present `dataset`, a NON-EMPTY list.
  // An empty list selects nothing, which is what a joined container selects.
  if (r.type === 'joined') {
    for (const key of JOINED_CONTAINER_SELECTION_KEYS) {
      const value = r[key];
      if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
      ctx.addIssue({
        code: 'custom',
        message: `a \`joined\` report selects per block — move \`${key}\` onto \`blocks[]\`, or delete it; on the container it selects nothing.`,
        path: [key],
      });
    }
    if (r.order?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'a `joined` report orders per block — move `order` onto `blocks[]`.',
        path: ['order'],
      });
    }
    // #20161 — the one container key refused WITHOUT a pointer onto `blocks[]`:
    // the joined branch never reads `chart`, and a block has no `chart` key to
    // move it to. Any present value is refused (it is an object, so there is no
    // "empty" reading the selection threshold above could apply to).
    if (r.chart !== undefined) {
      ctx.addIssue({ code: 'custom', message: JOINED_CONTAINER_CHART_REFUSED, path: ['chart'] });
    }
    // #26548 — the same arm, the same no-pointer style: one dataset's date
    // window and the export of one drawn table, neither of which a joined
    // container has. Any present value is refused, `{}` included.
    if (r.dateRange !== undefined) {
      ctx.addIssue({ code: 'custom', message: JOINED_CONTAINER_DATE_RANGE_REFUSED, path: ['dateRange'] });
    }
    if (r.exportOptions !== undefined) {
      ctx.addIssue({ code: 'custom', message: JOINED_CONTAINER_EXPORT_OPTIONS_REFUSED, path: ['exportOptions'] });
    }
  } else {
    checkReportOrder(r, ctx);
  }
}));

/**
 * One sub-report of a `type: 'joined'` report (input shape): the input type of
 * {@link JoinedReportBlockSchema}.
 *
 * [#19920] Was `unknown` while that schema was annotated `z.ZodTypeAny`.
 * `joined-report-block-type.test.ts` pins that `unknown`, an undeclared key and
 * the retired `chart` are refused here. A static type, not the schema's
 * verdict: the `order` check against the selected dimensions and measures is a
 * refinement, not a type, so `JoinedReportBlockSchema` remains the only judge.
 */
export type JoinedReportBlock = z.input<typeof JoinedReportBlockSchema>;
/** Post-parse shape of {@link JoinedReportBlock} — defaults applied, transforms run (ADR-0122). */
export type JoinedReportBlockParsed = z.infer<typeof JoinedReportBlockSchema>;

/**
 * Report Types
 * 
 * Note: For configuration/definition contexts, use the Input types (e.g., ReportInput)
 * which allow optional fields with defaults to be omitted.
 */
export type Report = z.input<typeof ReportSchema>;
/** Post-parse shape of {@link Report} — defaults applied, transforms run (ADR-0122). */
export type ReportParsed = z.infer<typeof ReportSchema>;
export type ReportChart = z.input<typeof ReportChartSchema>;
/** Post-parse shape of {@link ReportChart} — defaults applied, transforms run (ADR-0122). */
export type ReportChartParsed = z.infer<typeof ReportChartSchema>;
export type ReportSort = z.input<typeof ReportSortSchema>;
/** Post-parse shape of {@link ReportSort} — defaults applied, transforms run (ADR-0122). */
export type ReportSortParsed = z.infer<typeof ReportSortSchema>;
export type ReportType = z.input<typeof ReportType>;

/**
 * Report Factory Helper
 */
export const Report = {
  create: (config: Report): ReportParsed => ReportSchema.parse(config),
} as const;

/**
 * Type-safe factory for an analytics report. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Report` literal.
 */
export function defineReport(config: z.input<typeof ReportSchema>): ReportParsed {
  return ReportSchema.parse(config);
}
