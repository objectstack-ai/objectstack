// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Notification delivery outbox contracts (ADR-0030 Layer 4).
 *
 * The outbox stores `(event × recipient × channel)` delivery rows that must be
 * sent reliably (at-least-once + receiver-side idempotency on the materialized
 * artifact). Implementations are pluggable so the same dispatcher runs against
 * an in-memory test store or the SQL-backed `sys_notification_delivery` table.
 * Mirrors the proven `plugin-webhooks` outbox.
 */

export type DeliveryStatus =
    | 'pending'
    | 'in_flight'
    | 'success'
    | 'failed'
    | 'dead'
    | 'suppressed';

/** Rendered content snapshot carried on the delivery row for dispatch. */
export interface DeliveryPayload {
    title?: string;
    body?: string;
    severity?: 'info' | 'warning' | 'critical' | string;
    actionUrl?: string;
    [k: string]: unknown;
}

export interface NotificationDeliveryRecord {
    id: string;
    notificationId: string;
    recipientId: string;
    channel: string;
    topic?: string;
    payload: DeliveryPayload;
    organizationId?: string;
    partitionKey: number;
    status: DeliveryStatus;
    attempts: number;
    claimedBy?: string;
    claimedAt?: number;
    nextAttemptAt?: number;
    lastAttemptedAt?: number;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export interface EnqueueDeliveryInput {
    notificationId: string;
    recipientId: string;
    channel: string;
    topic?: string;
    payload: DeliveryPayload;
    organizationId?: string;
    /**
     * Earliest dispatch time (epoch ms). When set, the row enqueues with
     * `nextAttemptAt = notBefore`, so the dispatcher (which skips pending rows
     * whose `nextAttemptAt` is in the future) defers the send until then. Used
     * by the ADR-0030 P3 quiet-hours scheduler; absent ⇒ immediate.
     */
    notBefore?: number;
}

export interface ClaimOptions {
    nodeId: string;
    limit: number;
    /** Only claim rows whose `hash(notificationId) mod count === index`. */
    partition?: { index: number; count: number };
    /** Visibility timeout — claimed rows revert to pending after this many ms. */
    claimTtlMs: number;
    /** "Now" reference, ms. Defaults to Date.now(). */
    now?: number;
}

export interface AckSuccess {
    success: true;
    durationMs?: number;
}

export interface AckFailure {
    success: false;
    error?: string;
    durationMs?: number;
    /** Computed by the dispatcher per the retry schedule, or undefined for dead. */
    nextAttemptAt?: number;
    /** Marks the row terminal `dead` — retry budget exhausted / permanent error. */
    dead?: boolean;
    /** Marks the row terminal `suppressed` — intentionally not delivered. */
    suppressed?: boolean;
}

export type AckResult = AckSuccess | AckFailure;

/**
 * Pluggable storage for delivery rows. `claim()` MUST be atomic across
 * concurrent callers (the at-least-once guarantee), and `enqueue()` MUST treat
 * `(notificationId, recipientId, channel)` as unique (silently returning the
 * existing id on a duplicate) so a repeated `emit` can't double-deliver.
 */
export interface INotificationOutbox {
    enqueue(input: EnqueueDeliveryInput): Promise<string>;
    claim(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]>;
    ack(id: string, result: AckResult): Promise<void>;
    list(filter?: { status?: DeliveryStatus; notificationId?: string }): Promise<NotificationDeliveryRecord[]>;
}
