// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { hashPartition } from './backoff.js';
import { deliveryBody, signBody } from './http-sender.js';
import {
    HttpRedeliverError,
    assertEnqueueDeliverable,
    assertRedeliverAllowed,
    type EnqueueHttpInput,
    type HttpAckResult,
    type HttpClaimOptions,
    type HttpDelivery,
    type HttpDeliveryStatus,
    type IHttpOutbox,
    type RedeliverOptions,
    type UndeliverableHttpInput,
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
        assertEnqueueDeliverable(input);
        return this.insert(input, {
            signature: input.signingSecret
                ? signBody(deliveryBody(input.payload), input.signingSecret)
                : undefined,
            status: 'pending',
            error: undefined,
        });
    }

    /**
     * [#8069] Park a delivery that can never be sent — same row shape the SQL
     * outbox writes, so a test that inspects a parked row here is looking at
     * what production persists.
     */
    async recordUndeliverable(input: UndeliverableHttpInput): Promise<string> {
        return this.insert(input, { signature: undefined, status: 'dead', error: input.reason });
    }

    private insert(
        input: Omit<EnqueueHttpInput, 'signingSecret' | 'undeliverableReason'>,
        terminal: { signature: string | undefined; status: HttpDeliveryStatus; error?: string },
    ): string {
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
            signature: terminal.signature,
            timeoutMs: input.timeoutMs,
            payload: input.payload,
            // [#13546] Same stamp as `SqlHttpOutbox.insert`, so a test that
            // inspects a row here sees what production persists — and so
            // `redeliver()` below has a tenant to scope by.
            organizationId: input.organizationId,
            status: terminal.status,
            attempts: 0,
            error: terminal.error,
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

    /**
     * [#10740] `options.tenantId` IS applied here since #13546. The [#10740]
     * text this replaces disclaimed the predicate because the rows carried no
     * tenant at all ("a future memory implementation that DOES store a tenant
     * owes the predicate here") — and `insert()` now stamps
     * {@link HttpDelivery.organizationId}, so the debt is due.
     *
     * The predicate mirrors the SQL driver's tenant term
     * `(organization_id = :tenantId OR organization_id IS NULL)`, all three
     * arms deliberately:
     *  - a row in ANOTHER organization is INVISIBLE (`RESOURCE_NOT_FOUND`),
     *    never forbidden — the same non-oracle refusal the contract rules;
     *  - a row with NO organization is a global row every tenant may reach
     *    (the driver's deliberate fail-open arm — hiding platform rows from
     *    every tenant is a different defect);
     *  - a caller with NO tenant (`tenantId: undefined`) stays unscoped,
     *    which is the honest degraded shape {@link RedeliverOptions} rules
     *    for genuinely tenant-less deployments.
     */
    async redeliver(id: string, options: RedeliverOptions): Promise<HttpDelivery> {
        const row = this.rows.get(id);
        if (
            !row ||
            (options.tenantId !== undefined &&
                row.organizationId !== undefined &&
                row.organizationId !== options.tenantId)
        ) {
            throw new HttpRedeliverError(`Delivery row '${id}' not found`, 'RESOURCE_NOT_FOUND');
        }
        // [#8069] Refuse BEFORE any mutation — a refused redelivery must leave
        // the row byte-identical, including its `dead` status and its reason.
        await assertRedeliverAllowed({ ...row }, options.guard);
        // [#11009] The compare-and-set half of the check-then-act, mirroring
        // `SqlHttpOutbox.redeliver`'s predicate-path write: the guard above is
        // awaited, so a dispatcher tick can claim this row `in_flight` between
        // the read and this mutation. A row no longer terminal is NOT reset —
        // the same refusal (and the same code) the SQL store reports when its
        // predicate write matches zero rows. Without this, the two
        // implementations of one `IHttpOutbox.redeliver` contract would
        // disagree on exactly the race the contract exists to close.
        if (row.status !== 'success' && row.status !== 'failed' && row.status !== 'dead') {
            throw new HttpRedeliverError(
                `Delivery row '${id}' state changed during redeliver`,
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
