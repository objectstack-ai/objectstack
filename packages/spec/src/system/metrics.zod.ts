// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Metrics Protocol - Performance and Operational Metrics
 * 
 * Comprehensive metrics collection and monitoring:
 * - Counter, Gauge, Histogram, Summary metric types
 * - Time-series data collection
 * - SLI/SLO definitions
 * - Metric aggregation and export
 * - Integration with monitoring systems (Prometheus, etc.)
 */

/**
 * Metric Type Enum
 * Standard Prometheus metric types
 */
import { lazySchema } from '../shared/lazy-schema';
export const MetricType = z.enum([
  'counter',    // Monotonically increasing value
  'gauge',      // Value that can go up and down
  'histogram',  // Observations bucketed by configurable ranges
  'summary',    // Observations with quantiles
]).describe('Metric type');

export type MetricType = z.input<typeof MetricType>;

/**
 * Metric Unit Enum
 * Standard units for metrics
 */
export const MetricUnit = z.enum([
  // Time units
  'nanoseconds',
  'microseconds',
  'milliseconds',
  'seconds',
  'minutes',
  'hours',
  'days',

  // Size units
  'bytes',
  'kilobytes',
  'megabytes',
  'gigabytes',
  'terabytes',

  // Rate units
  'requests_per_second',
  'events_per_second',
  'bytes_per_second',

  // Percentage
  'percent',
  'ratio',

  // Count
  'count',
  'operations',

  // Custom
  'custom',
]).describe('Metric unit');

export type MetricUnit = z.input<typeof MetricUnit>;

/**
 * Metric Aggregation Type
 */
export const MetricAggregationType = z.enum([
  'sum',       // Sum of all values
  'avg',       // Average of all values
  'min',       // Minimum value
  'max',       // Maximum value
  'count',     // Count of observations
  'p50',       // 50th percentile (median)
  'p75',       // 75th percentile
  'p90',       // 90th percentile
  'p95',       // 95th percentile
  'p99',       // 99th percentile
  'p999',      // 99.9th percentile
  'rate',      // Rate of change
  'stddev',    // Standard deviation
]).describe('Metric aggregation type');

export type MetricAggregationType = z.input<typeof MetricAggregationType>;

/**
 * Histogram Bucket Configuration
 */
export const HistogramBucketConfigSchema = lazySchema(() => z.object({
  /**
   * Bucket type
   */
  type: z.enum(['linear', 'exponential', 'explicit']).describe('Bucket type'),

  /**
   * Linear bucket configuration
   */
  linear: z.object({
    start: z.number().describe('Start value'),
    width: z.number().positive().describe('Bucket width'),
    count: z.number().int().positive().describe('Number of buckets'),
  }).optional(),

  /**
   * Exponential bucket configuration
   */
  exponential: z.object({
    start: z.number().positive().describe('Start value'),
    factor: z.number().positive().describe('Growth factor'),
    count: z.number().int().positive().describe('Number of buckets'),
  }).optional(),

  /**
   * Explicit bucket boundaries
   */
  explicit: z.object({
    boundaries: z.array(z.number()).describe('Bucket boundaries'),
  }).optional(),
}).describe('Histogram bucket configuration'));

export type HistogramBucketConfig = z.input<typeof HistogramBucketConfigSchema>;

/**
 * Metric Labels Schema
 * Key-value pairs for metric dimensions
 */
export const MetricLabelsSchema = lazySchema(() => z.record(z.string(), z.string()).describe('Metric labels'));

export type MetricLabels = z.input<typeof MetricLabelsSchema>;

/**
 * Metric Definition Schema
 */
export const MetricDefinitionSchema = lazySchema(() => z.object({
  /**
   * Metric name (snake_case)
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Metric name (snake_case)'),

  /**
   * Display label
   */
  label: z.string().optional().describe('Display label'),

  /**
   * Metric type
   */
  type: MetricType.describe('Metric type'),

  /**
   * Metric unit
   */
  unit: MetricUnit.optional().describe('Metric unit'),

  /**
   * Description
   */
  description: z.string().optional().describe('Metric description'),

  /**
   * Label names for this metric
   */
  labelNames: z.array(z.string()).optional().default([]).describe('Label names'),

  /**
   * Histogram configuration (for histogram type)
   */
  histogram: HistogramBucketConfigSchema.optional(),

  /**
   * Summary configuration (for summary type)
   */
  summary: z.object({
    /**
     * Quantiles to track
     */
    quantiles: z.array(z.number().min(0).max(1)).optional().default([0.5, 0.9, 0.99]),

    /**
     * Max age of observations in seconds
     */
    maxAge: z.number().int().positive().optional().default(600),

    /**
     * Number of age buckets
     */
    ageBuckets: z.number().int().positive().optional().default(5),
  }).optional(),

  /**
   * Enabled flag
   */
  enabled: z.boolean().optional().default(true),
}).describe('Metric definition'));

export type MetricDefinition = z.input<typeof MetricDefinitionSchema>;
/** Post-parse shape of {@link MetricDefinition} — defaults applied, transforms run (ADR-0122). */
export type MetricDefinitionParsed = z.infer<typeof MetricDefinitionSchema>;

/**
 * Metric Data Point Schema
 * A single metric observation
 */
export const MetricDataPointSchema = lazySchema(() => z.object({
  /**
   * Metric name
   */
  name: z.string().describe('Metric name'),

  /**
   * Metric type
   */
  type: MetricType.describe('Metric type'),

  /**
   * Timestamp (ISO 8601)
   */
  timestamp: z.string().datetime().describe('Observation timestamp'),

  /**
   * Value (for counter and gauge)
   */
  value: z.number().optional().describe('Metric value'),

  /**
   * Labels
   */
  labels: MetricLabelsSchema.optional().describe('Metric labels'),

  /**
   * Histogram data
   */
  histogram: z.object({
    count: z.number().int().nonnegative().describe('Total count'),
    sum: z.number().describe('Sum of all values'),
    buckets: z.array(z.object({
      upperBound: z.number().describe('Upper bound of bucket'),
      count: z.number().int().nonnegative().describe('Count in bucket'),
    })).describe('Histogram buckets'),
  }).optional(),

  /**
   * Summary data
   */
  summary: z.object({
    count: z.number().int().nonnegative().describe('Total count'),
    sum: z.number().describe('Sum of all values'),
    quantiles: z.array(z.object({
      quantile: z.number().min(0).max(1).describe('Quantile (0-1)'),
      value: z.number().describe('Quantile value'),
    })).describe('Summary quantiles'),
  }).optional(),
}).describe('Metric data point'));

export type MetricDataPoint = z.input<typeof MetricDataPointSchema>;

/**
 * Time Series Data Point Schema
 */
export const TimeSeriesDataPointSchema = lazySchema(() => z.object({
  /**
   * Timestamp (ISO 8601)
   */
  timestamp: z.string().datetime().describe('Timestamp'),

  /**
   * Value
   */
  value: z.number().describe('Value'),

  /**
   * Labels/tags
   */
  labels: z.record(z.string(), z.string()).optional().describe('Labels'),
}).describe('Time series data point'));

export type TimeSeriesDataPoint = z.input<typeof TimeSeriesDataPointSchema>;

/**
 * Time Series Schema
 */
export const TimeSeriesSchema = lazySchema(() => z.object({
  /**
   * Series name
   */
  name: z.string().describe('Series name'),

  /**
   * Series labels
   */
  labels: z.record(z.string(), z.string()).optional().describe('Series labels'),

  /**
   * Data points
   */
  dataPoints: z.array(TimeSeriesDataPointSchema).describe('Data points'),

  /**
   * Start time
   */
  startTime: z.string().datetime().optional().describe('Start time'),

  /**
   * End time
   */
  endTime: z.string().datetime().optional().describe('End time'),
}).describe('Time series'));

export type TimeSeries = z.input<typeof TimeSeriesSchema>;

/**
 * Metric Aggregation Configuration
 */
export const MetricAggregationConfigSchema = lazySchema(() => z.object({
  /**
   * Aggregation type
   */
  type: MetricAggregationType.describe('Aggregation type'),

  /**
   * Time window for aggregation
   */
  window: z.object({
    /**
     * Window size in seconds
     */
    size: z.number().int().positive().describe('Window size in seconds'),

    /**
     * Sliding window (true) or tumbling window (false)
     */
    sliding: z.boolean().optional().default(false),

    /**
     * Slide interval for sliding windows
     */
    slideInterval: z.number().int().positive().optional(),
  }).optional(),

  /**
   * Group by labels
   */
  groupBy: z.array(z.string()).optional().describe('Group by label names'),

  /**
   * Filters
   */
  filters: z.record(z.string(), z.unknown()).optional().describe('Filter criteria'),
}).describe('Metric aggregation configuration'));

export type MetricAggregationConfig = z.input<typeof MetricAggregationConfigSchema>;
/** Post-parse shape of {@link MetricAggregationConfig} — defaults applied, transforms run (ADR-0122). */
export type MetricAggregationConfigParsed = z.infer<typeof MetricAggregationConfigSchema>;

/**
 * Service Level Indicator (SLI) Schema
 */
export const ServiceLevelIndicatorSchema = lazySchema(() => z.object({
  /**
   * SLI name
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('SLI name (snake_case)'),

  /**
   * Display label
   */
  label: z.string().describe('Display label'),

  /**
   * Description
   */
  description: z.string().optional().describe('SLI description'),

  /**
   * Metric name this SLI is based on
   */
  metric: z.string().describe('Base metric name'),

  /**
   * SLI type
   */
  type: z.enum([
    'availability',    // Percentage of successful requests
    'latency',         // Response time percentile
    'throughput',      // Requests per second
    'error_rate',      // Error percentage
    'saturation',      // Resource utilization
    'custom',          // Custom calculation
  ]).describe('SLI type'),

  /**
   * Success criteria — structured threshold/operator OR a CEL predicate.
   */
  successCriteria: z.union([
    z.object({
      threshold: z.number().describe('Threshold value'),
      operator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).describe('Comparison operator'),
      percentile: z.number().min(0).max(1).optional().describe('Percentile (0-1)'),
    }),
    ExpressionInputSchema,
  ]).describe('Success criteria — structured or CEL predicate'),

  /**
   * Measurement window
   */
  window: z.object({
    /**
     * Window size in seconds
     */
    size: z.number().int().positive().describe('Window size in seconds'),

    /**
     * Rolling window (true) or calendar-aligned (false)
     */
    rolling: z.boolean().optional().default(true),
  }).describe('Measurement window'),

  /**
   * Enabled flag
   */
  enabled: z.boolean().optional().default(true),
}).describe('Service Level Indicator'));

export type ServiceLevelIndicator = z.input<typeof ServiceLevelIndicatorSchema>;
/** Post-parse shape of {@link ServiceLevelIndicator} — defaults applied, transforms run (ADR-0122). */
export type ServiceLevelIndicatorParsed = z.infer<typeof ServiceLevelIndicatorSchema>;

/**
 * Service Level Objective (SLO) Schema
 */
export const ServiceLevelObjectiveSchema = lazySchema(() => z.object({
  /**
   * SLO name
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('SLO name (snake_case)'),

  /**
   * Display label
   */
  label: z.string().describe('Display label'),

  /**
   * Description
   */
  description: z.string().optional().describe('SLO description'),

  /**
   * SLI this SLO is based on
   */
  sli: z.string().describe('SLI name'),

  /**
   * Target percentage (0-100)
   */
  target: z.number().min(0).max(100).describe('Target percentage'),

  /**
   * Time period for SLO
   */
  period: z.object({
    /**
     * Period type
     */
    type: z.enum(['rolling', 'calendar']).describe('Period type'),

    /**
     * Duration in seconds (for rolling)
     */
    duration: z.number().int().positive().optional().describe('Duration in seconds'),

    /**
     * Calendar period (for calendar)
     */
    calendar: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  }).describe('Time period'),

  /**
   * Error budget configuration
   */
  errorBudget: z.object({
    /**
     * Auto-calculated budget (1 - target)
     */
    enabled: z.boolean().optional().default(true),

    /**
     * Alert when budget consumed percentage exceeds threshold
     */
    alertThreshold: z.number().min(0).max(100).optional().default(80),

    /**
     * Burn rate alert windows
     */
    burnRateWindows: z.array(z.object({
      /**
       * Window size in seconds
       */
      window: z.number().int().positive().describe('Window size'),

      /**
       * Burn rate multiplier threshold
       */
      threshold: z.number().positive().describe('Burn rate threshold'),
    })).optional(),
  }).optional(),

  /**
   * Alert configuration
   */
  alerts: z.array(z.object({
    /**
     * Alert name
     */
    name: z.string().describe('Alert name'),

    /**
     * Severity
     */
    severity: z.enum(['info', 'warning', 'critical']).describe('Alert severity'),

    /**
     * Condition
     */
    condition: z.object({
      type: z.enum(['slo_breach', 'error_budget', 'burn_rate']).describe('Condition type'),
      threshold: z.number().optional().describe('Threshold value'),
    }).describe('Alert condition'),
  })).optional().default([]),

  /**
   * Enabled flag
   */
  enabled: z.boolean().optional().default(true),
}).describe('Service Level Objective'));

export type ServiceLevelObjective = z.input<typeof ServiceLevelObjectiveSchema>;
/** Post-parse shape of {@link ServiceLevelObjective} — defaults applied, transforms run (ADR-0122). */
export type ServiceLevelObjectiveParsed = z.infer<typeof ServiceLevelObjectiveSchema>;

/**
 * Metric Export Configuration
 */
export const MetricExportConfigSchema = lazySchema(() => z.object({
  /**
   * Export type
   */
  type: z.enum([
    'prometheus',      // Prometheus exposition format
    'openmetrics',     // OpenMetrics format
    'graphite',        // Graphite plaintext protocol
    'statsd',          // StatsD protocol
    'influxdb',        // InfluxDB line protocol
    'datadog',         // Datadog agent
    'cloudwatch',      // AWS CloudWatch
    'stackdriver',     // Google Cloud Monitoring
    'azure_monitor',   // Azure Monitor
    'http',            // HTTP push
    'custom',          // Custom exporter
  ]).describe('Export type'),

  /**
   * Endpoint configuration
   */
  endpoint: z.string().optional().describe('Export endpoint'),

  /**
   * Export interval in seconds
   */
  interval: z.number().int().positive().optional().default(60),

  /**
   * Batch configuration
   */
  batch: z.object({
    enabled: z.boolean().optional().default(true),
    size: z.number().int().positive().optional().default(1000),
  }).optional(),

  /**
   * Authentication
   */
  auth: z.object({
    type: z.enum(['none', 'basic', 'bearer', 'api_key']).describe('Auth type'),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),

  /**
   * Additional configuration
   */
  config: z.record(z.string(), z.unknown()).optional().describe('Additional configuration'),
}).describe('Metric export configuration'));

export type MetricExportConfig = z.input<typeof MetricExportConfigSchema>;
/** Post-parse shape of {@link MetricExportConfig} — defaults applied, transforms run (ADR-0122). */
export type MetricExportConfigParsed = z.infer<typeof MetricExportConfigSchema>;

/**
 * Metrics Configuration Schema
 */
export const MetricsConfigSchema = lazySchema(() => z.object({
  /**
   * Configuration name
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .max(64)
    .describe('Configuration name (snake_case, max 64 chars)'),

  /**
   * Display label
   */
  label: z.string().describe('Display label'),

  /**
   * Enable metrics collection
   */
  enabled: z.boolean().optional().default(true),

  /**
   * Metric definitions
   */
  metrics: z.array(MetricDefinitionSchema).optional().default([]),

  /**
   * Default labels applied to all metrics
   */
  defaultLabels: MetricLabelsSchema.optional().default({}),

  /**
   * Aggregation configurations
   */
  aggregations: z.array(MetricAggregationConfigSchema).optional().default([]),

  /**
   * Service Level Indicators
   */
  slis: z.array(ServiceLevelIndicatorSchema).optional().default([]),

  /**
   * Service Level Objectives
   */
  slos: z.array(ServiceLevelObjectiveSchema).optional().default([]),

  /**
   * Export configurations
   */
  exports: z.array(MetricExportConfigSchema).optional().default([]),

  /**
   * Collection interval in seconds
   */
  collectionInterval: z.number().int().positive().optional().default(15),

  /**
   * Retention configuration
   */
  retention: z.object({
    /**
     * Retention period in seconds
     */
    period: z.number().int().positive().optional().default(604800), // 7 days

    /**
     * Downsampling configuration
     */
    downsampling: z.array(z.object({
      /**
       * After this duration, downsample to this resolution
       */
      afterSeconds: z.number().int().positive().describe('Downsample after seconds'),

      /**
       * Resolution in seconds
       */
      resolution: z.number().int().positive().describe('Downsampled resolution'),
    })).optional(),
  }).optional(),

  /**
   * Cardinality limits
   */
  cardinalityLimits: z.object({
    /**
     * Maximum unique label combinations per metric
     */
    maxLabelCombinations: z.number().int().positive().optional().default(10000),

    /**
     * Action when limit exceeded
     */
    onLimitExceeded: z.enum(['drop', 'sample', 'alert']).optional().default('alert'),
  }).optional(),
}).describe('Metrics configuration'));

export type MetricsConfig = z.input<typeof MetricsConfigSchema>;
/** Post-parse shape of {@link MetricsConfig} — defaults applied, transforms run (ADR-0122). */
export type MetricsConfigParsed = z.infer<typeof MetricsConfigSchema>;
