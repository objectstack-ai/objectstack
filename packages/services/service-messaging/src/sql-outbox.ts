// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
    AckResult,
    ClaimOptions,
    DeliveryStatus,
    EnqueueDeliveryInput,
    INotificationOutbox,
    NotificationDeliveryRecord,
} from './outbox.js';
import { hashPartition } from './backoff.js';
import { toEpochMs } from './audit-timestamp.js';
import { dispatcherAckCasOptions, dispatcherSweepOptions } from './outbox-dispatcher-scope.js';
import { NotificationAckError, notificationAckLostClaimMessage, notificationAckNotClaimedMessage } from './outbox.js';

export const DELIVERY_OBJECT = 'sys_notification_delivery';

export interface SqlNotificationOutboxOptions {
    /** Total partitions — MUST match the dispatcher's `partitionCount`. */
    partitionCount: number;
    /** Object name override (default {@link DELIVERY_OBJECT}). */
    objectName?: string;
}

interface DeliveryRow {
    id: string;
    notification_id: string;
    recipient_id: string;
    channel: string;
    topic?: string | null;
    payload?: unknown; // json column — engine returns object or string per driver
    organization_id?: string | null;
    partition_key: number;
    status: DeliveryStatus;
    attempts: number;
    claimed_by?: string | null;
    claimed_at?: number | null;
    next_attempt_at?: number | null;
    last_attempted_at?: number | null;
    error?: string | null;
    digest_key?: string | null;
    // Builtin audit columns (native TIMESTAMP on Postgres/MySQL): WRITTEN as
    // `Date`s. Read-back form is dialect-dependent (epoch-ms on SQLite, a
    // `Date`/ISO string on Postgres); `toRecord` normalises via `toEpochMs`.
    created_at: number | string | Date;
    updated_at: number | string | Date;
}

/**
 * Durable {@link INotificationOutbox} over ObjectQL — the production store.
 * Driver-agnostic (no `FOR UPDATE SKIP LOCKED`): safety comes from the
 * dispatcher's per-partition cluster lock plus the atomic
 * `UPDATE … WHERE status='pending'` claim. `partition_key` is precomputed on
 * enqueue (ObjectQL has no portable `hash()` in WHERE). Mirrors
 * `SqlWebhookOutbox`.
 *
 * **No UPDATE here writes `updated_at`** (#4765). ObjectQL's builtin
 * `sys_stamp_audit_update` hook stamps it on every update unconditionally, and
 * `updated_at` is `readonly`, so a caller-supplied value is stripped by
 * `stripReadonlyFields` (#2948) before it reaches the driver — with a WARN per
 * call. `claim()` / `claimDigest()` start with an unconditional reap UPDATE that
 * runs whether or not a row is stale, so on an idle dev server the three claim
 * paths × 8 partitions × a 500 ms dispatcher tick spammed 48 identical warnings
 * a second and drowned the console. Writing the column was already a no-op
 * (stripped, then re-stamped); passing it as epoch-ms would also have been the
 * wrong shape for a native TIMESTAMP column (see `toEpochMs`) had it ever
 * survived the strip. Leave it to the platform.
 */
export class SqlNotificationOutbox implements INotificationOutbox {
    private readonly objectName: string;
    private readonly partitionCount: number;

    constructor(private readonly engine: IDataEngine, opts: SqlNotificationOutboxOptions) {
        if (opts.partitionCount <= 0) throw new Error('SqlNotificationOutbox: partitionCount must be > 0');
        this.objectName = opts.objectName ?? DELIVERY_OBJECT;
        this.partitionCount = opts.partitionCount;
    }

    async enqueue(input: EnqueueDeliveryInput): Promise<string> {
        const dedup = {
            notification_id: input.notificationId,
            recipient_id: input.recipientId,
            channel: input.channel,
        };
        const existing = await this.engine.findOne(this.objectName, { where: dedup, fields: ['id'] });
        if (existing?.id) return String(existing.id);

        const id = randomUUID();
        // `Date`, not epoch-ms: `created_at` / `updated_at` are native TIMESTAMP
        // columns and a real timestamp column rejects a bare number on Postgres.
        const now = new Date();
        const row: DeliveryRow = {
            id,
            notification_id: input.notificationId,
            recipient_id: input.recipientId,
            channel: input.channel,
            topic: input.topic ?? null,
            payload: input.payload ?? {},
            organization_id: input.organizationId ?? null,
            // Digest rows partition by their group key so a window's rows land in
            // one partition and a single node collapses them under its lock.
            partition_key: hashPartition(input.digestKey ?? input.notificationId, this.partitionCount),
            status: 'pending',
            attempts: 0,
            // Deferred dispatch (quiet-hours / digest, P3): claim() skips pending
            // rows whose next_attempt_at is in the future.
            next_attempt_at: input.notBefore ?? null,
            digest_key: input.digestKey ?? null,
            created_at: now,
            updated_at: now,
        };
        try {
            await this.engine.insert(this.objectName, row);
            return id;
        } catch (err) {
            // Unique-index collision (dedup race) → return the winner.
            const winner = await this.engine.findOne(this.objectName, { where: dedup, fields: ['id'] });
            if (winner?.id) return String(winner.id);
            throw err;
        }
    }

    async claim(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]> {
        const now = opts.now ?? Date.now();

        // 1. Reap stale in_flight rows (visibility-timeout recovery).
        await this.engine.update(
            this.objectName,
            { status: 'pending', claimed_by: null, claimed_at: null },
            // Environment-wide by design: recovers rows a crashed node abandoned,
            // for every organization. Warrant in `outbox-dispatcher-scope.ts`.
            dispatcherSweepOptions({ status: 'in_flight', claimed_at: { $lt: now - opts.claimTtlMs } }),
        );

        // 2. Candidate ids: ready pending rows in our partition. Batched (digest)
        //    rows are excluded — they drain via claimDigest so they collapse.
        const partitionFilter = opts.partition ? { partition_key: opts.partition.index } : {};
        const candidates = await this.engine.find(this.objectName, {
            where: {
                status: 'pending',
                digest_key: null,
                ...partitionFilter,
                $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
            },
            fields: ['id'],
            limit: opts.limit,
        });
        if (!candidates.length) return [];
        const ids = (candidates as Array<{ id: string }>).map((c) => c.id);

        // 3. Atomic claim — WHERE status='pending' rejects rows another worker took.
        await this.engine.update(
            this.objectName,
            { status: 'in_flight', claimed_by: opts.nodeId, claimed_at: now },
            // Environment-wide by design: the dispatcher drains every
            // organization's queue. Warrant in `outbox-dispatcher-scope.ts`.
            dispatcherSweepOptions({ id: { $in: ids }, status: 'pending' }),
        );

        // 4. Read back only the rows we own.
        const claimed = (await this.engine.find(this.objectName, {
            where: { id: { $in: ids }, claimed_by: opts.nodeId, claimed_at: now, status: 'in_flight' },
        })) as DeliveryRow[];
        return claimed.map((r) => this.toRecord(r));
    }

    async claimDigest(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]> {
        const now = opts.now ?? Date.now();

        // 1. Reap stale in_flight (same as claim).
        await this.engine.update(
            this.objectName,
            { status: 'pending', claimed_by: null, claimed_at: null },
            // Environment-wide by design: recovers rows a crashed node abandoned,
            // for every organization. Warrant in `outbox-dispatcher-scope.ts`.
            dispatcherSweepOptions({ status: 'in_flight', claimed_at: { $lt: now - opts.claimTtlMs } }),
        );

        // 2. All DUE batched rows in our partition — a window is claimed whole, so
        //    we don't apply `limit` (a generous cap guards a pathological backlog).
        const partitionFilter = opts.partition ? { partition_key: opts.partition.index } : {};
        const candidates = await this.engine.find(this.objectName, {
            where: {
                status: 'pending',
                digest_key: { $ne: null },
                ...partitionFilter,
                $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
            },
            fields: ['id'],
            limit: 10000,
        });
        if (!candidates.length) return [];
        const ids = (candidates as Array<{ id: string }>).map((c) => c.id);

        // 3. Atomic claim.
        await this.engine.update(
            this.objectName,
            { status: 'in_flight', claimed_by: opts.nodeId, claimed_at: now },
            // Environment-wide by design: the dispatcher drains every
            // organization's queue. Warrant in `outbox-dispatcher-scope.ts`.
            dispatcherSweepOptions({ id: { $in: ids }, status: 'pending' }),
        );

        // 4. Read back the rows we own.
        const claimed = (await this.engine.find(this.objectName, {
            where: { id: { $in: ids }, claimed_by: opts.nodeId, claimed_at: now, status: 'in_flight' },
        })) as DeliveryRow[];
        return claimed.map((r) => this.toRecord(r));
    }

    async ack(id: string, result: AckResult): Promise<void> {
        const current = (await this.engine.findOne(this.objectName, {
            where: { id },
            fields: ['status', 'attempts'],
        })) as { status?: DeliveryStatus; attempts?: number } | null;
        // An id matching no row is not a contract violation: no state to
        // corrupt, no claim to lose. Declared on the interface, unchanged.
        if (!current) return;
        // [#11453] Precondition, half one: the loud, deterministic refusal for
        // a row that is not claimed at all — the ack-as-cancel trap. Refused
        // BEFORE any write, so a refused ack leaves the row byte-identical.
        if (current.status !== 'in_flight') {
            throw new NotificationAckError(
                notificationAckNotClaimedMessage(id, current.status ?? 'unknown'),
                'DELIVERY_NOT_ELIGIBLE',
            );
        }

        const now = Date.now();
        let status: DeliveryStatus;
        let nextAttemptAt: number | null = null;
        let error: string | null = null;

        if (result.success) {
            status = 'success';
        } else if (result.suppressed) {
            status = 'suppressed';
            error = result.error ?? null;
        } else if (result.dead) {
            status = 'dead';
            error = result.error ?? null;
        } else {
            status = 'pending';
            nextAttemptAt = result.nextAttemptAt ?? null;
            error = result.error ?? null;
        }

        // [#11453] Precondition, half two: the ATOMIC one. The status test
        // above is a read, and a read cannot hold a row still — `claim()` is
        // atomic by contract and this call was never part of that atom, which
        // is the race the card describes. So the requirement is re-stated IN
        // the write: the row is transitioned only if it is STILL `in_flight`.
        // A row reaped by the visibility timeout and re-claimed between the
        // read and here matches nothing and is left entirely alone.
        //
        // `attempts` is incremented HERE and only here, inside that condition,
        // so the counter can only move for a row that was genuinely claimed —
        // i.e. for a real dispatch attempt. Previously this write was
        // unconditional and by-id, so any caller could advance the retry
        // schedule of a row no dispatcher ever held.
        const attempts = (current.attempts ?? 0) + 1;
        await this.engine.update(
            this.objectName,
            {
                status,
                attempts,
                last_attempted_at: now,
                claimed_by: null,
                claimed_at: null,
                next_attempt_at: nextAttemptAt,
                error,
            },
            // Predicate write (`updateMany`), audited under that op. Declared a
            // global-sweep site — no request context exists on the tick that
            // reaches here. Warrant in `outbox-dispatcher-scope.ts`.
            dispatcherAckCasOptions(id, 'in_flight') as any,
        );

        // Did the conditional write land? `IDataEngine.update` declares its
        // return as `any`, so the row itself is the only contract-safe answer
        // — the same read-back `SqlHttpOutbox.redeliver` uses to report its own
        // compare-and-set miss. Without it a lost claim would write nothing and
        // still report success, which is the silent-success family this card
        // exists to close.
        //
        // The detector is the pair (status, attempts), not status alone: a
        // retry ack's post-state IS `pending`, the same status a refused row
        // already had, so only the recorded attempt tells the two apart.
        const after = (await this.engine.findOne(this.objectName, {
            where: { id },
            fields: ['status', 'attempts'],
        })) as { status?: DeliveryStatus; attempts?: number } | null;
        if (!after || after.status !== status || (after.attempts ?? 0) !== attempts) {
            throw new NotificationAckError(
                notificationAckLostClaimMessage(id, after?.status ?? 'unknown'),
                'DELIVERY_NOT_ELIGIBLE',
            );
        }
    }

    async list(filter?: { status?: DeliveryStatus; notificationId?: string }): Promise<NotificationDeliveryRecord[]> {
        const where: Record<string, unknown> = {};
        if (filter?.status) where.status = filter.status;
        if (filter?.notificationId) where.notification_id = filter.notificationId;
        const rows = (await this.engine.find(this.objectName, { where })) as DeliveryRow[];
        return rows.map((r) => this.toRecord(r));
    }

    private toRecord(r: DeliveryRow): NotificationDeliveryRecord {
        let payload = r.payload ?? {};
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { payload = {}; }
        }
        return {
            id: r.id,
            notificationId: r.notification_id,
            recipientId: r.recipient_id,
            channel: r.channel,
            topic: r.topic ?? undefined,
            payload: payload as NotificationDeliveryRecord['payload'],
            organizationId: r.organization_id ?? undefined,
            partitionKey: r.partition_key,
            status: r.status,
            attempts: r.attempts,
            claimedBy: r.claimed_by ?? undefined,
            claimedAt: r.claimed_at ?? undefined,
            nextAttemptAt: r.next_attempt_at ?? undefined,
            lastAttemptedAt: r.last_attempted_at ?? undefined,
            error: r.error ?? undefined,
            digestKey: r.digest_key ?? undefined,
            createdAt: toEpochMs(r.created_at),
            updatedAt: toEpochMs(r.updated_at),
        };
    }
}
