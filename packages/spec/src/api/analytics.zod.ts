// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { AnalyticsQuerySchema } from '../data/analytics.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { AggregationFunction, DateGranularity } from '../data/query.zod';
import { strictObject } from '../shared/strict-object';
import { BaseResponseSchema } from './contract.zod';
import { retiredKey } from '../shared/retired-key';

/**
 * Analytics API Protocol
 * 
 * Defines the HTTP interface for the Semantic Layer.
 * Provides endpoints for executing analytical queries and discovering metadata.
 */

// ==========================================
// 1. API Endpoints
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const AnalyticsEndpoint = z.enum([
  '/api/v1/analytics/query', // Execute analysis
  '/api/v1/analytics/meta',  // Discover cubes/metrics
  '/api/v1/analytics/sql',   // Dry-run SQL generation
]);

// ==========================================
// 2. Query Execution
// ==========================================

/**
 * Query Request Body — the BARE `AnalyticsQuery` shape (#3878).
 *
 * The body IS the `AnalyticsQuery`: `cube` + `measures` at the top level with
 * the optional `dimensions` / `where` / `timeDimensions` / `order` / `limit` /
 * `offset` / `timezone` fields beside them. This is what
 * `AnalyticsService.query` (the domain's one implementation,
 * `@objectstack/service-analytics`) consumes and what every real caller
 * (objectui dashboards, `client.analytics.query`) sends.
 *
 * History: this schema used to describe a `{ cube, query: {...}, format }`
 * ENVELOPE — the dialect of the retired degraded shim (#3891), which the real
 * engine never understood (an envelope body inferred a column-less cube and
 * died as an SQL syntax error instead of a shape error). The envelope is
 * rejected now — `.strict()` — and the dispatcher's `/analytics` entry answers
 * 400 with a migration hint. The unimplemented `format` field went with it
 * (declared ≠ enforced: every response is the JSON envelope).
 */
export const AnalyticsQueryRequestSchema = lazySchema(() =>
  AnalyticsQuerySchema.extend({
    cube: z.string().describe('Target cube name'),
    query: retiredKey(
      '`query` was removed from AnalyticsQueryRequest in @objectstack/spec 17.0.0. ' +
      'The { cube, query: {...} } envelope was the dialect of the retired degraded analytics shim — ' +
      'the real engine never understood it. Move the query.* fields to the body top level: ' +
      '{ cube, measures, dimensions?, where?, timeDimensions?, order?, limit?, offset?, timezone? }.',
    ),
    format: retiredKey(
      '`format` was removed from AnalyticsQueryRequest in @objectstack/spec 17.0.0. ' +
      'It was never implemented — every response is the JSON envelope. Delete the key; ' +
      'for CSV/XLSX use the export surface instead.',
    ),
  }).strict()
);

/**
 * Query Response (JSON)
 *
 * `data` IS the producer's declared return: `POST /analytics/query` ends
 * `deps.success(await analyticsService.query(body, ctx))`
 * (`runtime/src/domains/analytics.ts`), so the body under `data` is
 * `IAnalyticsService.query`'s `AnalyticsResult`
 * (`contracts/analytics-service.ts`) — member for member. #13078 restored the
 * parity: this schema used to declare only `rows` / `fields{name,type}` /
 * `sql?`, a strict subset of what the route relays, while the wire really
 * carries `fields[].label` (measured against a real `AnalyticsService` in
 * `packages/client/src/analytics-automation-json-erasure.test.ts`),
 * `format` / `currency` / `percentScale` (the ADR-0053 / percent-scale
 * renderer chains) and `totals` (the ADR-0021 marginal-aggregate channel).
 *
 * The reasoning is #6442's, recorded on `AnalyticsMetadataResponseSchema`
 * below: when the TS contract and the runtime already agree, the schema is
 * the lone outlier and the SCHEMA moves. A response schema that reads as the
 * route's contract but is narrower than it refuses reads the wire carries —
 * a consumer that bound it (exactly what a sweep reaches for, #12104) would
 * ship a false declaration. Zero runtime change: only the declaration moves.
 *
 * Drift guard: `analytics.test.ts` binds `AnalyticsResultResponse['data']` to
 * `AnalyticsResult` at compile time — narrow either side alone and it goes
 * red. Keep new `AnalyticsResult` members mirrored here (and vice versa).
 */
export const AnalyticsResultResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe('Result rows'),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string().describe(
        'Column data type, in the `DimensionType` vocabulary (`string` / `number` / '
        + '`boolean` / `time` / `geo`). A dimension column carries its cube dimension\'s '
        + 'type; a measure column is `number` except for `min`/`max` over a '
        + '`date`/`datetime`/`time` field, which is `time` — those aggregates return a '
        + 'value of the aggregated field\'s own type. `count`/`count_distinct`, '
        + '`sum`/`avg` and derived measures stay numeric.',
      ),
      label: z.string().optional()
        .describe('Human display label (e.g. measure `label`) — for legends/KPIs.'),
      format: z.string().optional()
        .describe('Display format hint (e.g. measure `format` like "$0,0", "0.0%").'),
      currency: z.string().optional().describe(
        'Resolved ISO 4217 code for a MONETARY measure (explicit measure '
        + '`currency`, then source-field default, then tenant default). Absent on '
        + 'non-monetary columns, which must never render a symbol.',
      ),
      percentScale: z.enum(['fraction', 'whole']).optional().describe(
        'The column\'s percent SCALE, when it is a percentage: `fraction` for a '
        + '0-1 ratio (`1` renders as "100%"), `whole` for percentage points (`1` '
        + 'renders as "1%"). Resolved from metadata; absent when the column is '
        + 'not a percentage. Renderers that receive it must scale by it instead '
        + 'of guessing from the value.',
      ),
      builtinAggregate: AggregationFunction.optional().describe(
        'Closed aggregate discriminator for a measure column whose display name '
        + 'is the server\'s built-in default: the dataset measure declared an '
        + '`aggregate` and no `label`. A renderer may substitute its own localized '
        + 'name for the aggregate. Absent whenever the author declared a label, and '
        + 'on dimension / derived columns.',
      ),
    })).describe('Column metadata'),
    sql: z.string().optional().describe('Executed SQL (if debug enabled)'),
    totals: z.array(z.object({
      dimensions: z.array(z.string())
        .describe('The dimension subset this marginal was grouped by (empty array = grand total)'),
      rows: z.array(z.record(z.string(), z.unknown()))
        .describe('The grouping\'s dimension columns plus the same measure columns as the main rows'),
    })).optional().describe(
      'Marginal aggregates - one entry per requested totals grouping, in '
      + 'request order, each computed with the measure\'s true aggregate over '
      + 'the underlying data (never re-derived from bucketed values). The '
      + 'grand-total grouping yields a single dimensionless row.',
    ),
  }),
}));

// ==========================================
// 3. Metadata Discovery
// ==========================================

/**
 * Meta Request
 */
export const GetAnalyticsMetaRequestSchema = lazySchema(() => z.object({
  cube: z.string().optional().describe('Optional cube name to filter'),
}));

/**
 * A measure or dimension as `GET /analytics/meta` publishes it — the discovery
 * projection, not the authoring definition.
 *
 * `name` is CUBE-QUALIFIED (`"<cube>.<key>"`), which is the form
 * `/analytics/query` expects back in `measures[]` / `dimensions[]`; the
 * unqualified key it was defined under is not published. `title` carries the
 * definition's `label`, so it is the display name a dashboard renders.
 *
 * Deliberately narrower than the authoring definitions (`MetricSchema` /
 * `DimensionSchema` in `data/analytics.zod.ts`): `sql`, `description`,
 * `granularities` and `format` are dropped by the projection and are NOT
 * reachable through this endpoint (#6442). (`filters` used to head this list;
 * #10414 removed it from the authoring definition itself.)
 *
 * Module-local, and NOT exported as its own named schema: `CubeMeta` in
 * `contracts/analytics-service.ts` is already THE name for this shape, so a
 * second exported name would be the permanent synonym ADR-0122 D3 forbids AND a
 * new dual-source export. `analytics.test.ts` binds the two at compile time.
 */
const cubeMetaMemberShape = () => z.object({
  name: z.string().describe('Cube-qualified member name, `"<cube>.<key>"` — the spelling `/analytics/query` accepts'),
  type: z.string().describe(
    'Aggregation type for a measure (`AggregationMetricType`) or data type for a '
    + 'dimension (`DimensionType`). Declared as a string rather than either enum '
    + 'because the projection copies the value through verbatim and this one '
    + 'shape serves both member kinds.',
  ),
  title: z.string().optional().describe('Display label, projected from the definition\'s `label`'),
});

/**
 * Meta Response
 *
 * Describes the body `GET /api/v1/analytics/meta` actually returns: `data` is a
 * BARE ARRAY of the `CubeMeta` discovery projection — not `{ cubes: Cube[] }`
 * (#6442, ruled by the maintainer 2026-08-08 as "narrow the declaration").
 *
 * The previous declaration described a shape the endpoint has never served, in
 * either implementation: `AnalyticsService.getMeta`
 * (`service-analytics/src/analytics-service.ts`) and its `driver-memory` twin
 * (`memory-analytics.ts`) both answer `Promise< CubeMeta[] >`, and
 * `runtime/src/domains/analytics.ts` hands that array to `success()` verbatim,
 * so it lands directly under `data`. A client written against the old
 * declaration read `data.cubes` and got `undefined`; a client that validated a
 * live response against this schema failed outright. `packages/spec` stated
 * both shapes itself — the TS contract
 * (`contracts/analytics-service.ts`, `getMeta(): Promise< CubeMeta[] >`) already
 * agreed with the runtime, and this schema was the lone outlier.
 *
 * Zero runtime change: the wire body is untouched, only its declaration moves.
 *
 * **Return path if more keys are ever needed** (recorded with the ruling): add
 * the key to the projection above — additive and backwards compatible. ⛔ Do NOT
 * widen this endpoint back to full `CubeSchema` definitions: that would publish
 * each cube's `sql` to every client, a capability expansion with no measured
 * consumer pulling it.
 */
export const AnalyticsMetadataResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.object({
    name: z.string().describe('Cube name'),
    title: z.string().optional().describe('Human-readable cube title'),
    measures: z.array(cubeMetaMemberShape()).describe('Measures this cube accepts in `/analytics/query`'),
    dimensions: z.array(cubeMetaMemberShape()).describe('Dimensions this cube accepts in `/analytics/query`'),
  })).describe(
    'Available cubes, each as the `CubeMeta` discovery projection — the cube name, '
    + 'its title, and the measures/dimensions a client may name in a query. A bare '
    + 'array: there is no `cubes` wrapper object, and no cube `sql` is published.',
  ),
}));

// ==========================================
// 4. SQL Dry-Run
// ==========================================

export const AnalyticsSqlResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    sql: z.string(),
    params: z.array(z.unknown()),
  }),
}));

// ==========================================
// 5. Dataset Selection (ADR-0021)
// ==========================================

/**
 * [#17551] The refusal sentence for a `compareTo.kind` outside the closed pair
 * — ONE wording for ONE condition, shared by the two doors that can raise it.
 *
 * The condition is reachable from two places and they must not disagree
 * (the #5240 convention; `analyticsDateRangeRefusalMessage` in
 * `data/analytics.zod.ts` is the same builder for the date-range vocabulary,
 * and this one is written to its shape deliberately):
 *
 * - **`'schema'`** — {@link DatasetCompareToSchema} refused the value at parse
 *   time. Every `POST /analytics/dataset/query` body passes through it.
 * - **`'runtime'`** — a reader PAST that door refused it: `shiftRange`
 *   (`service-analytics/src/dataset-executor.ts`), reached in-process by a
 *   caller that never posted a body at all.
 *
 * ⛔ There is no default `origin`. A defaulted one makes the same false
 * assertion, silently, for every caller who does not think about it: an author
 * refused past the door would be sent to inspect a parse that never ran.
 *
 * @param input - the refused value, exactly as it arrived.
 * @param origin - `'schema'` when {@link DatasetCompareToSchema} refused it at
 *   parse time, `'runtime'` when a reader past that door did.
 */
export function datasetCompareKindRefusalMessage(
  input: unknown,
  origin: 'schema' | 'runtime',
): string {
  const refusedAt = origin === 'schema'
    ? 'Refused at the schema (VALIDATION_FAILED / 400)'
    : 'Refused past the schema door, by the analytics executor that received it (DATASET_INVALID / 400)';
  return (
    `compareTo.kind ${JSON.stringify(input)} is not a comparison window this platform implements. `
    + "The two it runs are 'previousPeriod' (the equal-length window ending the day before this one "
    + "starts) and 'previousYear' (the same window one calendar year back). Name one of those, or "
    + `drop compareTo. ${refusedAt}: an unrecognised spelling used to reach the executor and answer `
    + 'with a previous-period comparison under an ordinary 200, which no status, header or field in '
    + 'the response distinguished from the comparison the caller asked for.'
  );
}

// The `{ offset }` arm authors carry from before #5011. It was never a member
// of this contract: the dashboard widget declared it, `DatasetWidget` forwarded
// it verbatim into a shape with no `offset` in it, and the executor threw
// `compareTo requires a timeDimension "undefined"` — which took the whole
// widget down. `//` rather than a doc comment deliberately (the `COMPARE_TO_*`
// convention in `ui/dashboard.zod.ts`): build-docs lifts JSDoc onto the
// reference page, and an upgrade note is not a doc for a shape that exists.
const COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED =
  '`compareTo.offset` is not a member of this contract and never was — the analytics executor has '
  + 'no `offset` concept, so a body carrying one reached it and threw. Write the kind instead: '
  + "`compareTo: { kind: 'previousPeriod' }` for the equal-length window immediately before, "
  + "`compareTo: { kind: 'previousYear' }` for the same window a calendar year back — "
  + "`{ offset: '1y' }` is exactly `previousYear`. For any other duration (`'7d'`, `'1M'`, …) there "
  + 'is no faithful one-key rewrite: state the window you want on the `timeDimensions[]` entry this '
  + 'comparison anchors on, and compare it with `previousPeriod`, which shifts by whatever length '
  + 'that window resolves to.';

// The bare-string form the pre-#5011 dashboard documented. It is not a key, so
// `guidance` cannot reach it: it arrives as `invalid_type` (a string where an
// object is declared), which is what `retiredForms` answers.
const COMPARE_TO_STRING_ON_THE_WIRE_RETIRED = (kind: 'previousPeriod' | 'previousYear') =>
  `\`compareTo: '${kind}'\` (the bare string form) is not a member of this contract — the `
  + 'comparison directive is an object. Write `compareTo: { kind: '
  + `'${kind}' }\` instead: same comparison, spelled the way the analytics executor reads it. Add `
  + '`dimension` only when the selection has more than one dated time dimension; with one, the '
  + 'executor resolves it.';

/**
 * `DatasetSelection.compareTo` — the period-over-period directive the ADR-0021
 * dataset executor implements, as a closed wire shape.
 *
 * ## Why this is a TRANSCRIPTION and not a new contract (#17551)
 *
 * `DatasetCompareTo` has been a published TypeScript interface since #5011
 * (`contracts/analytics-service.ts`) and `dashboard.widgets[].compareTo`
 * already declares the same two members as a `strictObject` — the widget's
 * copy being, in its own words, 「a thin projection of
 * `DatasetSelection.compareTo`」. What had no declaration was the WIRE: the
 * dataset route forwarded `compareTo` to the executor unparsed, so the
 * authoring path was doored and the HTTP path was not. This schema is the
 * already-published text made executable; it adds no member and no accepted
 * value.
 *
 * ⚠️ It is NOT the widget's schema re-used. The two carry different
 * prescriptions because they are read by authors at different moments — the
 * widget's point at neighbouring WIDGET keys (`options.dateGranularity`, the
 * widget's own `filter`), which do not exist on a wire selection. What they
 * share is the vocabulary, and that is shared by construction: `kind`'s refusal
 * sentence is {@link datasetCompareKindRefusalMessage}, the one builder the
 * executor also raises.
 */
export const DatasetCompareToSchema = lazySchema(() => strictObject(
  {
    surface: 'this compareTo directive',
    history: 'Until this shape was closed, an undeclared key here rode the wire into the dataset '
      + 'executor, which read the two members it knows and ignored the rest.',
    // The same near-misses `dashboard.widgets[].compareTo` curated in #5042 and
    // #5011, minus the two that name widget-only slots: an author reaching for
    // a word on the widget reaches for it here too, and the wire is where an
    // AI-written body arrives.
    aliases: {
      type: 'kind',
      mode: 'kind',
      field: 'dimension',
      dateField: 'dimension',
      timeDimension: 'dimension',
    },
    guidance: {
      // The retired `{ offset }` arm (#5011) and the words measured beside it.
      // The executor never had an `offset` concept, so this is not a rename.
      offset: COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED,
      period: COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED,
      duration: COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED,
      interval: COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED,
      shift: COMPARE_TO_OFFSET_ON_THE_WIRE_RETIRED,
      granularity: 'a comparison window carries no granularity — it shifts a window, it does not '
        + 'bucket one. Bucketing is `dateGranularity` on the selection itself (or a '
        + "`timeDimensions[]` entry's own `granularity`), and the comparison pass reuses whatever "
        + 'the primary pass resolved.',
      dateRange: '`compareTo` shifts a window it does not declare — put the window on the '
        + '`timeDimensions[]` entry this comparison anchors on (`{ dimension, dateRange }`) and '
        + 'name that dimension here, or omit `dimension` and let the executor resolve it.',
    },
    retiredForms: {
      previousPeriod: COMPARE_TO_STRING_ON_THE_WIRE_RETIRED('previousPeriod'),
      previousYear: COMPARE_TO_STRING_ON_THE_WIRE_RETIRED('previousYear'),
    },
  },
  {
    /**
     * Which comparison window to run.
     *
     * `previousPeriod` = the equal-length window immediately before the
     * resolved one; `previousYear` = the same window one calendar year back.
     * Those are the two the executor implements, and the refusal for anything
     * else is the shared sentence, not zod's bare option list — an
     * unrecognised spelling used to come back as a previous-period comparison
     * under a 200.
     */
    kind: z.enum(['previousPeriod', 'previousYear'], {
      error: (issue) => datasetCompareKindRefusalMessage(issue.input, 'schema'),
    }).describe(
      'Comparison window: previousPeriod (equal-length, immediately before) or previousYear '
      + '(the same window one calendar year back)',
    ),
    /**
     * The time dimension (by name) whose `dateRange` is shifted.
     *
     * OPTIONAL, and resolved BY THE EXECUTOR when omitted — exactly one dated
     * candidate is shifted; zero or several is a loud error naming what it
     * found. That rule lives at the producer of the comparison (PD #12), so
     * every caller gets the same answer or the same error; ⛔ a consumer must
     * never paper over it by guessing a dimension.
     */
    dimension: z.string().optional().describe(
      'Time dimension to shift; omit when the selection has exactly one dated time dimension',
    ),
  },
));

/**
 * `DatasetSelection.totals` — the ADR-0021 marginal-aggregate request.
 *
 * Each grouping is a subset of `dimensions` to additionally aggregate by, and
 * `[]` requests the grand total. The selection is re-run grouped only by those
 * dimensions, so every total is the measure's TRUE aggregate over the
 * underlying rows — the ADR-0021 governance line that forbids client-side
 * re-aggregation.
 */
export const DatasetTotalsSchema = lazySchema(() => strictObject(
  {
    surface: 'this totals request',
    history: 'Until this shape was closed, an undeclared key here rode the wire into the dataset '
      + 'executor, which reads `groupings` and nothing else.',
    aliases: {
      grouping: 'groupings',
      groupBy: 'groupings',
      subtotals: 'groupings',
    },
    guidance: {
      // The RESPONSE spells the same idea `dimensions` (`AnalyticsResult.totals[].dimensions`),
      // so reaching for it on the REQUEST is a cross-direction near-miss, not a typo.
      dimensions: '`dimensions` is how a total is reported back '
        + '(`AnalyticsResult.totals[].dimensions`), not how it is requested. Ask for it as '
        + '`totals: { groupings: [[...dimension names], []] }` — one entry per marginal, `[]` for '
        + 'the grand total.',
      grandTotal: 'the grand total is the EMPTY grouping, not a flag: '
        + '`totals: { groupings: [[]] }`.',
    },
  },
  {
    /**
     * One entry per marginal, in request order; the results arrive on
     * `AnalyticsResult.totals` in that same order. `[]` is the grand total, so
     * a matrix report asks for `{ groupings: [rowDims, columnDims, []] }`.
     *
     * `order` / `limit` / `offset` do not apply to totals queries — a total
     * always covers the full selection.
     */
    groupings: z.array(z.array(z.string())).describe(
      'Dimension subsets to additionally aggregate by, in request order; the empty subset is the '
      + 'grand total',
    ),
  },
));

/**
 * `DatasetSelection` — a presentation's selection against a dataset (ADR-0021),
 * and the body `POST /api/v1/analytics/dataset/query` posts under `selection`.
 *
 * Report/dashboard widgets bind to a dataset and pick dimensions/measures BY
 * NAME; this is the wire shape that request carries.
 *
 * ## Why this schema exists, and why it is a NARROWING onto published text
 *
 * [#17551, ruled] `DatasetSelection` was a TypeScript **interface** with no Zod
 * schema anywhere in the repo. PR #17548 put a door on the route, but only over
 * the SEVEN members the selection shares with `AnalyticsQuery`, parsed as a
 * projection; the four dataset-only members — `runtimeFilter`,
 * `dateGranularity`, `compareTo`, `totals` — were 「declared in TypeScript,
 * published in the api-surface, and enforced by nothing on the wire」. The
 * measured consequence was #17550: `compareTo: { kind: 'nonsense' }` came back
 * as a previous-period comparison under a 200, a number a dashboard renders and
 * a person reads as fact.
 *
 * Every member below is a transcription of a member this file's sibling
 * (`contracts/analytics-service.ts`) has published since ADR-0021. Nothing is
 * added, and nothing that the interface permits is refused.
 *
 * ## The seven shared members are taken BY REFERENCE, not retyped
 *
 * ⭐ `dimensions` / `measures` / `timeDimensions` / `order` / `limit` /
 * `offset` / `timezone` are read straight off `AnalyticsQuerySchema.shape`.
 * The interface already declared `timeDimensions` by reference
 * (`AnalyticsQuery['timeDimensions']`), and the door's own projection list is
 * a standing claim that the other six agree. Taking the declarations
 * themselves makes that claim STRUCTURAL: there is no second copy to drift,
 * and a member that leaves `AnalyticsQuery` fails the build here rather than
 * silently becoming a private dialect.
 *
 * ⛔ `runtimeFilter` is deliberately NOT read off `where`. They carry the same
 * `FilterCondition`, but they are different keys on each side, and the alias
 * table below is what tells an author so.
 *
 * ## Strict, like every other analytics door
 *
 * `AnalyticsQuerySchema` has been `.strict()` since #4001 and the sibling
 * request body is `.strict()` too. An undeclared key on a selection was never
 * declared; it was silently dropped, and the widget behind it answered a
 * narrower question than its author asked. It is now named, echoed back, and
 * pointed at the canonical key where one exists.
 */
export const DatasetSelectionSchema = lazySchema(() => {
  const shared = AnalyticsQuerySchema.shape;
  return strictObject(
    {
      surface: 'this dataset selection',
      history: 'Until this shape was closed, `runtimeFilter`, `dateGranularity`, `compareTo` and '
        + '`totals` were declared in TypeScript and enforced by nothing on the wire, and any other '
        + 'key was dropped without a word.',
      aliases: {
        // ⭐ MEASURED, not invented: `analytics-selection-door.ts` names this
        // exact pair as the near-miss its projection list must keep out —
        // 「`runtimeFilter` vs `where` — same `FilterCondition`, a different key
        // on each side」. The sibling body spells it `where`; a dataset
        // selection spells it `runtimeFilter`.
        where: 'runtimeFilter',
        filter: 'runtimeFilter',
        filters: 'runtimeFilter',
        // The sibling record dialect spells sorting `orderBy`; the analytics
        // dialect spells it `order` (`AnalyticsQuerySchema` carries the same
        // entry for the same reason).
        orderBy: 'order',
        // `ui/dataset.zod.ts` curates exactly these for the same target.
        granularity: 'dateGranularity',
        granularities: 'dateGranularity',
        dateBucket: 'dateGranularity',
        bucket: 'dateGranularity',
        // The dashboard widget spells its measure list `values`; a selection
        // spells it `measures`.
        values: 'measures',
      },
      guidance: {
        cube: '`cube` is an `AnalyticsQuery` member, not a selection member — a dataset selection '
          + 'names no cube. The dataset is addressed one level up, beside `selection`: '
          + '`dataset` (an inline definition) or `datasetName` (a saved one).',
        dataset: '`dataset` belongs one level up, beside `selection` — the request body is '
          + '`{ dataset | datasetName, selection }`, and the selection itself carries only the '
          + "dataset's dimension and measure NAMES.",
        datasetName: '`datasetName` belongs one level up, beside `selection` — the request body is '
          + '`{ dataset | datasetName, selection }`.',
        previewDrafts: '`previewDrafts` is a request-body flag, one level up beside `selection`, '
          + 'not a selection member.',
      },
    },
    {
      /** Dimension names from the dataset. */
      dimensions: shared.dimensions,
      /** Measure names from the dataset (may include derived measures). */
      measures: shared.measures,
      /**
       * Presentation-scope filter, ANDed with the dataset's intrinsic filter
       * at render. Same canonical `FilterCondition` the sibling body spells
       * `where` — a different key, deliberately, because it composes with the
       * dataset's own filter rather than replacing it.
       */
      runtimeFilter: FilterConditionSchema.optional().describe(
        "Presentation-scope filter (canonical Query DSL FilterCondition), ANDed with the dataset's "
        + 'intrinsic filter at render',
      ),
      /** Optional time-dimension windows passed through to the runtime. */
      timeDimensions: shared.timeDimensions,
      /**
       * Presentation-scope date bucketing (framework#3588). Applies to every
       * selected dimension the dataset declares as a `date` dimension, so a
       * widget can bucket a trend by month without the dataset having to
       * declare that granularity for every consumer.
       *
       * Precedence, per dimension: an explicit `timeDimensions` entry for that
       * dimension wins, then this selection-level granularity, then the
       * dataset dimension's own `dateGranularity` default. Unset leaves each
       * dimension on its dataset default (which may be no bucketing at all —
       * grouping by the raw column).
       */
      dateGranularity: DateGranularity.optional().describe(
        'Presentation-scope date bucketing applied to every selected `date` dimension; an explicit '
        + "`timeDimensions` entry wins over it, and the dataset dimension's own default is used "
        + 'when neither is set',
      ),
      /**
       * Result ordering, applied by key in insertion order
       * (`{ revenue: 'desc' }`).
       *
       * Every key must be a selected dimension, a selected measure, or a
       * `<measure>__compare` column; anything else is rejected by the executor
       * rather than silently ignored. Ordering is applied AFTER measure-scoped
       * filters are merged, `compareTo` columns are attached, and derived
       * measures are evaluated — so a derived measure (e.g. a win-rate ratio)
       * is a valid sort key even though no single SQL statement computes it.
       *
       * ⛔ The KEYS are judged by the executor, against the dataset this
       * selection runs on; this schema judges only the DIRECTION, which is all
       * a dataset-free parse can know.
       */
      order: shared.order,
      /**
       * Max rows to return, applied after `order`. When `limit` is set without
       * `order`, rows are ordered by the selected dimensions ascending first,
       * so the truncated window is deterministic rather than an arbitrary
       * subset.
       */
      limit: shared.limit,
      offset: shared.offset,
      /**
       * Compare-to directive — runs a shifted query and attaches
       * `<measure>__compare` columns.
       */
      compareTo: DatasetCompareToSchema.optional().describe(
        'Period-over-period comparison window ({ kind, dimension? }); attaches `<measure>__compare` '
        + 'columns',
      ),
      /**
       * Server-side totals (matrix subtotals + grand total). Results arrive on
       * `AnalyticsResult.totals` in request order.
       */
      totals: DatasetTotalsSchema.optional().describe(
        'Server-side marginal aggregates; each grouping is a dimension subset to additionally '
        + 'aggregate by, `[]` being the grand total',
      ),
      timezone: shared.timezone,
    },
  );
});

export type AnalyticsEndpoint = z.input<typeof AnalyticsEndpoint>;
export type AnalyticsQueryRequest = z.input<typeof AnalyticsQueryRequestSchema>;
/**
 * #13078 — previously this schema had NO exported type at all
 * (`protocol.zod.ts` kept a module-local `z.infer` alias), so a consumer could
 * not name the route's response even after the schema said the right thing.
 * Exported exactly as every sibling in this file is: `z.input` + `Parsed`.
 */
export type AnalyticsResultResponse = z.input<typeof AnalyticsResultResponseSchema>;
/** Post-parse shape of {@link AnalyticsResultResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsResultResponseParsed = z.infer<typeof AnalyticsResultResponseSchema>;
export type AnalyticsMetadataResponse = z.input<typeof AnalyticsMetadataResponseSchema>;
/** Post-parse shape of {@link AnalyticsMetadataResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsMetadataResponseParsed = z.infer<typeof AnalyticsMetadataResponseSchema>;
export type AnalyticsSqlResponse = z.input<typeof AnalyticsSqlResponseSchema>;
/** Post-parse shape of {@link AnalyticsSqlResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsSqlResponseParsed = z.infer<typeof AnalyticsSqlResponseSchema>;
export type GetAnalyticsMetaRequest = z.input<typeof GetAnalyticsMetaRequestSchema>;

/**
 * [#17551] The ADR-0021 comparison directive. THE declaration: the
 * `DatasetCompareTo` name `@objectstack/spec/contracts` publishes is this type
 * re-exported, never a second interface beside it.
 */
export type DatasetCompareTo = z.input<typeof DatasetCompareToSchema>;
/** The ADR-0021 marginal-aggregate request (`DatasetSelection.totals`). */
export type DatasetTotals = z.input<typeof DatasetTotalsSchema>;
/**
 * [#17551] A presentation’s selection against a dataset (ADR-0021) — the body
 * `POST /api/v1/analytics/dataset/query` posts under `selection`. THE
 * declaration: the `DatasetSelection` name `@objectstack/spec/contracts`
 * publishes is this type re-exported.
 */
export type DatasetSelection = z.input<typeof DatasetSelectionSchema>;
