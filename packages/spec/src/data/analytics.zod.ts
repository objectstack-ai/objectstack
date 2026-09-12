// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';
import { DATE_RANGE_PRESETS } from './date-range-presets';
import { DateGranularity } from './query.zod';

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
 * The three sub-day names this enum declared until protocol 18 (#17296).
 *
 * They were never a capability any backend could offer, and not because the
 * backends lag the contract — the rest of the contract never declared them:
 *
 * - `DateGranularity` (`data/query.zod.ts`), the vocabulary a `groupBy` entry
 *   and every driver's bucket expression are typed by, declares five;
 * - `@objectstack/core`'s `BUCKET_GRANULARITIES` — the canonical bucket-KEY
 *   vocabulary, an OUTPUT contract a drill-down crosses — labels the same five
 *   and has no key shape for a sub-day bucket;
 * - `DriverCapabilitiesSchema.supports.queryDateGranularity`, the mechanism a
 *   backend uses to say which granularities it buckets NATIVELY, is a
 *   `z.record(DateGranularity, boolean)`: `{ day, week, month, quarter, year }`
 *   parses and the same record plus `hour` raises `unrecognized_keys`. So a
 *   driver could not have advertised sub-day support even if it had one.
 *
 * That last point is what decides this as a RETIREMENT rather than a capability
 * gap. A declared value one backend cannot serve is a gap, and the contract
 * already has a place to say so. A declared value NO backend can even claim is
 * a declaration with no counterpart anywhere in the contract that carries it.
 *
 * Measured on the shipped faces before the narrowing: `driver-memory`'s
 * analytics face answered `NOT_IMPLEMENTED` / 501, `driver-mongodb`'s bucket
 * builder answered `NOT_IMPLEMENTED` / 501, and the engine's in-memory
 * aggregation — the fallback every SQL/ObjectQL analytics query with a
 * granularity lands on, since `NativeSQLStrategy` declines on a granularity —
 * answered 200 with one group per distinct timestamp, the raw instant echoed
 * back as its own bucket label. Two honest refusals and one silently wrong
 * answer, and no third behaviour.
 *
 * ⚠️ Retiring them does NOT retire sub-day analytics as an idea. Offering it
 * means widening `DateGranularity`, the `queryDateGranularity` record, the
 * canonical key vocabulary and every driver's bucket expression together —
 * new capability, decided as such, rather than a name that parses here and
 * resolves nowhere.
 */
export const RETIRED_SUB_DAY_INTERVALS = ['second', 'minute', 'hour'] as const;

/**
 * The refusal a value outside {@link TimeUpdateInterval} is answered with.
 *
 * Two populations, one function, because they are not the same mistake and the
 * author's next action differs — the separation `driver-memory`'s own
 * `unsupportedTimeGranularityError` draws at its own door, and the one
 * {@link analyticsDateRangeRefusalMessage} draws for this entry's sibling key:
 *
 * - a RETIRED sub-day name is a value this enum used to declare, so the
 *   prescription is the retirement — what replaced it and the migrate line;
 * - anything else was never declared, so the prescription is the vocabulary.
 */
export function timeUpdateIntervalRefusalMessage(input: unknown): string {
  const received = typeof input === 'string' ? `'${input}'` : JSON.stringify(input) ?? String(input);
  const declared = DateGranularity.options.join(', ');
  if (typeof input === 'string' && (RETIRED_SUB_DAY_INTERVALS as readonly string[]).includes(input)) {
    return (
      `Time interval ${received} was retired in protocol 18 (#17296, ADR-0049 enforce-or-remove). `
      + 'No backend ever bucketed it and none could advertise it: the canonical bucket-key '
      + 'vocabulary and `supports.queryDateGranularity` both stop at '
      + `${declared}, so the name resolved to a refusal or to one group per distinct timestamp. `
      + `Ask for the coarsest interval that still answers your question (${declared}), or drop `
      + 'the key and group on the raw timestamp deliberately. '
      + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.'
    );
  }
  return (
    `Time interval ${received} is not declared — the declared intervals are ${declared}. `
    + 'They are `DateGranularity`, the one vocabulary the drivers, the engine and the canonical '
    + 'bucket keys all share; this enum no longer carries a second, wider copy of it.'
  );
}

/**
 * Time Interval for Time Dimensions.
 *
 * **Derived from `DateGranularity`, never restated.** The two were separate
 * literal lists until #17296, and they disagreed by three members for as long
 * as both existed — the drift this file's own `granularity`/`granularities`
 * alias note warns about, one layer up. The members now come from the single
 * source; what this enum adds is the refusal text, because the value arrives
 * here from an analytics request body and an author needs the analytics
 * prescription rather than a bare enum error.
 */
export const TimeUpdateInterval = z.enum(
  DateGranularity.options,
  { error: (issue) => timeUpdateIntervalRefusalMessage(issue.input) },
);
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
    history: 'Until this shape was closed, an undeclared metric key was silently dropped — the cube '
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
        '`measures.<metric>.filters` was removed in @objectstack/spec 17 (ADR-0049) — '
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
    history: 'Until this shape was closed, an undeclared dimension key was silently dropped.',
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
    history: 'Until this shape was closed, an undeclared join key was silently dropped — a typo\'d '
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
    history: 'Until this shape was closed, an undeclared cube key was silently dropped — the cube '
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
        history: 'Until this shape was closed, an undeclared refreshKey key was silently dropped — '
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
 * The bare-string arm of `timeDimensions[].dateRange` — the dashboard
 * date-range PRESET vocabulary, closed (#16041).
 *
 * Derived from {@link DATE_RANGE_PRESETS} rather than restated: that module's
 * header records the vocabulary once existed in three drifting copies, and a
 * fourth here would be the defect it was consolidated to end. `today` is the
 * vocabulary's first member, so the ruling's "presets plus `today`" IS this
 * enum. `analytics-date-range-closed-vocabulary.test.ts` pins the options
 * equal to the module's list.
 *
 * Why closed (maintainer ruling on #16041, decision batch #57, option A —
 * contract first): the arm was a bare `z.string()` whose only documented
 * example, `"Last 7 days"`, was a value no driver could parse. An unrecognised
 * spelling reached `driver-memory` as written and fell through to a
 * `[range, range]` "window" that matched EVERY `Date`-typed row (a `Date`
 * compares above a `String` under BSON cross-type ordering, so both garbage
 * bounds were satisfied) — a dashboard asking for one week silently got all
 * of history, while the SQL side read a bare string as a single ISO day.
 * Same input, opposite wrong answers, neither an error. The protocol is the
 * baseline, so the vocabulary is declared ONCE here and the drivers align to
 * it (#16322) instead of each guessing.
 */
export const AnalyticsDateRangePresetSchema = z.enum(DATE_RANGE_PRESETS);
/** The same names as {@link DateRangePreset} — declared through the schema so the alias cannot drift from it. */
export type AnalyticsDateRangePreset = z.input<typeof AnalyticsDateRangePresetSchema>;

/**
 * The one refusal wording for a `timeDimensions[].dateRange` value outside
 * the closed contract — shared by the schema door (this file) and, through
 * the `ANALYTICS_DATE_RANGE_UNRECOGNIZED` envelope, by the runtime door and
 * the drivers (#16322), so one condition keeps one wording (the #5240
 * convention). A bare string is judged against {@link DATE_RANGE_PRESETS};
 * anything that is neither a preset name nor an array is described by type.
 */
export function analyticsDateRangeRefusalMessage(input: unknown): string {
  const window = 'an explicit window is the two-element array [start, end] of ISO dates or '
    + '{date-macro} tokens — e.g. ["2026-01-01", "2026-01-31"] or ["{7_days_ago}", "{today}"]';
  if (typeof input === 'string') {
    return (
      `${JSON.stringify(input)} is not a dateRange the platform can resolve. A bare string must `
      + `be one of the declared date-range PRESET names (${DATE_RANGE_PRESETS.join(', ')}) — the `
      + `same closed vocabulary the dashboard date filter uses, case-sensitive, snake_case; `
      + `${window}. Refused at the schema (ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400): an `
      + 'unrecognised spelling used to reach the driver as written and silently widen the window '
      + 'to every row instead of the one you named.'
    );
  }
  const received = input === null ? 'null' : Array.isArray(input) ? 'an array with a non-string bound' : typeof input;
  return (
    `dateRange must be a date-range preset name (${DATE_RANGE_PRESETS.join(', ')}) or `
    + `${window}; received ${received}. Refused at the schema (ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400).`
  );
}

/**
 * `timeDimensions[].dateRange` — a preset name from the closed vocabulary, or
 * an explicit `[start, end]` window.
 *
 * @example
 * <!-- os:check -->
 * ```ts
 * import type { AnalyticsQuery } from '@objectstack/spec/data';
 *
 * const timeDimensions: AnalyticsQuery['timeDimensions'] = [
 *   { dimension: 'created_at', granularity: 'day', dateRange: 'last_7_days' },
 *   { dimension: 'created_at', granularity: 'month', dateRange: ['2023-01-01', '2023-01-31'] },
 *   { dimension: 'created_at', dateRange: ['{30_days_ago}', '{today}'] },
 * ];
 * ```
 *
 * A value that is neither raises ONE issue at the field's own path with the
 * prescriptive wording of {@link analyticsDateRangeRefusalMessage}; the
 * runtime door recognises it through {@link isAnalyticsDateRangeRefusalIssue}
 * and answers the ADR-0112 envelope `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`
 * (registered in `api/error-code-ledger.zod.ts`).
 */
export const AnalyticsDateRangeSchema = z.union(
  [AnalyticsDateRangePresetSchema, z.array(z.string())],
  {
    // Zod 4 reports a union with no matching arm as ONE `invalid_union` issue
    // at the union's own path, so the prescription lands on
    // `timeDimensions.N.dateRange` instead of on the two arms' generic texts.
    error: (issue) => (issue.code === 'invalid_union' ? analyticsDateRangeRefusalMessage(issue.input) : undefined),
  },
);
export type AnalyticsDateRange = z.input<typeof AnalyticsDateRangeSchema>;

/**
 * Is this Zod issue the closed-vocabulary refusal of a
 * `timeDimensions[].dateRange` value? Structural — the union's own
 * `invalid_union` issue at the path this schema declares — so the door that
 * lifts it into `ANALYTICS_DATE_RANGE_UNRECOGNIZED` reads the contract rather
 * than sniffing message prose, and moves with the schema if the field ever
 * moves. Accepts any object with a Zod-issue-shaped `code` and `path` so a
 * door does not need Zod's own types to ask.
 */
export function isAnalyticsDateRangeRefusalIssue(
  issue: { code: string; path: ReadonlyArray<PropertyKey> },
): boolean {
  const p = issue.path;
  return (
    issue.code === 'invalid_union'
    && p.length >= 3
    && p[p.length - 1] === 'dateRange'
    && typeof p[p.length - 2] === 'number'
    && p[p.length - 3] === 'timeDimensions'
  );
}

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
    history: 'Until this shape was closed, an undeclared key here was silently dropped at every door '
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
        + 'either: fold the condition into the metric\'s own `sql` expression, or use '
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
  where: FilterConditionSchema.optional().describe(
    'Filtering criteria (canonical Query DSL FilterCondition). An authored `FilterArray` is '
    + 'lowered by `parseFilterAST` on the client before the wire; this field admits only the '
    + 'lowered `FilterCondition` (see `FilterArray` in `data/filter.zod.ts`).'
  ),

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
      history: 'Until this shape was closed, an undeclared key here was silently stripped even at the '
        + 'strict `/analytics/query` door — top-level strictness does not recurse.',
      // The plural is the cube DIMENSION's declaration key; a query's time
      // dimension takes exactly one `granularity`.
      aliases: { granularities: 'granularity' },
    },
    {
      dimension: z.string(),
      granularity: TimeUpdateInterval.optional(),
      // The string arm is the closed preset vocabulary (`'last_7_days'`, never
      // the display spelling `"Last 7 days"` this comment used to show — a
      // value no driver could parse, #16041); the array arm is an explicit
      // `["2023-01-01", "2023-01-31"]` window. See {@link AnalyticsDateRangeSchema}.
      dateRange: AnalyticsDateRangeSchema.optional().describe(
        // The vocabulary is spelled by the module, never restated here — the
        // generated reference page is one of the three copies #4614 retired.
        'Time window for this dimension: a date-range PRESET name from the closed vocabulary in '
        + `\`data/date-range-presets.ts\` (${DATE_RANGE_PRESETS.join(', ')} — e.g. \`'last_7_days'\`), `
        + 'or an explicit `[start, end]` array of ISO dates / {date-macro} tokens (e.g. '
        + '`["2023-01-01", "2023-01-31"]`). Any other string is refused at the schema with '
        + '`400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`.'
      ),
    },
  )).optional().describe(
    'Time-bucketed dimensions. Each entry names a dimension, an optional bucket `granularity`, '
    + 'and an optional `dateRange` — a preset name from the closed date-range vocabulary '
    + '(e.g. `\'last_7_days\'`) or an explicit `[start, end]` window; an unrecognised '
    + 'string answers `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` instead of silently widening.'
  ),

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

