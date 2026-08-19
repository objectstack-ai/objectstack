// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Semantic conventions — canonical metric names emitted by the
 * framework. Listed here so hosts can wire alerts/dashboards against
 * a stable namespace and so call sites don't sprinkle string
 * literals through the code base.
 *
 * Naming follows Prometheus conventions:
 *
 *   - snake_case identifiers.
 *   - `_total` suffix for monotonic counters.
 *   - `_ms`, `_seconds`, `_bytes` suffixes for histograms / gauges
 *     with units.
 *
 * Groups roughly mirror the framework subsystems that emit them.
 * Cloud-specific metrics (DO restarts, Workers Analytics Engine
 * writes, …) do NOT belong here — they are deployment-specific and
 * stay in the deployment repo.
 */
export const SEMCONV = {
    // ── HTTP — emitter differs per family, see each ────────────────────
    /**
     * Counter, labels: `method`, `route`, `status`. Emitted by the TRANSPORT
     * through the `IHttpServer.afterResponse` seam (#9835), so it covers
     * every inbound request on the server rather than only the routes the
     * runtime dispatcher registers.
     */
    httpRequestsTotal: 'http_requests_total',
    /**
     * Histogram (ms), labels: `method`, `route`. Emitted by the TRANSPORT
     * through the same seam (#9834). It measures the REQUEST as the transport
     * sees it — first sight to the response existing, middleware chain and
     * body parse included — not the handler's share of it.
     */
    httpRequestDurationMs: 'http_request_duration_ms',
    /**
     * Counter, labels: `method`, `route`. Incremented when an in-flight
     * handler throws after the response is sent. Emitted by
     * `@objectstack/runtime`'s `instrumentRouteHandler`, and NOT movable to
     * the seam above as-is: the observation carries a status but no throw
     * signal, so a transport-side emitter would count a different population
     * (#9834 records the fork).
     */
    httpRequestErrorsTotal: 'http_request_errors_total',

    // ── Storage — emitted by `@objectstack/service-storage` adapters ──
    /** Counter, labels: `adapter` (`local`|`s3`|…), `op` (`get`|`put`|`delete`|`head`), `result` (`ok`|`error`). */
    storageOperationsTotal: 'storage_operations_total',
    /** Histogram (ms), labels: `adapter`, `op`. */
    storageOperationDurationMs: 'storage_operation_duration_ms',
    /** Counter, labels: `adapter`, `op`, `errorClass`. */
    storageErrorsTotal: 'storage_errors_total',

    // ── Cache — emitted by `@objectstack/service-cache` adapters ──
    /** Counter, labels: `adapter` (`memory`|`redis`), `result` (`hit`|`miss`). */
    cacheLookupsTotal: 'cache_lookups_total',
    /** Counter, labels: `adapter`, `op` (`set`|`delete`|`clear`). */
    cacheWritesTotal: 'cache_writes_total',
    /** Counter, labels: `adapter`, `op`, `errorClass`. */
    cacheErrorsTotal: 'cache_errors_total',

    // ── Background jobs — emitted by `@objectstack/runtime`'s AppPlugin ──
    /**
     * Counter, labels: `app`, `job`. Incremented when a DECLARED background
     * job could not be handed to the job service — i.e. the app booted green
     * but that job will never run (#4567). Any non-zero value is an outage of
     * the job, not a warning.
     */
    jobScheduleFailuresTotal: 'job_schedule_failures_total',

    // ── Package / registry-reader — emitted by `@objectstack/service-package` ──
    /** Counter, labels: `result` (`ok`|`miss`|`error`). */
    registryLookupsTotal: 'registry_lookups_total',
    /** Histogram (ms). */
    registryLookupDurationMs: 'registry_lookup_duration_ms',
    /** Counter, labels: `source` (`r2`|`http`|`local`), `result` (`hit`|`miss`|`error`). */
    registrySourceFetchesTotal: 'registry_source_fetches_total',
} as const;

/**
 * Backwards-compat alias. `RUNTIME_METRICS` was the original (HTTP-only)
 * constant name shipped from `@objectstack/runtime`; we keep it here so
 * existing code reading `RUNTIME_METRICS.httpRequestsTotal` continues
 * to work after the constants moved into this package.
 */
export const RUNTIME_METRICS = {
    httpRequestsTotal: SEMCONV.httpRequestsTotal,
    httpRequestDurationMs: SEMCONV.httpRequestDurationMs,
    httpRequestErrorsTotal: SEMCONV.httpRequestErrorsTotal,
} as const;
