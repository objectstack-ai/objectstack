// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error reporter contract.
 *
 * Production deployments wire this to Sentry, Datadog APM, Rollbar,
 * etc. The runtime calls {@link ErrorReporter.captureException} when a
 * route handler results in a 5xx response so the host's APM gets the
 * stack trace without each plugin/route needing to import the SDK.
 *
 * Implementations MUST NOT throw — error reporting failures should be
 * swallowed (or at most logged) so the original error reaches the
 * client unmolested.
 *
 * 4xx responses are intentionally NOT captured here. Client errors
 * (validation failures, auth, not-found) flood APM systems with noise
 * and obscure real bugs. If a deployment wants to track them, do it
 * via the metrics counter (`http_requests_total{status="4xx"}`),
 * not error reporting.
 */
export interface ErrorReporter {
    /**
     * Capture a thrown error with optional context. Context typically
     * includes `requestId`, `method`, `route`, `userId`, `orgId`.
     *
     * The reporter is responsible for redacting sensitive fields from
     * `context` (the runtime does not know what is sensitive in the
     * caller's deployment).
     */
    captureException(error: unknown, context?: Record<string, unknown>): void;
}

/** No-op reporter — the default. */
export class NoopErrorReporter implements ErrorReporter {
    captureException(): void {}
}

/** Recorded report (in-memory reporter). */
export interface CapturedError {
    error: unknown;
    context: Record<string, unknown>;
    at: number;
}

/**
 * In-memory reporter used in tests to assert that error capture was
 * (or was not) invoked for a given request.
 */
export class InMemoryErrorReporter implements ErrorReporter {
    readonly captured: CapturedError[] = [];

    captureException(error: unknown, context: Record<string, unknown> = {}): void {
        this.captured.push({ error, context, at: Date.now() });
    }

    reset(): void {
        this.captured.length = 0;
    }
}
