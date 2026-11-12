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
import { SysMember, SysNotification } from '@objectstack/platform-objects';
import { RecipientResolver } from './recipient-resolver.js';
import { MessagingService, NOTIFICATION_EVENT_OBJECT } from './messaging-service.js';
import { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { InboxMessage, NotificationDelivery, NotificationPreference, NotificationReceipt } from './objects/index.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };

// [C8 stage 8b] Declared as the platform declares them: better-auth owns both tables,
// so the registration injects no organization column. A bare schema would gain one,
// and under `single` the first organization's own insert would then be refused.
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

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

describe('[#32445] org:members — an emit reaches the inbox of every member of its organization, and only those', () => {
    // A user record the member object's title formula can read (`name`, `email`).
    const SYS_USER_WITH_EMAIL = { ...SYS_USER, fields: { ...SYS_USER.fields, email: { type: 'text', label: 'Email' } } };
    const ORG_A = ['u_owner', 'u_member', 'u_no_role', 'u_custom', 'u_admin'];

    async function bootMembers(): Promise<ObjectQL> {
        const ql = new ObjectQL();
        ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
        await ql.init();
        for (const def of [SYS_ORGANIZATION, SYS_USER_WITH_EMAIL, SysMember, SysNotification, InboxMessage, NotificationReceipt, NotificationDelivery, NotificationPreference]) {
            ql.registry.registerObject(def as any, '@objectstack/service-messaging');
        }
        await ql.syncSchemas();
        ql.setTenancyPostureProvider(() => 'single');
        for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
        for (const id of [...ORG_A, 'u_elsewhere']) await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYSTEM);
        const member = (id: string, user: string, organization: string, role: string | null) =>
            ql.insert('sys_member', { id, user_id: user, organization_id: organization, role }, SYSTEM);
        await member('m1', 'u_owner', 'org_a', 'owner');
        await member('m2', 'u_member', 'org_a', 'member');
        await member('m3', 'u_no_role', 'org_a', null);
        await member('m5', 'u_admin', 'org_a', 'admin');
        await member('m6', 'u_elsewhere', 'org_b', 'member');
        // A role outside the built-in four is refused on write today, so a row
        // holding one is data at rest from an earlier release: seeded through
        // the driver, never through the engine's write.
        await ql.getDriverForObject('sys_member')!.create('sys_member', {
            id: 'm4', user_id: 'u_custom', organization_id: 'org_a', role: 'sales_rep',
        });
        engine = ql;
        return ql;
    }

    it('pages past one page (two members a page), delivers to all five members of org_a, and to no one in org_b', async () => {
        const ql = await bootMembers();
        const resolver = new RecipientResolver({ getData: () => ql as any, logger: silentLogger, membershipPageSize: 2 });
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any, recipientResolver: resolver });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        const result = await messaging.emit({
            topic: 'org.announcement',
            audience: 'org:members',
            organizationId: 'org_a',
            channels: ['inbox'],
            payload: { title: 'Maintenance window', body: 'Saturday 02:00-04:00.' },
        });

        expect(result.delivered).toBe(ORG_A.length);
        const inbox = (await ql.find(INBOX_OBJECT, { fields: ['user_id', 'organization_id'] }, SYSTEM)) ?? [];
        expect(inbox.map((r: Record<string, unknown>) => r.user_id).sort()).toEqual([...ORG_A].sort());
        expect(new Set(inbox.map((r: Record<string, unknown>) => r.organization_id))).toEqual(new Set(['org_a']));
    });

    it('an emit that names no organization reaches nobody through org:members — never every organization', async () => {
        const ql = await bootMembers();
        const messaging = new MessagingService({ logger: silentLogger, getData: () => ql as any });
        messaging.registerChannel(createInboxChannel({ getData: () => ql as any }));

        // Two organizations under `single`: the event write itself is refused
        // before any audience is read (ADR-0131 D9), so nothing is delivered.
        await expect(messaging.emit({ topic: 'org.announcement', audience: 'org:members', channels: ['inbox'], payload: { title: 't', body: 'b' } }))
            .rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED' });
        expect((await ql.find(INBOX_OBJECT, { fields: ['user_id'] }, SYSTEM)) ?? []).toEqual([]);
    });
});

function recordingLogger() {
    const warnings: string[] = [];
    const l: any = { info: () => {}, warn: (m: unknown) => warnings.push(String(m)), error: () => {}, debug: () => {} };
    l.child = () => l;
    return { logger: l, warnings };
}

/**
 * A `single`-posture engine holding `org_live` and `org_gone`, and user_1's
 * inbox, oldest first: three messages from `org_live`, then three from
 * `org_gone` (the newest, so a short window opens on them). `org_gone` is then
 * deleted. Answers the event id of each message by title. (An
 * organization-less row cannot be stored here, the column being NOT NULL on
 * this store; `messaging-service.test.ts` pins that it is served.)
 */
async function bootInbox(): Promise<{ ql: ObjectQL; messaging: MessagingService; warnings: string[]; ids: Record<string, string> }> {
    const ql = await boot(['org_live', 'org_gone']);

    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 1, 0, 0, tick++)).toISOString();
    const { logger, warnings } = recordingLogger();
    const messaging = new MessagingService({ logger, getData: () => ql as any, now });
    messaging.registerChannel(createInboxChannel({ getData: () => ql as any, now }));

    const ids: Record<string, string> = {};
    const emit = async (title: string, organizationId: string) => {
        const r = await messaging.emit({ topic: 't', audience: ['user_1'], channels: ['inbox'], organizationId, payload: { title, body: title } });
        ids[title] = String(r.notificationId);
    };
    await emit('live-1', 'org_live');
    await emit('live-2', 'org_live');
    await emit('live-3', 'org_live');
    await emit('gone-1', 'org_gone');
    await emit('gone-2', 'org_gone');
    await emit('gone-3', 'org_gone');

    // The engine's own organization delete: the kept engine-owned rows do not refuse it.
    await ql.delete('sys_organization', { where: { id: 'org_gone' }, ...SYSTEM } as any);
    expect(await ql.find('sys_organization', { fields: ['id'] }, SYSTEM)).toEqual([{ id: 'org_live' }]);
    return { ql, messaging, warnings, ids };
}

async function receiptState(ql: ObjectQL, notificationId: string): Promise<string | undefined> {
    const rows = await ql.find(RECEIPT_OBJECT, { where: { notification_id: notificationId, user_id: 'user_1' }, fields: ['state'] }, SYSTEM);
    return (rows[0] as Record<string, unknown> | undefined)?.state as string | undefined;
}

/**
 * [#32512] A deleted organization's inbox messages are kept, never served.
 *
 * `sys_inbox_message` (and its receipt and event siblings) is engine-owned, so
 * an organization delete keeps its rows (`ObjectQL.outlivesOrganization`) and
 * they live out their 90-day TTL. The inbox list and its `unreadCount` serve
 * no row whose organization no longer exists; mark-read still clears one, since
 * the Console bell lists the inbox through the data API. Retention is
 * untouched: every row is still stored afterwards. The organization is
 * removed by the engine's own `sys_organization` delete, the path the
 * organization delete door ends in.
 */
describe('[#32512] the inbox list and its unread count serve no row of a deleted organization', () => {
    it('lists and counts only the live organization\'s rows, and keeps every row stored', async () => {
        const { ql, messaging, warnings } = await bootInbox();

        const listed = await messaging.listInbox('user_1');

        expect(listed.notifications.map((n) => n.title)).toEqual(['live-3', 'live-2', 'live-1']);
        expect(listed.unreadCount).toBe(3);
        // Retention untouched: the deleted organization's rows are all still stored.
        const stored = await ql.find(INBOX_OBJECT, { where: { user_id: 'user_1' }, fields: ['organization_id'] }, SYSTEM);
        expect(stored.map((r: any) => String(r.organization_id)).sort()).toEqual(
            ['org_gone', 'org_gone', 'org_gone', 'org_live', 'org_live', 'org_live'],
        );
        expect(warnings).toEqual([]);
    });

    it('a window that opens on the deleted organization\'s rows is still a full window, and the badge is the live total', async () => {
        const { messaging } = await bootInbox();

        // The three newest rows are org_gone's: a window of 2 filtered after the
        // read would come back empty with an unread total of 0.
        const listed = await messaging.listInbox('user_1', { limit: 2 });

        expect(listed.notifications.map((n) => n.title)).toEqual(['live-3', 'live-2']);
        expect(listed.unreadCount).toBe(3);
    });

    it('mark-read is not narrowed: the deleted organization\'s rows can still be cleared by a client that lists them elsewhere', async () => {
        const { ql, messaging, ids } = await bootInbox();

        expect(await messaging.markRead('user_1', [ids['gone-1']!])).toEqual({ success: true, readCount: 1 });
        expect(await receiptState(ql, ids['gone-1']!)).toBe('read');
        expect(await messaging.markAllRead('user_1')).toEqual({ success: true, readCount: 5 });
        for (const title of ['live-1', 'live-2', 'live-3', 'gone-1', 'gone-2', 'gone-3']) expect(await receiptState(ql, ids[title]!)).toBe('read');
    });
});
