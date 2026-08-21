// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';

/**
 * Analytics/Semantic Layer Protocol
 * 
 * Defines the "Business Logic" for data analysis.
 * Inspired by Cube.dev, LookML, and dbt MetricFlow.
 * 
 * This layer decouples the "Physical Data" (Tables/Columns) from the 
 * "Business Data" (Metrics/Dimensions).
 */

/**
 * Aggregation Metric Type
 * The mathematical operation to perform on a metric.
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
export const AggregationMetricType = z.enum([
  'count', 
  'sum', 
  'avg', 
  'min', 
  'max', 
  'count_distinct', 
  'number', // Custom SQL expression returning a number
  'string', // Custom SQL expression returning a string
  'boolean' // Custom SQL expression returning a boolean
]);
export type AggregationMetricType = z.input<typeof AggregationMetricType>;

/**
 * Dimension Type
 * The nature of the grouping field.
 */
export const DimensionType = z.enum([
  'string', 
  'number', 
  'boolean', 
  'time', 
  'geo'
]);
export type DimensionType = z.input<typeof DimensionType>;

/**
 * Time Interval for Time Dimensions
 */
export const TimeUpdateInterval = z.enum([
  'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'
]);
export type TimeUpdateInterval = z.input<typeof TimeUpdateInterval>;

/**
 * Metric Schema
 * A quantitative measurement (e.g., "Total Revenue", "Average Order Value").
 *
 * Strict as of #4001 batch D: the cube family is a real authoring surface —
 * `defineCube()` parses an author literal and `defineStack({ analyticsCubes })`
 * carries every cube through `StackSchema.parse` (BFS from the 26 metadata-type
 * roots + `ObjectStackSchema` resolves the whole family reachable, with
 * `ObjectSchema` as positive control and a fresh uncarried shape as negative
 * control in the same run).
 */
export const MetricSchema = lazySchema(() => strictObject(
  {
    surface: 'this metric',
    history: 'Until #4001 batch D an undeclared metric key was silently dropped — the cube '
      + 'registered and the metric computed as if the key had never been written.',
    // `title` is CORRECT one level up (`CubeSchema.title`); a metric spells it `label`.
    aliases: { title: 'label' },
    guidance: {
      // REMOVED (#10414, ADR-0049 enforce-or-remove): `filters` was a declared
      // per-metric raw-SQL filter (`filters: [{ sql }]`) with ZERO consumers —
      // both SQL strategies aggregate `sql` and never read it, so a
      // hand-authored condition parsed, registered, and silently returned the
      // UNFILTERED aggregate under the author's metric name (the #10298 shape,
      // one level up). What actually filters: the query's `where`, the
      // condition folded into the metric's own `sql` expression, or an
      // ADR-0021 dataset measure's structured `filter` (#10411). The nested
      // `strictObject` the key carried (closed by #4001 batch D) is gone with
      // it — strictness on a shape nothing reads was fake compliance either way.
      filters:
        '`measures.<metric>.filters` was removed in @objectstack/spec 17 (#10414, ADR-0049) — '
        + 'it never had an effect: no strategy read it (NativeSQLStrategy and ObjectQLStrategy '
        + 'both aggregate the metric\'s `sql` and ignore `filters`), so an authored '
        + '`filters: [{ sql: … }]` parsed clean and the query returned the UNFILTERED aggregate. '
        + 'Delete the key. To filter what a metric measures: filter at query time with `where` '
        + '(canonical Query DSL FilterCondition), fold the condition into the metric\'s own `sql` '
        + 'expression, or use an ADR-0021 dataset measure\'s structured `filter`. '
        + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
    },
  },
  {
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique metric ID'),
    label: z.string().describe('Human readable label'),
    description: z.string().optional(),

    type: AggregationMetricType,

    /** Source Calculation */
    sql: z.string().describe('SQL expression or field reference'),

    // `filters` was REMOVED here (#10414) — see the `guidance` entry above for
    // the full story and the replacement channels. The raw-SQL fragment shape
    // (`[{ sql: string }]`) also ran against the platform's structured
    // `FilterCondition` direction: a raw fragment cannot be parameterized,
    // re-targeted per driver dialect, or walked by the lint rules
    // (`packages/lint/src/filter-walk.ts` deliberately never enumerated it).

    /** Format for display (e.g. "currency", "percent") */
    format: z.string().optional(),
  },
));

/**
 * Dimension Schema
 * A categorical attribute to group by (e.g., "Product Category", "Order Date").
 *
 * Strict as of #4001 batch D — same doors as {@link MetricSchema}.
 */
export const DimensionSchema = lazySchema(() => strictObject(
  {
    surface: 'this dimension',
    history: 'Until #4001 batch D an undeclared dimension key was silently dropped.',
    aliases: {
      // `title` is CORRECT one level up (`CubeSchema.title`); a dimension spells it `label`.
      title: 'label',
      // The singular names ONE granularity; this key declares the SUPPORTED list.
      granularity: 'granularities',
    },
  },
  {
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique dimension ID'),
    label: z.string().describe('Human readable label'),
    description: z.string().optional(),

    type: DimensionType,

    /** Source Column */
    sql: z.string().describe('SQL expression or column reference'),

    /** For Time Dimensions: Supported Granularities */
    granularities: z.array(TimeUpdateInterval).optional(),
  },
));

/**
 * Join Schema
 * Defines how this cube relates to others.
 *
 * Strict as of #4001 batch D — same doors as {@link MetricSchema}. Before the
 * close, a join authored with `relationshipp:` (or any near-miss) parsed clean
 * and fell back to the `many_to_one` default — a different join shape than the
 * author declared, under a successful parse.
 */
export const CubeJoinSchema = lazySchema(() => strictObject(
  {
    surface: 'this cube join',
    history: 'Until #4001 batch D an undeclared join key was silently dropped — a typo\'d '
      + '`relationship` fell back to the `many_to_one` default.',
    // The join condition is spelled `sql` here (its doc says "ON clause").
    aliases: { on: 'sql' },
  },
  {
    name: z.string().describe('Target cube name'),
    relationship: z.enum(['one_to_one', 'one_to_many', 'many_to_one']).default('many_to_one'),
    sql: z.string().describe('Join condition (ON clause)'),
  },
));

/**
 * Cube Schema
 * A logical data model representing a business entity or process for analysis.
 * Maps physical tables to business metrics and dimensions.
 *
 * Strict as of #4001 batch D. Doors, measured: `defineCube()` (the factory the
 * showcase example authors through) and `defineStack({ analyticsCubes })` /
 * artifact ingest, both of which parse `StackSchema` → `analyticsCubes[]`.
 *
 * [#10194] This docblock used to say the ADR-0010 protection envelope is
 * deliberately NOT declared here, on the premise that `analytics_cube`
 * resolves no `getMetadataTypeSchema` entry (so `saveMetaItem` never 422s
 * it). #10194 retired that premise: `analytics_cube` is now bound in
 * `UNREGISTERED_KIND_SCHEMAS`, so `PUT /meta/analytics_cube/:name` parses a
 * body through THIS schema — and the `getMetaItemLayered` → `saveMetaItem`
 * round-trip carries the `applyProtection` stamp. The shape is `.strict()`,
 * so without the envelope spread below the new 422 would fire at the
 * runtime's own stamp instead of at malformed author input. The other two
 * observations stand: `CubeRegistry.register` takes typed objects without a
 * parse, and artifact ingest parses the compiled definition BEFORE
 * `applyProtection` stamps `_packageId`/`_provenance` at registration.
 */
export const CubeSchema = lazySchema(() => strictObject(
  {
    surface: 'this cube',
    history: 'Until #4001 batch D an undeclared cube key was silently dropped — the cube '
      + 'registered without it and the analytics service served whatever remained.',
    aliases: {
      // `label` is the metric/dimension spelling; the cube itself uses `title`.
      label: 'title',
      // `sql` doubles as the base table name ("Base SQL statement or Table Name").
      table: 'sql',
      sqlTable: 'sql',
    },
  },
  {
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Cube name (snake_case)'),
    title: z.string().optional(),
    description: z.string().optional(),

    /** Physical Data Source */
    sql: z.string().describe('Base SQL statement or Table Name'),

    /** Semantic Definitions */
    measures: z.record(z.string(), MetricSchema).describe('Quantitative metrics'),
    dimensions: z.record(z.string(), DimensionSchema).describe('Qualitative attributes'),

    /** Relationships */
    joins: z.record(z.string(), CubeJoinSchema).optional(),

    /** Pre-aggregations / Caching */
    refreshKey: strictObject(
      {
        surface: 'this cube refreshKey block',
        history: 'Until #4001 batch D an undeclared refreshKey key was silently dropped — '
          + 'a typo\'d `sql` probe left the cube refreshing on nothing.',
      },
      {
        every: z.string().optional().describe('Refresh interval (e.g. "1 hour")'),
        sql: z.string().optional().describe('SQL to check for data changes'),
      },
    ).optional(),

    /** Access Control */
    public: z.boolean().default(false),

    // ADR-0010 — runtime protection envelope (internal — set by loader).
    // [#10194] See the docblock above for why this spread became load-bearing
    // the day the `/meta` write door started parsing bodies with this schema.
    ...MetadataProtectionFields,
  },
));

/**
 * Analytics Query Schema
 * The request format for the Analytics API.
 *
 * Strict as of #4001 batch D. The TOP level was already gated at the one
 * production door — `api/analytics.zod.ts`'s `AnalyticsQueryRequestSchema` is
 * `.extend(…).strict()` since #3878, so an undeclared top-level key answered
 * 400 at `/analytics/query` before this change. What was NOT gated is the
 * level this file owns: closing the base makes the posture hold at every
 * door (a future bare `AnalyticsQuerySchema.parse` included) instead of only
 * at the wrapper that happened to re-apply it, and the nested
 * `timeDimensions[]` item below carries the real behaviour change.
 */
export const AnalyticsQuerySchema = lazySchema(() => strictObject(
  {
    surface: 'this analytics query',
    history: 'Until #4001 batch D an undeclared key here was silently dropped at every door '
      + 'except the strict `/analytics/query` wrapper.',
    // The sibling record dialect (`data/query.zod.ts` `BaseQuerySchema`) spells
    // sorting `orderBy`; the analytics dialect spells it `order`.
    aliases: { orderBy: 'order' },
    guidance: {
      // The second sentence used to point at the cube metric's own `filters` —
      // a key #10414 removed (never suggest a key the schema cannot accept;
      // the `triggerPhrase` lesson in strict-object.ts).
      filters: '`filters` is not an AnalyticsQuery field — use `where` (canonical Query DSL '
        + 'FilterCondition, the same shape find() takes). There is no per-metric filter key '
        + 'either (#10414): fold the condition into the metric\'s own `sql` expression, or use '
        + 'an ADR-0021 dataset measure\'s structured `filter`.',
    },
    // No `extraKeys`: the one extension (`AnalyticsQueryRequestSchema`) adds
    // only the #3878 `retiredKey` tombstones, and a tombstone must never be
    // suggested (the `triggerPhrase` lesson in strict-object.ts).
  },
  {
  cube: z.string().optional().describe('Target cube name (optional when provided externally, e.g. in API request wrapper)'),
  measures: z.array(z.string()).describe('List of metrics to calculate'),
  dimensions: z.array(z.string()).optional().describe('List of dimensions to group by'),

  /**
   * WHERE clause — canonical filter shape per the unified Query DSL
   * (see {@link FilterConditionSchema} in `data/filter.zod.ts` and
   * {@link QuerySchema} in `data/query.zod.ts`). This is the same
   * MongoDB-style filter used by `find()`, dashboard widget `filter`,
   * RLS conditions, etc.
   *
   * @example
   * ```ts
   * { where: { is_active: true, stage: { $nin: ['lost'] } } }
   * ```
   */
  where: FilterConditionSchema.optional().describe('Filtering criteria (canonical Query DSL FilterCondition)'),

  /**
   * Time-bucketed dimensions. Strict as of #4001 batch D — and this item is
   * the batch's live behaviour change at the REST door: the `.strict()` on
   * `AnalyticsQueryRequestSchema` guards only the TOP level, so before this
   * close `{ dimension, granuarity: 'day' }` rode through the strict wrapper
   * with the typo'd granularity silently stripped — the query bucketed the
   * whole range as one group under an ordinary 200 (measured on `main`).
   */
  timeDimensions: z.array(strictObject(
    {
      surface: 'this time dimension',
      history: 'Until #4001 batch D an undeclared key here was silently stripped even at the '
        + 'strict `/analytics/query` door — top-level strictness does not recurse.',
      // The plural is the cube DIMENSION's declaration key; a query's time
      // dimension takes exactly one `granularity`.
      aliases: { granularities: 'granularity' },
    },
    {
      dimension: z.string(),
      granularity: TimeUpdateInterval.optional(),
      dateRange: z.union([
        z.string(), // "Last 7 days"
        z.array(z.string()) // ["2023-01-01", "2023-01-31"]
      ]).optional(),
    },
  )).optional(),

  order: z.record(z.string(), z.enum(['asc', 'desc'])).optional(),

  limit: z.number().optional(),
  offset: z.number().optional(),

  /**
   * Reference timezone (IANA name) for date bucketing. OPTIONAL WITH NO
   * DEFAULT, deliberately (#4538): an ABSENT timezone is a meaningful state —
   * the engine resolves it (`selection.timezone ?? context.timezone ?? 'UTC'`,
   * ADR-0053 Phase 2), and the `/analytics` entry forwards bodies
   * validation-only precisely so a schema default cannot silently override
   * the org-timezone resolution chain (#1982/#2018). The `.default('UTC')`
   * this field used to carry declared a boundary the runtime refused to
   * enforce.
   */
  timezone: z.string().optional(),
  },
));

export type Metric = z.input<typeof MetricSchema>;
export type Dimension = z.input<typeof DimensionSchema>;
export type CubeJoin = z.input<typeof CubeJoinSchema>;
/** Post-parse shape of {@link CubeJoin} — defaults applied, transforms run (ADR-0122). */
export type CubeJoinParsed = z.infer<typeof CubeJoinSchema>;
export type Cube = z.input<typeof CubeSchema>;
/** Post-parse shape of {@link Cube} — defaults applied, transforms run (ADR-0122). */
export type CubeParsed = z.infer<typeof CubeSchema>;

/**
 * Type-safe factory for an analytics semantic-layer cube. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Cube` literal.
 */
export function defineCube(config: z.input<typeof CubeSchema>): CubeParsed {
  return CubeSchema.parse(config);
}
export type AnalyticsQuery = z.input<typeof AnalyticsQuerySchema>;

