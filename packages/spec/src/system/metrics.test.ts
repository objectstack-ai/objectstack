import { describe, it, expect } from 'vitest';
import {
  MetricType,
  MetricUnit,
  MetricAggregationType,
  HistogramBucketConfigSchema,
  MetricDefinitionSchema,
  MetricDataPointSchema,
  TimeSeriesDataPointSchema,
  TimeSeriesSchema,
  MetricAggregationConfigSchema,
  ServiceLevelIndicatorSchema,
  ServiceLevelObjectiveSchema,
  MetricExportConfigSchema,
  MetricsConfigSchema,
  type MetricDefinition,
  type MetricDataPoint,
  type ServiceLevelIndicator,
  type ServiceLevelObjective,
  type MetricsConfig,
} from './metrics.zod';

describe('MetricType', () => {
  it('should accept valid metric types', () => {
    const types = ['counter', 'gauge', 'histogram', 'summary'];
    
    types.forEach((type) => {
      expect(() => MetricType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid metric types', () => {
    expect(() => MetricType.parse('invalid')).toThrow();
  });
});

describe('MetricUnit', () => {
  it('should accept valid units', () => {
    const units = [
      'milliseconds', 'seconds', 'bytes', 'kilobytes',
      'requests_per_second', 'percent', 'count',
    ];
    
    units.forEach((unit) => {
      expect(() => MetricUnit.parse(unit)).not.toThrow();
    });
  });
});

describe('MetricAggregationType', () => {
  it('should accept valid aggregation types', () => {
    const types = ['sum', 'avg', 'min', 'max', 'count', 'p50', 'p95', 'p99'];
    
    types.forEach((type) => {
      expect(() => MetricAggregationType.parse(type)).not.toThrow();
    });
  });
});

describe('HistogramBucketConfigSchema', () => {
  it('should accept linear buckets', () => {
    const config = HistogramBucketConfigSchema.parse({
      type: 'linear',
      linear: {
        start: 0,
        width: 10,
        count: 10,
      },
    });
    
    expect(config.type).toBe('linear');
    expect(config.linear?.start).toBe(0);
    expect(config.linear?.width).toBe(10);
  });

  it('should accept exponential buckets', () => {
    const config = HistogramBucketConfigSchema.parse({
      type: 'exponential',
      exponential: {
        start: 1,
        factor: 2,
        count: 8,
      },
    });
    
    expect(config.type).toBe('exponential');
    expect(config.exponential?.factor).toBe(2);
  });

  it('should accept explicit buckets', () => {
    const config = HistogramBucketConfigSchema.parse({
      type: 'explicit',
      explicit: {
        boundaries: [0, 10, 50, 100, 500, 1000],
      },
    });
    
    expect(config.type).toBe('explicit');
    expect(config.explicit?.boundaries).toHaveLength(6);
  });
});

describe('MetricDefinitionSchema', () => {
  it('should accept valid counter definition', () => {
    const metric: MetricDefinition = {
      name: 'http_requests_total',
      type: 'counter',
      description: 'Total HTTP requests',
    };
    
    expect(() => MetricDefinitionSchema.parse(metric)).not.toThrow();
  });

  it('should accept gauge with labels', () => {
    const metric: MetricDefinition = {
      name: 'memory_usage_bytes',
      type: 'gauge',
      unit: 'bytes',
      labelNames: ['service', 'instance'],
    };
    
    expect(() => MetricDefinitionSchema.parse(metric)).not.toThrow();
  });

  it('should accept histogram with buckets', () => {
    const metric: MetricDefinition = {
      name: 'http_request_duration_ms',
      type: 'histogram',
      unit: 'milliseconds',
      histogram: {
        type: 'exponential',
        exponential: {
          start: 1,
          factor: 2,
          count: 10,
        },
      },
    };
    
    expect(() => MetricDefinitionSchema.parse(metric)).not.toThrow();
  });

  it('should accept summary with quantiles', () => {
    const metric: MetricDefinition = {
      name: 'response_time_ms',
      type: 'summary',
      summary: {
        quantiles: [0.5, 0.9, 0.95, 0.99],
        maxAgeSeconds: 300,
      },
    };
    
    expect(() => MetricDefinitionSchema.parse(metric)).not.toThrow();
  });

  it('should apply defaults', () => {
    const metric = MetricDefinitionSchema.parse({
      name: 'test_metric',
      type: 'counter',
    });
    
    expect(metric.labelNames).toEqual([]);
    expect(metric.enabled).toBe(true);
  });

  it('should enforce snake_case naming', () => {
    expect(() => MetricDefinitionSchema.parse({
      name: 'camelCase',
      type: 'counter',
    })).toThrow();
  });
});

describe('MetricDataPointSchema', () => {
  it('should accept counter data point', () => {
    const dataPoint: MetricDataPoint = {
      name: 'requests_total',
      type: 'counter',
      timestamp: '2024-01-15T10:30:00.000Z',
      value: 100,
    };
    
    expect(() => MetricDataPointSchema.parse(dataPoint)).not.toThrow();
  });

  it('should accept gauge with labels', () => {
    const dataPoint: MetricDataPoint = {
      name: 'cpu_usage',
      type: 'gauge',
      timestamp: '2024-01-15T10:30:00.000Z',
      value: 45.5,
      labels: {
        host: 'server-01',
        core: '0',
      },
    };
    
    expect(() => MetricDataPointSchema.parse(dataPoint)).not.toThrow();
  });

  it('should accept histogram data', () => {
    const dataPoint: MetricDataPoint = {
      name: 'request_duration',
      type: 'histogram',
      timestamp: '2024-01-15T10:30:00.000Z',
      histogram: {
        count: 100,
        sum: 5000,
        buckets: [
          { upperBound: 10, count: 20 },
          { upperBound: 50, count: 50 },
          { upperBound: 100, count: 25 },
        ],
      },
    };
    
    expect(() => MetricDataPointSchema.parse(dataPoint)).not.toThrow();
  });
});

describe('TimeSeriesSchema', () => {
  it('should accept time series data', () => {
    const timeSeries = TimeSeriesSchema.parse({
      name: 'cpu_usage',
      labels: { host: 'server-01' },
      dataPoints: [
        { timestamp: '2024-01-15T10:00:00.000Z', value: 45.5 },
        { timestamp: '2024-01-15T10:01:00.000Z', value: 46.2 },
        { timestamp: '2024-01-15T10:02:00.000Z', value: 44.8 },
      ],
    });
    
    expect(timeSeries.dataPoints).toHaveLength(3);
  });
});

describe('MetricAggregationConfigSchema', () => {
  it('should accept aggregation with window', () => {
    const config = MetricAggregationConfigSchema.parse({
      type: 'avg',
      window: {
        durationSeconds: 300,
        sliding: true,
        slideInterval: 60,
      },
      groupBy: ['service', 'instance'],
    });
    
    expect(config.type).toBe('avg');
    expect(config.window?.durationSeconds).toBe(300);
  });
});

describe('ServiceLevelIndicatorSchema', () => {
  it('should accept availability SLI', () => {
    const sli: ServiceLevelIndicator = {
      name: 'api_availability',
      label: 'API Availability',
      metric: 'http_requests_total',
      type: 'availability',
      successCriteria: {
        threshold: 99.9,
        operator: 'gte',
      },
      window: {
        durationSeconds: 2592000, // 30 days
      },
    };
    
    expect(() => ServiceLevelIndicatorSchema.parse(sli)).not.toThrow();
  });

  it('should accept latency SLI with percentile', () => {
    const sli: ServiceLevelIndicator = {
      name: 'api_latency_p99',
      label: 'API Latency P99',
      metric: 'http_request_duration',
      type: 'latency',
      successCriteria: {
        threshold: 100,
        operator: 'lte',
        percentile: 0.99,
      },
      window: {
        durationSeconds: 86400, // 1 day
        rolling: true,
      },
    };
    
    expect(() => ServiceLevelIndicatorSchema.parse(sli)).not.toThrow();
  });

  it('should apply defaults', () => {
    const sli = ServiceLevelIndicatorSchema.parse({
      name: 'test_sli',
      label: 'Test SLI',
      metric: 'test_metric',
      type: 'availability',
      successCriteria: {
        threshold: 99,
        operator: 'gte',
      },
      window: {
        durationSeconds: 3600,
      },
    });
    
    expect(sli.enabled).toBe(true);
  });
});

describe('ServiceLevelObjectiveSchema', () => {
  it('should accept SLO with rolling period', () => {
    const slo: ServiceLevelObjective = {
      name: 'api_uptime_slo',
      label: 'API Uptime SLO',
      sli: 'api_availability',
      target: 99.9,
      period: {
        type: 'rolling',
        durationSeconds: 2592000, // 30 days
      },
    };
    
    expect(() => ServiceLevelObjectiveSchema.parse(slo)).not.toThrow();
  });

  it('should accept SLO with calendar period', () => {
    const slo: ServiceLevelObjective = {
      name: 'monthly_slo',
      label: 'Monthly SLO',
      sli: 'test_sli',
      target: 99.5,
      period: {
        type: 'calendar',
        calendar: 'monthly',
      },
    };
    
    expect(() => ServiceLevelObjectiveSchema.parse(slo)).not.toThrow();
  });

  it('should accept error budget configuration', () => {
    const slo: ServiceLevelObjective = {
      name: 'error_budget_slo',
      label: 'Error Budget SLO',
      sli: 'test_sli',
      target: 99.9,
      period: { type: 'rolling', durationSeconds: 2592000 },
      errorBudget: {
        enabled: true,
        alertThreshold: 75,
        burnRateWindows: [
          { durationSeconds: 3600, threshold: 14.4 },
          { durationSeconds: 86400, threshold: 6 },
        ],
      },
    };
    
    expect(() => ServiceLevelObjectiveSchema.parse(slo)).not.toThrow();
  });

  it('should apply defaults', () => {
    const slo = ServiceLevelObjectiveSchema.parse({
      name: 'test_slo',
      label: 'Test SLO',
      sli: 'test_sli',
      target: 99,
      period: { type: 'rolling', durationSeconds: 86400 },
    });
    
    expect(slo.enabled).toBe(true);
    expect(slo.alerts).toEqual([]);
  });
});

describe('MetricExportConfigSchema', () => {
  it('should accept Prometheus export', () => {
    const config = MetricExportConfigSchema.parse({
      type: 'prometheus',
      endpoint: '/metrics',
    });
    
    expect(config.type).toBe('prometheus');
    expect(config.intervalSeconds).toBe(60);
  });

  it('should accept HTTP push export', () => {
    const config = MetricExportConfigSchema.parse({
      type: 'http',
      endpoint: 'https://metrics.example.com',
      intervalSeconds: 30,
      auth: {
        type: 'bearer',
        token: 'secret-token',
      },
    });
    
    expect(config.intervalSeconds).toBe(30);
    expect(config.auth?.type).toBe('bearer');
  });
});

describe('MetricsConfigSchema', () => {
  it('should accept minimal configuration', () => {
    const config: MetricsConfig = {
      name: 'default_metrics',
      label: 'Default Metrics',
    };
    
    expect(() => MetricsConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply defaults', () => {
    const config = MetricsConfigSchema.parse({
      name: 'test_metrics',
      label: 'Test Metrics',
    });
    
    expect(config.enabled).toBe(true);
    expect(config.metrics).toEqual([]);
    expect(config.defaultLabels).toEqual({});
    expect(config.collectionIntervalSeconds).toBe(15);
  });

  it('should accept full configuration', () => {
    const config: MetricsConfig = {
      name: 'production_metrics',
      label: 'Production Metrics',
      enabled: true,
      metrics: [
        {
          name: 'http_requests_total',
          type: 'counter',
          labelNames: ['method', 'status'],
        },
      ],
      defaultLabels: {
        environment: 'production',
        region: 'us-east-1',
      },
      slis: [
        {
          name: 'api_availability',
          label: 'API Availability',
          metric: 'http_requests_total',
          type: 'availability',
          successCriteria: {
            threshold: 99.9,
            operator: 'gte',
          },
          window: { durationSeconds: 2592000 },
        },
      ],
      slos: [
        {
          name: 'api_slo',
          label: 'API SLO',
          sli: 'api_availability',
          target: 99.9,
          period: { type: 'rolling', durationSeconds: 2592000 },
        },
      ],
      exports: [
        {
          type: 'prometheus',
          endpoint: '/metrics',
        },
      ],
      retention: {
        durationSeconds: 604800,
      },
    };
    
    expect(() => MetricsConfigSchema.parse(config)).not.toThrow();
  });

  it('should enforce snake_case naming', () => {
    expect(() => MetricsConfigSchema.parse({
      name: 'CamelCase',
      label: 'Test',
    })).toThrow();
  });

  it('should enforce max length for name', () => {
    const longName = 'a'.repeat(65);
    expect(() => MetricsConfigSchema.parse({
      name: longName,
      label: 'Test',
    })).toThrow();
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. All three old spellings are
// `retiredKey()` tombstones; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`. The new name is `durationSeconds` and NOT the
// gate's mechanical `sizeSeconds`: `size` is byte/row-count vocabulary elsewhere
// in this spec, and the parent key is already `window`, so `windowSeconds` would
// read `window.windowSeconds`.
describe('metrics window and period lengths carry their unit (#15679)', () => {
  const sliBase = {
    name: 'api_availability',
    label: 'API Availability',
    metric: 'http_requests_total',
    type: 'availability' as const,
    successCriteria: { threshold: 99.9, operator: 'gte' as const },
  };
  const sloBase = {
    name: 'api_uptime_slo', label: 'API Uptime SLO', sli: 'api_availability', target: 99.9,
  };

  it('REFUSES the retired `MetricAggregationConfig.window.size`', () => {
    const result = MetricAggregationConfigSchema.safeParse({
      type: 'avg',
      window: { size: 300 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'window.size');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('renamed to `durationSeconds`');
    // The prescription must EXPLAIN the departure from the mechanical name, or the
    // next author reads `durationSeconds` as a slip and "corrects" it back.
    expect(issue!.message).toContain('The new name is not `sizeSeconds`');
  });

  it('REFUSES the retired `ServiceLevelIndicator.window.size`', () => {
    const result = ServiceLevelIndicatorSchema.safeParse({ ...sliBase, window: { size: 2592000 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'window.size');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('renamed to `durationSeconds`');
  });

  it('REFUSES the retired `ServiceLevelObjective.period.duration`', () => {
    const result = ServiceLevelObjectiveSchema.safeParse({
      ...sloBase,
      period: { type: 'rolling', duration: 2592000 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'period.duration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`ServiceLevelObjective.period.duration` was renamed to `durationSeconds`',
    );
  });

  it('accepts every renamed key at the same magnitude', () => {
    expect(MetricAggregationConfigSchema.parse({ type: 'avg', window: { durationSeconds: 300 } })
      .window?.durationSeconds).toBe(300);
    expect(ServiceLevelIndicatorSchema.parse({ ...sliBase, window: { durationSeconds: 2592000 } })
      .window.durationSeconds).toBe(2592000);
    expect(ServiceLevelObjectiveSchema.parse({
      ...sloBase, period: { type: 'rolling', durationSeconds: 2592000 },
    }).period.durationSeconds).toBe(2592000);
  });

  // Was `leaves the two non-duration keys on this file alone`, and it pinned two
  // subjects. The exporter batch `size` (below) is unchanged and still true. The
  // other was the error-budget burn-rate `window`, held bare on the reading that
  // it is "outside the gate population entirely". #15939 ruling A settled that it
  // is outside #15679's RENAME, not outside the population — its unit lived in
  // the JSDoc channel the gate does not read — so this card renames it and that
  // guard succeeds by failing. Its replacement pins are in the #15939 block
  // below; the header is narrowed here rather than left asserting a second key
  // that no longer stays bare.
  it('leaves the exporter batch size — a COUNT of records — alone', () => {
    expect(MetricExportConfigSchema.parse({ type: 'prometheus', batch: { size: 500 } })
      .batch?.size).toBe(500);
  });
});

// #15939 ruling A (executing #14478) — the five durations on this file whose
// unit lived in a source JSDoc only, a channel `check:duration-unit-keys` does
// not read: four carried no `.describe()` at all and the fifth read "Window
// size". Every old spelling is a `retiredKey()` tombstone (none of the five
// enclosing shapes is `.strict()`, so a bare deletion would silently strip);
// asserted on the issue CODE and the prescription, never on a bare `toThrow()`.
// Three of the five new names are not the mechanical suffix: see the tombstone
// prose on each key for why `windowSeconds`, `periodSeconds` and a bare
// `intervalSeconds` were rejected.
describe('metrics JSDoc-only durations carry their unit (#15939, #14478)', () => {
  const sliBase = {
    name: 'api_availability',
    label: 'API Availability',
    metric: 'http_requests_total',
    type: 'availability' as const,
    successCriteria: { threshold: 99.9, operator: 'gte' as const },
  };
  const sloBase = {
    name: 'api_uptime_slo', label: 'API Uptime SLO', sli: 'api_availability', target: 99.9,
  };

  it('REFUSES `MetricDefinition.summary.maxAge` with a rename naming `maxAgeSeconds`', () => {
    const result = MetricDefinitionSchema.safeParse({
      name: 'response_time', type: 'summary', summary: { maxAge: 600 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'summary.maxAge');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /`MetricDefinition\.summary\.maxAge` was renamed.*Rename the key to `maxAgeSeconds`/s,
    );
    // The prescription must EXPLAIN why it is not `durationSeconds` like the
    // three window lengths on this same file, or the next author "corrects" it.
    expect(issue!.message).toContain('ageBuckets');
  });

  it('REFUSES the burn-rate `window` with a rename naming `durationSeconds`', () => {
    const result = ServiceLevelObjectiveSchema.safeParse({
      ...sloBase,
      period: { type: 'rolling', durationSeconds: 2592000 },
      errorBudget: { burnRateWindows: [{ window: 3600, threshold: 14.4 }] },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find(
      (i) => i.path.join('.') === 'errorBudget.burnRateWindows.0.window',
    );
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(/was renamed to\s+`durationSeconds`/s);
    // Why not the mechanical `windowSeconds`.
    expect(issue!.message).toContain('burnRateWindows');
  });

  it('REFUSES `MetricExportConfig.interval` with a rename naming `intervalSeconds`', () => {
    const result = MetricExportConfigSchema.safeParse({ type: 'prometheus', interval: 60 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'interval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /`MetricExportConfig\.interval` was renamed.*Rename the key to `intervalSeconds`/s,
    );
  });

  it('REFUSES `MetricsConfig.collectionInterval` with a rename naming the qualified key', () => {
    const result = MetricsConfigSchema.safeParse({
      name: 'm', label: 'M', collectionInterval: 15,
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'collectionInterval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /was renamed to `collectionIntervalSeconds`/s,
    );
    // Why the qualifier is kept rather than reusing the exporter's own key.
    expect(issue!.message).toContain('MetricExportConfig.intervalSeconds');
  });

  it('REFUSES `MetricsConfig.retention.period` with a rename naming `durationSeconds`', () => {
    const result = MetricsConfigSchema.safeParse({
      name: 'm', label: 'M', retention: { period: 604800 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'retention.period');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /`MetricsConfig\.retention\.period` was renamed.*Rename the key to `durationSeconds`/s,
    );
    // Why not the mechanical `periodSeconds`.
    expect(issue!.message).toContain('calendar vocabulary');
  });

  it('accepts every renamed key at the magnitude the retired one carried', () => {
    expect(MetricDefinitionSchema.parse({
      name: 'response_time', type: 'summary', summary: { maxAgeSeconds: 600 },
    }).summary?.maxAgeSeconds).toBe(600);

    const slo = ServiceLevelObjectiveSchema.parse({
      ...sloBase,
      period: { type: 'rolling', durationSeconds: 2592000 },
      errorBudget: { burnRateWindows: [{ durationSeconds: 3600, threshold: 14.4 }] },
    });
    expect(slo.errorBudget?.burnRateWindows?.[0]?.durationSeconds).toBe(3600);
    expect(slo.errorBudget?.burnRateWindows?.[0]).not.toHaveProperty('window');

    expect(MetricExportConfigSchema.parse({ type: 'http', intervalSeconds: 30 })
      .intervalSeconds).toBe(30);
    expect(MetricsConfigSchema.parse({
      name: 'm', label: 'M', collectionIntervalSeconds: 30, retention: { durationSeconds: 86400 },
    }).retention?.durationSeconds).toBe(86400);
  });

  it('keeps every default the retired keys carried', () => {
    expect(MetricDefinitionSchema.parse({ name: 'r', type: 'summary', summary: {} })
      .summary?.maxAgeSeconds).toBe(600);
    expect(MetricExportConfigSchema.parse({ type: 'prometheus' }).intervalSeconds).toBe(60);
    const config = MetricsConfigSchema.parse({ name: 'm', label: 'M', retention: {} });
    expect(config.collectionIntervalSeconds).toBe(15);
    expect(config.retention?.durationSeconds).toBe(604800);
  });

  it('publishes the unit in every describe — the text the reference pages render', () => {
    const summary = MetricDefinitionSchema.shape.summary.unwrap();
    expect(summary.shape.maxAgeSeconds.description).toBe('Max age of observations in seconds');
    expect(MetricExportConfigSchema.shape.intervalSeconds.description)
      .toBe('Export interval in seconds');
    expect(MetricsConfigSchema.shape.collectionIntervalSeconds.description)
      .toBe('Collection interval in seconds');
    expect(MetricsConfigSchema.shape.retention.unwrap().shape.durationSeconds.description)
      .toBe('Retention duration in seconds');
    const burn = ServiceLevelObjectiveSchema.shape.errorBudget.unwrap()
      .shape.burnRateWindows.unwrap().element;
    expect(burn.shape.durationSeconds.description).toBe('Window duration in seconds');
  });

  it('leaves the three same-named decoys on this file alone', () => {
    // All three are `z.object({ … })`, not duration numbers, and two of them
    // already hold a `durationSeconds` of their own from #15679.
    expect(MetricAggregationConfigSchema.parse({ type: 'avg', window: { durationSeconds: 300 } })
      .window?.durationSeconds).toBe(300);
    expect(ServiceLevelIndicatorSchema.parse({ ...sliBase, window: { durationSeconds: 2592000 } })
      .window.durationSeconds).toBe(2592000);
    expect(ServiceLevelObjectiveSchema.parse({
      ...sloBase, period: { type: 'rolling', durationSeconds: 2592000 },
    }).period.durationSeconds).toBe(2592000);
  });
});
// #18124 — step 3 of ruling A on #18115. Two metrics rows declare their unit
// through `DurationSeconds`:
//
//   - `MetricAggregationConfig.window.slideInterval` — seconds, from the
//     `durationSeconds` sibling it slides across in the same object literal.
//   - `MetricsConfig.retention.downsampling[].resolution` — seconds, stated in its
//     JSDoc and by its `afterSeconds` sibling, and in NEITHER published channel
//     until now (the #14519 shape: the reader of the reference page could not
//     reach the unit at all).
//
// Both keep the `.positive()` floor they already declared, so the accepted set
// narrows only by the integer requirement `DurationSeconds` carries.
describe('metrics duration rows declare seconds through the type (#18124)', () => {
  const window = { durationSeconds: 300, sliding: true };

  it('slideInterval refuses a fractional second count', () => {
    const result = MetricAggregationConfigSchema.safeParse({
      type: 'avg',
      window: { ...window, slideInterval: 60.5 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'window.slideInterval');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
  });

  it('slideInterval keeps its positive floor — zero and negatives still refused', () => {
    for (const bad of [0, -60]) {
      const result = MetricAggregationConfigSchema.safeParse({
        type: 'avg',
        window: { ...window, slideInterval: bad },
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'window.slideInterval');
      expect(issue).toBeDefined();
      expect(issue!.code).toBe('too_small');
    }
  });

  it('slideInterval still accepts the whole-second value it always did', () => {
    const parsed = MetricAggregationConfigSchema.parse({
      type: 'avg',
      window: { ...window, slideInterval: 60 },
    });
    expect(parsed.window?.slideInterval).toBe(60);
  });

  it('downsampling resolution refuses a fractional second count and keeps its floor', () => {
    const config = (resolution: number) => ({
      name: 'test_metrics',
      label: 'Test Metrics',
      retention: { downsampling: [{ afterSeconds: 3600, resolution }] },
    });
    const fractional = MetricsConfigSchema.safeParse(config(60.5));
    expect(fractional.success).toBe(false);
    expect(fractional.error!.issues.some((i) => i.code === 'invalid_type')).toBe(true);

    const zero = MetricsConfigSchema.safeParse(config(0));
    expect(zero.success).toBe(false);
    expect(zero.error!.issues.some((i) => i.code === 'too_small')).toBe(true);

    expect(MetricsConfigSchema.parse(config(60)).retention?.downsampling?.[0]?.resolution).toBe(60);
  });
});
