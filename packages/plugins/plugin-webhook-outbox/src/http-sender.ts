// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac, randomUUID } from 'node:crypto';
import type { WebhookDelivery, AckResult } from './outbox.js';

/**
 * Default per-request timeout. Receivers SHOULD respond within ~30s; we
 * cap aggressively to free dispatcher slots.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Truncate response bodies to keep storage cost predictable. */
const RESPONSE_BODY_CAP = 16 * 1024;

export type FetchImpl = (
    input: string,
    init: {
        method: string;
        headers: Record<string, string>;
        body: string;
        signal: AbortSignal;
    },
) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;

/** Single HTTP attempt classified to an `AckResult` shape (without nextRetryAt). */
export type AttemptOutcome =
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
 * Send one HTTP attempt for the delivery. Pure (no DB writes) so the
 * dispatcher owns retry-schedule + ack logic.
 *
 *   - 2xx                       → success
 *   - 4xx (except 408/429)      → permanent failure (retriable = false → goes to `dead`)
 *   - 408, 429, 5xx, transport  → retriable
 */
export async function sendOnce(
    delivery: WebhookDelivery,
    fetchImpl: FetchImpl,
): Promise<AttemptOutcome> {
    const body =
        typeof delivery.payload === 'string'
            ? delivery.payload
            : JSON.stringify(delivery.payload);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'ObjectStack-Webhooks/1.0',
        'X-Objectstack-Event': delivery.eventType,
        'X-Objectstack-Delivery': delivery.id,
        'X-Objectstack-Attempt': String(delivery.attempts + 1),
        ...(delivery.headers ?? {}),
    };
    if (delivery.secret) {
        const sig = createHmac('sha256', delivery.secret).update(body).digest('hex');
        headers['X-Objectstack-Signature'] = `sha256=${sig}`;
    }

    const timeoutMs = delivery.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
        const res = await fetchImpl(delivery.url, {
            method: delivery.method ?? 'POST',
            headers,
            body,
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
 * Stripe-style retry schedule. Returns the next `nextRetryAt` ms (relative
 * to `now`) given how many attempts have already happened, or `null` if
 * the row should be moved to `dead`.
 *
 *   attempt 1 fails -> retry in ~1s
 *   attempt 2 fails -> ~10s
 *   attempt 3 fails -> ~1m
 *   attempt 4 fails -> ~10m
 *   attempt 5 fails -> ~1h
 *   attempt 6 fails -> ~6h
 *   attempt 7 fails -> ~24h
 *   attempt 8+ fails -> dead
 *
 * Each delay is multiplied by jitter ∈ [0.8, 1.2].
 */
export function nextRetryDelayMs(
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
 * Compose an `AckResult` from an `AttemptOutcome`, applying the retry
 * schedule on retriable failures.
 */
export function classifyAttempt(
    outcome: AttemptOutcome,
    attemptsSoFar: number,
    now: number = Date.now(),
    rng?: () => number,
): AckResult {
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
    const delay = nextRetryDelayMs(attemptsSoFar + 1, rng);
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
