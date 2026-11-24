// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { HTTP_SIGNATURE_HEADER, signHttpBody } from '@objectstack/core';
import { findEgressRefusal } from '@objectstack/core/egress';
import type { HttpAckResult, HttpDelivery } from './http-outbox.js';

/**
 * Pure HTTP transport for the generic outbound-delivery outbox (ADR-0018 M3).
 *
 * Lifted and generalised from `plugin-webhooks/src/http-sender.ts`: a single
 * stateless attempt (`sendOnce`) plus the retry-schedule classifier
 * (`classifyAttempt`). The dispatcher owns claim/ack; this module owns the wire.
 *
 * It also owns the outbox's half of the HMAC contract — {@link deliveryBody}, the
 * exact bytes that are signed AND sent — so the enqueue-time signer and the
 * send-time transport cannot drift into signing one string and posting another.
 * HOW those bytes are signed is not this module's: the scheme is
 * `@objectstack/core`'s `signHttpBody` / `HTTP_SIGNATURE_HEADER`, shared with the
 * flow `http` node's inline arm, and re-exported below under this module's
 * historical names. See {@link HttpDelivery.signature} for why the signature is
 * computed once, at enqueue, instead of re-derived at send time from a secret
 * carried on the row.
 */

/** Default per-request timeout. */
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

/**
 * The signature header and the signer — the SAME bindings `@objectstack/core`
 * exports, never a second implementation: the outbox and the flow `http` node's
 * inline arm must mean one thing by one `signingSecret`.
 */
export { HTTP_SIGNATURE_HEADER as SIGNATURE_HEADER, signHttpBody as signBody };

/**
 * Whether a request of this method goes out with no body at all. `fetch`
 * refuses a GET or HEAD request that carries one (any one, `''` included), so
 * a delivery of either verb is sent bodyless and signed as such. The inline
 * `http` node arm sends the same: no body for a GET.
 */
export function isBodylessMethod(method: string | undefined): boolean {
    return method !== undefined && /^(GET|HEAD)$/i.test(method);
}

/**
 * Whether a payload stands for "no body": absent, `null`, or an empty plain
 * object — what a durable `http` node with no `body` enqueues (`body ?? {}`).
 * Anything else is bytes a receiver would be sent.
 */
function isNoBodyPayload(payload: unknown): boolean {
    if (payload === undefined || payload === null) return true;
    if (typeof payload !== 'object' || Array.isArray(payload)) return false;
    const proto = Object.getPrototypeOf(payload);
    return (proto === Object.prototype || proto === null) && Object.keys(payload).length === 0;
}

/**
 * Why a delivery of this method cannot carry this payload, or `undefined` when
 * it can. A GET or HEAD sends no body, so a payload that is a real body would
 * be dropped while the row records success. The outbox refuses it instead.
 */
export function bodylessPayloadRefusal(method: string | undefined, payload: unknown): string | undefined {
    if (!isBodylessMethod(method) || isNoBodyPayload(payload)) return undefined;
    const verb = method!.toUpperCase();
    return `a ${verb} delivery is sent with no body, and this one carries a payload, which would be `
        + `dropped. Use POST or PUT to send the payload, or drop the body to send a bodyless ${verb}.`;
}

/**
 * Refuse, at enqueue, a GET or HEAD delivery whose payload is a real body
 * (see {@link bodylessPayloadRefusal}). Both outboxes call it before they sign.
 */
export function assertBodylessPayloadAdmitted(input: { method?: string; payload: unknown }): void {
    const refusal = bodylessPayloadRefusal(input.method, input.payload);
    if (refusal !== undefined) throw new Error(`IHttpOutbox.enqueue: ${refusal}`);
}

/**
 * The exact request body for a delivery — the bytes that get sent, and
 * therefore the bytes the signature covers.
 *
 * A string payload is sent verbatim (a pre-rendered body); anything else is
 * JSON-serialised. Stable across a persistence round-trip: `SqlHttpOutbox`
 * stores `JSON.stringify(payload)` and re-parses it on claim, and
 * `JSON.stringify(JSON.parse(s)) === s` for any `s` that `JSON.stringify`
 * produced — so signing at enqueue and sending after a reload agree byte for
 * byte. `http-signature-at-rest.integration.test.ts` pins that.
 *
 * A GET or HEAD sends no body, so its bytes are the empty string — what the
 * published scheme signs for a request with no body. The outbox admits such a
 * delivery only with no payload, so nothing is dropped. Pass the delivery's
 * `method` wherever the body is signed, or the signature covers bytes that
 * are never sent.
 */
export function deliveryBody(payload: unknown, method?: string): string {
    if (isBodylessMethod(method)) return '';
    return typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
}

/** Truncate response bodies to keep storage cost predictable. */
const RESPONSE_BODY_CAP = 16 * 1024;

export type FetchImpl = (
    input: string,
    init: {
        method: string;
        headers: Record<string, string>;
        /** Absent for a GET or HEAD delivery, which is sent with no body. */
        body?: string;
        signal: AbortSignal;
    },
) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;

/** Single HTTP attempt classified to an ack shape (without nextRetryAt). */
export type HttpAttemptOutcome =
    | { success: true; httpStatus: number; responseBody?: string; durationMs: number }
    | {
          success: false;
          retriable: boolean;
          httpStatus?: number;
          responseBody?: string;
          error?: string;
          durationMs: number;
      };

/**
 * Send one HTTP attempt for the delivery. Pure (no DB writes) so the dispatcher
 * owns retry-schedule + ack logic.
 *
 *   - 2xx                       → success
 *   - 4xx (except 408/429)      → permanent failure (retriable = false → dead)
 *   - 408, 429, 5xx, transport  → retriable
 *   - a connect the egress guard refused → permanent failure, named
 *     `EGRESS_REFUSED`: retrying cannot change the verdict, so it dead-letters
 *     at once instead of walking the retry schedule; a host name that did
 *     not resolve reads the same refusal text and stays retriable
 */
export async function sendOnce(
    delivery: HttpDelivery,
    fetchImpl: FetchImpl,
): Promise<HttpAttemptOutcome> {
    const method = delivery.method ?? 'POST';
    // A row enqueued before the enqueue refusal (or redelivered from then) can
    // still hold a GET or HEAD with a real payload: fail it, never drop it.
    const refusal = bodylessPayloadRefusal(method, delivery.payload);
    if (refusal !== undefined) {
        return { success: false, retriable: false, error: refusal, durationMs: 0 };
    }
    // The bytes the enqueue-time signature covers. A GET or HEAD sends none.
    const body = deliveryBody(delivery.payload, method);
    const bodyless = isBodylessMethod(method);

    const headers: Record<string, string> = {
        ...(bodyless ? {} : { 'Content-Type': 'application/json' }),
        'User-Agent': 'ObjectStack-Http/1.0',
        'X-Objectstack-Delivery': delivery.id,
        'X-Objectstack-Attempt': String(delivery.attempts + 1),
        ...(delivery.label ? { 'X-Objectstack-Event': delivery.label } : {}),
        ...(delivery.headers ?? {}),
    };
    // Signed at enqueue (the body is fixed then and never rewritten), so the
    // signing secret is not on the row for this attempt — or any other — to
    // carry. #7722.
    if (delivery.signature) {
        headers[HTTP_SIGNATURE_HEADER] = delivery.signature;
    }

    const timeoutMs = delivery.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
        const res = await fetchImpl(delivery.url, {
            method,
            headers,
            ...(bodyless ? {} : { body }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        const responseText = await safeReadBody(res);
        const durationMs = Date.now() - start;
        if (res.ok) {
            return { success: true, httpStatus: res.status, responseBody: responseText, durationMs };
        }
        const retriable = res.status === 408 || res.status === 429 || res.status >= 500;
        return {
            success: false,
            retriable,
            httpStatus: res.status,
            responseBody: responseText,
            error: `HTTP ${res.status}`,
            durationMs,
        };
    } catch (err: unknown) {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const refused = findEgressRefusal(err);
        // Final unless the host name did not resolve; the text is the same either way.
        if (refused) return { success: false, retriable: refused.unresolved === true, error: refused.message, durationMs };
        const e = err as { name?: string; message?: string };
        const error = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e?.message ?? String(err);
        return { success: false, retriable: true, error, durationMs };
    }
}

async function safeReadBody(res: { text(): Promise<string> }): Promise<string | undefined> {
    try {
        const text = await res.text();
        return text.length > RESPONSE_BODY_CAP ? text.slice(0, RESPONSE_BODY_CAP) : text;
    } catch {
        return undefined;
    }
}

/**
 * Stripe-style retry schedule. Returns the next delay (ms) given how many
 * attempts have already happened, or `null` once the budget is exhausted.
 *
 *   1→~1s · 2→~10s · 3→~1m · 4→~10m · 5→~1h · 6→~6h · 7→~24h · 8+→dead
 *
 * Each delay is multiplied by jitter ∈ [0.8, 1.2).
 */
export function nextHttpRetryDelayMs(
    attemptsSoFar: number,
    rng: () => number = Math.random,
): number | null {
    const SCHEDULE = [1_000, 10_000, 60_000, 600_000, 3_600_000, 21_600_000, 86_400_000];
    if (attemptsSoFar < 1 || attemptsSoFar > SCHEDULE.length) return null;
    const base = SCHEDULE[attemptsSoFar - 1];
    const jitter = 0.8 + rng() * 0.4;
    return Math.floor(base * jitter);
}

/**
 * Compose an {@link HttpAckResult} from an outcome, applying the retry schedule
 * on retriable failures.
 */
export function classifyAttempt(
    outcome: HttpAttemptOutcome,
    attemptsSoFar: number,
    now: number = Date.now(),
    rng?: () => number,
): HttpAckResult {
    if (outcome.success) return outcome;
    if (!outcome.retriable) {
        return {
            success: false,
            httpStatus: outcome.httpStatus,
            responseBody: outcome.responseBody,
            error: outcome.error,
            durationMs: outcome.durationMs,
            dead: true,
        };
    }
    const delay = nextHttpRetryDelayMs(attemptsSoFar + 1, rng);
    if (delay === null) {
        return {
            success: false,
            httpStatus: outcome.httpStatus,
            responseBody: outcome.responseBody,
            error: outcome.error,
            durationMs: outcome.durationMs,
            dead: true,
        };
    }
    return {
        success: false,
        httpStatus: outcome.httpStatus,
        responseBody: outcome.responseBody,
        error: outcome.error,
        durationMs: outcome.durationMs,
        nextRetryAt: now + delay,
    };
}

/** Generate a fresh delivery id (UUID v4). Exposed for tests. */
export function newDeliveryId(): string {
    return randomUUID();
}
