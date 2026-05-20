// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Request correlation primitives.
 *
 * Two concerns:
 *
 *   1. **Request IDs.** Every request gets a stable id that is echoed back
 *      via `X-Request-Id`, threaded into log records, and (where the host
 *      asks for it) made available to handlers via `req.requestId`. The id
 *      comes from the incoming `X-Request-Id` header when present and
 *      well-formed, otherwise we mint a fresh one.
 *
 *   2. **W3C Trace Context.** When clients pass `traceparent` per
 *      <https://www.w3.org/TR/trace-context/>, we surface the parsed
 *      `traceId` / `spanId` / `sampled` triple so the host can attach it
 *      to its OTel SDK / logger.
 *
 * Both helpers are pure functions — no I/O, no side effects, no
 * dependencies — so they are safe to call on the hot path and trivial to
 * test.
 */

const MAX_REQUEST_ID_LENGTH = 200;

/**
 * Allowed characters in a request id: alphanumerics plus `-_.:`.
 * Rejects whitespace, control chars, anything that could interfere
 * with header serialization or log parsing.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Extract a request id from incoming headers, validating shape. If
 * the header is missing or malformed, returns `undefined` and the
 * caller should mint one via {@link generateRequestId}.
 *
 * Header lookup is case-insensitive — adapters normalize differently.
 */
export function extractRequestId(headers: unknown): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
        if (k.toLowerCase() !== 'x-request-id') continue;
        const raw = Array.isArray(v) ? v[0] : v;
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) return undefined;
        if (!REQUEST_ID_PATTERN.test(trimmed)) return undefined;
        return trimmed;
    }
    return undefined;
}

/**
 * Mint a fresh request id. Uses `crypto.randomUUID()` when available
 * (Node 16+, modern browsers, edge runtimes); falls back to a
 * timestamp+random suffix otherwise so the function is universally
 * callable.
 *
 * Format is `req_<hex>`; the prefix makes it obvious in logs that the
 * id was minted by this layer (vs. propagated from a client).
 */
export function generateRequestId(): string {
    const g: { randomUUID?: () => string } | undefined =
        (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (g && typeof g.randomUUID === 'function') {
        return `req_${g.randomUUID().replace(/-/g, '')}`;
    }
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 12);
    return `req_${t}${r}`;
}

/**
 * Return the incoming request id if valid, otherwise mint one.
 */
export function resolveRequestId(
    headers: unknown,
    generate: () => string = generateRequestId,
): string {
    return extractRequestId(headers) ?? generate();
}

/**
 * Parsed W3C Trace Context. `sampled` reflects the lowest flag bit.
 */
export interface TraceContext {
    traceId: string;
    spanId: string;
    sampled: boolean;
}

const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a `traceparent` header value into its W3C fields. Returns
 * `undefined` for malformed input, the all-zero trace/span ids
 * (spec-mandated invalid), or unknown versions.
 */
export function parseTraceparent(value: unknown): TraceContext | undefined {
    if (typeof value !== 'string') return undefined;
    const m = TRACEPARENT_PATTERN.exec(value.trim().toLowerCase());
    if (!m) return undefined;
    const [, version, traceId, spanId, flags] = m;
    if (version !== '00') return undefined;
    if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
    const sampled = (parseInt(flags, 16) & 0x01) === 0x01;
    return { traceId, spanId, sampled };
}

/**
 * Build the response header equivalent so downstream services
 * continue the trace.
 */
export function formatTraceparent(ctx: TraceContext): string {
    const flag = ctx.sampled ? '01' : '00';
    return `00-${ctx.traceId}-${ctx.spanId}-${flag}`;
}
