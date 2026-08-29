// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema } from './i18n.zod';
import { AggregationFunction, DateGranularity } from '../data/query.zod';

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
  name: SnakeCaseIdentifierSchema.describe('Dimension name — referenced by presentations'),
  label: I18nLabelSchema.optional(),
  /**
   * A field on the base object, OR a relationship path (one or more to-one hops)
   * ending in a field — e.g. `account.region` or `account.owner.region`
   * (ADR-0071 multi-hop). The join chain is DERIVED from the relationship(s)
   * declared in `Dataset.include`; the author never writes a predicate.
   */
  field: z.string().describe('Base field, or `relationship[.relationship].field` path'),
  type: z.enum(['string', 'number', 'date', 'boolean', 'lookup']).optional(),
  /** Default bucketing for date dimensions (day/week/month/quarter/year). */
  dateGranularity: DateGranularity.optional(),
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
  name: SnakeCaseIdentifierSchema.describe('Measure name — e.g. "revenue"; defined once'),
  label: I18nLabelSchema.optional(),
  /** Aggregation function — reuses the canonical query.zod enum. */
  aggregate: AggregationFunction.optional().describe('Aggregation (sum/avg/count/...); omit when `derived` is set'),
  /** Base field, or `relationship[.relationship].field` path. Optional for `count` (count(*)). */
  field: z.string().optional().describe('Aggregated field; optional for count(*)'),
  /** Measure-scoped filter (e.g. only won deals for "won_amount"). */
  filter: FilterConditionSchema.optional(),
  /** Display format, e.g. "$0,0.00", "0.0%". */
  format: z.string().optional(),
  /**
   * Display currency (ISO 4217, e.g. "USD", "CNY"). Carried onto the result
   * field so presentations render a locale-correct symbol via `Intl` rather
   * than a "$" baked into `format`. Declare it on the measure (the semantic
   * layer) when the aggregated field is a fixed-currency amount.
   */
  currency: z.string().length(3).optional().describe('Display currency code (ISO 4217)'),
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
  }).optional(),
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

  /** Definition-level filter (the dataset's intrinsic scope, e.g. non-deleted). */
  filter: FilterConditionSchema.optional().describe('Intrinsic dataset scope filter'),

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

