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
 * Dimension — a groupable axis (e.g. "region", "close_date by quarter").
 */
export const DatasetDimensionSchema = lazySchema(() => z.object({
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
export const DatasetMeasureSchema = lazySchema(() => z.object({
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
  derived: z.object({
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
    'Until #4001 closed this shape these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  aliases: { source: 'object', objectName: 'object', measures: 'metrics', dimension: 'dimensions', filter: 'filters' },
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
export function defineDataset(dataset: DatasetInput): DatasetInput {
  return dataset;
}

export type DatasetDimension = z.infer<typeof DatasetDimensionSchema>;
export type DatasetMeasure = z.infer<typeof DatasetMeasureSchema>;
export type DerivedMeasureOpValue = z.infer<typeof DerivedMeasureOp>;
export type Dataset = z.infer<typeof DatasetSchema>;

/** Input types for authoring (optional fields with defaults may be omitted). */
export type DatasetDimensionInput = z.input<typeof DatasetDimensionSchema>;
export type DatasetMeasureInput = z.input<typeof DatasetMeasureSchema>;
export type DatasetInput = z.input<typeof DatasetSchema>;
