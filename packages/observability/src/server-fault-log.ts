// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14310] The one rule for "a 5xx must never be silent", shared by every
 * transport that turns a fault into an HTTP envelope.
 *
 * ## The hole this closes
 *
 * A 500 that leaves no server-side line is diagnosed from the browser or not
 * at all. Measured on `main`: a plain `Error` thrown out of a dispatcher route
 * answered `500 INTERNAL_ERROR` with **zero** log records at any level — the
 * only evidence was the client's console and the response body. The failure
 * that motivated this had been reachable for a week and nobody saw it, which
 * is AGENTS.md "Route & surface ownership §3 — absence must be loud" inverted.
 *
 * The reporting that DID exist was not a substitute, in two independent ways:
 *
 *  1. `ErrorReporter.captureException` is an APM channel and defaults to
 *     `NoopErrorReporter`. A dev server — the surface an operator actually
 *     watches — wires no reporter, so the capture was a no-op every time.
 *  2. It is fed by `res.__obsRecordedError`, which only the THROWN exit sets.
 *     A dispatcher route that catches its own fault and RETURNS a 5xx envelope
 *     (`deps.errorFromThrown`, which is how every `/packages` handler answers)
 *     records nothing, so even a wired reporter never saw those.
 *
 * This module is the log half, and it is deliberately not the reporter half:
 * an APM capture is opt-in telemetry, a log line is the operator's floor.
 *
 * ## Why it lives here
 *
 * `@objectstack/rest` and `@objectstack/runtime` both emit 5xx envelopes and
 * both already depend on this package, which owns the operator-facing channel
 * (`Logger`, `LOG_LEVELS`, `ErrorReporter`). The rule cannot live in either
 * consumer: `runtime` depends on `rest`, so an import could only ever point
 * one way — the same argument that put `resolveThrownHttpError` in
 * `@objectstack/types` rather than in one of its two doors. Centralising it
 * is also what keeps the two doors serving `/api/v1/packages` from printing
 * two lines for one fault: each door logs at its own single exit, and the
 * predicate that decides "is this worth a line" has one definition.
 *
 * ## `error` level, and why that clears the default
 *
 * The requirement is that the line survives `--log-level`'s DEFAULT. The CLI
 * default is `warn` (`packages/cli/src/utils/log-level.ts`) and `error` (40)
 * outranks `warn` (30) in `LEVEL_PRIORITY`, so an `error` record passes the
 * default threshold without any bypass of the level system. An operator who
 * asks for `--log-level silent` still gets silence: that is a deliberate
 * instruction, not the default this issue is about.
 *
 * ## 5xx only
 *
 * 4xx stays quiet, deliberately and at this one gate rather than at each call
 * site. A client error is the caller's mistake and the response already
 * explains it; logging them is how the `/meta` `?state=draft` probe once
 * printed 45 stack traces in one browsing session. `isServerFault` is the
 * whole rule: at or above 500.
 */

import type { Logger } from './contracts.js';

/** The request coordinates an operator needs to find the failing call. */
export interface ServerFaultRequest {
    /** HTTP method, e.g. `GET`. */
    method?: string;
    /** Request path as served, e.g. `/api/v1/packages`. */
    path?: string;
    /** Correlation id — the `X-Request-Id` echoed on the response. */
    requestId?: string;
}

/** One fault, as the emitting door knows it. */
export interface ServerFaultLogInput {
    /** The HTTP status about to be written. Below 500 nothing is logged. */
    status: number;
    /**
     * The original thrown value, when the door still holds it. Carries the
     * stack; the wire body never does, because a 5xx message is withheld.
     */
    error?: unknown;
    /** The envelope's `code`, when the door resolved one. */
    code?: string;
    /**
     * The message to print when {@link ServerFaultLogInput.error} carries
     * none — a declared fault built from a string rather than a throw.
     */
    message?: string;
    /** Where the call came in. */
    request?: ServerFaultRequest;
}

/** The prefix every fault line carries, so an operator can grep one token. */
export const SERVER_FAULT_LOG_PREFIX = '[5xx]';

/**
 * THE predicate. A response is a server fault worth a line exactly when its
 * status is 5xx. Exported so a door can decide without restating `>= 500`.
 */
export function isServerFault(status: number): boolean {
    return typeof status === 'number' && status >= 500;
}

/**
 * Normalize a thrown value to an `Error`, because `Logger.error`'s second
 * parameter is typed to one and a `throw 'string'` must not cost the line.
 * Returns `undefined` when there was no throw at all (a declared fault), so
 * the logger is not handed an empty synthetic stack.
 */
function toError(thrown: unknown): Error | undefined {
    if (thrown === undefined || thrown === null) return undefined;
    if (thrown instanceof Error) return thrown;
    const wrapped = new Error(typeof thrown === 'string' ? thrown : safeStringify(thrown));
    // The synthetic stack points at THIS file and would mislead; the value's
    // own text is the whole of what the producer gave us.
    wrapped.stack = undefined;
    return wrapped;
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/**
 * The human half of the line: `[5xx] 500 GET /api/v1/packages — <message>`.
 * Split out so both the emitted record and a test can name the same string.
 */
export function serverFaultLogMessage(input: ServerFaultLogInput): string {
    const err = toError(input.error);
    const text = err?.message || input.message || 'Unhandled server fault';
    const where = [input.request?.method, input.request?.path].filter(Boolean).join(' ');
    return `${SERVER_FAULT_LOG_PREFIX} ${input.status}${where ? ` ${where}` : ''} — ${text}`;
}

/**
 * The structured half. `status`/`code`/`requestId` are what a log search keys
 * on; `method`/`path` repeat the message's coordinates because a JSON sink
 * indexes fields, not prose.
 */
export function serverFaultLogMeta(input: ServerFaultLogInput): Record<string, unknown> {
    return {
        status: input.status,
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.request?.method !== undefined ? { method: input.request.method } : {}),
        ...(input.request?.path !== undefined ? { path: input.request.path } : {}),
        ...(input.request?.requestId !== undefined ? { requestId: input.request.requestId } : {}),
    };
}

/**
 * Emit EXACTLY ONE `error`-level record for a 5xx, or nothing at all.
 *
 * Returns whether a record was emitted, so a caller that must not double-log
 * can branch on the answer rather than re-deriving the 5xx test.
 *
 * `logger` is optional: a door with no injected logger falls back to
 * `console.error`, because the point of this function is that the line exists
 * even on a surface nobody configured. Emission never throws — a logging
 * failure must not become a second fault on top of the one being reported.
 */
export function logServerFault(
    input: ServerFaultLogInput,
    logger?: Logger,
): boolean {
    if (!isServerFault(input.status)) return false;
    const message = serverFaultLogMessage(input);
    const meta = serverFaultLogMeta(input);
    const err = toError(input.error);
    try {
        if (logger) {
            logger.error(message, err, meta);
            return true;
        }
        const sink = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
        sink?.error?.(message, { ...meta, ...(err?.stack ? { stack: err.stack } : {}) });
        return true;
    } catch {
        // Log emission must never throw — the original fault is still answered.
        return false;
    }
}

/**
 * Read request coordinates off whatever request object the transport hands
 * the door. Adapters disagree on the spelling (`path` / `url` /
 * `originalUrl`), and the request id may be on the object (set by
 * `instrumentRouteHandler`) or only on the incoming header — so both are
 * read here, once, instead of at each call site.
 */
export function describeFaultRequest(req: unknown): ServerFaultRequest {
    const r = req as {
        method?: unknown;
        path?: unknown;
        url?: unknown;
        originalUrl?: unknown;
        requestId?: unknown;
        headers?: Record<string, unknown>;
    } | undefined | null;
    if (!r || typeof r !== 'object') return {};
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const headerId = r.headers
        ? str(r.headers['x-request-id']) ?? str(r.headers['X-Request-Id'])
        : undefined;
    const method = str(r.method);
    const path = str(r.path) ?? str(r.url) ?? str(r.originalUrl);
    const requestId = str(r.requestId) ?? headerId;
    return {
        ...(method !== undefined ? { method } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
    };
}
