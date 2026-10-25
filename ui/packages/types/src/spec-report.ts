/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Spec Report Bridge
 *
 * This module re-exports the authoritative `Report` protocol types defined in
 * `@objectstack/spec` (UI Protocol). It is intentionally separated from the
 * legacy `reports.ts` module so we can introduce spec compliance without
 * breaking existing consumers.
 *
 * ## Two layers, on purpose
 *
 * 1. **Definition layer (this file, `Spec*` prefixed):** What a Report *is* —
 *    the data shape that survives storage, transport, AI generation, and
 *    cross-stack reuse. Mirrors `@objectstack/spec` exactly.
 *
 * 2. **Presentation layer (`reports.ts`, kept as `ReportComponentSchema`):** How the
 *    ObjectUI runtime *renders* a report — sections, toolbar config, schedule
 *    UI, conditional formatting, export buttons. These are ObjectUI-specific
 *    UX enhancements that the protocol does not (and should not) prescribe.
 *
 * ## Why both
 *
 * - JSON authored against the spec must render in ObjectUI without rewriting.
 * - ObjectUI can still ship richer UX (sections, schedules, export presets)
 *   without polluting the protocol.
 * - A converter (`specReportToPresentation`) lets the legacy renderer keep
 *   working while we migrate to spec-native rendering.
 *
 * ## Aggregation naming
 *
 * The UI spec uses `aggregate: 'unique'` while the data layer (ObjectQL,
 * `@objectstack/spec/data`) uses `count_distinct`. Use {@link mapAggregateToQL}
 * when translating a Report column into an ObjectQL `AggregationNode`.
 */

// `@objectstack/spec` 17.0.0-rc.6 retired every `…Input` alias and moved the
// bare name onto the `z.input` side: `Report`/`ReportChart` are now
// `z.input<typeof …Schema>` and `ReportParsed`/`ReportChartParsed` carry the
// `z.infer` shape these bindings used to read under the bare name. Both pairs
// below are therefore re-pointed so that each local alias keeps the meaning it
// had at rc.5 — `SpecReport`/`SpecReportChart` stay PARSED, `SpecReportInput`/
// `SpecReportChartInput` stay INPUT. Following the rename by name alone (`X` →
// `X`) would have silently swapped the two.
import type {
  ReportParsed as SpecReportType_,
  Report as SpecReportInputType_,
  ReportChartParsed as SpecReportChartType_,
  ReportChart as SpecReportChartInputType_,
  JoinedReportBlock as SpecJoinedReportBlockType_,
} from '@objectstack/spec/ui';

import {
  ReportSchema as SpecReportSchema_,
  ReportChartSchema as SpecReportChartSchema_,
  ReportType as SpecReportTypeEnum_,
  Report as SpecReportFactory_,
} from '@objectstack/spec/ui';

// ---------------------------------------------------------------------------
// Type re-exports (Spec* prefix to avoid collision with legacy reports.ts)
// ---------------------------------------------------------------------------

export type SpecReport = SpecReportType_;
export type SpecReportInput = SpecReportInputType_;
export type SpecReportChart = SpecReportChartType_;
export type SpecReportChartInput = SpecReportChartInputType_;

/**
 * The four report types defined by the UI Protocol.
 *
 * - `tabular`   — flat list, no grouping (think: "filtered SELECT")
 * - `summary`   — row-wise grouping with aggregations (a.k.a. grouped report)
 * - `matrix`    — row × column pivot (cross-tab)
 * - `joined`    — multiple independent report blocks stacked vertically
 */
export type SpecReportTypeName = 'tabular' | 'summary' | 'matrix' | 'joined';

/**
 * Aggregation enum as it appears in the *UI* Report spec
 * (`@objectstack/spec/ui` Report.columns[].aggregate).
 *
 * Note that this intentionally differs from the data-layer `AggregationFunction`
 * enum used in ObjectQL — see {@link mapAggregateToQL}.
 */
export type SpecReportAggregate = 'sum' | 'avg' | 'max' | 'min' | 'count' | 'unique';

/**
 * Date granularity for time-based grouping
 * (`Report.groupingsDown[].dateGranularity`).
 */
export type SpecReportDateGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

// ---------------------------------------------------------------------------
// Schema (Zod) re-exports
// ---------------------------------------------------------------------------

export const SpecReportSchema = SpecReportSchema_;
export const SpecReportChartSchema = SpecReportChartSchema_;
export const SpecReportTypeEnum = SpecReportTypeEnum_;

/**
 * Spec factory helper (`Report.create`).
 * Validates the input against the spec and returns a typed `SpecReport`.
 */
export const SpecReport = SpecReportFactory_;

// ---------------------------------------------------------------------------
// Aggregate mapping: UI spec → data layer (ObjectQL)
// ---------------------------------------------------------------------------

/**
 * The aggregation enum used by the ObjectQL data layer.
 * Kept as a string union (rather than importing the value from
 * `@objectstack/spec/data`) so this types-only package stays
 * runtime-dependency-free.
 */
export type QLAggregationFunction =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count_distinct'
  | 'array_agg'
  | 'string_agg';

/**
 * Translate a UI-layer aggregate name into the corresponding ObjectQL
 * `AggregationFunction`. The only non-trivial mapping is `unique → count_distinct`.
 *
 * @example
 * mapAggregateToQL('unique') // 'count_distinct'
 * mapAggregateToQL('sum')    // 'sum'
 */
export function mapAggregateToQL(aggregate: SpecReportAggregate): QLAggregationFunction {
  switch (aggregate) {
    case 'unique': return 'count_distinct';
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'count':
      return aggregate;
    default: {
      // Exhaustiveness check
      const _exhaustive: never = aggregate;
      void _exhaustive;
      return 'count';
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter: spec Report → legacy presentation ReportComponentSchema
// ---------------------------------------------------------------------------

// Lightweight structural type for the legacy presentation schema. We don't
// import `ReportComponentSchema` from `./reports` here to avoid a circular module load
// at type-resolution time (some downstream tooling crashes on that). The shape
// is intentionally permissive: the adapter only fills the fields it knows about.
export interface LegacyReportPresentationLike {
  type: 'report';
  title?: string;
  description?: string;
  // No `reportType`: `ReportComponentSchema.reportType` is retired (objectui#6152
  // round 4) — nothing read it, and this adapter was its only writer.
  fields?: Array<{
    name: string;
    label?: string;
    aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct';
  }>;
  groupBy?: Array<{
    field: string;
    label?: string;
    sort?: 'asc' | 'desc';
    dateGranularity?: SpecReportDateGranularity;
  }>;
}

function resolveLabel(label: unknown, fallback: string): string {
  // I18nLabel in the current spec is a plain string. We accept an object form
  // (`{ default: string, translations?: Record<string,string> }`) defensively
  // in case the spec evolves towards a richer i18n shape.
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    const def = (label as { default?: unknown }).default;
    if (typeof def === 'string') return def;
  }
  return fallback;
}

/**
 * Convert a spec `Report` into the legacy presentation `ReportComponentSchema` so the
 * existing `ReportRenderer`/`ReportViewer` can render it during migration.
 *
 * Since the ADR-0021 single-form cutover (`@objectstack/spec` 9.0) a report is
 * **dataset-bound**: `rows` (dimension names) and `values` (measure names) are
 * plain `string[]` that reference the dataset's semantic layer — the per-column
 * `label` / `aggregate` and per-grouping `sortOrder` / `dateGranularity` now
 * live in the dataset definition, not the report. This conversion is therefore
 * **lossy by construction**: it maps the names through and leaves label /
 * aggregation / sort / granularity for the dataset-aware renderer to resolve.
 */
export function specReportToPresentation(report: SpecReport): LegacyReportPresentationLike {
  // The spec report's `type` is deliberately NOT carried over. This adapter used to
  // write it as `reportType` (collapsing `joined` to `tabular`), and nothing on the
  // presentation path ever read it, so the key was retired on both faces of
  // `ReportComponentSchema` and this write went with it (objectui#6152 round 4).

  // `values` are measure names defined in the dataset; the report only refers
  // to them. Label / aggregation are resolved downstream from the dataset.
  const fields: NonNullable<LegacyReportPresentationLike['fields']> = (report.values ?? []).map(
    (name) => ({ name, label: resolveLabel(undefined, name) }),
  );

  // `rows` are dimension names from the dataset; sort / dateGranularity live in
  // the dataset definition, not the report.
  const groupBy: NonNullable<LegacyReportPresentationLike['groupBy']> = (
    report.rows ?? []
  ).map((field) => ({ field, sort: 'asc' as const }));

  return {
    type: 'report',
    title: resolveLabel(report.label, report.name),
    description: report.description
      ? resolveLabel(report.description, '')
      : undefined,
    fields,
    groupBy: groupBy.length > 0 ? groupBy : undefined,
  };
}

/**
 * Type guard: does this object look like a spec `Report` (vs. a legacy
 * presentation `ReportComponentSchema`)?
 *
 * Heuristic (spec 9.0, dataset-bound): spec reports carry `name` + a report
 * `type` and are **not** the legacy presentation shape (which carries
 * `type: 'report'` + `fields`). A non-joined spec report references a `dataset`;
 * a joined one carries `blocks`. We accept any of those discriminators.
 */
export function isSpecReport(value: unknown): value is SpecReport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string') return false;
  if (v.type === 'report' && Array.isArray(v.fields)) return false; // legacy presentation
  return typeof v.dataset === 'string'
    || Array.isArray((v as { blocks?: unknown }).blocks)
    || (typeof v.type === 'string' && ['tabular', 'summary', 'matrix', 'joined'].includes(v.type));
}

// ---------------------------------------------------------------------------
// Joined Report — derived from the spec (objectui#10940)
// ---------------------------------------------------------------------------

/**
 * A single block inside a `type: 'joined'` report: the spec's own
 * `JoinedReportBlock` (`@objectstack/spec/ui`), the INPUT shape of
 * `JoinedReportBlockSchema` — the same name with the same meaning it has
 * upstream, so the authoring tier is not silently swapped for the parsed one.
 *
 * Each block is an independently queried, ADR-0021 dataset-bound sub-report:
 * it names its own `dataset`, selects `rows` / `columns` / `values` by
 * dimension and measure NAME, may declare its own `runtimeFilter` (merged with
 * the container's at query time) and orders itself through `order`. Its `type`
 * defaults to `tabular`, and a block cannot itself be `joined` (no recursion).
 * The schema is closed: an undeclared key is refused, and `chart` is refused
 * by name (objectstack#20161).
 *
 * This replaced a hand-written interface that typed the legacy inline-query
 * block (`objectName`, `columns` as column objects, `groupingsDown`,
 * `groupingsAcross`, `filter`, `chart`, an index signature) while the spec
 * still erased its schema to `unknown` (through `@objectstack/spec` 17.4.0).
 * The spec's block has been typed since 17.5.0, so the local shape is gone
 * rather than kept beside it.
 */
export type JoinedReportBlock = SpecJoinedReportBlockType_;

/**
 * A `SpecReport` of `type: 'joined'` carrying its constituent blocks.
 * Use this as the schema input to `ReportRenderer` (dataset-bound blocks render
 * through `DatasetReportRenderer`).
 *
 * `blocks` is the spec's own `Report.blocks`, made required. It is on the
 * PARSED tier, like `SpecReport` itself (`type` and each `order[].direction`
 * are defaulted), so each element is assignable to the authoring-tier
 * {@link JoinedReportBlock}, but not the other way round.
 */
export type JoinedSpecReport = SpecReport & {
  type: 'joined';
  blocks: NonNullable<SpecReport['blocks']>;
};

/** Type guard for joined reports with a `blocks` array. */
export function isJoinedSpecReport(value: unknown): value is JoinedSpecReport {
  if (!isSpecReport(value)) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'joined' && Array.isArray((v as { blocks?: unknown }).blocks);
}
