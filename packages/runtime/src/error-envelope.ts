// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE place the dispatcher stack builds an error body (#3842).
 *
 * ## What was wrong
 *
 * `HttpDispatcher.error()` took the HTTP status as its `code` argument and wrote
 * it straight into `error.code` — the field `ApiErrorSchema` declares as a
 * semantic string:
 *
 * ```ts
 * return { status: code, body: { success: false, error: { message, code, details } } };
 * ```
 *
 * So a caller reading `error.code` got the number `403`, duplicating the response
 * status and occupying the one slot it is meant to branch on. The real code then
 * had to go somewhere else, and did — three somewhere-elses:
 *
 * | Site | Real code went to |
 * |---|---|
 * | auth gate, permission denial, anonymous denial | `details.code` |
 * | project-membership gate | `details.type` |
 * | `routeNotFound()` | `error.type` — a third spelling, sibling to the numeric `code` |
 *
 * Four sites, three parking spots, because the declared one was full. The
 * dispatcher working around its own field is what marked the number as being in
 * the wrong place.
 *
 * ## What this does
 *
 * `code` is the semantic string, `httpStatus` is the number, `details` is
 * genuine context only:
 *
 * ```json
 * { "success": false,
 *   "error": { "code": "PERMISSION_DENIED", "message": "…", "httpStatus": 403 } }
 * ```
 *
 * A code already carried in `details.code` is PROMOTED into `error.code` rather
 * than renamed, so `PASSWORD_EXPIRED` / `PERMISSION_DENIED` / `unauthenticated`
 * / `VALIDATION_FAILED` reach the wire spelled exactly as they are today — this
 * change moves a field, it does not pick a vocabulary (#3841 owns that). Only a
 * site that has NO code of its own gets one derived from the status, from the
 * single map in `packages/spec` (`standardErrorCodeForHttpStatus`), because
 * `ApiErrorSchema.code` is required and something has to fill it.
 *
 * Every error exit on this surface routes through here — `HttpDispatcher.error`,
 * `HttpDispatcher.routeNotFound`, `dispatcher-plugin`'s `errorResponseBase` and
 * its inline 404, and the MCP 405 that needs its own `Allow` header. That is
 * asserted by source scan in `error-envelope.conformance.test.ts`, so a new
 * branch cannot quietly reintroduce a numeric `code`.
 *
 * Message sanitisation stays at the call sites: each has its own 5xx-leak rule
 * and fallback message (#3867), and this module is deliberately only about which
 * field carries what.
 */

import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';

/** The `error` member of a dispatcher error body — an `ApiError` superset. */
export interface ApiErrorEnvelope {
    /** Semantic, machine-readable code. Never the HTTP status. */
    code: string;
    message: string;
    /** The response status, mirrored for callers that want it off the body. */
    httpStatus: number;
    details?: unknown;
    [extra: string]: unknown;
}

export interface ApiErrorInput {
    /** Already sanitised — see the module note on #3867. */
    message: string;
    httpStatus: number;
    /**
     * Semantic code. Wins over anything in `details`; omit to promote
     * `details.code`, and failing that to derive one from `httpStatus`.
     */
    code?: string;
    /** Structured context. A string `code` inside is promoted, not duplicated. */
    details?: unknown;
    /**
     * Declared siblings of `code`/`message` that are part of this error rather
     * than context — `route` / `hint` / `service` on a route-resolution failure
     * (see `DispatcherErrorResponseSchema`).
     */
    extra?: Record<string, unknown>;
}

/**
 * Lift a semantic `code` out of a legacy `details` payload.
 *
 * `details.code` was the dispatcher's de-facto carrier for the real error code,
 * so ~all existing call sites express it that way and keep working unchanged.
 * Non-string `code` values are left alone: a `details` that happens to carry a
 * numeric `code` is context, not a semantic code, and is passed through intact
 * rather than silently promoted into a string field.
 */
export function splitSemanticCode(details: unknown): { code?: string; details?: unknown } {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return { details: details ?? undefined };
    }
    const { code, ...rest } = details as Record<string, unknown>;
    if (code !== undefined && (typeof code !== 'string' || code === '')) {
        return { details };
    }
    return {
        code: code as string | undefined,
        // `undefined` rather than `{}` so a details payload that held nothing but
        // the code disappears from the wire instead of leaving an empty object.
        details: Object.keys(rest).length > 0 ? rest : undefined,
    };
}

/** Build the `error` member. See {@link ApiErrorInput} for the precedence rules. */
export function buildApiError(input: ApiErrorInput): ApiErrorEnvelope {
    const { code: promoted, details } = splitSemanticCode(input.details);
    return {
        code: input.code ?? promoted ?? standardErrorCodeForHttpStatus(input.httpStatus),
        message: input.message,
        httpStatus: input.httpStatus,
        ...(input.extra ?? {}),
        ...(details !== undefined ? { details } : {}),
    };
}

/** Build a full `{ status, body }` error response. */
export function apiErrorResponse(input: ApiErrorInput): { status: number; body: { success: false; error: ApiErrorEnvelope } } {
    return {
        status: input.httpStatus,
        body: { success: false, error: buildApiError(input) },
    };
}
