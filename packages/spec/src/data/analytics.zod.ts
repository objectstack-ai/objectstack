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
 */
export const MetricSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique metric ID'),
  label: z.string().describe('Human readable label'),
  description: z.string().optional(),
  
  type: AggregationMetricType,
  
  /** Source Calculation */
  sql: z.string().describe('SQL expression or field reference'),
  
  /** Filtering for this specific metric (e.g. "Revenue from Premium Users") */
  filters: z.array(z.object({
    sql: z.string()
  })).optional(),
  
  /** Format for display (e.g. "currency", "percent") */
  format: z.string().optional(),
}));

/**
 * Dimension Schema
 * A categorical attribute to group by (e.g., "Product Category", "Order Date").
 */
export const DimensionSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique dimension ID'),
  label: z.string().describe('Human readable label'),
  description: z.string().optional(),
  
  type: DimensionType,
  
  /** Source Column */
  sql: z.string().describe('SQL expression or column reference'),
  
  /** For Time Dimensions: Supported Granularities */
  granularities: z.array(TimeUpdateInterval).optional(),
}));

/**
 * Join Schema
 * Defines how this cube relates to others.
 */
export const CubeJoinSchema = lazySchema(() => z.object({
  name: z.string().describe('Target cube name'),
  relationship: z.enum(['one_to_one', 'one_to_many', 'many_to_one']).default('many_to_one'),
  sql: z.string().describe('Join condition (ON clause)'),
}));

/**
 * Cube Schema
 * A logical data model representing a business entity or process for analysis.
 * Maps physical tables to business metrics and dimensions.
 */
export const CubeSchema = lazySchema(() => z.object({
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
  refreshKey: z.object({
    every: z.string().optional(), // e.g. "1 hour"
    sql: z.string().optional(),   // SQL to check for data changes
  }).optional(),
  
  /** Access Control */
  public: z.boolean().default(false),
}));

/**
 * Analytics Query Schema
 * The request format for the Analytics API.
 */
export const AnalyticsQuerySchema = lazySchema(() => z.object({
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

  timeDimensions: z.array(z.object({
    dimension: z.string(),
    granularity: TimeUpdateInterval.optional(),
    dateRange: z.union([
      z.string(), // "Last 7 days"
      z.array(z.string()) // ["2023-01-01", "2023-01-31"]
    ]).optional(),
  })).optional(),

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
}));

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

