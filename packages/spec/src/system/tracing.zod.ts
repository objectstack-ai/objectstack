// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

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
import { retiredKey } from '../shared/retired-key';
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
  // Renamed from `duration` (#15679, #14478 ruling B): the unit lived only in the
  // describe prose. OpenTelemetry, which this shape mirrors, carries the span
  // length as a start/end nanosecond pair rather than a key named `duration`, so
  // there is no external spelling to mirror here — this is a rename, not an
  // `externalVocabulary` marker.
  durationMs: z.number().nonnegative().optional().describe('Duration in milliseconds'),

  /** Tombstone for the rename above (#15679, ruling B on #14478). */
  duration: retiredKey(
    '`Span.duration` was renamed to `durationMs` in @objectstack/spec 17 — the unit of a '
    + 'duration-shaped number lives in the key name, not only in the describe prose. Rename '
    + 'the key to `durationMs`; the value (milliseconds) is unchanged.',
  ),

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
 * Why `tracing.sampling.composite[].condition` no longer takes a CEL predicate
 * (#18118).
 *
 * The slot was `z.union([<a structured filter record>, <the evaluated
 * expression schema>])`. The expression arm parsed, normalized a bare string to
 * `{ dialect: 'cel', source }`, registered, and was served back — and NOTHING
 * anywhere evaluated it. No composite sampler reads this key; an author (very
 * often an AI reading the generated reference page, ADR-0033) who wrote a
 * sampling condition got a green parse and no signal, indistinguishable from a
 * predicate that ran and answered. ADR-0049 enforce-or-remove, ruled A on this
 * card: application platforms do not carry trace-sampling conditions as
 * authorable application metadata — that lives in observability infrastructure
 * (OTel sampling policy), where it is structured rather than a free expression.
 * So the arm is REMOVED, not wired.
 *
 * Module-local on purpose: it is ONE slot's rule, not a published contract, so
 * it stays off `api-surface/` — the same reason `evaluatedExpressionUnionRefusal`
 * (which this replaces here) is package-internal.
 *
 * The REFUSED SET at this slot is unchanged from #15811 in one direction and
 * narrower in the other. An object carrying a `dialect` key was already refused
 * there (a bare record accepted `{ dialect: 'cel', ast }` as an ordinary filter,
 * which made #15811's narrowing inert until that arm learned to decline); it is
 * still refused, and now says WHY in the retirement's words instead of routing
 * the author to an arm that no longer exists. What genuinely narrows is the
 * expression arm's own accept set: a bare string and a healthy
 * `{ dialect: 'cel', source: '…' }` envelope were accepted and now are not. A
 * structured filter carrying no `dialect` key is accepted exactly as before.
 *
 * ⛔ No `os migrate meta` sentence: the house sentence is owed only where an
 * ADR-0087 conversion covers the surface (`shared/retired-key.ts` module
 * docblock). This retirement's disposition is a D3 SEMANTIC entry
 * (`observability-cel-predicates-retired`) — no transform can turn a predicate
 * into an attribute filter without inventing the attributes.
 *
 * ⚠️ The structured-filter arm is UNTOUCHED, and whether it is read by anything
 * is a separate measurement on its own card — this retirement makes no claim
 * about it.
 */
const SAMPLING_CONDITION_EXPRESSION_RETIRED =
  '`tracing.sampling.composite[].condition` no longer accepts a CEL predicate — the expression '
  + 'arm was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — nothing ever '
  + 'evaluated it, so a condition authored as an expression parsed, registered and read back '
  + 'while sampling nothing. Delete the expression and write a structured filter instead: a '
  + 'plain object of match criteria carrying no `dialect` key, e.g. '
  + '`{ service: \'api\', attributes: { \'http.route\': \'/v1/orders\' } }`. A sampling rule the '
  + 'structured filter cannot express belongs in your OpenTelemetry sampler configuration, not '
  + 'in application metadata.';

/**
 * The refusal for an input that is recognisably a RETIRED expression attempt.
 *
 * Deliberately narrow, the same discipline as `evaluatedExpressionUnionRefusal`:
 * the surviving arm is a structured filter, so blaming a mistyped filter on a
 * retired CEL arm would send the author to the wrong key. It answers only for a
 * string — the bare-string spelling the reference page advertised — and returns
 * `undefined` for everything else, so zod's own message stands. The ENVELOPE
 * spelling is answered by the `dialect` refine below, which sees the object
 * itself.
 */
function samplingConditionExpressionRefusal(input: unknown): string | undefined {
  return typeof input === 'string' ? SAMPLING_CONDITION_EXPRESSION_RETIRED : undefined;
}

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
    // ⚠️ The structured-filter arm must refuse an EXPRESSION-shaped object or
    // it swallows the shape this slot's RETIRED arm used to judge: a bare
    // `z.record(z.string(), z.unknown())` accepts `{ dialect: 'cel', source }`
    // as an ordinary filter, so an author whose predicate stopped being
    // evaluated would go on writing one and it would go on parsing — the exact
    // silent no-op #18118 removed. An object carrying `dialect` is an
    // expression attempt and is answered with the retirement prescription.
    //
    // ⚠️ `abort: true` is about the MESSAGE and never the accept set — the
    // refused set is identical either way, measured. It is kept from #15811 so
    // the refusal is answered once, at the slot, instead of being nested.
    condition: z.record(z.string(), z.unknown(), {
      error: (issue) => samplingConditionExpressionRefusal(issue.input),
    })
      .refine((value) => !('dialect' in value), {
        message: SAMPLING_CONDITION_EXPRESSION_RETIRED,
        abort: true,
      })
      .optional().describe('Condition for this strategy — a structured filter object of match criteria, carrying no `dialect` key. ⚠️ A CEL predicate is NOT accepted here: that arm was removed in 17.5.0 because nothing evaluated it, and an object carrying a `dialect` key is refused as an expression attempt.'),
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
     * Per-export request deadline, in milliseconds.
     *
     * Renamed from `timeout` (#17785, ruling A on #15939 executing #14478):
     * the unit lived in this JSDoc only and the key carried no `.describe()`
     * at all, so the reference page published a bare 10000. Tombstoned rather
     * than deleted because this nested object is not `.strict()`.
     */
    timeoutMs: z.number().int().positive().optional().default(10000)
      .describe('Exporter request timeout in milliseconds'),

    /** Tombstone for the rename above (#17785, ruling A on #15939). */
    timeout: retiredKey(
      '`OpenTelemetryCompatibility.exporter.timeout` was renamed to `timeoutMs` in '
      + '@objectstack/spec 17 — the unit of a duration-shaped number lives in the key name, '
      + 'not only in the describe prose. Its unit (milliseconds) lived in a source JSDoc '
      + 'only and the key carried no describe at all, so the reference-page reader got a '
      + 'bare 10000 and could not tell it from 10000 seconds. Rename the key to `timeoutMs`; '
      + 'the value (milliseconds) and the 10000 default are unchanged.',
    ),

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
       * Batch-processor export deadline, in milliseconds.
       *
       * Renamed from `exportTimeout` (#17785, ruling A on #15939 executing
       * #14478): the unit lived in this JSDoc only and the key carried no
       * `.describe()` at all. Tombstoned rather than deleted because this
       * nested object is not `.strict()`.
       */
      exportTimeoutMs: z.number().int().positive().optional().default(30000)
        .describe('Batch export timeout in milliseconds'),

      /**
       * Delay between two scheduled batch exports, in milliseconds.
       *
       * Renamed from `scheduledDelay` (#17785, ruling A on #15939 executing
       * #14478): the unit lived in this JSDoc only and the key carried no
       * `.describe()` at all. Tombstoned rather than deleted because this
       * nested object is not `.strict()`.
       */
      scheduledDelayMs: z.number().int().positive().optional().default(5000)
        .describe('Delay between scheduled batch exports, in milliseconds'),

      /** Tombstones for the two renames above (#17785, ruling A on #15939). */
      exportTimeout: retiredKey(
        '`OpenTelemetryCompatibility.exporter.batch.exportTimeout` was renamed to '
        + '`exportTimeoutMs` in @objectstack/spec 17 — the unit of a duration-shaped number '
        + 'lives in the key name, not only in the describe prose. Its unit (milliseconds) '
        + 'lived in a source JSDoc only and the key carried no describe at all, so the '
        + 'reference-page reader got a bare 30000. Rename the key to `exportTimeoutMs`; the '
        + 'value (milliseconds) and the 30000 default are unchanged.',
      ),
      scheduledDelay: retiredKey(
        '`OpenTelemetryCompatibility.exporter.batch.scheduledDelay` was renamed to '
        + '`scheduledDelayMs` in @objectstack/spec 17 — the unit of a duration-shaped number '
        + 'lives in the key name, not only in the describe prose. Its unit (milliseconds) '
        + 'lived in a source JSDoc only and the key carried no describe at all, so the '
        + 'reference-page reader got a bare 5000. Rename the key to `scheduledDelayMs`; the '
        + 'value (milliseconds) and the 5000 default are unchanged.',
      ),
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
     * Background span-export interval, in milliseconds.
     *
     * Renamed from `exportInterval` (#17785, ruling A on #15939 executing
     * #14478): the unit lived in this JSDoc only and the key carried no
     * `.describe()` at all. Tombstoned rather than deleted because this
     * nested object is not `.strict()`.
     */
    exportIntervalMs: z.number().int().positive().optional().default(5000)
      .describe('Background span-export interval in milliseconds'),

    /** Tombstone for the rename above (#17785, ruling A on #15939). */
    exportInterval: retiredKey(
      '`TracingConfig.performance.exportInterval` was renamed to `exportIntervalMs` in '
      + '@objectstack/spec 17 — the unit of a duration-shaped number lives in the key name, '
      + 'not only in the describe prose. Its unit (milliseconds) lived in a source JSDoc '
      + 'only and the key carried no describe at all, so the reference-page reader got a '
      + 'bare 5000. Rename the key to `exportIntervalMs`; the value (milliseconds) and the '
      + '5000 default are unchanged.',
    ),
  }).optional(),
}).describe('Tracing configuration'));

export type TracingConfig = z.input<typeof TracingConfigSchema>;
/** Post-parse shape of {@link TracingConfig} — defaults applied, transforms run (ADR-0122). */
export type TracingConfigParsed = z.infer<typeof TracingConfigSchema>;
