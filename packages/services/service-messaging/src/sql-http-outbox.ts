// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { hashPartition } from './backoff.js';
import { toEpochMs } from './audit-timestamp.js';
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
    type RedeliverGuard,
    type UndeliverableHttpInput,
} from './http-outbox.js';
import { SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';

export interface SqlHttpOutboxOptions {
    /**
     * Total partition count — MUST match the dispatcher's `partitionCount`.
     * Used at enqueue time to precompute `partition_key`.
     */
    partitionCount: number;
    /** Object name to read/write. Defaults to `sys_http_delivery`. */
    objectName?: string;
}

/**
 * [#8118] Engines that expose the privileged internal-field dereference
 * (ObjectQL — the sibling of the `resolveSecretField` probe in
 * `plugin-webhooks/webhook-headers.ts`). Structural on purpose: this package
 * depends only on the `IDataEngine` contract, and a minimal fake engine that
 * implements neither method is an engine whose `find` does not redact either.
 */
type InternalFieldResolvingEngine = IDataEngine & {
    resolveInternalField?(
        object: string,
        recordIds: readonly string[],
        field: string,
    ): Promise<Map<string, unknown>>;
    getSchema?(objectName: string): unknown;
};

interface DeliveryRow {
    id: string;
    source: string;
    ref_id: string;
    dedup_key: string;
    label?: string | null;
    url: string;
    method?: string | null;
    headers_json?: string | null;
    signature?: string | null;
    timeout_ms?: number | null;
    payload_json: string;
    partition_key: number;
    status: HttpDeliveryStatus;
    attempts: number;
    claimed_by?: string | null;
    claimed_at?: number | null;
    next_retry_at?: number | null;
    last_attempted_at?: number | null;
    response_code?: number | null;
    response_body?: string | null;
    error?: string | null;
    // Builtin audit columns (native TIMESTAMP on Postgres/MySQL): WRITTEN as
    // `Date`s. Read-back form is dialect-dependent; `toRecord` normalises via
    // `toEpochMs`.
    created_at: number | string | Date;
    updated_at: number | string | Date;
}

/**
 * Durable {@link IHttpOutbox} backed by ObjectQL — the production storage impl
 * for the generic outbound-HTTP outbox (ADR-0018 M3). Works against any
 * registered driver through the driver-agnostic `IDataEngine` API.
 *
 * Mirrors `SqlWebhookOutbox` exactly (cluster-lock + atomic
 * `UPDATE WHERE status='pending'` for the exactly-once claim; precomputed
 * `partition_key`; SELECT-then-INSERT dedup converging on the unique index).
 * Dedup uniqueness is `(source, dedup_key)`; partition affinity is on `ref_id`.
 *
 * **No UPDATE here writes `updated_at`** (#4765) — same rule, same reason as
 * {@link SqlNotificationOutbox}: the platform's `sys_stamp_audit_update` hook
 * owns that column, a caller-supplied value is stripped as `readonly` (#2948)
 * with a WARN per call, and `claim()`'s unconditional reap UPDATE runs on every
 * dispatcher tick — so writing it turned an idle dev server into a console
 * firehose while changing nothing about the stored row.
 */
export class SqlHttpOutbox implements IHttpOutbox {
    private readonly objectName: string;
    private readonly partitionCount: number;

    constructor(
        private readonly engine: IDataEngine,
        opts: SqlHttpOutboxOptions,
    ) {
        if (opts.partitionCount <= 0) {
            throw new Error('SqlHttpOutbox: partitionCount must be > 0');
        }
        this.objectName = opts.objectName ?? SYS_HTTP_DELIVERY;
        this.partitionCount = opts.partitionCount;
    }

    async enqueue(input: EnqueueHttpInput): Promise<string> {
        assertEnqueueDeliverable(input);
        return this.insert(input, {
            // Sign here, store only the signature (#7722). The body is decided
            // at enqueue and replayed byte-for-byte by every retry, so one HMAC
            // covers every attempt and the secret has no reason to be persisted.
            signature: input.signingSecret
                ? signBody(deliveryBody(input.payload), input.signingSecret)
                : undefined,
            status: 'pending',
            error: undefined,
        });
    }

    /**
     * [#8069] Park a delivery that can never be sent.
     *
     * Written terminal on arrival — `status: 'dead'`, `attempts: 0`, the cause
     * in the existing `error` column, and **no signature**, because the secret
     * that would have produced one is precisely what could not be resolved.
     * The dispatcher's claim query filters `status = 'pending'`, so a parked row
     * is never picked up; `redeliver()` refuses it (see
     * `assertHttpRedeliverable`), so no operator can conjure a first delivery
     * out of it either.
     *
     * Reuses the same INSERT + `(source, dedup_key)` dedup convergence as
     * `enqueue()`: one discarded event yields at most one record, and a webhook
     * that re-arms cannot double-write a record for an event it already parked.
     */
    async recordUndeliverable(input: UndeliverableHttpInput): Promise<string> {
        return this.insert(input, { signature: undefined, status: 'dead', error: input.reason });
    }

    private async insert(
        input: Omit<EnqueueHttpInput, 'signingSecret' | 'undeliverableReason'>,
        terminal: { signature: string | undefined; status: HttpDeliveryStatus; error?: string },
    ): Promise<string> {
        const existing = await this.engine.findOne(this.objectName, {
            where: { source: input.source, dedup_key: input.dedupKey },
            fields: ['id'],
        });
        if (existing?.id) return existing.id as string;

        const id = randomUUID();
        // `Date`, not epoch-ms: `created_at` / `updated_at` are native TIMESTAMP
        // columns and a real timestamp column rejects a bare number on Postgres.
        const now = new Date();
        const row: DeliveryRow = {
            id,
            source: input.source,
            ref_id: input.refId,
            dedup_key: input.dedupKey,
            label: input.label,
            url: input.url,
            method: input.method ?? 'POST',
            headers_json: input.headers ? JSON.stringify(input.headers) : undefined,
            signature: terminal.signature,
            timeout_ms: input.timeoutMs,
            payload_json: JSON.stringify(input.payload ?? null),
            partition_key: hashPartition(input.refId, this.partitionCount),
            status: terminal.status,
            attempts: 0,
            error: terminal.error,
            created_at: now,
            updated_at: now,
        };
        try {
            await this.engine.insert(this.objectName, row);
            return id;
        } catch (err) {
            const winner = await this.engine.findOne(this.objectName, {
                where: { source: input.source, dedup_key: input.dedupKey },
                fields: ['id'],
            });
            if (winner?.id) return winner.id as string;
            throw err;
        }
    }

    async claim(opts: HttpClaimOptions): Promise<HttpDelivery[]> {
        const now = opts.now ?? Date.now();

        // 1. Reap stale in_flight rows — visibility-timeout recovery.
        await this.engine.update(
            this.objectName,
            { status: 'pending', claimed_by: null, claimed_at: null },
            {
                where: {
                    status: 'in_flight',
                    claimed_at: { $lt: now - opts.claimTtlMs },
                },
                multi: true,
            },
        );

        // 2. Pick candidate ids.
        const partitionFilter = opts.partition ? { partition_key: opts.partition.index } : {};
        const candidates = await this.engine.find(this.objectName, {
            where: {
                status: 'pending',
                ...partitionFilter,
                $or: [{ next_retry_at: null }, { next_retry_at: { $lte: now } }],
            },
            fields: ['id'],
            limit: opts.limit,
        });
        if (candidates.length === 0) return [];

        const ids = (candidates as Array<{ id: string }>).map((c) => c.id);

        // 3. Atomic claim. WHERE status='pending' rejects rows another worker took.
        await this.engine.update(
            this.objectName,
            { status: 'in_flight', claimed_by: opts.nodeId, claimed_at: now },
            { where: { id: { $in: ids }, status: 'pending' }, multi: true },
        );

        // 4. Read back the rows we actually own.
        const claimed = (await this.engine.find(this.objectName, {
            where: { id: { $in: ids }, claimed_by: opts.nodeId, claimed_at: now, status: 'in_flight' },
        })) as DeliveryRow[];

        // 5. [#8118] Recover the redacted header column for the rows this
        // claim now owns — the one read that must see the authored map.
        const headerColumns = await this.readClaimedHeaderColumns(claimed.map((r) => r.id));

        return claimed.map((r) => this.toDelivery(r, headerColumns));
    }

    /**
     * [#8118] Recover `headers_json` for a batch of just-claimed rows.
     *
     * `sys_http_delivery.headers_json` is declared `internal: true`, so the
     * generic read path — including the step-4 read-back above — hands rows
     * back WITHOUT it, for every caller, with no system carve-out (#7728's
     * explicit design). The dispatcher is the one reader that must see the
     * authored map verbatim: a delivery that goes out MISSING a header is not
     * self-announcing — against an endpoint that does not require it (a
     * routing `X-Tenant-Id`, an `X-Environment: staging`) the delivery
     * SUCCEEDS while silently deviating from the authored configuration, and
     * nothing records that it went out incomplete. So the claim path reads the
     * column back through the engine's purpose-built privileged accessor
     * (`resolveInternalField` — the remedy #7728 itself names), one driver
     * read per claim batch, never per row.
     *
     * Returns `undefined` — "use the row's own value" — when nothing redacts:
     *  - an object whose `headers_json` is not flagged `internal` has nothing
     *    withheld (a custom `objectName` override without the marking), and
     *  - an engine that exposes no schema at all is a minimal fake whose
     *    `find` does not omit the column either.
     *
     * The one combination this must NOT survive silently is "the column is
     * flagged, rows were claimed, and the engine cannot dereference": headers
     * are stored but unrecoverable, and delivering without them is the exact
     * fail-closed violation above. That combination THROWS — the same
     * discipline as `resolveWebhookHeaders` in plugin-webhooks (drop the
     * delivery attempt loudly, never deliver incomplete) — and the claimed
     * rows revert to `pending` via the claim TTL instead of going out bare.
     */
    private async readClaimedHeaderColumns(ids: string[]): Promise<Map<string, unknown> | undefined> {
        if (ids.length === 0) return undefined;
        const engine = this.engine as InternalFieldResolvingEngine;
        const schema = typeof engine.getSchema === 'function'
            ? (engine.getSchema(this.objectName) as
                | { fields?: Record<string, { internal?: unknown }> }
                | undefined)
            : undefined;
        // Strict `=== true`, matching the engine's own collector — a truthy-
        // but-not-true value does not enrol a field in the redaction either.
        if (schema?.fields?.headers_json?.internal !== true) return undefined;
        if (typeof engine.resolveInternalField !== 'function') {
            throw new Error(
                `SqlHttpOutbox.claim: ${this.objectName}.headers_json is declared \`internal: true\`, `
                    + 'but this data engine does not implement resolveInternalField() — stored headers '
                    + 'cannot be recovered, and a delivery must not go out missing the headers it was '
                    + 'authored with (#8118). The claimed rows revert to pending via the claim TTL.',
            );
        }
        return engine.resolveInternalField(this.objectName, ids, 'headers_json');
    }

    async ack(id: string, result: HttpAckResult): Promise<void> {
        const current = (await this.engine.findOne(this.objectName, {
            where: { id },
            fields: ['attempts'],
        })) as { attempts?: number } | null;
        if (!current) return;

        const now = Date.now();
        let status: HttpDeliveryStatus;
        let nextRetryAt: number | null;
        let error: string | null;

        if (result.success) {
            status = 'success';
            nextRetryAt = null;
            error = null;
        } else if (result.dead) {
            status = 'dead';
            nextRetryAt = null;
            error = result.error ?? null;
        } else {
            status = 'pending';
            nextRetryAt = result.nextRetryAt ?? null;
            error = result.error ?? null;
        }

        await this.engine.update(
            this.objectName,
            {
                status,
                attempts: (current.attempts ?? 0) + 1,
                last_attempted_at: now,
                claimed_by: null,
                claimed_at: null,
                response_code: result.httpStatus ?? null,
                response_body: result.responseBody ?? null,
                next_retry_at: nextRetryAt,
                error,
            },
            { where: { id }, multi: false },
        );
    }

    async list(filter?: { status?: HttpDeliveryStatus; source?: string }): Promise<HttpDelivery[]> {
        const where: Record<string, unknown> = {};
        if (filter?.status) where.status = filter.status;
        if (filter?.source) where.source = filter.source;
        const rows = (await this.engine.find(this.objectName, { where })) as DeliveryRow[];
        return rows.map((r) => this.toDelivery(r));
    }

    async redeliver(id: string, guard?: RedeliverGuard): Promise<HttpDelivery> {
        const current = (await this.engine.findOne(this.objectName, { where: { id } })) as DeliveryRow | null;
        if (!current) {
            throw new HttpRedeliverError(`Delivery row '${id}' not found`, 'RESOURCE_NOT_FOUND');
        }
        // [#8069] Every refusal runs BEFORE the reset UPDATE — a refused
        // redelivery leaves the row exactly as it was, `dead` reason included.
        await assertRedeliverAllowed(this.toDelivery(current), guard);
        await this.engine.update(
            this.objectName,
            {
                status: 'pending',
                attempts: 0,
                claimed_by: null,
                claimed_at: null,
                next_retry_at: null,
                last_attempted_at: null,
                response_code: null,
                response_body: null,
                error: null,
            },
            { where: { id, status: { $in: ['success', 'failed', 'dead'] } }, multi: false },
        );
        const after = (await this.engine.findOne(this.objectName, { where: { id } })) as DeliveryRow | null;
        if (!after || after.status !== 'pending') {
            throw new HttpRedeliverError(`Delivery row '${id}' state changed during redeliver`, 'DELIVERY_NOT_ELIGIBLE');
        }
        return this.toDelivery(after);
    }

    private toDelivery(r: DeliveryRow, headerColumns?: Map<string, unknown>): HttpDelivery {
        // [#8118] On the claim path the read-back row no longer carries
        // `headers_json` (`internal: true`) — the value arrives through the
        // privileged per-batch read instead. Parse semantics are IDENTICAL for
        // both sources on purpose: this is one column with two doors, not two
        // formats. Rows materialised WITHOUT the map (`list()`, `redeliver()`)
        // yield `headers: undefined` under a redacting engine — the redacted
        // view, which is the surface narrowing #8118 rules; the dispatcher
        // never sends from those.
        const headersJson = headerColumns
            ? (headerColumns.get(r.id) as string | null | undefined)
            : r.headers_json;
        return {
            id: r.id,
            source: r.source,
            refId: r.ref_id,
            dedupKey: r.dedup_key,
            label: r.label ?? undefined,
            url: r.url,
            method: r.method ?? undefined,
            headers: headersJson ? JSON.parse(headersJson) : undefined,
            signature: r.signature ?? undefined,
            timeoutMs: r.timeout_ms ?? undefined,
            payload: JSON.parse(r.payload_json),
            status: r.status,
            attempts: r.attempts,
            claimedBy: r.claimed_by ?? undefined,
            claimedAt: r.claimed_at ?? undefined,
            nextRetryAt: r.next_retry_at ?? undefined,
            lastAttemptedAt: r.last_attempted_at ?? undefined,
            responseCode: r.response_code ?? undefined,
            responseBody: r.response_body ?? undefined,
            error: r.error ?? undefined,
            createdAt: toEpochMs(r.created_at),
            updatedAt: toEpochMs(r.updated_at),
        };
    }
}
