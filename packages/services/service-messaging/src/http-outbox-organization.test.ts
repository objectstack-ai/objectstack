// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13546] `sys_http_delivery` rows carry the producer's organization.
 *
 * The consequence being pinned: the cross-organization wall on `redeliver()`
 * (#10740) scopes by the row's `organization_id`. The driver's tenant term was
 * then `(organization_id = :tenantId OR organization_id IS NULL)`, a global-row
 * fail-open, and the enqueue door never stamped the column, so 100% of rows
 * were in that arm and the wall excluded nothing. ADR-0131 D8 has since
 * retired the NULL arm: the term is `organization_id = :tenantId` alone, and
 * an organization-less row is reached by no tenant-scoped redeliver.
 *
 * ⭐ The control for this suite is the sibling notification outbox
 * (`SqlOutbox.enqueue` writes `organization_id: input.organizationId ?? null`)
 * — the repair the HTTP outbox is here made to mirror. One package, one
 * convention: the member is optional on the input, the write normalizes a
 * missing value to NULL exactly once, and the read-back maps NULL to absent.
 *
 * The memory double is pinned alongside on purpose: it now STORES the tenant,
 * so per its own #10740 note ("a future memory implementation that DOES store
 * a tenant owes the predicate here") its `redeliver()` owes the same
 * invisible-not-forbidden scoping the SQL store applies — otherwise a suite
 * running against the double passes cross-organization replays production
 * refuses.
 */

import { describe, it, expect } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpRedeliverError } from './http-outbox.js';

/**
 * A capturing data engine for the INSERT path: dedup probes miss (so the
 * insert runs), writes are recorded verbatim, and `find` replays what was
 * inserted so the `list()` read-back mapping can be asserted.
 */
function capturingEngine() {
    const inserts: Array<{ object: string; row: Record<string, unknown> }> = [];
    const engine = {
        async insert(object: string, row: Record<string, unknown>) {
            inserts.push({ object, row: { ...row } });
            return { ...row };
        },
        async findOne(object: string, query?: { fields?: string[] }) {
            assertEngineFindOnePredicate(object, query);
            return null; // no dedup winner — the insert path runs
        },
        async find() {
            return inserts.map((i) => ({ ...i.row }));
        },
    } as unknown as IDataEngine;
    return { engine, inserts };
}

const enqueueInput = {
    source: 'flow',
    refId: 'node_1',
    dedupKey: 'dk_1',
    url: 'https://example.test/hook',
    payload: { hello: 'world' },
};

describe('#13546 — SqlHttpOutbox stamps organization_id on the delivery row', () => {
    it('enqueue() writes the producer organization onto the row', async () => {
        const { engine, inserts } = capturingEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.enqueue({ ...enqueueInput, organizationId: 'org_pin_alpha' });

        expect(inserts).toHaveLength(1);
        // Verbatim — threaded, never derived or defaulted.
        expect(inserts[0].row.organization_id).toBe('org_pin_alpha');
    });

    it('enqueue() without an organization writes an EXPLICIT null (normalized once, at the write)', async () => {
        const { engine, inserts } = capturingEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.enqueue(enqueueInput);

        expect(inserts).toHaveLength(1);
        // Present-and-null, mirroring `SqlOutbox.enqueue` — the key exists so
        // the normalization site is this insert, not scattered consumers.
        expect(Object.prototype.hasOwnProperty.call(inserts[0].row, 'organization_id')).toBe(true);
        expect(inserts[0].row.organization_id).toBeNull();
    });

    it('recordUndeliverable() stamps the parked row the same way', async () => {
        const { engine, inserts } = capturingEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.recordUndeliverable({
            ...enqueueInput,
            organizationId: 'org_pin_alpha',
            reason: 'signing secret unresolvable',
        });

        expect(inserts).toHaveLength(1);
        expect(inserts[0].row.status).toBe('dead');
        // A parked row is a tenant-scoped row too — it sits in the Failures
        // view for the full retention window and must not be a global row.
        expect(inserts[0].row.organization_id).toBe('org_pin_alpha');
    });

    it('list() maps organization_id back to organizationId (NULL → absent)', async () => {
        const { engine } = capturingEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 8 });

        await outbox.enqueue({ ...enqueueInput, organizationId: 'org_pin_alpha' });
        await outbox.enqueue({ ...enqueueInput, dedupKey: 'dk_2' });

        const rows = await outbox.list();
        expect(rows.map((r) => r.organizationId)).toEqual(['org_pin_alpha', undefined]);
    });
});

describe('#13546 — MemoryHttpOutbox parity', () => {
    it('enqueue() stamps organizationId on the stored row', async () => {
        const outbox = new MemoryHttpOutbox();
        const id = await outbox.enqueue({ ...enqueueInput, organizationId: 'org_pin_alpha' });

        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(id);
        expect(rows[0].organizationId).toBe('org_pin_alpha');
    });

    /** Enqueue + dead-ack: the shortest path to a redeliverable terminal row. */
    async function deadRow(outbox: MemoryHttpOutbox, organizationId?: string): Promise<string> {
        const id = await outbox.enqueue({
            ...enqueueInput,
            dedupKey: `dk_${organizationId ?? 'none'}`,
            ...(organizationId ? { organizationId } : {}),
        });
        await outbox.ack(id, { success: false, dead: true, error: 'boom', durationMs: 1 });
        return id;
    }

    it("redeliver() from ANOTHER organization is INVISIBLE — RESOURCE_NOT_FOUND, row untouched", async () => {
        const outbox = new MemoryHttpOutbox();
        const id = await deadRow(outbox, 'org_pin_alpha');

        // [ADR-0112] The envelope, not just "it threw": the refusal must be
        // the not-found the contract rules (never an existence oracle), on the
        // error class callers match on.
        const attempt = outbox.redeliver(id, { tenantId: 'org_pin_beta' });
        await expect(attempt).rejects.toBeInstanceOf(HttpRedeliverError);
        await expect(attempt).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

        // Invisible means NOTHING was written — the row still reads dead.
        const [row] = await outbox.list({ status: 'dead' });
        expect(row.id).toBe(id);
        expect(row.attempts).toBe(1);
    });

    it('redeliver() inside the owning organization succeeds', async () => {
        const outbox = new MemoryHttpOutbox();
        const id = await deadRow(outbox, 'org_pin_alpha');

        const row = await outbox.redeliver(id, { tenantId: 'org_pin_alpha' });
        expect(row.status).toBe('pending');
        // The reset must not strip the tenant — a replay stays scoped.
        expect(row.organizationId).toBe('org_pin_alpha');
    });

    it('an org-less row is INVISIBLE to every tenant-scoped redeliver — no NULL arm (ADR-0131 D8)', async () => {
        // The memory predicate mirrors the SQL driver's `organization_id =
        // :tenantId` with no `OR organization_id IS NULL` arm: NULL is not an
        // owner, so no tenant may replay a row of no organization.
        const outbox = new MemoryHttpOutbox();
        const id = await deadRow(outbox);

        const attempt = outbox.redeliver(id, { tenantId: 'org_pin_beta' });
        await expect(attempt).rejects.toBeInstanceOf(HttpRedeliverError);
        await expect(attempt).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
        const [row] = await outbox.list({ status: 'dead' });
        expect(row.id).toBe(id);
        expect(row.attempts).toBe(1);

        // Still reachable where nothing scopes: a tenant-less caller.
        const replayed = await outbox.redeliver(id, { tenantId: undefined });
        expect(replayed.status).toBe('pending');
    });

    it('a tenant-less caller stays unscoped (the honest degraded shape RedeliverOptions rules)', async () => {
        const outbox = new MemoryHttpOutbox();
        const id = await deadRow(outbox, 'org_pin_alpha');

        const row = await outbox.redeliver(id, { tenantId: undefined });
        expect(row.status).toBe('pending');
    });
});
