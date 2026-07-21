// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/observability` — vendor-neutral contracts and exporters
 * for ObjectStack metrics, errors, and logs.
 *
 * @see {@link MetricsRegistry} {@link ErrorReporter} {@link Logger}
 */

// Contracts
export type { MetricsRegistry, MetricSample, ErrorReporter, CapturedError, Logger } from './contracts.js';

// Service-registry names (consumed by runtime's ObservabilityServicePlugin and lookup sites)
export { OBSERVABILITY_METRICS_SERVICE, OBSERVABILITY_ERRORS_SERVICE } from './service-names.js';

// Semantic conventions
export { SEMCONV, RUNTIME_METRICS } from './semconv.js';

// Metric exporters
export {
    NoopMetricsRegistry,
    InMemoryMetricsRegistry,
    ConsoleMetricsRegistry,
    OtlpHttpMetricsRegistry,
    type OtlpHttpExporterOptions,
} from './metrics-exporters.js';

// Error reporters
export {
    NoopErrorReporter,
    InMemoryErrorReporter,
    ConsoleErrorReporter,
} from './error-exporters.js';

// Loggers
export {
    NoopLogger,
    ConsoleLogger,
    JsonLogger,
    LOG_LEVELS,
    type LogLevel,
} from './loggers.js';

// Per-request performance timing (Server-Timing header)
export {
    PerfTiming,
    perfNow,
    formatServerTiming,
    runWithPerfTiming,
    currentPerfTiming,
    recordServerTiming,
    startServerTiming,
    measureServerTiming,
    countServerTiming,
    recordServerTimingDetail,
    runWithPerfDisclosure,
    allowPerfDisclosure,
    isPerfDisclosureAllowed,
    isPerfDisclosurePrivileged,
    isPerfDisclosurePrincipal,
    type ServerTimingMark,
    type ServerTimingDetail,
    type PerfDisclosureGate,
} from './perf-timing.js';
