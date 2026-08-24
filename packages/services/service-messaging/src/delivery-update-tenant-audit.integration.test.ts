// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10740 — the `update`-op half of the delivery tenant-audit surface, where
 * three single-record writes on two objects carry TWO OPPOSITE
 * classifications.
 *
 * | site                            | reachable from     | classification      |
 * | ------------------------------- | ------------------ | ------------------- |
 * | `SqlNotificationOutbox.ack`     | dispatcher tick    | global sweep        |
 * | `SqlHttpOutbox.ack`             | dispatcher tick    | global sweep        |
 * | `SqlHttpOutbox.redeliver`       | POST /api/v1/…     | request-contextual  |
 *
 * [#11009] `redeliver`'s reset now rides the PREDICATE path (`multi: true`,
 * `driver.updateMany`) so its terminal-status compare-and-set is actually
 * evaluated — the by-id path silently discarded it. Its audit op is therefore
 * `updateMany`, and its spy below records `SqlDriver.updateMany`; the
 * tenant-classification contract this file pins (#10740) is unchanged —
 * threaded `tenantId`, never `bypassTenantAudit`.
 *
 * [#11453] `SqlNotificationOutbox.ack` has since made the SAME move for the
 * same reason: its new status precondition ("this row must still be
 * `in_flight`") is a compare-and-set, and a predicate on the by-id path is
 * silently discarded, so it rides `multi: true` too. Its audit op is
 * `updateMany` and its spy below records `SqlDriver.updateMany`. Its
 * CLASSIFICATION is unchanged — declared global, now via
 * `dispatcherAckCasOptions` — which is the point of pinning the two
 * separately: the op moved, the warrant did not. Of the three sites only
 * `SqlHttpOutbox.ack` still writes by id.
 *
 * The `ack` pair is declared global (`dispatcherAckOptions`, warrant in
 * `outbox-dispatcher-scope.ts`). `redeliver` is NOT: it is served to any
 * authenticated user, so it threads the caller's tenant instead. ⛔ A
 * `bypassTenantAudit` on that third site would convert a detectable hole into
 * an undetectable one, which is why the assertions below are not written
 * against the audit line alone.
 *
 * ## Why the audit line is not a sufficient assertion here
 * A SCOPED write and a BYPASSED write produce the SAME silence in the log.
 * An assertion that only checked "no `[tenant-audit]` line for `redeliver`"
 * would therefore pass on the one implementation this card forbids. So the
 * `redeliver` tests assert **the options that actually reached the driver** —
 * `tenantId` present, `bypassTenantAudit` absent — through a spy installed on
 * `SqlDriver.update` itself, the method that both applies the tenant scope and
 * decides the audit.
 *
 * ## Why a real delivery is driven through
 * `ack` runs only once a delivery has actually been processed, unlike the
 * claim path's reap `UPDATE` which runs on every tick. A boot log on an empty
 * queue shows the two `updateMany` lines and says NOTHING about this op — an
 * audit line that is absent because nothing ran is NOT MEASURED, not a pass.
 * Every `ack` test below therefore runs a real dispatcher tick and then pins
 * that the attempt was recorded (`status`, `attempts`), so a silent run cannot
 * be mistaken for a clean one.
 *
 * ## The vacuity traps closed explicitly
 *  1. **"the audit was never armed."** Every silence assertion is followed by
 *     a positive control on the SAME object through the SAME driver: an
 *     unscoped by-id `update` that MUST produce the line. The gate throttles
 *     one warning per `${object}:${op}`, so the control runs last and only
 *     fires if the production path consumed no `update` warning of its own.
 *  2. **"a fix that touches nothing."** Row state is pinned after every write.
 *  3. **"a refusal that refuses everything."** The cross-tenant refusal is
 *     paired with a still-works leg: an in-tenant redeliver still succeeds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { NotificationDispatcher } from './dispatcher.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import type { FetchImpl } from './http-sender.js';
import type { MessagingChannel } from './channel.js';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_AUDIT = process.env.OS_TENANT_AUDIT;

let engine: ObjectQL;
let driver: SqlDriver;
let warns: Array<{ msg: string; meta: any }>;
/** Every `options` bag that reached `SqlDriver.update` — the `update` op only. */
let driverUpdates: Array<{ object: string; id: unknown; options: any }>;
/** Every `options` bag that reached `SqlDriver.updateMany` — `redeliver`'s op since #11009, and the notification `ack`'s since #11453. */
let driverUpdateManys: Array<{ object: string; where: unknown; options: any }>;

/** The audit line for the SINGLE-RECORD op, matched on object + op. */
const auditedUpdate = (object: string): boolean =>
    warns.some((w) => w.msg.includes(`[tenant-audit] update on tenant-scoped object "${object}"`));

/** The audit line for the PREDICATE op — `redeliver`'s write since #11009, the notification `ack`'s since #11453. */
const auditedUpdateMany = (object: string): boolean =>
    warns.some((w) => w.msg.includes(`[tenant-audit] updateMany on tenant-scoped object "${object}"`));

beforeEach(async () => {
    // Read LIVE by `isMultiTenantMode()` (#5262), so this really arms the gate.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    delete process.env.OS_TENANT_AUDIT;

    driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    warns = [];
    driverUpdates = [];
    driverUpdateManys = [];
    (driver as any).logger = { warn: (msg: string, meta: any) => warns.push({ msg, meta }) };

    // Spy on the driver's by-id UPDATE — the method that calls
    // `auditMissingTenant(object, 'update', options)` AND `applyTenantScope`.
    // Recording here rather than at the engine is deliberate: the engine may
    // add or withhold `tenantId` (`buildDriverOptions`), so the driver's
    // argument is the only reading of what the write was actually scoped by.
    const realUpdate = (driver as any).update.bind(driver);
    (driver as any).update = async (object: string, id: unknown, data: any, options: any) => {
        driverUpdates.push({ object, id, options });
        return realUpdate(object, id, data, options);
    };
    // [#11009] The same reading for the predicate op: `redeliver`'s reset now
    // reaches the driver through `updateMany`, and the options bag IT received
    // is the only truthful record of what that write was scoped by.
    const realUpdateMany = (driver as any).updateMany.bind(driver);
    (driver as any).updateMany = async (object: string, query: any, data: any, options: any) => {
        driverUpdateManys.push({ object, where: query?.where, options });
        return realUpdateMany(object, query, data, options);
    };

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
 * The positive control for the `update` op. A by-id write with no `tenantId`
 * and no bypass MUST produce the audit line on `object`, or this file cannot
 * tell "classified" from "the gate was never armed". Run AFTER the assertion
 * it guards — the gate throttles one warning per `${object}:${op}`.
 */
async function controlUnscopedUpdate(object: string, existingId: string): Promise<void> {
    // `where: { id }` with a scalar id routes through `driver.update`
    // (`resolveEngineUpdateDispatch` → `by-id`), exactly as the production
    // paths under test do.
    //
    // ⚠️ It must name a row that EXISTS. The engine's by-id branch raises
    // `Record <id> not found` before it ever reaches the driver, so a control
    // pointed at a missing id never arms the gate it is meant to prove is
    // armed — it fails as an error rather than reporting a vacuous suite,
    // which is the only reason that mistake was visible here.
    await engine.update(object, { attempts: 99 }, { where: { id: existingId } } as any);
    expect(
        auditedUpdate(object),
        `positive control failed: an unscoped by-id update on ${object} produced no [tenant-audit] `
            + 'line, so every "no finding" assertion in this file is vacuous',
    ).toBe(true);
}

/**
 * The positive control for the `updateMany` op — `redeliver`'s op since
 * #11009. An unscoped predicate write with no bypass MUST produce the
 * `updateMany` audit line, or the silence assertions on that op are vacuous.
 * Run AFTER the assertion it guards (one warning per object+op key).
 */
async function controlUnscopedUpdateMany(object: string, existingId: string): Promise<void> {
    // Scalar id + a second predicate key + multi — the #11009 predicate-path
    // spelling, exactly the shape `redeliver` writes.
    await engine.update(object, { attempts: 98 }, { where: { id: existingId, attempts: { $gte: 0 } }, multi: true } as any);
    expect(
        auditedUpdateMany(object),
        `positive control failed: an unscoped predicate update on ${object} produced no `
            + '[tenant-audit] updateMany line, so the silence assertions on that op are vacuous',
    ).toBe(true);
}

function okFetch(): { impl: FetchImpl; calls: string[] } {
    const calls: string[] = [];
    const impl: FetchImpl = async (url) => {
        calls.push(url);
        return { ok: true, status: 204, async text() { return ''; } };
    };
    return { impl, calls };
}

async function seedHttpRow(id: string, org: string, over: Record<string, unknown> = {}): Promise<void> {
    const now = new Date();
    await engine.insert(SYS_HTTP_DELIVERY, {
        id,
        source: 'webhook',
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

/** A terminal, genuinely-attempted row — the only kind `redeliver` accepts. */
async function seedDeadRow(id: string, org: string): Promise<void> {
    await seedHttpRow(id, org, { status: 'dead', attempts: 3, error: 'receiver down' });
}

// ───────────────────────────────────────────────────────────────────────────
describe('ack — the two dispatcher sites are a classified global sweep (update + updateMany ops)', () => {
    it('SqlHttpOutbox.ack records a REAL delivery in every organization, without a finding', async () => {
        // The gate's own precondition: this object really is tenant-scoped.
        expect((driver as any).resolveTenantField(SYS_HTTP_DELIVERY)).toBe('organization_id');

        await seedHttpRow('h_a', 'org_a');
        await seedHttpRow('h_b', 'org_b');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const { impl, calls } = okFetch();
        // A real tick: claim → POST → ack. Nothing is hand-called.
        await new HttpDispatcher({
            nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1, intervalMs: 10_000,
        }).tick();

        // ① The delivery ACTUALLY ran — otherwise the silence below is
        // NOT MEASURED rather than clean.
        expect(calls).toHaveLength(2);
        const rows = (await engine.find(SYS_HTTP_DELIVERY, { where: {} })) as any[];
        expect(rows.map((r) => `${r.id}:${r.organization_id}:${r.status}:${r.attempts}`).sort()).toEqual([
            'h_a:org_a:success:1',
            'h_b:org_b:success:1',
        ]);
        // ② Both organizations' rows were acked by one dispatcher — the
        // cross-organization reach is the operation's semantics.
        const ackWrites = driverUpdates.filter((u) => u.object === SYS_HTTP_DELIVERY);
        expect(ackWrites.map((u) => u.id).sort()).toEqual(['h_a', 'h_b']);
        // ③ …under the DECLARED classification, not an accidental silence.
        expect(ackWrites.every((u) => u.options?.bypassTenantAudit === true)).toBe(true);
        expect(ackWrites.every((u) => u.options?.tenantId === undefined)).toBe(true);
        expect(auditedUpdate(SYS_HTTP_DELIVERY)).toBe(false);

        await controlUnscopedUpdate(SYS_HTTP_DELIVERY, 'h_a');
    });

    it('SqlNotificationOutbox.ack records a REAL delivery in every organization, without a finding', async () => {
        expect((driver as any).resolveTenantField(DELIVERY_OBJECT)).toBe('organization_id');

        const outbox = new SqlNotificationOutbox(engine as any, { partitionCount: 1 });
        const idA = await outbox.enqueue({
            notificationId: 'n_a', recipientId: 'u_a', channel: 'inbox', organizationId: 'org_a', payload: {},
        } as any);
        await outbox.enqueue({
            notificationId: 'n_b', recipientId: 'u_b', channel: 'inbox', organizationId: 'org_b', payload: {},
        } as any);

        let sent = 0;
        const channel: MessagingChannel = {
            id: 'inbox',
            async send() { sent += 1; return { ok: true }; },
        };
        await new NotificationDispatcher({
            nodeId: 'n1',
            outbox,
            channels: { getChannel: (id: string) => (id === 'inbox' ? channel : undefined) } as any,
            channelContext: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
            partitionCount: 1,
            intervalMs: 10_000,
        }).tick();

        // ① Both deliveries really were sent and really were acked.
        expect(sent).toBe(2);
        const rows = (await engine.find(DELIVERY_OBJECT, { where: {} })) as any[];
        expect(rows.map((r) => `${r.organization_id}:${r.status}:${r.attempts}`).sort()).toEqual([
            'org_a:success:1',
            'org_b:success:1',
        ]);
        // ② Declared global, for both organizations' rows.
        //
        // [#11453] The ack's op is `updateMany` now, so the reading moves to
        // that spy. The claim path writes there too (its reap and its atomic
        // claim), so the filter names what an ACK write looks like — and that
        // predicate is not incidental: `{ id: <scalar>, status: 'in_flight' }`
        // IS the compare-and-set, so matching on it pins that the ack reached
        // the driver CONDITIONAL rather than as a blind by-id write.
        const ackWrites = driverUpdateManys.filter(
            (u) => u.object === DELIVERY_OBJECT
                && typeof (u.where as any)?.id === 'string'
                && (u.where as any)?.status === 'in_flight',
        );
        expect(ackWrites).toHaveLength(2);
        expect(ackWrites.every((u) => u.options?.bypassTenantAudit === true)).toBe(true);
        expect(auditedUpdateMany(DELIVERY_OBJECT)).toBe(false);

        await controlUnscopedUpdateMany(DELIVERY_OBJECT, idA);
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('redeliver — the request-reachable site is SCOPED, never bypassed', () => {
    /**
     * The assertion this card exists for. A bypassed `redeliver` and a scoped
     * `redeliver` are indistinguishable from the log, so the distinction is
     * drawn where it is real: in the options the driver received.
     */
    it('threads the caller\'s tenant to the driver and carries NO bypass', async () => {
        expect((driver as any).resolveTenantField(SYS_HTTP_DELIVERY)).toBe('organization_id');
        await seedDeadRow('h_a', 'org_a');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const replayed = await outbox.redeliver('h_a', { tenantId: 'org_a' });
        expect(replayed.status).toBe('pending');

        // [#11009] The reset rides the predicate path now, so the truthful
        // record of its scoping is the options `SqlDriver.updateMany`
        // received — and the write must carry its full compare-and-set
        // predicate, id AND terminal status.
        const writes = driverUpdateManys.filter((u) => u.object === SYS_HTTP_DELIVERY);
        expect(writes).toHaveLength(1);
        expect(writes[0].where).toMatchObject({ id: 'h_a', status: { $in: ['success', 'failed', 'dead'] } });
        // ⛔ The forbidden implementation, named: a bypass here would silence
        // the audit for an authenticated user's unscoped write.
        expect(writes[0].options?.bypassTenantAudit).toBeUndefined();
        // …and the remedy that replaces it, present.
        expect(writes[0].options?.tenantId).toBe('org_a');
        // The line is absent BECAUSE the write is scoped — the two assertions
        // above are what make this one mean something.
        expect(auditedUpdateMany(SYS_HTTP_DELIVERY)).toBe(false);

        await controlUnscopedUpdateMany(SYS_HTTP_DELIVERY, 'h_a');
    });

    it('refuses a cross-tenant redeliver — the row is not found, not merely forbidden', async () => {
        await seedDeadRow('h_b', 'org_b');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        // ADR-0112: assert the CODE, not merely that something threw. The HTTP
        // status this code maps to (404) is pinned at the route, in
        // plugin-webhooks' `webhook-redeliver-tenant-scope.test.ts`.
        await expect(outbox.redeliver('h_b', { tenantId: 'org_a' })).rejects.toMatchObject({
            name: 'HttpRedeliverError',
            code: 'RESOURCE_NOT_FOUND',
        });

        // The refusal ran before any write — the row is untouched, not reset.
        const [row] = (await engine.find(SYS_HTTP_DELIVERY, { where: {} })) as any[];
        expect(`${row.status}:${row.attempts}`).toBe('dead:3');
        expect(driverUpdates.filter((u) => u.object === SYS_HTTP_DELIVERY)).toHaveLength(0);
        expect(driverUpdateManys.filter((u) => u.object === SYS_HTTP_DELIVERY)).toHaveLength(0);
    });

    it('still works: an in-tenant redeliver succeeds while a foreign one does not', async () => {
        // The still-works leg. An implementation that refused EVERY redeliver
        // would score green on the refusal test alone.
        await seedDeadRow('h_a', 'org_a');
        await seedDeadRow('h_b', 'org_b');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const replayed = await outbox.redeliver('h_a', { tenantId: 'org_a' });
        expect(`${replayed.id}:${replayed.status}:${replayed.attempts}`).toBe('h_a:pending:0');
        await expect(outbox.redeliver('h_b', { tenantId: 'org_a' })).rejects.toMatchObject({
            code: 'RESOURCE_NOT_FOUND',
        });

        // One row moved, the other did not — the predicate discriminates.
        const rows = (await engine.find(SYS_HTTP_DELIVERY, { where: {} })) as any[];
        expect(rows.map((r) => `${r.id}:${r.status}`).sort()).toEqual(['h_a:pending', 'h_b:dead']);
    });

    it('a tenant-less caller is NOT silenced — the audit still reports the gap', async () => {
        // The honest half of `tenantId: string | undefined`. Passing
        // `undefined` leaves the write unscoped, and the finding is REPORTED
        // rather than suppressed. If this ever goes green-by-silence, someone
        // has reached for `bypassTenantAudit` on this path.
        await seedDeadRow('h_a', 'org_a');

        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        await outbox.redeliver('h_a', { tenantId: undefined });

        // [#11009] `redeliver`'s op is `updateMany` now; the audit line moves
        // with it. The dispatcher sweeps on this object carry
        // `bypassTenantAudit` and return before the throttle, so they cannot
        // have consumed this op's one warning.
        const writes = driverUpdateManys.filter((u) => u.object === SYS_HTTP_DELIVERY);
        expect(writes).toHaveLength(1);
        expect(writes[0].options?.bypassTenantAudit).toBeUndefined();
        expect(auditedUpdateMany(SYS_HTTP_DELIVERY)).toBe(true);
    });
});
