// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export {
    extractRequestId,
    generateRequestId,
    resolveRequestId,
    parseTraceparent,
    formatTraceparent,
    type TraceContext,
} from './request-context.js';

export {
    NoopMetricsRegistry,
    InMemoryMetricsRegistry,
    RUNTIME_METRICS,
    armHttpRequestCounter,
    armHttpRequestDurationHistogram,
    type ArmHttpMetricResult,
    type ArmHttpRequestCounterResult,
    type MetricsRegistry,
    type MetricSample,
} from './metrics.js';

export {
    NoopErrorReporter,
    InMemoryErrorReporter,
    type ErrorReporter,
    type CapturedError,
} from './error-reporter.js';

export {
    instrumentRouteHandler,
    type InstrumentOptions,
} from './instrument.js';

export {
    ObservabilityServicePlugin,
    OBSERVABILITY_METRICS_SERVICE,
    OBSERVABILITY_ERRORS_SERVICE,
    resolveMetrics,
    resolveErrorReporter,
    type ObservabilityServicePluginOptions,
} from './observability-service-plugin.js';
