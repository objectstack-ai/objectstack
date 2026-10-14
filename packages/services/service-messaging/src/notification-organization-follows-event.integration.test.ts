// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23284] A notification no producer could attribute takes the owner the
 * engine derives for a system write (ADR-0131 D9), and every row below it
 * follows that event row.
 *
 * ## What was measured
 *
 * On HotCRM at 18.0.0-next.0 (one `single`-posture install with its Default
 * Organization) every notification emitted from a system-context run — a
 * schedule tick, a record change a system context wrote, an approval node —
 * stored `sys_notification.organization_id` NULL. The producer passed no
 * organization, and the engine's system-write rule never ran for the table: it
 * was `unclassified` in the #13491 ledger, so it sat outside the rule that
 * derived its own DELIVERY row's organization one write later. On an install
 * holding two organizations the same emit stored the NULL event row and had
 * every delivery refused, with the notify step reporting success.
 *
 * ## What this pins, on a real `ObjectQL` over `SqlDriver` (better-sqlite3)
 *
 *  - `single`, one organization: an emit that carries no organization stores
 *    the sole organization on the event row AND on the inbox row, the receipt
 *    (inline fan-out) and the delivery row (outbox) — the children follow the
 *    stored event row, so the family cannot split;
 *  - `single`, two organizations: the same emit is REFUSED with the engine's
 *    own envelope and nothing is written, the event row included;
 *  - an emit that carries its organization is stored with exactly that one.
 *
 * The producer half — WHICH organization a notify node, or the approvals
 * service, threads — is pinned at each producer
 * (`notify-organization-stamp.integration.test.ts`,
 * `approval-notification-body.integration.test.ts`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysNotification } from '@objectstack/platform-objects';
import { MessagingService, NOTIFICATION_EVENT_OBJECT } from './messaging-service.js';
import { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { InboxMessage, NotificationDelivery, NotificationPreference, NotificationReceipt } from './objects/index.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', fields: { name: { type: 'text', label: 'Name' } } };

const silentLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
silentLogger.child = () => silentLogger;

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

/** A real engine on the `single` posture holding `organizations`, and one recipient. */
async function boot(organizations: readonly string[]): Promise<ObjectQL> {
    const ql = new ObjectQL();
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysNotification, InboxMessage, NotificationReceipt, NotificationDelivery, NotificationPreference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    for (const id of organizations) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
    await ql.insert('sys_user', { id: 'user_1', name: 'Recipient' }, SYSTEM);
    engine = ql;
    return ql;
}

async function organizationsOf(ql: ObjectQL, object: string): Promise<string[]> {
    const rows = (await ql.find(object, { fields: ['id', 'organization_id'] }, SYSTEM)) ?? [];
    return rows.map((r: Record<string, unknown>) => String(r.organization_id ?? 'NULL'));
}

const EMIT = { topic: 'sweep.breach', audience: ['user_1'], payload: { title: 'Breach', body: 'An SLA was breached.' } };

describe('#23284 — a notification no producer attributed takes the owner ADR-0131 D9 derives', () => {
    it('single, one organization: the event row and every row below it carry the sole organization (inline)', async () => {
        const ql = await boot(['org_sole']);
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        const result = await messaging.emit({ ...EMIT, channels: ['inbox'] });

        expect(result.delivered).toBe(1);
        expect(await organizationsOf(ql, NOTIFICATION_EVENT_OBJECT)).toEqual(['org_sole']);
        expect(await organizationsOf(ql, INBOX_OBJECT)).toEqual(['org_sole']);
        expect(await organizationsOf(ql, RECEIPT_OBJECT)).toEqual(['org_sole']);
    });

    it('single, one organization: the delivery row carries the event row\'s organization (outbox)', async () => {
        const ql = await boot(['org_sole']);
        const outbox = new SqlNotificationOutbox(ql as any, { partitionCount: 1 });
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any, outbox });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        const result = await messaging.emit({ ...EMIT, channels: ['inbox'] });

        expect(result.enqueued).toBe(1);
        expect(await organizationsOf(ql, NOTIFICATION_EVENT_OBJECT)).toEqual(['org_sole']);
        expect(await organizationsOf(ql, DELIVERY_OBJECT)).toEqual(['org_sole']);
    });

    it('single, two organizations: the emit is REFUSED with the engine envelope, and nothing is written', async () => {
        const ql = await boot(['org_a', 'org_b']);
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        await expect(messaging.emit({ ...EMIT, channels: ['inbox'] })).rejects.toMatchObject({
            code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
            status: 500,
        });
        // Before #23284 this stored the event row with organization_id NULL.
        expect(await organizationsOf(ql, NOTIFICATION_EVENT_OBJECT)).toEqual([]);
        expect(await organizationsOf(ql, INBOX_OBJECT)).toEqual([]);
    });

    it('an emit that carries its organization is stored with exactly that one, on every row', async () => {
        const ql = await boot(['org_a', 'org_b']);
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        await messaging.emit({ ...EMIT, channels: ['inbox'], organizationId: 'org_b' });

        expect(await organizationsOf(ql, NOTIFICATION_EVENT_OBJECT)).toEqual(['org_b']);
        expect(await organizationsOf(ql, INBOX_OBJECT)).toEqual(['org_b']);
        expect(await organizationsOf(ql, RECEIPT_OBJECT)).toEqual(['org_b']);
    });
});
