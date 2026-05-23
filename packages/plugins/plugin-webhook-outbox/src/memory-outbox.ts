// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type {
    AckResult,
    ClaimOptions,
    EnqueueInput,
    DeliveryStatus,
    IWebhookOutbox,
    WebhookDelivery,
} from './outbox.js';
import { hashPartition } from './partition.js';

/**
 * In-memory `IWebhookOutbox` for tests and single-process development.
 *
 * Implements the atomic-claim semantics by running its claim/ack logic
 * synchronously (single-threaded JS event loop) inside one `Map`. Two
 * `MemoryWebhookOutbox` instances do NOT share state — for the cross-node
 * test the *same* instance is passed to both dispatchers (simulating one
 * shared database).
 *
 * A production SQL-backed implementation will live in a sibling file and
 * use `SELECT ... FOR UPDATE SKIP LOCKED`.
 */
export class MemoryWebhookOutbox implements IWebhookOutbox {
    private readonly rows = new Map<string, WebhookDelivery>();
    /** Dedup index keyed by `${eventId}::${webhookId}` -> row id. */
    private readonly dedup = new Map<string, string>();

    async enqueue(input: EnqueueInput): Promise<string> {
        const dedupKey = `${input.eventId}::${input.webhookId}`;
        const existing = this.dedup.get(dedupKey);
        if (existing) return existing;

        const id = randomUUID();
        const now = Date.now();
        const row: WebhookDelivery = {
            id,
            webhookId: input.webhookId,
            eventId: input.eventId,
            eventType: input.eventType,
            url: input.url,
            method: input.method ?? 'POST',
            headers: input.headers,
            secret: input.secret,
            timeoutMs: input.timeoutMs,
            payload: input.payload,
            status: 'pending',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(id, row);
        this.dedup.set(dedupKey, id);
        return id;
    }

    async claim(opts: ClaimOptions): Promise<WebhookDelivery[]> {
        const now = opts.now ?? Date.now();
        const claimed: WebhookDelivery[] = [];

        // First pass: reap expired in_flight rows (visibility timeout).
        for (const row of this.rows.values()) {
            if (
                row.status === 'in_flight' &&
                row.claimedAt !== undefined &&
                now - row.claimedAt > opts.claimTtlMs
            ) {
                row.status = 'pending';
                row.claimedBy = undefined;
                row.claimedAt = undefined;
                row.updatedAt = now;
            }
        }

        for (const row of this.rows.values()) {
            if (claimed.length >= opts.limit) break;
            if (row.status !== 'pending') continue;
            if (row.nextRetryAt !== undefined && row.nextRetryAt > now) continue;
            if (opts.partition) {
                const p = hashPartition(row.webhookId, opts.partition.count);
                if (p !== opts.partition.index) continue;
            }
            row.status = 'in_flight';
            row.claimedBy = opts.nodeId;
            row.claimedAt = now;
            row.updatedAt = now;
            claimed.push({ ...row });
        }
        return claimed;
    }

    async ack(id: string, result: AckResult): Promise<void> {
        const row = this.rows.get(id);
        if (!row) return;
        const now = Date.now();
        row.attempts += 1;
        row.lastAttemptedAt = now;
        row.updatedAt = now;
        row.claimedBy = undefined;
        row.claimedAt = undefined;
        row.responseCode = result.httpStatus;
        row.responseBody = result.responseBody;

        let status: DeliveryStatus;
        if (result.success) {
            status = 'success';
            row.nextRetryAt = undefined;
            row.error = undefined;
        } else if (result.dead) {
            status = 'dead';
            row.error = result.error;
            row.nextRetryAt = undefined;
        } else {
            status = 'pending';
            row.error = result.error;
            row.nextRetryAt = result.nextRetryAt;
        }
        row.status = status;
    }

    async list(filter?: { status?: DeliveryStatus }): Promise<WebhookDelivery[]> {
        const all = Array.from(this.rows.values()).map((r) => ({ ...r }));
        return filter?.status ? all.filter((r) => r.status === filter.status) : all;
    }
}
