// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10673 — the delivery dispatchers' predicate writes are classified, not
 * silenced.
 *
 * ## What was measured
 * On a walled deployment (`OS_TENANCY_POSTURE=isolated`) the SQL driver's
 * `auditMissingTenant` gate printed, for both delivery objects:
 *
 *   [tenant-audit] updateMany on tenant-scoped object "sys_http_delivery"
 *   without options.tenantId — writes will not be tenant-isolated.
 *   [tenant-audit] updateMany on tenant-scoped object "sys_notification_delivery"
 *   without options.tenantId — writes will not be tenant-isolated.
 *
 * The audit is right that the writes are environment-wide. The fix is the
 * classification it demands, not the quiet: each `multi: true` write on the
 * claim path is declared a global dispatcher sweep (`bypassTenantAudit`), with
 * the warrant in `outbox-dispatcher-scope.ts`. See that file for why a
 * `tenantId` is not merely absent but unavailable and unwanted here.
 *
 * ## Why this harness rather than the composed boot
 * The card's repro is an EE image booted under docker compose, which this
 * checkout cannot run. What stands in its place is the instrument's OWN
 * criterion, exercised end to end: a real `SqlDriver` on better-sqlite3, real
 * `syncSchemas()` (so `organization_id` is really provisioned and
 * `resolveTenantField` really answers), the real `OS_TENANCY_POSTURE` read,
 * the production `SqlHttpOutbox` / `SqlNotificationOutbox`, and the driver's
 * own logger as the assertion surface — the same substitution
 * `sql-driver-tenant-audit-posture.test.ts` makes.
 *
 * ## The vacuity traps closed here, explicitly
 *  1. **A green that means "the audit was never armed".** Every test that
 *     asserts silence first asserts the gate's own preconditions are live —
 *     `resolveTenantField(object) === 'organization_id'` — and then performs a
 *     deliberately unscoped `multi: true` write on the SAME object through the
 *     SAME driver and requires the warning to appear. Without that positive
 *     control an object that stopped being tenant-scoped, a posture that
 *     stopped resolving, or a typo in the matcher would all read as a fix.
 *  2. **A "fix" that touches nothing.** Silence is cheap for an implementation
 *     that claims no rows. Every claim assertion pins the ROWS: both
 *     organizations' rows move, and their `organization_id` survives the write
 *     — the cross-organization reach is the operation's semantics, so a
 *     regression to per-organization scoping must go red here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_AUDIT = process.env.OS_TENANT_AUDIT;

let engine: ObjectQL;
let driver: SqlDriver;
let warns: Array<{ msg: string; meta: any }>;

/** The audit line the card quotes, matched on object + op. */
const auditedUpdateMany = (object: string): boolean =>
    warns.some((w) => w.msg.includes(`[tenant-audit] updateMany on tenant-scoped object "${object}"`));

beforeEach(async () => {
    // The posture is read LIVE by `isMultiTenantMode()` (#5262), so setting it
    // here really does arm the gate for the writes below.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    delete process.env.OS_TENANT_AUDIT;

    driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    warns = [];
    (driver as any).logger = { warn: (msg: string, meta: any) => warns.push({ msg, meta }) };

    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
    engine.registry.registerObject(NotificationDelivery as any, '@objectstack/service-messaging');
    await engine.syncSchemas();
});

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    if (OLD_AUDIT === undefined) delete process.env.OS_TENANT_AUDIT;
    else process.env.OS_TENANT_AUDIT = OLD_AUDIT;
});

/**
 * The positive control. An unscoped predicate write on `object`, issued
 * directly through the engine with no `bypassTenantAudit`, MUST produce the
 * audit line — otherwise a silent run proves nothing about the code under
 * test. Deliberately run AFTER the assertion it guards: the gate throttles one
 * warning per `${object}:${op}`, so this only fires if the production path
 * consumed no `updateMany` warning of its own.
 */
async function controlUnscopedUpdateMany(object: string): Promise<void> {
    // A PREDICATE write (no `id`), so it routes through `driver.updateMany`
    // exactly as the production path does; matching zero rows is fine — the
    // audit fires before the statement runs.
    await engine.update(object, { attempts: 99 }, { where: { status: '__control_no_such_status__' }, multi: true } as any);
    expect(
        auditedUpdateMany(object),
        `positive control failed: an unscoped multi:true write on ${object} produced no [tenant-audit] `
            + 'line, so this file cannot distinguish "classified" from "audit not armed"',
    ).toBe(true);
}

async function seedHttpRow(id: string, org: string, over: Record<string, unknown> = {}): Promise<void> {
    const now = new Date();
    await engine.insert(SYS_HTTP_DELIVERY, {
        id,
        source: 'test',
        ref_id: id,
        dedup_key: id,
        url: 'https://receiver.example/hook',
        method: 'POST',
        payload_json: '{}',
        partition_key: 0,
        status: 'pending',
        attempts: 0,
        organization_id: org,
        created_at: now,
        updated_at: now,
        ...over,
    } as any);
}

// ───────────────────────────────────────────────────────────────────────────
describe('sys_http_delivery — the dispatcher claim path is a classified global sweep', () => {
    it('claims across organizations without a tenant-audit finding', async () => {
        // The gate's own precondition: this object really is tenant-scoped.
        expect((driver as any).resolveTenantField(SYS_HTTP_DELIVERY)).toBe('organization_id');

        await seedHttpRow('h_a', 'org_a');
        await seedHttpRow('h_b', 'org_b');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const claimed = await outbox.claim({ nodeId: 'node1', limit: 10, claimTtlMs: 60_000 });

        // ① the classified write is silent…
        expect(auditedUpdateMany(SYS_HTTP_DELIVERY)).toBe(false);
        // ② …and it still reaches every organization, which is the point.
        expect(claimed.map((c) => c.id).sort()).toEqual(['h_a', 'h_b']);
        const rows = (await engine.find(SYS_HTTP_DELIVERY, { where: {} })) as any[];
        expect(rows.map((r) => `${r.id}:${r.organization_id}:${r.status}`).sort()).toEqual([
            'h_a:org_a:in_flight',
            'h_b:org_b:in_flight',
        ]);

        await controlUnscopedUpdateMany(SYS_HTTP_DELIVERY);
    });

    it('reaps a crashed node\'s in_flight rows in every organization, without a finding', async () => {
        const stale = Date.now() - 10 * 60_000;
        await seedHttpRow('h_a', 'org_a', { status: 'in_flight', claimed_by: 'dead_node', claimed_at: stale });
        await seedHttpRow('h_b', 'org_b', { status: 'in_flight', claimed_by: 'dead_node', claimed_at: stale });

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const claimed = await outbox.claim({ nodeId: 'node2', limit: 10, claimTtlMs: 60_000 });

        expect(auditedUpdateMany(SYS_HTTP_DELIVERY)).toBe(false);
        // Both organizations' abandoned rows were recovered AND re-claimed by
        // the live node — a per-organization reap would have stranded one.
        expect(claimed.map((c) => c.id).sort()).toEqual(['h_a', 'h_b']);
        const rows = (await engine.find(SYS_HTTP_DELIVERY, { where: {} })) as any[];
        expect(rows.every((r) => r.claimed_by === 'node2')).toBe(true);

        await controlUnscopedUpdateMany(SYS_HTTP_DELIVERY);
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('sys_notification_delivery — the dispatcher claim path is a classified global sweep', () => {
    it('claims across organizations without a tenant-audit finding', async () => {
        expect((driver as any).resolveTenantField(DELIVERY_OBJECT)).toBe('organization_id');

        const outbox = new SqlNotificationOutbox(engine as any, { partitionCount: 1 });
        const idA = await outbox.enqueue({
            notificationId: 'n_a', recipientId: 'u_a', channel: 'inbox', organizationId: 'org_a', payload: {},
        } as any);
        const idB = await outbox.enqueue({
            notificationId: 'n_b', recipientId: 'u_b', channel: 'inbox', organizationId: 'org_b', payload: {},
        } as any);

        const claimed = await outbox.claim({ nodeId: 'node1', limit: 10, claimTtlMs: 60_000 });

        expect(auditedUpdateMany(DELIVERY_OBJECT)).toBe(false);
        expect(claimed.map((c) => c.id).sort()).toEqual([idA, idB].sort());
        // The organization stamped at enqueue survives the sweep untouched —
        // the sweep moves `status`, never a row's tenant.
        expect(claimed.map((c) => c.organizationId).sort()).toEqual(['org_a', 'org_b']);

        await controlUnscopedUpdateMany(DELIVERY_OBJECT);
    });

    it('collapses a digest window across organizations without a finding', async () => {
        const outbox = new SqlNotificationOutbox(engine as any, { partitionCount: 1 });
        await outbox.enqueue({
            notificationId: 'n_a', recipientId: 'u_a', channel: 'inbox', organizationId: 'org_a',
            payload: {}, digestKey: 'u_a|inbox|w1',
        } as any);
        await outbox.enqueue({
            notificationId: 'n_b', recipientId: 'u_b', channel: 'inbox', organizationId: 'org_b',
            payload: {}, digestKey: 'u_b|inbox|w1',
        } as any);

        const claimed = await outbox.claimDigest({ nodeId: 'node1', limit: 10, claimTtlMs: 60_000 });

        expect(auditedUpdateMany(DELIVERY_OBJECT)).toBe(false);
        expect(claimed.map((c) => c.organizationId).sort()).toEqual(['org_a', 'org_b']);

        await controlUnscopedUpdateMany(DELIVERY_OBJECT);
    });
});
