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
  ANALYTICS_BASE_COLUMN,
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
  + 'a measure names an `aggregate` + `field`, and the two computed forms are '
  + '`derived: { op, of: [...] }`, which combines OTHER measures in this dataset by name, and '
  + '`duration: { from, to, unit }`, which aggregates the time between two datetime columns of each record. '
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
  + '(`{ name: \'done_count\', aggregate: \'count\', filter: { status: \'done\' } }`), a ratio, sum, '
  + 'difference or product of measures is `derived: { op, of: [...] }` over measures named in this dataset '
  + '(`{ name: \'done_rate\', derived: { op: \'ratio\', of: [\'done_count\', \'task_count\'] }, format: '
  + '\'0.0%\' }` — a 0–1 fraction, which the `%` pattern displays as a percentage), and the time between two '
  + 'datetime columns of the same record is `duration: { from, to, unit }` '
  + '(`{ name: \'avg_cycle_days\', aggregate: \'avg\', duration: { from: \'submitted_at\', to: \'activated_at\', '
  + 'unit: \'days\' } }`).';

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
  /**
   * The display name of this dimension's null bucket — the group of rows whose
   * value for the dimension is null (e.g. `'System'` on a `user_id` axis, where
   * the rows nobody wrote carry no user). Display copy only: it names the
   * bucket, it never changes which rows fall in it or how they are grouped.
   * When absent, a consumer draws its own default for that bucket.
   */
  nullLabel: I18nLabelSchema.optional()
    .describe(
      'Label for the bucket of rows whose value for this dimension is null (e.g. "System" on a user axis). '
      + 'Display copy only: grouping is unchanged. When absent, consumers fall back to their own default label for that bucket.',
    )
    .meta({ title: 'Null Label' }),
}));

/**
 * Derived-measure operator (ADR-0021 Q1).
 * A derived measure references OTHER measures BY NAME only — no raw fields,
 * no raw SQL — keeping it enumerable and reviewable.
 */
export const DerivedMeasureOp = z.enum(['ratio', 'sum', 'difference', 'product']);

/**
 * [#25778] The unit a duration measure's number is expressed in. Fixed-length
 * units only: a month or a year has no one length in seconds, so a duration in
 * either would depend on which calendar months the interval crosses.
 */
export const DatasetDurationUnit = z.enum(['seconds', 'minutes', 'hours', 'days']);

/**
 * [#25778] Seconds per {@link DatasetDurationUnit} — the one conversion every
 * consumer divides by (the SQL compiler, the draft-preview evaluator, a
 * renderer suffixing the unit), so no two of them can disagree about a day.
 */
export const DATASET_DURATION_UNIT_SECONDS: Readonly<Record<z.infer<typeof DatasetDurationUnit>, number>> =
  Object.freeze({ seconds: 1, minutes: 60, hours: 3600, days: 86400 });

/**
 * [#25778] The aggregates a duration measure takes. Each reads the per-record
 * duration as a number: `avg` and `sum` add them up, `min` and `max` pick one.
 * `count` and `count_distinct` are not here: a count of records with both
 * instants set is a `count` measure with a `filter`, not a duration.
 */
export const DATASET_DURATION_AGGREGATES = ['avg', 'min', 'max', 'sum'] as const;

const DATASET_DURATION_COLUMN_NOT_BASE =
  'a duration reads two columns of the SAME record: name a `datetime` field of the dataset\'s own object '
  + '(`submitted_at`), by its bare name. A relationship path, a SQL expression, `\'*\'` or an empty string '
  + 'is refused: the dataset layer takes no raw SQL or expressions (ADR-0021).';

/**
 * [#25778] A duration measure's column pair: the time from `from` to `to` on
 * each record, in `unit`, which the measure's `aggregate` then reduces.
 *
 * Both columns are `datetime` fields of the dataset's own object — the time
 * between two instants of one record (cycle time, time in stage, time to
 * first response). The type is judged where the declarations are in hand: at
 * authoring (`measure-duration-field-type-refused`) and when the dataset is
 * compiled (`400 DATASET_INVALID`).
 *
 * A record whose `from` or `to` is null contributes nothing: it is excluded
 * from `avg`, `min`, `max` and `sum` alike, so `avg` is the mean over records
 * with both instants set. A record whose `to` is before its `from` contributes
 * a NEGATIVE duration, as written — the measure reports the data, it does not
 * repair it; filter such records out with the measure's `filter` if they are
 * errors.
 *
 * The result is a number of `unit`s (`1.5` with `unit: 'days'` is a day and a
 * half), the same on every SQL dialect the analytics runtime serves. No
 * expression language and no raw SQL: the pair is two column names and a unit
 * word, so every field it reads stays judgeable (ADR-0021).
 */
export const DatasetMeasureDurationSchema = lazySchema(() => strictObject({
  surface: 'this duration-measure spec',
  history: DATASET_HISTORY,
  aliases: {
    start: 'from',
    begin: 'from',
    since: 'from',
    startField: 'from',
    fromField: 'from',
    end: 'to',
    until: 'to',
    endField: 'to',
    toField: 'to',
    units: 'unit',
    interval: 'unit',
  },
  guidance: {
    sql: DATASET_NO_SQL,
    expression: DATASET_NO_SQL,
    formula: DATASET_NO_SQL,
    field:
      'a duration reads TWO columns — name them in `from` (the earlier instant) and `to` (the later one); '
      + 'the measure itself carries no `field`.',
  },
}, {
  from: z.string()
    .regex(ANALYTICS_BASE_COLUMN, { error: () => DATASET_DURATION_COLUMN_NOT_BASE })
    .describe('The earlier instant: a datetime field of the dataset\'s own object, by its bare name.')
    .meta({ title: 'From' }),
  to: z.string()
    .regex(ANALYTICS_BASE_COLUMN, { error: () => DATASET_DURATION_COLUMN_NOT_BASE })
    .describe('The later instant: a datetime field of the dataset\'s own object, by its bare name.')
    .meta({ title: 'To' }),
  unit: DatasetDurationUnit
    .describe('Unit of the result: the measure answers a number of these (1.5 with "days" is a day and a half).')
    .meta({ title: 'Unit' }),
}).superRefine((duration, ctx) => {
  if (duration.from === duration.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message:
        `\`from\` and \`to\` both name "${duration.from}", so every record's duration is zero. `
        + 'Name the two instants the duration spans — e.g. `from: \'submitted_at\'`, `to: \'activated_at\'`.',
    });
  }
}));

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
    // [#25778] The column-pair measure.
    elapsed: 'duration',
    timeBetween: 'duration',
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
   * ⚠️ The datetime half of that sentence is the newer one: until objectui#8352 a DATETIME value ignored `format` altogether,
   * and this docblock and the `describe` beneath it both said so.
   *
   * Measured on the renderer's shared measure formatter: its date-only arm
   * threads `format` into the date STYLE parameter (whose `relative` branch
   * falls back to the absolute form beyond ±7 days), while its datetime arm
   * answers `relative`, `short` (the compact style) and everything else — a
   * date PATTERN included — with the bare locale default. The read points are
   * recorded by symbol in `packages/spec/liveness/dataset.json`, row
   * `measures.format`.
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
  /**
   * [#25778] Duration measure — the time between two `datetime` columns of
   * each record, in `unit`, reduced by `aggregate` (`avg` / `min` / `max` /
   * `sum`): e.g. `{ aggregate: 'avg', duration: { from: 'submitted_at', to:
   * 'activated_at', unit: 'days' } }` is the average cycle time in days. See
   * {@link DatasetMeasureDurationSchema}. Excludes `field` and `derived`: the
   * two columns are the measure's source.
   */
  duration: DatasetMeasureDurationSchema.optional().describe(
    'Time between two datetime columns of each record ({ from, to, unit }), reduced by `aggregate` '
    + '(avg / min / max / sum). Records with either instant null are excluded. Replaces `field`.',
  ).meta({ title: 'Duration' }),
}).superRefine((measure, ctx) => {
  // [#25778] A duration measure's source is its column pair, and its value is
  // a number of `unit`s: so no `field` beside it (two sources), no `derived`
  // (two computed forms), only the aggregates that read a number, and no
  // `currency` (a duration is no amount of money).
  if (measure.duration) {
    if (measure.field !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['field'],
        message:
          'a duration measure reads the two columns named in `duration.from` / `duration.to` — it takes no '
          + '`field`. Delete `field`, or delete `duration` to aggregate one column.',
      });
    }
    if (measure.derived !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['derived'],
        message:
          'a measure is either `derived` (combines other measures by name) or a `duration` (two columns of '
          + 'each record), never both. Declare them as two measures; a derived measure may name the duration one in `of`.',
      });
    }
    if (measure.aggregate === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['aggregate'],
        message:
          `a duration measure needs \`aggregate\` — one of ${DATASET_DURATION_AGGREGATES.join(', ')} — to reduce `
          + 'the per-record durations to one number (e.g. `aggregate: \'avg\'` for the average cycle time).',
      });
    } else if (!(DATASET_DURATION_AGGREGATES as readonly string[]).includes(measure.aggregate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['aggregate'],
        message:
          `a duration measure takes \`aggregate\` ${DATASET_DURATION_AGGREGATES.join(' / ')}, not `
          + `"${measure.aggregate}": the per-record duration is a number to average, add up or pick the least or `
          + 'greatest of. To count records, declare a `count` measure (with a `filter` for the records whose '
          + 'two instants are set).',
      });
    }
    if (measure.currency !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message:
          'a duration measure answers a number of `duration.unit`s, not an amount of money — delete `currency`. '
          + 'Decimals and grouping go in `format` (e.g. "0.0").',
      });
    }
  }

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
   * ADR-0010 — package-author protection envelope, declared in a code package's
   * source; the loader translates this into the private `_lock` envelope at
   * registration and strips it. The metadata API's save door does not translate
   * it and refuses it (`400 VALIDATION_ERROR`), so that door never stores it.
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
    // [#25778] A duration measure's aggregate and column pair are judged on the
    // measure itself (`DatasetMeasureSchema`'s refinement); it carries no
    // `field` and names no other measure, so neither check below is its.
    if (m.duration) continue;
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
export type DatasetMeasureDuration = z.input<typeof DatasetMeasureDurationSchema>;
export type DatasetDurationUnitValue = z.input<typeof DatasetDurationUnit>;
export type DerivedMeasureOpValue = z.input<typeof DerivedMeasureOp>;
export type Dataset = z.input<typeof DatasetSchema>;

