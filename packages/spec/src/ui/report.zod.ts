// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { ChartConfigSchema } from './chart.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { ResponsiveConfigSchema, PerformanceConfigSchema } from './responsive.zod';

/**
 * Report Type Enum
 */
import { lazySchema } from '../shared/lazy-schema';
export const ReportType = z.enum([
  'tabular',   // Simple list
  'summary',   // Grouped by row
  'matrix',    // Grouped by row and column
  'joined'     // Joined multiple blocks
]);

/**
 * Report Column Schema
 */
export const ReportColumnSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name'),
  label: I18nLabelSchema.optional().describe('Override label'),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'unique']).optional().describe('Aggregation function'),
  /** Responsive visibility/priority per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive visibility for this column'),
}));

/**
 * Report Grouping Schema
 */
export const ReportGroupingSchema = lazySchema(() => z.object({
  field: z.string().describe('Field to group by'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  dateGranularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional().describe('For date fields'),
}));

/**
 * Report Chart Schema
 * Embedded visualization configuration using unified chart taxonomy.
 */
export const ReportChartSchema = lazySchema(() => ChartConfigSchema.extend({
  /** Report-specific chart configuration */
  xAxis: z.string().describe('Grouping field for X-Axis'),
  yAxis: z.string().describe('Summary field for Y-Axis'),
  groupBy: z.string().optional().describe('Additional grouping field'),
}));

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
export const JoinedReportBlockSchema: z.ZodTypeAny = lazySchema(() => z.object({
  /** Stable id for the block (used as react key, telemetry, deeplinks). */
  name: SnakeCaseIdentifierSchema,
  /** Human label shown above the block. Falls back to `name`. */
  label: I18nLabelSchema.optional(),
  /** Optional description rendered below the label. */
  description: I18nLabelSchema.optional(),
  /** Block report type — `joined` is intentionally excluded (no recursion). */
  type: z.enum(['tabular', 'summary', 'matrix']).default('tabular'),
  /** Object queried by this block. Defaults to the container's objectName. */
  objectName: z.string().optional(),
  /** Columns to display / aggregate. Same shape as `Report.columns`. */
  columns: z.array(ReportColumnSchema),
  /** Row groupings (same shape as `Report.groupingsDown`). */
  groupingsDown: z.array(ReportGroupingSchema).optional(),
  /** Column groupings — only meaningful when `type: matrix`. */
  groupingsAcross: z.array(ReportGroupingSchema).optional(),
  /** Block-specific filter, ANDed with the container filter at render time. */
  filter: FilterConditionSchema.optional(),
  /** Optional inline chart configuration. */
  chart: ReportChartSchema.optional(),
}));

/**
 * Report Schema
 * Deep data analysis definition.
 */
export const ReportSchema = lazySchema(() => z.object({
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Report unique name'),
  label: I18nLabelSchema.describe('Report label'),
  description: I18nLabelSchema.optional(),

  /**
   * Data Source — inline single-object query.
   * Optional since ADR-0021: a report may instead bind to a semantic-layer
   * `dataset` (see `dataset`/`rows`/`values` below). Exactly one shape is used
   * per report; the `superRefine` enforces it. Required for the legacy inline
   * shape (no `dataset`).
   */
  objectName: z.string().optional().describe('Primary object (inline-query reports; omit when `dataset` is set)'),

  /** Report Configuration */
  type: ReportType.default('tabular').describe('Report format type'),

  columns: z.array(ReportColumnSchema).optional().describe('Columns to display (inline-query reports)'),

  /**
   * ADR-0021 — bind to a semantic-layer `dataset` (the governed alternative to
   * the inline `objectName` + `columns` query). When set, the report renders
   * the dataset's named measures grouped by the chosen dimensions — numbers
   * stay consistent with every other surface that uses the same dataset.
   * Additive / dual-form: existing inline reports are unchanged.
   */
  dataset: SnakeCaseIdentifierSchema.optional().describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) to group rows by. Dataset-bound only. */
  rows: z.array(z.string()).optional().describe('Dimension names down (dataset-bound)'),
  /** Measure names (from the dataset) to display. Dataset-bound only. */
  values: z.array(z.string()).optional().describe('Measure names to show (dataset-bound)'),
  /** Render-time scope filter, ANDed at query time. Dataset-bound only. */
  runtimeFilter: FilterConditionSchema.optional().describe('Render-time scope filter (dataset-bound)'),

  /** Grouping (for Summary/Matrix) */
  groupingsDown: z.array(ReportGroupingSchema).optional().describe('Row groupings'),
  groupingsAcross: z.array(ReportGroupingSchema).optional().describe('Column groupings (Matrix only)'),
  
  /** Filtering (MongoDB-style FilterCondition) */
  filter: FilterConditionSchema.optional().describe('Filter criteria'),
  
  /** Visualization */
  chart: ReportChartSchema.optional().describe('Embedded chart configuration'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),

  /** Performance optimization settings */
  performance: PerformanceConfigSchema.optional().describe('Performance optimization settings'),

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
  // ADR-0021 dual-form: a report is EITHER dataset-bound OR an inline query.
  if (r.dataset) {
    if (!r.values || r.values.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'a dataset-bound report needs `values` (measure names from the dataset).',
        path: ['values'],
      });
    }
  } else {
    // Legacy inline shape — keep requiring objectName + columns so existing
    // reports stay valid and a half-specified report is rejected.
    if (!r.objectName) {
      ctx.addIssue({
        code: 'custom',
        message: 'report needs `objectName` (or bind a `dataset`).',
        path: ['objectName'],
      });
    }
    if (!r.columns) {
      ctx.addIssue({
        code: 'custom',
        message: 'report needs `columns` (or bind a `dataset` with `values`).',
        path: ['columns'],
      });
    }
  }
}));

export type JoinedReportBlock = z.infer<typeof JoinedReportBlockSchema>;
export type JoinedReportBlockInput = z.input<typeof JoinedReportBlockSchema>;

/**
 * Report Types
 * 
 * Note: For configuration/definition contexts, use the Input types (e.g., ReportInput)
 * which allow optional fields with defaults to be omitted.
 */
export type Report = z.infer<typeof ReportSchema>;
export type ReportColumn = z.infer<typeof ReportColumnSchema>;
export type ReportGrouping = z.infer<typeof ReportGroupingSchema>;
export type ReportChart = z.infer<typeof ReportChartSchema>;

/**
 * Input Types for Report Configuration
 * Use these when defining reports in configuration files.
 */
export type ReportInput = z.input<typeof ReportSchema>;
export type ReportColumnInput = z.input<typeof ReportColumnSchema>;
export type ReportGroupingInput = z.input<typeof ReportGroupingSchema>;
export type ReportChartInput = z.input<typeof ReportChartSchema>;

/**
 * Report Factory Helper
 */
export const Report = {
  create: (config: ReportInput): Report => ReportSchema.parse(config),
} as const;
