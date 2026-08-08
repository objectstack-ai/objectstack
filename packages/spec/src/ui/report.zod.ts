// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { ChartConfigSchema } from './chart.zod';
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
    'Until #4001 批 14 closed this shape these were dropped silently — the key still parsed, '
    + '`direction` fell back to `asc`, and the report rendered in an order nobody asked for '
    + '(the `SortNodeSchema` failure of #4721, one layer up).',
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
  by: z.string().describe('Dimension or measure name to order by (must be selected by this report)'),
  /** Sort direction. Null/empty cells sort LAST in both directions. */
  direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction (default ascending)'),
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
 * Joined Report Block Schema
 *
 * Represents a single sub-report inside a `type: 'joined'` report. Each block
 * is a self-contained, independently-queried report stacked vertically (or
 * arranged in a grid) inside the joined container. Blocks are used for
 * comparative dashboards where each panel is a different slice of the same
 * domain — e.g. "new customers / churned / silent" in a customer-churn
 * report, or "new / qualified / closed" in a lead-funnel report.
 *
 * Blocks may declare their own filter (combined with the container filter
 * via `$and` at render time) and their own grouping / aggregation.
 *
 * Notes for implementers:
 * - `type` defaults to `tabular` — leave a block's type implicit if the
 *   sub-report is just a list. Set explicitly to `summary` or `matrix` for
 *   aggregated blocks.
 * - The schema is intentionally permissive about the column shape: blocks
 *   are not allowed to be themselves `joined` (no recursion).
 */
export const JoinedReportBlockSchema: z.ZodTypeAny = lazySchema(() => strictObject({
  surface: 'this joined report block',
  history:
    'Until #4001 批 14 closed this shape these were dropped silently — the block still rendered, '
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
  },
}, {
  /** Stable id for the block (used as react key, telemetry, deeplinks). */
  name: SnakeCaseIdentifierSchema,
  /** Human label shown above the block. Falls back to `name`. */
  label: I18nLabelSchema.optional(),
  /** Optional description rendered below the label. */
  description: I18nLabelSchema.optional(),
  /** Block report type — `joined` is intentionally excluded (no recursion). */
  type: z.enum(['tabular', 'summary', 'matrix']).default('tabular'),
  /** Optional inline chart configuration. */
  chart: ReportChartSchema.optional(),

  /**
   * ADR-0021 — the dataset this block binds to (single-form). The block selects
   * the dataset's measures by name; the legacy inline `objectName` + `columns` +
   * `groupings` query was removed in the cutover.
   */
  dataset: SnakeCaseIdentifierSchema.optional().describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) to group rows by. Dataset-bound only. */
  rows: z.array(z.string()).optional().describe('Dimension names down (dataset-bound)'),
  /** Dimension names across — matrix blocks pivot rows × columns (ADR-0021 D2). */
  columns: z.array(z.string()).optional().describe('Dimension names across (matrix, dataset-bound)'),
  /** Measure names (from the dataset) to display. Dataset-bound only. */
  values: z.array(z.string()).optional().describe('Measure names to show (dataset-bound)'),
  /** Render-time scope filter, ANDed at query time. Dataset-bound only. */
  runtimeFilter: FilterConditionSchema.optional().describe('Render-time scope filter (dataset-bound)'),
  /** Result ordering for this block, most significant key first (framework#3916). */
  order: z.array(ReportSortSchema).optional().describe('Result ordering, most significant key first'),
}).superRefine(checkReportOrder));

/**
 * Report Schema
 * Deep data analysis definition.
 */
export const ReportSchema = lazySchema(() => strictObject({
  surface: 'this report',
  history:
    'Until #4001 closed this shape these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  // Kept deliberately parallel to `JoinedReportBlockSchema` above: a block is a
  // sub-report, so an author who learns one vocabulary must not be corrected
  // differently on the other. The scope-filter entries are that table's,
  // verbatim.
  //
  // #5013 — `filter` used to point at `filters`, a key `ReportSchema` does not
  // declare either, so taking the advice earned a SECOND rejection and that one
  // carried no suggestion at all. Three entries are gone with it: `columns` and
  // `chart` are both declared here (the matrix across-axis and the embedded
  // chart), so an alias filed under them could never run — an alias is consulted
  // only from the `unrecognized_keys` path — and `chartConfig` was not a key
  // either. `alias-integrity.test.ts` now proves both halves for every table in
  // the package.
  aliases: {
    dataSet: 'dataset', source: 'dataset',
    fields: 'values',
    // Scope filter. `runtimeFilter` is camelCase, so the edit-distance fallback
    // under-reaches every one of these (#4990) — same as on a block.
    filter: 'runtimeFilter',
    filters: 'runtimeFilter',
    where: 'runtimeFilter',
    criteria: 'runtimeFilter',
  },
  guidance: {
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
   * single-form cutover). For a `joined` report, the data lives on `blocks`.
   */
  dataset: SnakeCaseIdentifierSchema.optional().describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) to group rows by (down axis). */
  rows: z.array(z.string()).optional().describe('Dimension names down'),
  /**
   * Dimension names across (ADR-0021 D2) — a `matrix` report pivots
   * `rows` × `columns` with `values` in the cells. Ignored for other types.
   */
  columns: z.array(z.string()).optional().describe('Dimension names across (matrix)'),
  /** Measure names (from the dataset) to display. */
  values: z.array(z.string()).optional().describe('Measure names to show'),
  /** Render-time scope filter, ANDed at query time. */
  runtimeFilter: FilterConditionSchema.optional().describe('Render-time scope filter'),
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

  /** Visualization */
  chart: ReportChartSchema.optional().describe('Embedded chart configuration'),

  /**
   * Joined report blocks — only meaningful when `type: 'joined'`.
   *
   * A joined report renders multiple independent sub-reports stacked
   * vertically in the same view. Each block declares its own object,
   * columns, groupings and filter. The container-level `filter` is ANDed
   * into every block at query time so a top-level scope (e.g. "this
   * quarter") flows down without per-block duplication.
   *
   * Renderers must ignore `blocks` when `type !== 'joined'`.
   */
  blocks: z.array(JoinedReportBlockSchema).optional().describe('Sub-reports for type=joined'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
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
  } else if (!r.dataset || !r.values || r.values.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'a report needs `dataset` + `values` (measure names).',
      path: ['dataset'],
    });
  }
  // A `joined` report selects nothing itself — its ordering lives per block.
  if (r.type === 'joined') {
    if (r.order?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'a `joined` report orders per block — move `order` onto `blocks[]`.',
        path: ['order'],
      });
    }
  } else {
    checkReportOrder(r, ctx);
  }
}));

export type JoinedReportBlock = z.input<typeof JoinedReportBlockSchema>;

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
