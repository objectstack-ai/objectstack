// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Backwards-compat shim. The canonical home for `MetricsRegistry`,
 * `NoopMetricsRegistry`, `InMemoryMetricsRegistry`, `MetricSample`, and
 * the `RUNTIME_METRICS` constants moved to `@objectstack/observability`
 * so deployment-target-neutral code (cloud, self-hosted, ...) can
 * import them without pulling in the whole runtime.
 *
 * Existing imports from `@objectstack/runtime`-internal paths continue
 * to work transparently via this re-export.
 */
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
} from '@objectstack/observability';
