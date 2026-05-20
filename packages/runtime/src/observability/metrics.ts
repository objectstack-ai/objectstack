// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metrics registry contract.
 *
 * The runtime emits metrics via this interface so the host application
 * can plug in whatever metrics backend it wants (Prometheus via
 * `prom-client`, OTel via `@opentelemetry/api-metrics`, StatsD,
 * CloudWatch, etc.) without the framework taking a hard dep on any of
 * them.
 *
 * Naming follows Prometheus conventions:
 *   - snake_case names
 *   - unit suffix (`_ms`, `_seconds`, `_bytes`, `_total` for counters)
 *
 * Labels are arbitrary string maps; backends should map them to their
 * native label/tag concept. Keep cardinality low — never label by raw
 * url path or user id.
 *
 * All methods are fire-and-forget; implementations MUST NOT throw on
 * the hot path. Use {@link NoopMetricsRegistry} when metrics are
 * disabled.
 */
export interface MetricsRegistry {
    /** Monotonic counter. `value` defaults to 1. */
    counter(name: string, labels?: Record<string, string>, value?: number): void;

    /** Histogram / timing in arbitrary units (typically ms). */
    histogram(name: string, value: number, labels?: Record<string, string>): void;

    /** Point-in-time gauge. */
    gauge(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * No-op metrics registry — the default. Discards every observation.
 * Production deployments should swap this for a real registry; tests
 * can use {@link InMemoryMetricsRegistry} to assert emissions.
 */
export class NoopMetricsRegistry implements MetricsRegistry {
    counter(): void {}
    histogram(): void {}
    gauge(): void {}
}

/** Recorded metric sample (in-memory registry). */
export interface MetricSample {
    name: string;
    kind: 'counter' | 'histogram' | 'gauge';
    value: number;
    labels: Record<string, string>;
    /** Wall-clock timestamp; useful for ordering assertions in tests. */
    at: number;
}

/**
 * In-memory registry used for tests and local inspection. Stores
 * every observation in insertion order; query via the helpers below
 * or read {@link samples} directly.
 *
 * Not intended for production — unbounded growth.
 */
export class InMemoryMetricsRegistry implements MetricsRegistry {
    readonly samples: MetricSample[] = [];

    counter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
        this.samples.push({ name, kind: 'counter', value, labels, at: Date.now() });
    }

    histogram(name: string, value: number, labels: Record<string, string> = {}): void {
        this.samples.push({ name, kind: 'histogram', value, labels, at: Date.now() });
    }

    gauge(name: string, value: number, labels: Record<string, string> = {}): void {
        this.samples.push({ name, kind: 'gauge', value, labels, at: Date.now() });
    }

    /**
     * Sum of all counter increments matching `name` (and optionally a
     * label subset). Useful in tests: `metrics.totalCounter('http_requests_total', { status: '500' })`.
     */
    totalCounter(name: string, labelMatch: Record<string, string> = {}): number {
        return this.samples
            .filter(
                s =>
                    s.kind === 'counter' &&
                    s.name === name &&
                    matchesLabels(s.labels, labelMatch),
            )
            .reduce((acc, s) => acc + s.value, 0);
    }

    /**
     * All histogram observations matching `name` (and optionally a
     * label subset), as raw values.
     */
    histogramValues(name: string, labelMatch: Record<string, string> = {}): number[] {
        return this.samples
            .filter(
                s =>
                    s.kind === 'histogram' &&
                    s.name === name &&
                    matchesLabels(s.labels, labelMatch),
            )
            .map(s => s.value);
    }

    /** Clear all recorded samples. */
    reset(): void {
        this.samples.length = 0;
    }
}

function matchesLabels(
    actual: Record<string, string>,
    expected: Record<string, string>,
): boolean {
    for (const [k, v] of Object.entries(expected)) {
        if (actual[k] !== v) return false;
    }
    return true;
}

/**
 * Canonical metric names emitted by the runtime. Hosts may rely on
 * these (e.g., to wire alerts) so they are listed here for reference
 * rather than being string literals scattered through call sites.
 */
export const RUNTIME_METRICS = {
    /** Counter, labels: method, route, status. */
    httpRequestsTotal: 'http_requests_total',
    /** Histogram (ms), labels: method, route. */
    httpRequestDurationMs: 'http_request_duration_ms',
    /** Counter, labels: method, route. Incremented when an in-flight handler throws (after the response is sent). */
    httpRequestErrorsTotal: 'http_request_errors_total',
} as const;
