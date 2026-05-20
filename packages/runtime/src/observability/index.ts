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
