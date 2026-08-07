// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Tracing Protocol - Distributed Tracing & Observability
 * 
 * Comprehensive distributed tracing based on OpenTelemetry standards:
 * - Trace context propagation
 * - Span creation and management
 * - Sampling strategies
 * - Integration with tracing backends (Jaeger, Zipkin, etc.)
 * - W3C Trace Context standard compliance
 */

/**
 * Trace State Schema
 * W3C Trace Context tracestate header
 */
import { lazySchema } from '../shared/lazy-schema';
export const TraceStateSchema = lazySchema(() => z.object({
  /**
   * Vendor-specific key-value pairs
   */
  entries: z.record(z.string(), z.string()).describe('Trace state entries'),
}).describe('Trace state'));

export type TraceState = z.input<typeof TraceStateSchema>;

/**
 * Trace Flags Enum
 * W3C Trace Context trace flags
 */
export const TraceFlagsSchema = lazySchema(() => z.number().int().min(0).max(255).describe('Trace flags bitmap'));

export type TraceFlags = z.input<typeof TraceFlagsSchema>;

/**
 * Trace Context Schema
 * W3C Trace Context standard
 */
export const TraceContextSchema = lazySchema(() => z.object({
  /**
   * Trace ID (128-bit identifier, 32 hex chars)
   */
  traceId: z.string()
    .regex(/^[0-9a-f]{32}$/)
    .describe('Trace ID (32 hex chars)'),

  /**
   * Span ID (64-bit identifier, 16 hex chars)
   */
  spanId: z.string()
    .regex(/^[0-9a-f]{16}$/)
    .describe('Span ID (16 hex chars)'),

  /**
   * Trace flags (8-bit)
   */
  traceFlags: TraceFlagsSchema.optional().default(1),

  /**
   * Trace state (vendor-specific)
   */
  traceState: TraceStateSchema.optional(),

  /**
   * Parent span ID
   */
  parentSpanId: z.string()
    .regex(/^[0-9a-f]{16}$/)
    .optional()
    .describe('Parent span ID (16 hex chars)'),

  /**
   * Is sampled
   */
  sampled: z.boolean().optional().default(true),

  /**
   * Remote context (from incoming request)
   */
  remote: z.boolean().optional().default(false),
}).describe('Trace context (W3C Trace Context)'));

export type TraceContext = z.input<typeof TraceContextSchema>;
/** Post-parse shape of {@link TraceContext} — defaults applied, transforms run (ADR-0122). */
export type TraceContextParsed = z.infer<typeof TraceContextSchema>;

/**
 * Span Kind Enum
 * OpenTelemetry span kinds
 */
export const SpanKind = z.enum([
  'internal',   // Internal operation
  'server',     // Server-side request handling
  'client',     // Client-side request
  'producer',   // Message producer
  'consumer',   // Message consumer
]).describe('Span kind');

export type SpanKind = z.input<typeof SpanKind>;

/**
 * Span Status Enum
 * OpenTelemetry span status
 */
export const SpanStatus = z.enum([
  'unset',      // Default status
  'ok',         // Successful operation
  'error',      // Error occurred
]).describe('Span status');

export type SpanStatus = z.input<typeof SpanStatus>;

/**
 * Span Attribute Value Schema
 */
export const SpanAttributeValueSchema = lazySchema(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]).describe('Span attribute value'));

export type SpanAttributeValue = z.input<typeof SpanAttributeValueSchema>;

/**
 * Span Attributes Schema
 * OpenTelemetry semantic conventions
 */
export const SpanAttributesSchema = lazySchema(() => z.record(z.string(), SpanAttributeValueSchema).describe('Span attributes'));

export type SpanAttributes = z.input<typeof SpanAttributesSchema>;

/**
 * Span Event Schema
 */
export const SpanEventSchema = lazySchema(() => z.object({
  /**
   * Event name
   */
  name: z.string().describe('Event name'),

  /**
   * Event timestamp (ISO 8601)
   */
  timestamp: z.string().datetime().describe('Event timestamp'),

  /**
   * Event attributes
   */
  attributes: SpanAttributesSchema.optional().describe('Event attributes'),
}).describe('Span event'));

export type SpanEvent = z.input<typeof SpanEventSchema>;

/**
 * Span Link Schema
 * Links to other spans
 */
export const SpanLinkSchema = lazySchema(() => z.object({
  /**
   * Linked trace context
   */
  context: TraceContextSchema.describe('Linked trace context'),

  /**
   * Link attributes
   */
  attributes: SpanAttributesSchema.optional().describe('Link attributes'),
}).describe('Span link'));

export type SpanLink = z.input<typeof SpanLinkSchema>;
/** Post-parse shape of {@link SpanLink} — defaults applied, transforms run (ADR-0122). */
export type SpanLinkParsed = z.infer<typeof SpanLinkSchema>;

/**
 * Span Schema
 * OpenTelemetry span representation
 */
export const SpanSchema = lazySchema(() => z.object({
  /**
   * Trace context
   */
  context: TraceContextSchema.describe('Trace context'),

  /**
   * Span name
   */
  name: z.string().describe('Span name'),

  /**
   * Span kind
   */
  kind: SpanKind.optional().default('internal'),

  /**
   * Start time (ISO 8601)
   */
  startTime: z.string().datetime().describe('Span start time'),

  /**
   * End time (ISO 8601)
   */
  endTime: z.string().datetime().optional().describe('Span end time'),

  /**
   * Duration in milliseconds
   */
  duration: z.number().nonnegative().optional().describe('Duration in milliseconds'),

  /**
   * Span status
   */
  status: z.object({
    code: SpanStatus.describe('Status code'),
    message: z.string().optional().describe('Status message'),
  }).optional(),

  /**
   * Span attributes
   */
  attributes: SpanAttributesSchema.optional().default({}),

  /**
   * Span events
   */
  events: z.array(SpanEventSchema).optional().default([]),

  /**
   * Span links
   */
  links: z.array(SpanLinkSchema).optional().default([]),

  /**
   * Resource attributes
   */
  resource: SpanAttributesSchema.optional().describe('Resource attributes'),

  /**
   * Instrumentation library
   */
  instrumentationLibrary: z.object({
    name: z.string().describe('Library name'),
    version: z.string().optional().describe('Library version'),
  }).optional(),
}).describe('OpenTelemetry span'));

export type Span = z.input<typeof SpanSchema>;
/** Post-parse shape of {@link Span} — defaults applied, transforms run (ADR-0122). */
export type SpanParsed = z.infer<typeof SpanSchema>;

/**
 * Sampling Decision Enum
 */
export const SamplingDecision = z.enum([
  'drop',           // Do not record or export
  'record_only',    // Record but do not export
  'record_and_sample', // Record and export
]).describe('Sampling decision');

export type SamplingDecision = z.input<typeof SamplingDecision>;

/**
 * Sampling Strategy Type Enum
 */
export const SamplingStrategyType = z.enum([
  'always_on',          // Always sample
  'always_off',         // Never sample
  'trace_id_ratio',     // Sample based on trace ID ratio
  'rate_limiting',      // Rate-limited sampling
  'parent_based',       // Respect parent span sampling decision
  'probability',        // Probability-based sampling
  'composite',          // Combine multiple strategies
  'custom',             // Custom sampling logic
]).describe('Sampling strategy type');

export type SamplingStrategyType = z.input<typeof SamplingStrategyType>;

/**
 * Trace Sampling Configuration Schema
 */
export const TraceSamplingConfigSchema = lazySchema(() => z.object({
  /**
   * Sampling strategy type
   */
  type: SamplingStrategyType.describe('Sampling strategy'),

  /**
   * Sample ratio (0.0 to 1.0) for trace_id_ratio and probability strategies
   */
  ratio: z.number().min(0).max(1).optional().describe('Sample ratio (0-1)'),

  /**
   * Rate limit (traces per second) for rate_limiting strategy
   */
  rateLimit: z.number().positive().optional().describe('Traces per second'),

  /**
   * Parent-based configuration
   */
  parentBased: z.object({
    /**
     * Sampler to use when parent is sampled
     */
    whenParentSampled: SamplingStrategyType.optional().default('always_on'),

    /**
     * Sampler to use when parent is not sampled
     */
    whenParentNotSampled: SamplingStrategyType.optional().default('always_off'),

    /**
     * Sampler to use when there is no parent (root span)
     */
    root: SamplingStrategyType.optional().default('trace_id_ratio'),

    /**
     * Root sampler ratio
     */
    rootRatio: z.number().min(0).max(1).optional().default(0.1),
  }).optional(),

  /**
   * Composite sampling (multiple strategies)
   */
  composite: z.array(z.object({
    strategy: SamplingStrategyType.describe('Strategy type'),
    ratio: z.number().min(0).max(1).optional(),
    condition: z.union([
      z.record(z.string(), z.unknown()),
      ExpressionInputSchema,
    ]).optional().describe('Condition for this strategy — structured filter or CEL predicate'),
  })).optional(),

  /**
   * Sampling rules
   */
  rules: z.array(z.object({
    /**
     * Rule name
     */
    name: z.string().describe('Rule name'),

    /**
     * Match condition
     */
    match: z.object({
      /**
       * Service name pattern
       */
      service: z.string().optional(),

      /**
       * Span name pattern (regex)
       */
      spanName: z.string().optional(),

      /**
       * Attribute filters
       */
      attributes: z.record(z.string(), z.unknown()).optional(),
    }).optional(),

    /**
     * Sampling decision for matching spans
     */
    decision: SamplingDecision.describe('Sampling decision'),

    /**
     * Sample rate for this rule
     */
    rate: z.number().min(0).max(1).optional(),
  })).optional().default([]),

  /**
   * Custom sampler ID (for custom strategy)
   */
  customSamplerId: z.string().optional().describe('Custom sampler identifier'),
}).describe('Trace sampling configuration'));

export type TraceSamplingConfig = z.input<typeof TraceSamplingConfigSchema>;
/** Post-parse shape of {@link TraceSamplingConfig} — defaults applied, transforms run (ADR-0122). */
export type TraceSamplingConfigParsed = z.infer<typeof TraceSamplingConfigSchema>;

/**
 * Trace Context Propagation Format Enum
 */
export const TracePropagationFormat = z.enum([
  'w3c',            // W3C Trace Context
  'b3',             // Zipkin B3 (single header)
  'b3_multi',       // Zipkin B3 (multi header)
  'jaeger',         // Jaeger propagation
  'xray',           // AWS X-Ray
  'ottrace',        // OpenTracing
  'custom',         // Custom format
]).describe('Trace propagation format');

export type TracePropagationFormat = z.input<typeof TracePropagationFormat>;

/**
 * Trace Context Propagation Schema
 */
export const TraceContextPropagationSchema = lazySchema(() => z.object({
  /**
   * Propagation formats (in priority order)
   */
  formats: z.array(TracePropagationFormat).optional().default(['w3c']),

  /**
   * Extract context from incoming requests
   */
  extract: z.boolean().optional().default(true),

  /**
   * Inject context into outgoing requests
   */
  inject: z.boolean().optional().default(true),

  /**
   * Custom header mappings
   */
  headers: z.object({
    /**
     * Trace ID header name
     */
    traceId: z.string().optional(),

    /**
     * Span ID header name
     */
    spanId: z.string().optional(),

    /**
     * Trace flags header name
     */
    traceFlags: z.string().optional(),

    /**
     * Trace state header name
     */
    traceState: z.string().optional(),
  }).optional(),

  /**
   * Baggage propagation
   */
  baggage: z.object({
    /**
     * Enable baggage propagation
     */
    enabled: z.boolean().optional().default(true),

    /**
     * Maximum baggage size in bytes
     */
    maxSize: z.number().int().positive().optional().default(8192),

    /**
     * Allowed baggage keys (whitelist)
     */
    allowedKeys: z.array(z.string()).optional(),
  }).optional(),
}).describe('Trace context propagation'));

export type TraceContextPropagation = z.input<typeof TraceContextPropagationSchema>;
/** Post-parse shape of {@link TraceContextPropagation} — defaults applied, transforms run (ADR-0122). */
export type TraceContextPropagationParsed = z.infer<typeof TraceContextPropagationSchema>;

/**
 * OpenTelemetry Exporter Type Enum
 */
export const OtelExporterType = z.enum([
  'otlp_http',      // OTLP over HTTP
  'otlp_grpc',      // OTLP over gRPC
  'jaeger',         // Jaeger
  'zipkin',         // Zipkin
  'console',        // Console (for debugging)
  'datadog',        // Datadog
  'honeycomb',      // Honeycomb
  'lightstep',      // Lightstep
  'newrelic',       // New Relic
  'custom',         // Custom exporter
]).describe('OpenTelemetry exporter type');

export type OtelExporterType = z.input<typeof OtelExporterType>;

/**
 * OpenTelemetry Compatibility Schema
 */
export const OpenTelemetryCompatibilitySchema = lazySchema(() => z.object({
  /**
   * OpenTelemetry SDK version
   */
  sdkVersion: z.string().optional().describe('OTel SDK version'),

  /**
   * Exporter configuration
   */
  exporter: z.object({
    /**
     * Exporter type
     */
    type: OtelExporterType.describe('Exporter type'),

    /**
     * Endpoint URL
     */
    endpoint: z.string().url().optional().describe('Exporter endpoint'),

    /**
     * Protocol version
     */
    protocol: z.string().optional().describe('Protocol version'),

    /**
     * Headers
     */
    headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),

    /**
     * Timeout in milliseconds
     */
    timeout: z.number().int().positive().optional().default(10000),

    /**
     * Compression
     */
    compression: z.enum(['none', 'gzip']).optional().default('none'),

    /**
     * Batch configuration
     */
    batch: z.object({
      /**
       * Maximum batch size
       */
      maxBatchSize: z.number().int().positive().optional().default(512),

      /**
       * Maximum queue size
       */
      maxQueueSize: z.number().int().positive().optional().default(2048),

      /**
       * Export timeout in milliseconds
       */
      exportTimeout: z.number().int().positive().optional().default(30000),

      /**
       * Scheduled delay in milliseconds
       */
      scheduledDelay: z.number().int().positive().optional().default(5000),
    }).optional(),
  }).describe('Exporter configuration'),

  /**
   * Resource attributes (service identification)
   */
  resource: z.object({
    /**
     * Service name
     */
    serviceName: z.string().describe('Service name'),

    /**
     * Service version
     */
    serviceVersion: z.string().optional().describe('Service version'),

    /**
     * Service instance ID
     */
    serviceInstanceId: z.string().optional().describe('Service instance ID'),

    /**
     * Service namespace
     */
    serviceNamespace: z.string().optional().describe('Service namespace'),

    /**
     * Deployment environment
     */
    deploymentEnvironment: z.string().optional().describe('Deployment environment'),

    /**
     * Additional resource attributes
     */
    attributes: SpanAttributesSchema.optional().describe('Additional resource attributes'),
  }).describe('Resource attributes'),

  /**
   * Instrumentation configuration
   */
  instrumentation: z.object({
    /**
     * Auto-instrumentation enabled
     */
    autoInstrumentation: z.boolean().optional().default(true),

    /**
     * Instrumentation libraries to enable
     */
    libraries: z.array(z.string()).optional().describe('Enabled libraries'),

    /**
     * Instrumentation libraries to disable
     */
    disabledLibraries: z.array(z.string()).optional().describe('Disabled libraries'),
  }).optional(),

  /**
   * Semantic conventions version
   */
  semanticConventionsVersion: z.string().optional().describe('Semantic conventions version'),
}).describe('OpenTelemetry compatibility configuration'));

export type OpenTelemetryCompatibility = z.input<typeof OpenTelemetryCompatibilitySchema>;
/** Post-parse shape of {@link OpenTelemetryCompatibility} — defaults applied, transforms run (ADR-0122). */
export type OpenTelemetryCompatibilityParsed = z.infer<typeof OpenTelemetryCompatibilitySchema>;

/**
 * Tracing Configuration Schema
 */
export const TracingConfigSchema = lazySchema(() => z.object({
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
   * Enable tracing
   */
  enabled: z.boolean().optional().default(true),

  /**
   * Sampling configuration
   */
  sampling: TraceSamplingConfigSchema.optional().default({ type: 'always_on', rules: [] }),

  /**
   * Context propagation
   */
  propagation: TraceContextPropagationSchema.optional().default({ formats: ['w3c'], extract: true, inject: true }),

  /**
   * OpenTelemetry configuration
   */
  openTelemetry: OpenTelemetryCompatibilitySchema.optional(),

  /**
   * Span limits
   */
  spanLimits: z.object({
    /**
     * Maximum number of attributes per span
     */
    maxAttributes: z.number().int().positive().optional().default(128),

    /**
     * Maximum number of events per span
     */
    maxEvents: z.number().int().positive().optional().default(128),

    /**
     * Maximum number of links per span
     */
    maxLinks: z.number().int().positive().optional().default(128),

    /**
     * Maximum attribute value length
     */
    maxAttributeValueLength: z.number().int().positive().optional().default(4096),
  }).optional(),

  /**
   * Trace ID generator
   */
  traceIdGenerator: z.enum(['random', 'uuid', 'custom']).optional().default('random'),

  /**
   * Custom trace ID generator ID
   */
  customTraceIdGeneratorId: z.string().optional().describe('Custom generator identifier'),

  /**
   * Performance configuration
   */
  performance: z.object({
    /**
     * Async span export
     */
    asyncExport: z.boolean().optional().default(true),

    /**
     * Background export interval in milliseconds
     */
    exportInterval: z.number().int().positive().optional().default(5000),
  }).optional(),
}).describe('Tracing configuration'));

export type TracingConfig = z.input<typeof TracingConfigSchema>;
/** Post-parse shape of {@link TracingConfig} — defaults applied, transforms run (ADR-0122). */
export type TracingConfigParsed = z.infer<typeof TracingConfigSchema>;
