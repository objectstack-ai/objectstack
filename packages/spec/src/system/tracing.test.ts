import { describe, it, expect } from 'vitest';
import {
  TraceStateSchema,
  TraceFlagsSchema,
  TraceContextSchema,
  SpanKind,
  SpanStatus,
  SpanAttributeValueSchema,
  SpanEventSchema,
  SpanLinkSchema,
  SpanSchema,
  SamplingDecision,
  SamplingStrategyType,
  TraceSamplingConfigSchema,
  TracePropagationFormat,
  TraceContextPropagationSchema,
  OtelExporterType,
  OpenTelemetryCompatibilitySchema,
  TracingConfigSchema,
  type TraceContext,
  type Span,
  type TraceSamplingConfig,
  type OpenTelemetryCompatibility,
  type TracingConfig,
} from './tracing.zod';

describe('TraceFlagsSchema', () => {
  it('should accept valid trace flags', () => {
    expect(() => TraceFlagsSchema.parse(0)).not.toThrow();
    expect(() => TraceFlagsSchema.parse(1)).not.toThrow();
    expect(() => TraceFlagsSchema.parse(255)).not.toThrow();
  });

  it('should reject invalid trace flags', () => {
    expect(() => TraceFlagsSchema.parse(-1)).toThrow();
    expect(() => TraceFlagsSchema.parse(256)).toThrow();
  });
});

describe('TraceContextSchema', () => {
  it('should accept valid trace context', () => {
    const context: TraceContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: 1,
    };
    
    expect(() => TraceContextSchema.parse(context)).not.toThrow();
  });

  it('should apply defaults', () => {
    const context = TraceContextSchema.parse({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });
    
    expect(context.traceFlags).toBe(1);
    expect(context.sampled).toBe(true);
    expect(context.remote).toBe(false);
  });

  it('should accept parent span ID', () => {
    const context = TraceContextSchema.parse({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      parentSpanId: 'fedcba9876543210',
    });
    
    expect(context.parentSpanId).toBe('fedcba9876543210');
  });

  it('should validate trace ID format', () => {
    expect(() => TraceContextSchema.parse({
      traceId: 'invalid',
      spanId: '0123456789abcdef',
    })).toThrow();

    expect(() => TraceContextSchema.parse({
      traceId: '0123456789abcdef', // Too short
      spanId: '0123456789abcdef',
    })).toThrow();
  });

  it('should validate span ID format', () => {
    expect(() => TraceContextSchema.parse({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'invalid',
    })).toThrow();

    expect(() => TraceContextSchema.parse({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '01234567', // Too short
    })).toThrow();
  });
});

describe('SpanKind', () => {
  it('should accept valid span kinds', () => {
    const kinds = ['internal', 'server', 'client', 'producer', 'consumer'];
    
    kinds.forEach((kind) => {
      expect(() => SpanKind.parse(kind)).not.toThrow();
    });
  });
});

describe('SpanStatus', () => {
  it('should accept valid span statuses', () => {
    const statuses = ['unset', 'ok', 'error'];
    
    statuses.forEach((status) => {
      expect(() => SpanStatus.parse(status)).not.toThrow();
    });
  });
});

describe('SpanAttributeValueSchema', () => {
  it('should accept various attribute types', () => {
    expect(() => SpanAttributeValueSchema.parse('string value')).not.toThrow();
    expect(() => SpanAttributeValueSchema.parse(42)).not.toThrow();
    expect(() => SpanAttributeValueSchema.parse(true)).not.toThrow();
    expect(() => SpanAttributeValueSchema.parse(['a', 'b', 'c'])).not.toThrow();
    expect(() => SpanAttributeValueSchema.parse([1, 2, 3])).not.toThrow();
    expect(() => SpanAttributeValueSchema.parse([true, false])).not.toThrow();
  });
});

describe('SpanEventSchema', () => {
  it('should accept span event', () => {
    const event = SpanEventSchema.parse({
      name: 'exception',
      timestamp: '2024-01-15T10:30:00.000Z',
      attributes: {
        'exception.type': 'Error',
        'exception.message': 'Something went wrong',
      },
    });
    
    expect(event.name).toBe('exception');
  });
});

describe('SpanLinkSchema', () => {
  it('should accept span link', () => {
    const link = SpanLinkSchema.parse({
      context: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
      },
      attributes: {
        'link.type': 'follows_from',
      },
    });
    
    expect(link.context.traceId).toBe('0123456789abcdef0123456789abcdef');
  });
});

describe('SpanSchema', () => {
  it('should accept minimal span', () => {
    const span: Span = {
      context: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
      },
      name: 'http.request',
      startTime: '2024-01-15T10:30:00.000Z',
    };
    
    expect(() => SpanSchema.parse(span)).not.toThrow();
  });

  it('should accept full span with all fields', () => {
    const span: Span = {
      context: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        parentSpanId: 'fedcba9876543210',
        traceFlags: 1,
        sampled: true,
      },
      name: 'GET /api/users',
      kind: 'server',
      startTime: '2024-01-15T10:30:00.000Z',
      endTime: '2024-01-15T10:30:00.150Z',
      durationMs: 150,
      status: {
        code: 'ok',
      },
      attributes: {
        'http.method': 'GET',
        'http.url': '/api/users',
        'http.status_code': 200,
      },
      events: [
        {
          name: 'request.received',
          timestamp: '2024-01-15T10:30:00.000Z',
        },
      ],
      links: [],
      resource: {
        'service.name': 'api-server',
        'service.version': '1.0.0',
      },
      instrumentationLibrary: {
        name: 'opentelemetry-instrumentation-http',
        version: '0.35.0',
      },
    };
    
    expect(() => SpanSchema.parse(span)).not.toThrow();
  });

  it('should apply defaults', () => {
    const span = SpanSchema.parse({
      context: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
      },
      name: 'test.span',
      startTime: '2024-01-15T10:30:00.000Z',
    });
    
    expect(span.kind).toBe('internal');
    expect(span.attributes).toEqual({});
    expect(span.events).toEqual([]);
    expect(span.links).toEqual([]);
  });
});

describe('SamplingDecision', () => {
  it('should accept valid decisions', () => {
    const decisions = ['drop', 'record_only', 'record_and_sample'];
    
    decisions.forEach((decision) => {
      expect(() => SamplingDecision.parse(decision)).not.toThrow();
    });
  });
});

describe('SamplingStrategyType', () => {
  it('should accept valid strategy types', () => {
    const types = [
      'always_on', 'always_off', 'trace_id_ratio', 'rate_limiting',
      'parent_based', 'probability', 'composite', 'custom',
    ];
    
    types.forEach((type) => {
      expect(() => SamplingStrategyType.parse(type)).not.toThrow();
    });
  });
});

describe('TraceSamplingConfigSchema', () => {
  it('should accept always_on strategy', () => {
    const config: TraceSamplingConfig = {
      type: 'always_on',
    };
    
    expect(() => TraceSamplingConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept trace_id_ratio strategy', () => {
    const config: TraceSamplingConfig = {
      type: 'trace_id_ratio',
      ratio: 0.1,
    };
    
    expect(() => TraceSamplingConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept parent_based strategy', () => {
    const config: TraceSamplingConfig = {
      type: 'parent_based',
      parentBased: {
        whenParentSampled: 'always_on',
        whenParentNotSampled: 'always_off',
        root: 'trace_id_ratio',
        rootRatio: 0.2,
      },
    };
    
    expect(() => TraceSamplingConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept sampling rules', () => {
    const config: TraceSamplingConfig = {
      type: 'always_on',
      rules: [
        {
          name: 'health_check',
          match: {
            spanName: '/health',
          },
          decision: 'drop',
        },
        {
          name: 'errors',
          match: {
            attributes: { 'http.status_code': 500 },
          },
          decision: 'record_and_sample',
          rate: 1.0,
        },
      ],
    };
    
    expect(() => TraceSamplingConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply defaults', () => {
    const config = TraceSamplingConfigSchema.parse({
      type: 'always_on',
    });
    
    expect(config.rules).toEqual([]);
  });
});

describe('TracePropagationFormat', () => {
  it('should accept valid formats', () => {
    const formats = ['w3c', 'b3', 'b3_multi', 'jaeger', 'xray', 'ottrace', 'custom'];
    
    formats.forEach((format) => {
      expect(() => TracePropagationFormat.parse(format)).not.toThrow();
    });
  });
});

describe('TraceContextPropagationSchema', () => {
  it('should apply defaults', () => {
    const config = TraceContextPropagationSchema.parse({});
    
    expect(config.formats).toEqual(['w3c']);
    expect(config.extract).toBe(true);
    expect(config.inject).toBe(true);
  });

  it('should accept multiple formats', () => {
    const config = TraceContextPropagationSchema.parse({
      formats: ['w3c', 'b3', 'jaeger'],
    });
    
    expect(config.formats).toHaveLength(3);
  });

  it('should accept baggage configuration', () => {
    const config = TraceContextPropagationSchema.parse({
      baggage: {
        enabled: true,
        maxSize: 4096,
        allowedKeys: ['user-id', 'request-id'],
      },
    });
    
    expect(config.baggage?.maxSize).toBe(4096);
  });
});

describe('OtelExporterType', () => {
  it('should accept valid exporter types', () => {
    const types = [
      'otlp_http', 'otlp_grpc', 'jaeger', 'zipkin', 'console',
      'datadog', 'honeycomb', 'lightstep', 'newrelic', 'custom',
    ];
    
    types.forEach((type) => {
      expect(() => OtelExporterType.parse(type)).not.toThrow();
    });
  });
});

describe('OpenTelemetryCompatibilitySchema', () => {
  it('should accept minimal configuration', () => {
    const config: OpenTelemetryCompatibility = {
      exporter: {
        type: 'console',
      },
      resource: {
        serviceName: 'my-service',
      },
    };
    
    expect(() => OpenTelemetryCompatibilitySchema.parse(config)).not.toThrow();
  });

  it('should accept OTLP HTTP exporter', () => {
    const config: OpenTelemetryCompatibility = {
      exporter: {
        type: 'otlp_http',
        endpoint: 'https://otel-collector.example.com/v1/traces',
        headers: {
          'Authorization': 'Bearer token',
        },
      },
      resource: {
        serviceName: 'api-server',
        serviceVersion: '1.0.0',
        deploymentEnvironment: 'production',
      },
    };
    
    expect(() => OpenTelemetryCompatibilitySchema.parse(config)).not.toThrow();
  });

  it('should accept batch configuration', () => {
    const config: OpenTelemetryCompatibility = {
      exporter: {
        type: 'otlp_grpc',
        endpoint: 'otel-collector:4317',
        batch: {
          maxBatchSize: 1024,
          maxQueueSize: 4096,
          exportTimeoutMs: 60000,
          scheduledDelayMs: 10000,
        },
      },
      resource: {
        serviceName: 'test-service',
      },
    };
    
    expect(() => OpenTelemetryCompatibilitySchema.parse(config)).not.toThrow();
  });

  it('should apply defaults', () => {
    const config = OpenTelemetryCompatibilitySchema.parse({
      exporter: {
        type: 'console',
      },
      resource: {
        serviceName: 'test',
      },
    });
    
    expect(config.exporter.timeoutMs).toBe(10000);
    expect(config.exporter.compression).toBe('none');
  });
});

describe('TracingConfigSchema', () => {
  it('should accept minimal configuration', () => {
    const config: TracingConfig = {
      name: 'default_tracing',
      label: 'Default Tracing',
    };
    
    expect(() => TracingConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply defaults', () => {
    const config = TracingConfigSchema.parse({
      name: 'test_tracing',
      label: 'Test Tracing',
    });
    
    expect(config.enabled).toBe(true);
    expect(config.sampling?.type).toBe('always_on');
    expect(config.propagation?.formats).toEqual(['w3c']);
    expect(config.traceIdGenerator).toBe('random');
  });

  it('should accept full configuration', () => {
    const config: TracingConfig = {
      name: 'production_tracing',
      label: 'Production Tracing',
      enabled: true,
      sampling: {
        type: 'parent_based',
        parentBased: {
          root: 'trace_id_ratio',
          rootRatio: 0.1,
        },
      },
      propagation: {
        formats: ['w3c', 'b3'],
        extract: true,
        inject: true,
      },
      openTelemetry: {
        exporter: {
          type: 'otlp_http',
          endpoint: 'https://otel-collector/v1/traces',
        },
        resource: {
          serviceName: 'api-server',
          serviceVersion: '2.0.0',
          deploymentEnvironment: 'production',
        },
      },
      spanLimits: {
        maxAttributes: 256,
        maxEvents: 256,
        maxLinks: 64,
      },
      traceIdGenerator: 'random',
    };
    
    expect(() => TracingConfigSchema.parse(config)).not.toThrow();
  });

  it('should enforce snake_case naming', () => {
    expect(() => TracingConfigSchema.parse({
      name: 'CamelCase',
      label: 'Test',
    })).toThrow();
  });

  it('should enforce max length for name', () => {
    const longName = 'a'.repeat(65);
    expect(() => TracingConfigSchema.parse({
      name: longName,
      label: 'Test',
    })).toThrow();
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. The old spelling is a
// `retiredKey()` tombstone; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`. A span is runtime-emitted, so the silent-strip
// alternative is the real hazard here: an exporter still writing `duration`
// would have lost the measurement without any error at all.
describe('Span.duration carries its unit (#15679)', () => {
  const base = {
    context: { traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef' },
    name: 'GET /api/users',
    startTime: '2024-01-15T10:30:00.000Z',
  };

  it('REFUSES the retired `duration` with the rename in the message', () => {
    const result = SpanSchema.safeParse({ ...base, duration: 150 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'duration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`Span.duration` was renamed to `durationMs`');
  });

  it('accepts `durationMs` at the same magnitude and still refuses a negative one', () => {
    expect(SpanSchema.parse({ ...base, durationMs: 150 }).durationMs).toBe(150);
    expect(SpanSchema.safeParse({ ...base, durationMs: -1 }).success).toBe(false);
  });

});

// #17785, ruling A on #15939 (per-file remediation of #14478). The four tracing
// durations whose unit lived in a source JSDoc only — and whose `.describe()`
// did not exist at all, so the published reference row was a bare integer.
//
// This block REPLACES, and relocates, the guard that used to close the #15679
// describe above: `it('leaves the OTel exporter timeout alone — its describe
// names no unit, so it is outside the population')`. That pin was written to
// catch exactly this sweep, so it succeeds by failing: its key, its "names no
// unit" clause and its "outside the population" clause all go false here. It is
// replaced by the three-part shape #15679 itself set on this file — a refusal
// pin asserting the issue CODE and the prescription (never a bare `toThrow()`),
// an acceptance pin at the same magnitude and the same default, and a describe
// pin proving the unit now reaches the published channel — and moved out of a
// describe headed `Span.duration carries its unit`, which is not its subject.
//
// These shapes are NOT `.strict()`, so `unrecognized_keys` was never the
// alternative: a bare deletion would have been a silent strip that lands a
// default on an exporter deadline.
describe('the OTel exporter and performance durations carry their unit (#17785)', () => {
  const otelBase = {
    exporter: { type: 'console' as const },
    resource: { serviceName: 'test' },
  };
  const tracingBase = { name: 'test_tracing', label: 'Test Tracing' };

  /**
   * `describe()` is what `content/docs/references/**` publishes; JSDoc is not.
   *
   * Descends by `shape`, unwrapping wrappers (`.optional()`, `.default()`) only
   * to reach a CHILD — never on the leaf, whose `description` `.describe()` set
   * on the outermost node and which an unwrap would discard.
   */
  const shapeOf = (node: unknown): Record<string, unknown> | undefined => {
    let cur = node as { shape?: Record<string, unknown>; def?: { innerType?: unknown } };
    while (cur && !cur.shape && cur.def?.innerType) cur = cur.def.innerType as typeof cur;
    return cur?.shape;
  };
  const describeOf = (schema: unknown, path: readonly string[]): string | undefined => {
    let cursor: unknown = schema;
    for (const segment of path) {
      const shape = shapeOf(cursor);
      if (!shape) return undefined;
      cursor = shape[segment];
    }
    return (cursor as { description?: string } | undefined)?.description;
  };

  it.each([
    ['exporter.timeout', 'timeoutMs', 10000],
    ['exporter.batch.exportTimeout', 'exportTimeoutMs', 30000],
    ['exporter.batch.scheduledDelay', 'scheduledDelayMs', 5000],
  ] as const)('REFUSES the retired `%s` with the rename in the message', (retired, renamed) => {
    const leaf = retired.split('.').pop()!;
    const body = retired.startsWith('exporter.batch')
      ? { ...otelBase, exporter: { ...otelBase.exporter, batch: { [leaf]: 1234 } } }
      : { ...otelBase, exporter: { ...otelBase.exporter, [leaf]: 1234 } };
    const result = OpenTelemetryCompatibilitySchema.safeParse(body);
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === `${retired}`);
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      `\`OpenTelemetryCompatibility.${retired}\` was renamed to \`${renamed}\``,
    );
  });

  it('REFUSES the retired `performance.exportInterval` with the rename in the message', () => {
    const result = TracingConfigSchema.safeParse({
      ...tracingBase,
      performance: { exportInterval: 1234 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues
      .find((i) => i.path.join('.') === 'performance.exportInterval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`TracingConfig.performance.exportInterval` was renamed to `exportIntervalMs`',
    );
  });

  it('accepts the suffixed keys at the same magnitudes, and still applies the same defaults', () => {
    const authored = OpenTelemetryCompatibilitySchema.parse({
      ...otelBase,
      exporter: {
        ...otelBase.exporter,
        timeoutMs: 10000,
        batch: { exportTimeoutMs: 60000, scheduledDelayMs: 10000 },
      },
    });
    expect(authored.exporter.timeoutMs).toBe(10000);
    expect(authored.exporter.batch?.exportTimeoutMs).toBe(60000);
    expect(authored.exporter.batch?.scheduledDelayMs).toBe(10000);

    // The defaults the rename must not move: 10000 / 30000 / 5000.
    const defaulted = OpenTelemetryCompatibilitySchema.parse({
      ...otelBase,
      exporter: { ...otelBase.exporter, batch: {} },
    });
    expect(defaulted.exporter.timeoutMs).toBe(10000);
    expect(defaulted.exporter.batch?.exportTimeoutMs).toBe(30000);
    expect(defaulted.exporter.batch?.scheduledDelayMs).toBe(5000);

    const tracing = TracingConfigSchema.parse({ ...tracingBase, performance: {} });
    expect(tracing.performance?.exportIntervalMs).toBe(5000);
    expect(
      TracingConfigSchema.parse({
        ...tracingBase,
        performance: { exportIntervalMs: 250 },
      }).performance?.exportIntervalMs,
    ).toBe(250);
  });

  it('still refuses a non-positive value on each renamed key', () => {
    expect(OpenTelemetryCompatibilitySchema.safeParse({
      ...otelBase,
      exporter: { ...otelBase.exporter, timeoutMs: 0 },
    }).success).toBe(false);
    expect(OpenTelemetryCompatibilitySchema.safeParse({
      ...otelBase,
      exporter: { ...otelBase.exporter, batch: { exportTimeoutMs: -1 } },
    }).success).toBe(false);
    expect(OpenTelemetryCompatibilitySchema.safeParse({
      ...otelBase,
      exporter: { ...otelBase.exporter, batch: { scheduledDelayMs: 0 } },
    }).success).toBe(false);
    expect(TracingConfigSchema.safeParse({
      ...tracingBase,
      performance: { exportIntervalMs: -1 },
    }).success).toBe(false);
  });

  it('publishes the unit in the `describe()` the reference pages render', () => {
    expect(describeOf(OpenTelemetryCompatibilitySchema, ['exporter', 'timeoutMs']))
      .toBe('Exporter request timeout in milliseconds');
    expect(describeOf(OpenTelemetryCompatibilitySchema, ['exporter', 'batch', 'exportTimeoutMs']))
      .toBe('Batch export timeout in milliseconds');
    expect(describeOf(OpenTelemetryCompatibilitySchema, ['exporter', 'batch', 'scheduledDelayMs']))
      .toBe('Delay between scheduled batch exports, in milliseconds');
    expect(describeOf(TracingConfigSchema, ['performance', 'exportIntervalMs']))
      .toBe('Background span-export interval in milliseconds');
  });
});
