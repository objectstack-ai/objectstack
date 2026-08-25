// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4765 — the SQL outboxes must never put `updated_at` in an UPDATE payload.
 *
 * ObjectQL's builtin `sys_stamp_audit_update` hook owns that column on every
 * update, and the column is `readonly`, so a caller-supplied value is stripped
 * by `stripReadonlyFields` (#2948) — which WARNs once per call. `claim()` and
 * `claimDigest()` open with an unconditional "reap stale in_flight" UPDATE that
 * runs on every dispatcher tick whether or not a row is stale, so the write was
 * both a no-op (stripped, then re-stamped) and, at 3 claim paths × 8 partitions
 * × a 500 ms tick, 48 identical warnings a second on an idle `pnpm dev`.
 *
 * INSERT is a different path (no strip, and `created_at` IS caller-owned): it
 * keeps writing both audit columns, as `Date`s — a native TIMESTAMP column
 * rejects a bare epoch-ms number on Postgres (see `audit-timestamp.ts`).
 */

import { describe, it, expect } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';

interface RecordedUpdate {
    object: string;
    data: Record<string, unknown>;
}

/**
 * Minimal recording `IDataEngine`. `find` replays a scripted queue of result
 * sets so a claim can be driven all the way through candidate-select →
 * atomic-claim → read-back; everything else is inert.
 *
 * [#11453] `SqlNotificationOutbox.ack` is a compare-and-set now — it reads the
 * row's STATUS as well as its attempts, writes conditionally, then reads back
 * to confirm the write landed. So the fake keeps one row's state and applies
 * writes to it, rather than answering a bare `{ attempts }` forever:
 *
 *  - the row starts `in_flight`, because acking a row is something a
 *    dispatcher does to a row IT CLAIMED, and a fixture that left it `pending`
 *    would be asserting audit columns on a call the contract now refuses;
 *  - `update` applies the payload, so the read-back sees what was written and
 *    the ack completes. A fake that could never report the write would make
 *    every ack look like a lost claim.
 */
function makeEngine(findResults: Array<Array<Record<string, unknown>>> = []) {
    const updates: RecordedUpdate[] = [];
    const inserts: Array<{ object: string; data: Record<string, unknown> }> = [];
    let findCall = 0;
    const row: Record<string, unknown> = { status: 'in_flight', attempts: 2 };

    const engine = {
        async insert(object: string, data: Record<string, unknown>) {
            inserts.push({ object, data });
            return data;
        },
        async update(object: string, data: Record<string, unknown>) {
            updates.push({ object, data });
            Object.assign(row, data);
            return { matched: 1, modified: 1 };
        },
        async find(_object: string) {
            return findResults[findCall++] ?? [];
        },
        async findOne(_object: string, opts?: { fields?: string[] }) {
            // `ack()` reads the row it is completing; `enqueue()` probes for a
            // dedup winner and must miss so the insert path runs.
            if (opts?.fields?.includes('attempts')) return { ...row };
            return null;
        },
        async delete() { return { matched: 0, modified: 0 }; },
    } as unknown as IDataEngine;

    return { engine, updates, inserts, row };
}

/** Every audit column an UPDATE payload must leave to the platform. */
const PLATFORM_OWNED_ON_UPDATE = ['updated_at'];

function expectNoPlatformAuditColumns(updates: RecordedUpdate[]) {
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
        for (const column of PLATFORM_OWNED_ON_UPDATE) {
            expect(
                Object.prototype.hasOwnProperty.call(u.data, column),
                `UPDATE on ${u.object} must not write '${column}' — keys: ${Object.keys(u.data).join(', ')}`,
            ).toBe(false);
        }
    }
}

describe('SqlNotificationOutbox — audit columns on UPDATE (#4765)', () => {
    it('claim() writes no updated_at (reap + atomic claim)', async () => {
        // find #1 → candidate ids; find #2 → read-back of the rows we own.
        const { engine, updates } = makeEngine([[{ id: 'd1' }], []]);
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 8 });

        await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });

        // Both the unconditional reap and the atomic claim ran.
        expect(updates).toHaveLength(2);
        expectNoPlatformAuditColumns(updates);
        // The claim still stamps its OWN columns — this is not a blanket strip.
        expect(updates[1].data).toMatchObject({ status: 'in_flight', claimed_by: 'n1' });
        expect(updates[1].data.claimed_at).toEqual(expect.any(Number));
    });

    it('claim() writes no updated_at even when nothing is claimable', async () => {
        // The reap UPDATE fires on every tick regardless — that is the firehose.
        const { engine, updates } = makeEngine([[]]);
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 8 });

        await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });

        expect(updates).toHaveLength(1);
        expectNoPlatformAuditColumns(updates);
    });

    it('claimDigest() writes no updated_at', async () => {
        const { engine, updates } = makeEngine([[{ id: 'd1' }], []]);
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 8 });

        await outbox.claimDigest({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });

        expect(updates).toHaveLength(2);
        expectNoPlatformAuditColumns(updates);
    });

    it('ack() writes no updated_at but still bumps its own columns', async () => {
        const { engine, updates } = makeEngine();
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 8 });

        await outbox.ack('d1', { success: false, error: 'boom', nextAttemptAt: 123 });

        expectNoPlatformAuditColumns(updates);
        expect(updates[0].data).toMatchObject({
            status: 'pending',
            attempts: 3, // 2 (read back) + 1
            error: 'boom',
            next_attempt_at: 123,
        });
    });

    it('enqueue() still writes both audit columns as Dates on INSERT', async () => {
        const { engine, inserts } = makeEngine();
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 8 });

        await outbox.enqueue({ notificationId: 'n1', recipientId: 'u1', channel: 'email', payload: {} });

        expect(inserts).toHaveLength(1);
        expect(inserts[0].data.created_at).toBeInstanceOf(Date);
        expect(inserts[0].data.updated_at).toBeInstanceOf(Date);
    });
});

describe('SqlHttpOutbox — audit columns on UPDATE (#4765)', () => {
    const enqueueInput = {
        source: 'flow',
        refId: 'r1',
        dedupKey: 'd1',
        url: 'https://example.test/hook',
        payload: { hello: 'world' },
    };

    it('claim() writes no updated_at (reap + atomic claim)', async () => {
        const { engine, updates } = makeEngine([[{ id: 'h1' }], []]);
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });

        expect(updates).toHaveLength(2);
        expectNoPlatformAuditColumns(updates);
        expect(updates[1].data).toMatchObject({ status: 'in_flight', claimed_by: 'n1' });
    });

    it('claim() writes no updated_at even when nothing is claimable', async () => {
        const { engine, updates } = makeEngine([[]]);
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });

        expect(updates).toHaveLength(1);
        expectNoPlatformAuditColumns(updates);
    });

    it('ack() writes no updated_at but still bumps its own columns', async () => {
        const { engine, updates } = makeEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.ack('h1', {
            success: false,
            error: 'boom',
            httpStatus: 503,
            nextRetryAt: 456,
            durationMs: 12,
        });

        expectNoPlatformAuditColumns(updates);
        expect(updates[0].data).toMatchObject({
            status: 'pending',
            attempts: 3,
            error: 'boom',
            response_code: 503,
            next_retry_at: 456,
        });
    });

    it('enqueue() still writes both audit columns as Dates on INSERT', async () => {
        const { engine, inserts } = makeEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.enqueue(enqueueInput);

        expect(inserts).toHaveLength(1);
        expect(inserts[0].data.created_at).toBeInstanceOf(Date);
        expect(inserts[0].data.updated_at).toBeInstanceOf(Date);
    });
});
