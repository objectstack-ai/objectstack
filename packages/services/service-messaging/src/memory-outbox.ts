// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type {
    AckResult,
    ClaimOptions,
    DeliveryStatus,
    EnqueueDeliveryInput,
    INotificationOutbox,
    NotificationDeliveryRecord,
} from './outbox.js';
import { hashPartition } from './backoff.js';

/**
 * In-memory {@link INotificationOutbox} — the test/minimal-stack backend.
 * Single-process, so `claim()` is trivially atomic (no DB round-trips). Same
 * semantics as {@link SqlNotificationOutbox} for dedup, reaping, and acks.
 */
export class MemoryNotificationOutbox implements INotificationOutbox {
    private readonly rows = new Map<string, NotificationDeliveryRecord>();

    constructor(
        private readonly partitionCount = 8,
        /** Injectable clock (ms) for deterministic tests. Defaults to Date.now. */
        private readonly clock: () => number = () => Date.now(),
    ) {}

    async enqueue(input: EnqueueDeliveryInput): Promise<string> {
        for (const r of this.rows.values()) {
            if (
                r.notificationId === input.notificationId &&
                r.recipientId === input.recipientId &&
                r.channel === input.channel
            ) {
                return r.id; // dedup
            }
        }
        const id = randomUUID();
        const now = this.clock();
        this.rows.set(id, {
            id,
            notificationId: input.notificationId,
            recipientId: input.recipientId,
            channel: input.channel,
            topic: input.topic,
            payload: input.payload ?? {},
            organizationId: input.organizationId,
            partitionKey: hashPartition(input.notificationId, this.partitionCount),
            status: 'pending',
            attempts: 0,
            // Deferred dispatch (quiet-hours, P3): claim() skips pending rows
            // whose nextAttemptAt is still in the future.
            nextAttemptAt: input.notBefore,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    }

    async claim(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]> {
        const now = opts.now ?? this.clock();
        // Reap stale in_flight.
        for (const r of this.rows.values()) {
            if (r.status === 'in_flight' && (r.claimedAt ?? 0) < now - opts.claimTtlMs) {
                r.status = 'pending';
                r.claimedBy = undefined;
                r.claimedAt = undefined;
                r.updatedAt = now;
            }
        }
        const out: NotificationDeliveryRecord[] = [];
        for (const r of this.rows.values()) {
            if (out.length >= opts.limit) break;
            if (r.status !== 'pending') continue;
            if (opts.partition && r.partitionKey !== opts.partition.index) continue;
            if (r.nextAttemptAt != null && r.nextAttemptAt > now) continue;
            r.status = 'in_flight';
            r.claimedBy = opts.nodeId;
            r.claimedAt = now;
            r.updatedAt = now;
            out.push({ ...r });
        }
        return out;
    }

    async ack(id: string, result: AckResult): Promise<void> {
        const r = this.rows.get(id);
        if (!r) return;
        const now = this.clock();
        r.attempts += 1;
        r.lastAttemptedAt = now;
        r.claimedBy = undefined;
        r.claimedAt = undefined;
        r.updatedAt = now;
        if (result.success) {
            r.status = 'success';
            r.nextAttemptAt = undefined;
            r.error = undefined;
        } else if (result.suppressed) {
            r.status = 'suppressed';
            r.error = result.error;
        } else if (result.dead) {
            r.status = 'dead';
            r.error = result.error;
        } else {
            r.status = 'pending';
            r.nextAttemptAt = result.nextAttemptAt;
            r.error = result.error;
        }
    }

    async list(filter?: { status?: DeliveryStatus; notificationId?: string }): Promise<NotificationDeliveryRecord[]> {
        let rows = [...this.rows.values()];
        if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
        if (filter?.notificationId) rows = rows.filter((r) => r.notificationId === filter.notificationId);
        return rows.map((r) => ({ ...r }));
    }
}
