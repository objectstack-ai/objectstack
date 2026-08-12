// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { hashPartition } from './backoff.js';
import { deliveryBody, signBody } from './http-sender.js';
import {
    HttpRedeliverError,
    type EnqueueHttpInput,
    type HttpAckResult,
    type HttpClaimOptions,
    type HttpDelivery,
    type HttpDeliveryStatus,
    type IHttpOutbox,
} from './http-outbox.js';

/**
 * In-memory {@link IHttpOutbox} for tests and single-process development.
 * Mirrors `MemoryWebhookOutbox`: atomic-claim semantics come for free from the
 * single-threaded event loop operating on one `Map`. Two instances do NOT share
 * state — pass the same instance to both dispatchers to simulate one DB.
 *
 * Signs at enqueue and drops the secret exactly like {@link SqlHttpOutbox}
 * (#7722) — the rows a test inspects here have the same shape as the ones the
 * SQL outbox persists, so a test cannot pass on a row that production wouldn't
 * write.
 */
export class MemoryHttpOutbox implements IHttpOutbox {
    private readonly rows = new Map<string, HttpDelivery>();
    /** Dedup index keyed by `${source}::${dedupKey}` -> row id. */
    private readonly dedup = new Map<string, string>();

    async enqueue(input: EnqueueHttpInput): Promise<string> {
        const dedupKey = `${input.source}::${input.dedupKey}`;
        const existing = this.dedup.get(dedupKey);
        if (existing) return existing;

        const id = randomUUID();
        const now = Date.now();
        const row: HttpDelivery = {
            id,
            source: input.source,
            refId: input.refId,
            dedupKey: input.dedupKey,
            label: input.label,
            url: input.url,
            method: input.method ?? 'POST',
            headers: input.headers,
            signature: input.signingSecret
                ? signBody(deliveryBody(input.payload), input.signingSecret)
                : undefined,
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

    async claim(opts: HttpClaimOptions): Promise<HttpDelivery[]> {
        const now = opts.now ?? Date.now();
        const claimed: HttpDelivery[] = [];

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
                const p = hashPartition(row.refId, opts.partition.count);
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

    async ack(id: string, result: HttpAckResult): Promise<void> {
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

        let status: HttpDeliveryStatus;
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

    async list(filter?: { status?: HttpDeliveryStatus; source?: string }): Promise<HttpDelivery[]> {
        let all = Array.from(this.rows.values()).map((r) => ({ ...r }));
        if (filter?.status) all = all.filter((r) => r.status === filter.status);
        if (filter?.source) all = all.filter((r) => r.source === filter.source);
        return all;
    }

    async redeliver(id: string): Promise<HttpDelivery> {
        const row = this.rows.get(id);
        if (!row) {
            throw new HttpRedeliverError(`Delivery row '${id}' not found`, 'RESOURCE_NOT_FOUND');
        }
        if (row.status !== 'success' && row.status !== 'failed' && row.status !== 'dead') {
            throw new HttpRedeliverError(
                `Delivery row '${id}' is '${row.status}', expected one of: success, failed, dead`,
                'DELIVERY_NOT_ELIGIBLE',
            );
        }
        const now = Date.now();
        row.status = 'pending';
        row.attempts = 0;
        row.claimedBy = undefined;
        row.claimedAt = undefined;
        row.nextRetryAt = undefined;
        row.error = undefined;
        row.responseCode = undefined;
        row.responseBody = undefined;
        row.updatedAt = now;
        return { ...row };
    }
}
