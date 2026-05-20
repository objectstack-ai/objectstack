// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    NoopMetricsRegistry,
    NoopErrorReporter,
    resolveRequestId,
    RUNTIME_METRICS,
    type MetricsRegistry,
    type ErrorReporter,
} from './index.js';

/**
 * Options for {@link instrumentRouteHandler}. All fields optional; the
 * defaults make the wrapper a no-op (zero overhead, no behavior change).
 *
 * Hosts plug their own implementations to bridge to Prometheus / OTel /
 * Sentry / Datadog without the framework taking a hard dependency on
 * any of them.
 */
export interface InstrumentOptions {
    metrics?: MetricsRegistry;
    errorReporter?: ErrorReporter;
    /** Override the default `req_<uuid>` generator. */
    generateRequestId?: () => string;
    /** Response header that echoes the request id (default `X-Request-Id`). */
    requestIdHeader?: string;
    /**
     * Wall clock for tests. Defaults to `Date.now`; only `now()` is
     * called, so any monotonic source works.
     */
    now?: () => number;
}

/**
 * Wrap an HTTP route handler with the runtime's standard observability
 * lifecycle:
 *
 *   1. Resolve a request id from incoming `X-Request-Id` (or mint one).
 *   2. Set the request id on `req.requestId` and response header.
 *   3. Time the handler.
 *   4. Emit `http_requests_total{method,route,status}` counter and
 *      `http_request_duration_ms{method,route}` histogram.
 *   5. On thrown errors, emit `http_request_errors_total` and call
 *      `errorReporter.captureException` for 5xx.
 *   6. When the handler catches its own error and calls
 *      `errorResponseBase` (which leaves a side-channel
 *      `res.__obsRecordedError`), still call the error reporter.
 *
 * The wrapper does not catch the error — it re-throws so the host
 * server still gets a chance to render its own 500 page if needed.
 */
export function instrumentRouteHandler(
    method: string,
    route: string,
    handler: (req: any, res: any) => unknown,
    opts: InstrumentOptions = {},
): (req: any, res: any) => Promise<void> {
    const metrics = opts.metrics ?? new NoopMetricsRegistry();
    const errorReporter = opts.errorReporter ?? new NoopErrorReporter();
    const generateRequestId = opts.generateRequestId;
    const requestIdHeader = opts.requestIdHeader ?? 'X-Request-Id';
    const now = opts.now ?? Date.now;

    return async (req: any, res: any) => {
        const requestId = resolveRequestId(req?.headers, generateRequestId);
        try {
            (req as any).requestId = requestId;
        } catch {
            // frozen req object — fine, the header is the source of truth
        }
        if (typeof res?.header === 'function') {
            try {
                res.header(requestIdHeader, requestId);
            } catch {
                // adapter rejects header injection here — fine
            }
        }

        // Capture the final status. We start at 200 (the adapter default
        // when no status() is called) and override on status() calls via
        // a tiny proxy.
        let status = 200;
        const origStatus =
            typeof res?.status === 'function' ? res.status.bind(res) : undefined;
        if (origStatus) {
            res.status = (code: number) => {
                status = code;
                return origStatus(code);
            };
        }

        const startedAt = now();
        let threw = false;
        try {
            await handler(req, res);
        } catch (err: any) {
            threw = true;
            status = err?.statusCode ?? 500;
            metrics.counter(RUNTIME_METRICS.httpRequestErrorsTotal, { method, route });
            if (status >= 500) {
                safeReport(errorReporter, err, { requestId, method, route });
            }
            throw err;
        } finally {
            const elapsed = now() - startedAt;
            metrics.counter(RUNTIME_METRICS.httpRequestsTotal, {
                method,
                route,
                status: String(status),
            });
            metrics.histogram(
                RUNTIME_METRICS.httpRequestDurationMs,
                elapsed,
                { method, route },
            );
            // Side-channel: handler caught the error and called
            // errorResponseBase, which recorded the original error on
            // `res.__obsRecordedError`. Pick it up so 5xx still
            // reaches the reporter even though we did not see the throw.
            if (!threw && status >= 500) {
                const recorded = (res as any)?.__obsRecordedError;
                if (recorded !== undefined) {
                    safeReport(errorReporter, recorded, { requestId, method, route });
                }
            }
        }
    };
}

function safeReport(
    reporter: ErrorReporter,
    err: unknown,
    ctx: Record<string, unknown>,
): void {
    try {
        reporter.captureException(err, ctx);
    } catch {
        // never let reporter failures mask the original error
    }
}
