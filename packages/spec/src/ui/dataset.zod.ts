// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { analyticsCarrierFilter } from './analytics-carrier-filter';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema } from './i18n.zod';
import { AggregationFunction, DateGranularity } from '../data/query.zod';
import {
  ANALYTICS_COLUMN_PATH,
  ANALYTICS_COLUMN_REFERENCE,
  rowWildcardOutsideCount,
  rowWildcardOutsideCountRefusal,
} from '../data/analytics-column-reference';

/**
 * Analytics Dataset — the one semantic layer (ADR-0021).
 *
 * A `dataset` is a named, reusable analytical definition: a base object, the
 * relationships to include (joins are *derived* from the object graph — the
 * author never writes an `ON` clause), and the declared **dimensions**
 * (groupable axes) and **measures** (aggregatable values). It is deliberately
 * SMALLER than `QuerySchema`: no raw SQL, no hand-authored join predicates,
 * no window/having grammar in the author surface.
 *
 * Presentations (`report` / `dashboard`) bind to a dataset by reference and
 * pick dimensions/measures *by name*. The dataset compiles to the existing
 * Cube analytics runtime (ADR-0021 D-A=(c)); RLS / tenant scoping is enforced
 * by the runtime per joined object (D-C), never declared here.
 *
 * Naming: this module owns the high-prior `dataset` / `dimension` / `measure`
 * vocabulary (LookML / dbt / Cube / PowerBI). The Zod export identifiers are
 * `Dataset`-prefixed (`DatasetDimensionSchema`, `DatasetMeasureSchema`) so they
 * do not clash with the Cube layer's `DimensionSchema` / `MetricSchema` in
 * `data/analytics.zod.ts` while the two layers coexist (Phase 1). The Cube
 * layer is absorbed/retired in a later phase (D-A).
 */

/**
 * Shared history for the semantic-layer sub-shapes in this file (#4001 批 14).
 *
 * `DatasetSchema` (the container) has been strict since the ADR-0021 cutover;
 * the two shapes that carry the actual semantic contract — the dimension and
 * measure entries every presentation binds to BY NAME — were not. A strict
 * container around strip children is the silhouette of a closed surface, not a
 * closed surface (the nested-hole shape 批 13 found on `page.components[]`).
 */
const DATASET_HISTORY =
  'Until this shape was closed these were dropped silently — the dataset still '
  + 'compiled and every report and widget bound to it still rendered, computing something '
  + 'other than what was declared.';

/**
 * The competing vocabulary these two shapes are curated against is NAMED by this
 * module's own header: `data/analytics.zod.ts`'s Cube layer (`DimensionSchema` /
 * `MetricSchema`), which the two coexist with by design during ADR-0021 Phase 1.
 * That is the anchor for the aliases below — a sibling contract in this repo,
 * not an edit-distance guess:
 *
 *   Cube dimension  `{ name, label, description, type, sql, granularities }`
 *   Cube metric     `{ name, label, description, type, sql, filters, format }`
 *
 * Two of those overlaps are actively dangerous rather than merely different, and
 * neither is a typo any distance metric can reach:
 *
 * - **`type` means different things in the two layers.** On a Cube *metric* it
 *   is the AGGREGATION (`sum`/`avg`/…); on a dataset *dimension* it is the
 *   DATATYPE. So `{ name: 'revenue', type: 'sum', field: 'amount' }` — a
 *   perfectly sensible thing to write, and what an LLM trained on Cube/LookML
 *   emits — parsed clean on a measure and computed a `count`, because
 *   `aggregate` was absent and `type` was stripped.
 * - **`sql` has no destination here at all.** The dataset layer is deliberately
 *   SMALLER than a query: no raw SQL, no hand-authored predicates (see the
 *   module header). Aliasing it to `field` would be finding 7's trap — pointing
 *   an author who wrote `sql: 'SUM(amount)'` at a slot that takes a field PATH,
 *   where the same content is wrong again. It gets `guidance` instead.
 */
const DATASET_NO_SQL =
  'the dataset layer takes no raw SQL — it is deliberately smaller than a query (ADR-0021). '
  + 'A dimension names a `field` (a base field or a `relationship[.relationship].field` path); '
  + 'a measure names an `aggregate` + `field`, and the only computed form is '
  + '`derived: { op, of: [...] }`, which combines OTHER measures in this dataset by name. '
  + 'Joins are compiled from `Dataset.include` — you never write an ON clause.';

/**
 * A dataset dimension's and measure's `field` is a COLUMN REFERENCE, never a
 * SQL expression (#21220; ADR-0021 "zero raw SQL / zero raw expressions",
 * ADR-0049 enforce-or-remove) — the accept set the cube members it compiles to
 * already hold (#20943), from the one shared declaration in
 * `../data/analytics-column-reference.ts`: the dataset compiler copies `field`
 * into the cube member's `sql` verbatim, so the two slots are one value.
 *
 * The module header said so from the start ("no raw SQL"), and the field's own
 * description named a field or a relationship path, but the slot was a bare
 * `z.string()` and parsed anything. The runtime has refused an expression
 * `field` at the analytics dataset door since #21190 (`PERMISSION_DENIED` /
 * 403, inline or saved), so an expression could be saved and never answered —
 * declared, never enforced. That door stays, as defence in depth for a dataset
 * that reaches the service without meeting this parse. It never judged an
 * empty `field` (it skips one); a stored `count` measure with `field: ''` is
 * repaired on load by the D2 conversion `dataset-count-measure-empty-field-removed`.
 *
 * A measure admits the row wildcard `'*'` (a count's `COUNT(*)`) under
 * `aggregate: 'count'` only — the measure's refinement asks the one shared
 * predicate (#21409); a dimension does not admit it at all. Both restrictions,
 * and their measurements, are stated in `../data/analytics-column-reference.ts`.
 * An empty string is refused on both: on a measure the wildcard's spelling is
 * `'*'` or no `field` at all, and on a dimension it names nothing to group by.
 */
const DATASET_FIELD_EXPRESSION_REFUSED =
  'A SQL expression there names no single field, so no platform check can judge which fields it reads, '
  + 'and the analytics dataset door refuses it on every query (ADR-0021: the dataset layer takes no raw SQL '
  + 'and no raw expressions; ADR-0049 enforce-or-remove).';

const DATASET_DIMENSION_FIELD_NOT_COLUMN =
  '`dimensions[].field` is a column reference: a field of the dataset\'s object (`stage`), or a relationship '
  + 'path ending in one (`account.region`) whose relationships are declared in `include`. '
  + `${DATASET_FIELD_EXPRESSION_REFUSED} Group by the column itself. \`'*'\` is no dimension: it names every `
  + 'column at once, which is not an axis. A bucket computed over a column\'s values (a CASE over them) has no '
  + 'expression form in the dataset layer: keep the bucket as a field of the object and name that field here.';

const DATASET_MEASURE_FIELD_NOT_COLUMN =
  '`measures[].field` is a column reference: a field of the dataset\'s object (`amount`), a relationship path '
  + 'ending in one (`account.amount`) whose relationships are declared in `include`, or `\'*\'` for a count; '
  + `a count may also omit \`field\`. ${DATASET_FIELD_EXPRESSION_REFUSED} Name the column the measure `
  + 'aggregates. A derived value is declared in the ADR-0021 form, where the platform judges every field it '
  + 'reads: a conditional count or sum is a measure with its own structured `filter` '
  + '(`{ name: \'done_count\', aggregate: \'count\', filter: { status: \'done\' } }`), and a ratio, sum, '
  + 'difference or product of measures is `derived: { op, of: [...] }` over measures named in this dataset '
  + '(`{ name: \'done_rate\', derived: { op: \'ratio\', of: [\'done_count\', \'task_count\'] }, format: '
  + '\'0.0%\' }` — a 0–1 fraction, which the `%` pattern displays as a percentage).';

/**
 * Dimension — a groupable axis (e.g. "region", "close_date by quarter").
 */
export const DatasetDimensionSchema = lazySchema(() => strictObject({
  surface: 'this dataset dimension',
  history: DATASET_HISTORY,
  aliases: {
    // The source. A dimension names a field PATH; these are the words the Cube
    // layer, objectql and the chart surfaces use for the same slot.
    column: 'field',
    path: 'field',
    source: 'field',
    fieldName: 'field',
    property: 'field',
    // Bucketing. Cube spells it `granularities` (an ARRAY of supported ones);
    // here it is one default bucket, so the rename also changes the shape —
    // which is why it must be said rather than guessed.
    granularity: 'dateGranularity',
    granularities: 'dateGranularity',
    dateBucket: 'dateGranularity',
    bucket: 'dateGranularity',
    interval: 'dateGranularity',
    // Identity/display.
    title: 'label',
    displayName: 'label',
  },
  guidance: {
    sql: DATASET_NO_SQL,
    expression: DATASET_NO_SQL,
    formula: DATASET_NO_SQL,
    description:
      'a dimension has no `description` — its author-facing text is `label`. `description` is declared on the DATASET itself; put the explanation there.',
  },
}, {
  /** Referenced by presentations (report rows/columns, widget dimensions). */
  name: SnakeCaseIdentifierSchema.describe('Dimension name — referenced by presentations').meta({ title: 'Name' }),
  label: I18nLabelSchema.optional().meta({ title: 'Label' }),
  /**
   * A field on the base object, OR a relationship path (one or more to-one hops)
   * ending in a field — e.g. `account.region` or `account.owner.region`
   * (ADR-0071 multi-hop). The join chain is DERIVED from the relationship(s)
   * declared in `Dataset.include`; the author never writes a predicate.
   * A column reference only (#21220, see `DATASET_FIELD_EXPRESSION_REFUSED`):
   * a SQL expression, `'*'` or an empty string is refused at parse.
   */
  field: z.string()
    .regex(ANALYTICS_COLUMN_PATH, { error: () => DATASET_DIMENSION_FIELD_NOT_COLUMN })
    .describe('Base field, or `relationship[.relationship].field` path. A column reference, never a SQL expression.')
    .meta({ title: 'Field' }),
  type: z.enum(['string', 'number', 'date', 'boolean', 'lookup']).optional().meta({ title: 'Type' }),
  /** Default bucketing for date dimensions (day/week/month/quarter/year). */
  dateGranularity: DateGranularity.optional().meta({ title: 'Date Granularity' }),
}));

/**
 * Derived-measure operator (ADR-0021 Q1).
 * A derived measure references OTHER measures BY NAME only — no raw fields,
 * no raw SQL — keeping it enumerable and reviewable.
 */
export const DerivedMeasureOp = z.enum(['ratio', 'sum', 'difference', 'product']);

/**
 * Measure — an aggregatable value (e.g. "revenue = sum(amount)"). Defined ONCE
 * here; every presentation references it by name.
 */
export const DatasetMeasureSchema = lazySchema(() => strictObject({
  surface: 'this dataset measure',
  history: DATASET_HISTORY,
  aliases: {
    // THE dangerous one — see the note above `DATASET_NO_SQL`. A Cube metric's
    // `type` IS the aggregation, and `type` is not declared here at all, so an
    // author who brings that habit silently loses the aggregation.
    type: 'aggregate',
    aggregation: 'aggregate',
    agg: 'aggregate',
    fn: 'aggregate',
    func: 'aggregate',
    function: 'aggregate',
    operation: 'aggregate',
    // The aggregated column.
    column: 'field',
    source: 'field',
    fieldName: 'field',
    property: 'field',
    // Measure-scoped filter — singular here, plural on the Cube metric.
    filters: 'filter',
    where: 'filter',
    criteria: 'filter',
    // Formatting / display.
    numberFormat: 'format',
    displayFormat: 'format',
    currencyCode: 'currency',
    title: 'label',
    displayName: 'label',
    // Computed measures.
    calculated: 'derived',
    computed: 'derived',
  },
  guidance: {
    sql: DATASET_NO_SQL,
    expression: DATASET_NO_SQL,
    formula: DATASET_NO_SQL,
    description:
      'a measure has no `description` — its author-facing text is `label`. `description` is declared on the DATASET itself; put the explanation there.',
  },
}, {
  name: SnakeCaseIdentifierSchema.describe('Measure name — e.g. "revenue"; defined once').meta({ title: 'Name' }),
  label: I18nLabelSchema.optional().meta({ title: 'Label' }),
  /** Aggregation function — reuses the canonical query.zod enum. */
  aggregate: AggregationFunction.optional().describe('Aggregation (sum/avg/count/...); omit when `derived` is set')
    .meta({ title: 'Aggregate' }),
  /**
   * Base field, or `relationship[.relationship].field` path, or `'*'` for a
   * `count`. Optional for `count` (count(*)). A column reference only (#21220,
   * see `DATASET_FIELD_EXPRESSION_REFUSED`): a SQL expression or an empty string
   * is refused at parse, and `'*'` under any other aggregate is refused by the
   * schema's refinement below (#21409).
   */
  field: z.string()
    .regex(ANALYTICS_COLUMN_REFERENCE, { error: () => DATASET_MEASURE_FIELD_NOT_COLUMN })
    .optional()
    .describe('Aggregated field: a base field, a relationship path, or "*" for a count; optional for count(*). Never a SQL expression.')
    .meta({ title: 'Field' }),
  /**
   * Measure-scoped filter (e.g. only won deals for "won_amount"). [#20080] A
   * list in the equality slot inside a nested relation is refused on save, as
   * the analytics door refuses it on chart — see
   * {@link analyticsCarrierFilter} (`./analytics-carrier-filter.ts`).
   */
  filter: analyticsCarrierFilter().meta({ title: 'Filter' }),
  /**
   * Display format — a NUMERAL pattern controlling grouping, decimals and
   * percent: `"0,0.00"`, `"0.0%"`. A `$` in the pattern is still honoured as a
   * legacy literal, but a real amount takes its symbol from `currency` below,
   * never from the pattern — see that field's note.
   *
   * A DATE-valued measure (`min` / `max` over a date field) never reads a date
   * PATTERN here: `"YYYY-MM-DD"` is accepted by this schema, reaches the
   * renderer, and produces that arm's default face. The shared date path takes
   * a named STYLE instead, and BOTH arms honour the same two words — `short`
   * (`Jul 4, '24` for a date, `9/11/2026 9:30 am` for a datetime) and
   * `relative` (`3 days ago` inside a ±7-day window, the absolute form outside
   * it) — the same two words `DateCellRenderer` honours from `field.format`.
   *
   * ⚠️ The datetime half of that sentence is NEW at the pin below and is the
   * one thing this record's previous revision got wrong the moment the pin
   * moved: until objectui#8352 a DATETIME value ignored `format` altogether,
   * and this docblock and the `describe` beneath it both said so.
   *
   * Measured at the pin this repo builds against (`.objectui-sha` =
   * `2e818d0b5`; re-derived at that pin 2026-10-04 — `date-display.ts` and
   * `dataset-format.ts` are byte-identical to `ab1879721` (`git diff --quiet`),
   * so every anchor held unmoved. At `ab1879721`, re-derived there
   * 2026-10-03 — `date-display.ts` is
   * byte-identical to `89cad75d5`, so `formatDate` `445-480` and the ±7-day
   * fallback `399` held unmoved and were re-READ in place; `dataset-format.ts`
   * changed (+53/-36, objectui#11475: `scalePercent` scales at the storage
   * its caller states, through the spec's `percentScaleOf`, instead of
   * guessing from the value's magnitude), above `formatMeasureDate` in the
   * percent-scaling helpers and below it in `formatMeasure`'s docblock (line
   * for line) and its percent arm, so
   * `formatMeasureDate` `:229-263` -> `:240-274`, its datetime arm `:259`-`:261`
   * -> `:270`-`:272` and its call `:369` -> `:380` MOVED byte-identical,
   * re-READ with the same reading below. At `89cad75d5` (2026-10-02)
   * `dataset-format.ts` and `date-display.ts` were byte-identical to
   * `31971ff1e`, so every anchor below held unmoved and was re-READ in place.
   * At `31971ff1e` (2026-10-01) both
   * files were byte-identical to `e420df310`, so every anchor held unmoved and
   * was re-READ in place. At `e420df310` (2026-09-30)
   * `dataset-format.ts` was byte-identical to `db11afd49`, so `formatMeasureDate` `:229-263`, its call
   * at `:369` and its datetime arm `:259`-`:261` did not move and were re-READ
   * in place, and `date-display.ts` changed (+68/-1, objectui `858eafb4f`,
   * objectui#11141: a header comment naming the new `toDisplayEndDate` /
   * `toInclusiveEndDay` exports, and those two functions added after
   * `toDisplayDate`, above every anchor here), so `formatDate` `378-413` ->
   * `445-480` and the ±7-day fallback `332` -> `399` MOVED byte-identical,
   * re-READ with the same reading below. At `db11afd49` (2026-09-29)
   * `date-display.ts` was
   * byte-identical to `dd3f7e1be` and `dataset-format.ts` changed only in three
   * comment lines (`:529`, `:589`, `:660`, objectui `63ab76112`), all below every
   * anchor here, so `formatDate` `378-413`, the ±7-day fallback `332`,
   * `formatMeasureDate` `:229-263`, its call at `:369` and its datetime arm
   * `:259`-`:261` were re-READ and did not move. At `dd3f7e1be` (2026-09-28)
   * both files changed again on
   * that hop (objectui `544aca24f`, objectui#10301, the date-time half of
   * objectui#10026: `toDisplayDate` now refuses a date-TIME written on a day
   * that does not exist as well, and `dataset-format.ts` rewrote the
   * `ISO_DATETIME_RE` docblock that said such a value still rolls over, four
   * comment lines for four, so nothing below it moved), while the style
   * handling this record cites re-reads unchanged: `formatDate` `355-390` ->
   * `378-413` and the ±7-day fallback `309` -> `332` MOVED byte-identical, and
   * `formatMeasureDate` `:229-263`, its call at `:369` and its datetime arm at
   * `:259`-`:261` did not move. At `f8a9d0fb0` (2026-09-24) both files had
   * moved (objectui `ad694ac3d`, objectui#10026: the shared date path refuses a
   * date-only calendar day that does not exist, with the dash it renders for
   * any unparsable value, and `dataset-format.ts` rewrote
   * `formatMeasureDate`'s comment on that case), while the style handling
   * re-read unchanged: `formatDate` `271-306` -> `355-390` and the ±7-day
   * fallback `225` -> `309` MOVED byte-identical, and `formatMeasureDate` came
   * out one comment line shorter. At `62597c588` (2026-09-23)
   * `dataset-format.ts` was byte-identical to `87af769e9`, and `date-display.ts`
   * had moved (objectui `516583b54`, +77/-4): `formatDate` parses through
   * `toDisplayDate`, so a date-only value renders the calendar day it names in
   * every timezone. At `87af769e9` (2026-09-20) every anchor below MOVED and
   * one of them changed SUBSTANCE, so nothing here was carried there either:
   * `formatMeasureDate`'s datetime arm no longer calls
   * `formatDateTime(v, { locale })` unconditionally, it SELECTS a formatter,
   * because `formatDateTime(value, options?)` has no style parameter to thread
   * into and widening that published signature was refused) in
   * objectui
   * `packages/core/src/utils/dataset-format.ts`: `formatMeasure` routes a
   * non-numeric value through `formatMeasureDate` (`:240-274`, was `:229-263`,
   * `:229-264` and before that `:185-198`) at `:380`,
   * whose date-only arm threads `format` into the STYLE parameter of
   * `formatDate` (`utils/date-display.ts:445-480`, was `:378-413`, `:355-390`, `:271-306`,
   * `:198-233` and before that `:131-164`, whose `relative` branch falls back to the absolute form
   * beyond ±7 days at `:399`, was `:332`, `:309`, `:225`, `:152` and `:117` — the fallback strips the style through
   * `absoluteFallbackOptions`), while its datetime arm answers `relative` with
   * `formatRelativeDate` (`:270`), `short` with
   * `formatDateTime(v, { locale, style: 'compact' })` (`:271`) and everything
   * else — a date PATTERN included — with the bare
   * `formatDateTime(v, { locale })` (`:272`).
   * Teaching
   * the shared path a pattern grammar would change every list cell that reads
   * it, so that gap is still DOCUMENTED here rather than closed (objectui#7178
   * ruled A; the datetime half is objectui#7443 and objectui#8352).
   */
  format: z.string().optional().describe(
    'Numeral pattern for a NUMERIC measure — grouping, decimals, percent; e.g. "0,0.00", "0.0%". '
    + 'An amount takes its symbol from `currency`, not from a "$" in the pattern. A DATE-valued '
    + 'measure never reads a date pattern: `"YYYY-MM-DD"` renders that arm\'s default face. A date '
    + 'or datetime value reads `format` as a display style — `short` or `relative`, honoured on both.',
  ).meta({ title: 'Format' }),
  /**
   * Display currency (ISO 4217, e.g. "USD", "CNY"). Carried onto the result
   * field so presentations render a locale-correct symbol via `Intl` rather
   * than a "$" baked into `format`. Declare it on the measure (the semantic
   * layer) when the aggregated field is a fixed-currency amount.
   */
  currency: z.string().length(3).optional().describe('Display currency code (ISO 4217)').meta({ title: 'Currency' }),
  /**
   * Derived measure — computed from OTHER measures in this dataset by name
   * only. e.g. `{ op: 'ratio', of: ['won_amount', 'total_amount'] }`.
   * Mutually exclusive with `field`/`aggregate` semantics: when `derived` is
   * set, `aggregate` is ignored at compile time.
   */
  derived: strictObject({
    surface: 'this derived-measure spec',
    history: DATASET_HISTORY,
    // Two keys, both terse, both therefore out of edit-distance reach of the
    // words an author reaches for. `of` in particular: a two-character key has
    // a distance budget of 2, so `operands` (8 edits away) can never suggest it.
    aliases: {
      operator: 'op',
      operation: 'op',
      type: 'op',
      kind: 'op',
      fn: 'op',
      func: 'op',
      function: 'op',
      measures: 'of',
      operands: 'of',
      args: 'of',
      arguments: 'of',
      inputs: 'of',
      refs: 'of',
      from: 'of',
      over: 'of',
    },
    guidance: {
      // The refs are measure NAMES; pointing a field/SQL author at `of` would
      // hand them a slot where their content is wrong again (finding 7).
      sql: DATASET_NO_SQL,
      expression: DATASET_NO_SQL,
      formula: DATASET_NO_SQL,
      field:
        'a derived measure references OTHER MEASURES by name, never raw fields — that is what keeps it enumerable and reviewable (ADR-0021 Q1). List the measure names in `of`, and declare the underlying field on the measure being referenced.',
    },
  }, {
    op: DerivedMeasureOp,
    /** Names of other measures in this dataset (2+ for ratio/difference). */
    of: z.array(SnakeCaseIdentifierSchema).min(1),
  }).optional().meta({ title: 'Derived From' }),
}).superRefine((measure, ctx) => {
  // [#21409] `'*'` is the row wildcard a `count` aggregates (`COUNT(*)`), and
  // only a `count` consumes it: under any other aggregate — or none, as on a
  // `derived` measure — it names no column. Measured at
  // `POST /analytics/dataset/query` before this rule: `{ aggregate: 'sum',
  // field: '*' }` compiled to `SUM(*)` and answered 500 on both strategies.
  // Cross-field, so a refinement (a declared dropped-refinement site). The rule
  // is the ONE predicate the cube measure calls too (`MetricSchema`).
  if (rowWildcardOutsideCount(measure.field, measure.aggregate)) {
    ctx.addIssue({
      code: 'custom',
      path: ['field'],
      message: rowWildcardOutsideCountRefusal('measures[].field', 'aggregate', measure.aggregate),
    });
  }
}));

/**
 * Dataset — the single analytical source of truth (ADR-0021 D1).
 */
export const DatasetSchema = lazySchema(() => strictObject({
  surface: 'this dataset',
  history:
    'Until this shape was closed these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  // #5013 — `measures` and `filter` are both DECLARED here (the aggregatable
  // values and the intrinsic scope filter), so neither entry could ever run: an
  // alias is consulted only from the `unrecognized_keys` path, and a declared
  // key is recognised. Their targets (`metrics`, `filters`) were not keys of
  // this schema either, so had they been reachable they would have prescribed a
  // second rejection.
  aliases: { source: 'object', objectName: 'object', dimension: 'dimensions' },
}, {
  /** Identity. */
  name: SnakeCaseIdentifierSchema.describe('Dataset unique name'),
  label: I18nLabelSchema.describe('Dataset label'),
  description: I18nLabelSchema.optional(),

  /** Base object — the FROM. */
  object: z.string().describe('Base object name'),

  /**
   * Relationships to include, by NAME or by PATH — lookup / master_detail field
   * names on the object graph, optionally chained through to-one relationships
   * up to 3 hops (`account`, `account.owner`; ADR-0071 multi-hop). Joins are
   * COMPILED from these — the author writes no ON clause. Declaring `a.b`
   * implicitly includes the intermediate `a`. D-C: only declared paths are
   * joinable; no arbitrary predicates, and to-many traversal is out of scope.
   */
  include: z
    .array(
      z
        .string()
        .refine((p) => p.split('.').length <= 3, {
          message: 'include path exceeds the 3-hop limit (ADR-0071)',
        }),
    )
    .optional()
    .describe('Relationship names/paths to join (derived from object graph; max 3 hops)'),

  /**
   * Definition-level filter (the dataset's intrinsic scope, e.g. non-deleted).
   * [#20080] A list in the equality slot inside a nested relation is refused
   * on save, as the analytics door refuses it on chart — see
   * {@link analyticsCarrierFilter} (`./analytics-carrier-filter.ts`).
   */
  filter: analyticsCarrierFilter().describe('Intrinsic dataset scope filter'),

  /** The semantic contract presentations bind to. */
  dimensions: z.array(DatasetDimensionSchema).describe('Groupable axes'),
  measures: z.array(DatasetMeasureSchema).describe('Aggregatable values'),

  /**
   * ADR-0010 — package-author protection envelope; the loader translates this
   * into the private `_lock` envelope at registration and strips it before
   * persistence.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this dataset.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,
}).superRefine((ds, ctx) => {
  // Measure names must be unique (presentations reference them by name).
  const measureNames = new Set<string>();
  for (const m of ds.measures) {
    if (measureNames.has(m.name)) {
      ctx.addIssue({ code: 'custom', message: `duplicate measure name "${m.name}"`, path: ['measures'] });
    }
    measureNames.add(m.name);
  }
  // Dimension names must be unique.
  const dimNames = new Set<string>();
  for (const d of ds.dimensions) {
    if (dimNames.has(d.name)) {
      ctx.addIssue({ code: 'custom', message: `duplicate dimension name "${d.name}"`, path: ['dimensions'] });
    }
    dimNames.add(d.name);
  }
  // Derived measures may only reference OTHER measures declared in this dataset.
  for (const m of ds.measures) {
    if (!m.derived) {
      // A non-derived measure must declare an aggregate (a derived measure
      // omits it — it combines other measures by name instead).
      if (!m.aggregate) {
        ctx.addIssue({
          code: 'custom',
          message: `measure "${m.name}" requires \`aggregate\` (or a \`derived\` spec)`,
          path: ['measures'],
        });
      } else if (!m.field && m.aggregate !== 'count') {
        // A non-derived measure needs a field unless it is a plain count.
        ctx.addIssue({
          code: 'custom',
          message: `measure "${m.name}" requires \`field\` (only \`count\` may omit it)`,
          path: ['measures'],
        });
      }
      continue;
    }
    for (const ref of m.derived.of) {
      if (ref === m.name) {
        ctx.addIssue({ code: 'custom', message: `derived measure "${m.name}" cannot reference itself`, path: ['measures'] });
      } else if (!measureNames.has(ref)) {
        ctx.addIssue({
          code: 'custom',
          message: `derived measure "${m.name}" references unknown measure "${ref}"`,
          path: ['measures'],
        });
      }
    }
  }
}));

/**
 * Authoring helper — identity function that gives editors full type-checking
 * and inference when defining a dataset in a `*.dataset.ts` file.
 *
 * @example
 * ```ts
 * export default defineDataset({
 *   name: 'sales',
 *   label: 'Sales',
 *   object: 'opportunity',
 *   include: ['account'],
 *   dimensions: [{ name: 'region', field: 'account.region' }],
 *   measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
 * });
 * ```
 */
export function defineDataset(dataset: Dataset): Dataset {
  return dataset;
}

export type DatasetDimension = z.input<typeof DatasetDimensionSchema>;
export type DatasetMeasure = z.input<typeof DatasetMeasureSchema>;
export type DerivedMeasureOpValue = z.input<typeof DerivedMeasureOp>;
export type Dataset = z.input<typeof DatasetSchema>;

