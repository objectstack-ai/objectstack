// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32512] A deleted organization's inbox messages are kept, never served.
 *
 * `sys_inbox_message` (and its receipt and event siblings) is engine-owned, so
 * an organization delete keeps its rows (`ObjectQL.outlivesOrganization`) and
 * they live out their 90-day TTL. The inbox readers — the list, its
 * `unreadCount`, `markRead` and `markAllRead` — serve no row whose
 * organization no longer exists. Retention is untouched: every row is still
 * stored afterwards.
 *
 * On a real `ObjectQL` over `SqlDriver` (better-sqlite3), the organization
 * removed by the engine's own `sys_organization` delete, the path the
 * organization delete door ends in.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysNotification } from '@objectstack/platform-objects';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
import { InboxMessage, NotificationDelivery, NotificationPreference, NotificationReceipt } from './objects/index.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };

// Declared as the platform declares them: better-auth owns both tables, so the
// registration injects no organization column.
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

function recordingLogger() {
    const warnings: string[] = [];
    const l: any = { info: () => {}, warn: (m: unknown) => warnings.push(String(m)), error: () => {}, debug: () => {} };
    l.child = () => l;
    return { logger: l, warnings };
}

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

/**
 * A `single`-posture engine holding `org_live` and `org_gone`, and user_1's
 * inbox, oldest first: three messages from `org_live`, then three from
 * `org_gone` (the newest, so a short window opens on them). `org_gone` is then
 * deleted. Answers the event id of each message by title. (An
 * organization-less row cannot be stored here, the column being NOT NULL on
 * this store; `messaging-service.test.ts` pins that it is served.)
 */
async function bootInbox(): Promise<{ ql: ObjectQL; messaging: MessagingService; warnings: string[]; ids: Record<string, string> }> {
    const ql = new ObjectQL();
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysNotification, InboxMessage, NotificationReceipt, NotificationDelivery, NotificationPreference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    for (const id of ['org_live', 'org_gone']) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
    await ql.insert('sys_user', { id: 'user_1', name: 'Recipient' }, SYSTEM);
    engine = ql;

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

describe('[#32512] the inbox readers serve no row of a deleted organization', () => {
    it('lists and counts only the live organization\'s and the organization-less rows, and keeps every row stored', async () => {
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

    it('markAllRead flips and counts only the rows the user can see', async () => {
        const { ql, messaging, ids } = await bootInbox();

        const swept = await messaging.markAllRead('user_1');

        expect(swept).toEqual({ success: true, readCount: 3 });
        for (const title of ['live-1', 'live-2', 'live-3']) expect(await receiptState(ql, ids[title]!)).toBe('read');
        for (const title of ['gone-1', 'gone-2', 'gone-3']) expect(await receiptState(ql, ids[title]!)).toBe('delivered');
        expect((await messaging.listInbox('user_1')).unreadCount).toBe(0);
    });

    it('markRead of a deleted organization\'s message marks and counts nothing; a live one is marked', async () => {
        const { ql, messaging, ids } = await bootInbox();

        expect(await messaging.markRead('user_1', [ids['gone-1']!])).toEqual({ success: true, readCount: 0 });
        expect(await receiptState(ql, ids['gone-1']!)).toBe('delivered');

        expect(await messaging.markRead('user_1', [ids['live-1']!])).toEqual({ success: true, readCount: 1 });
        expect(await receiptState(ql, ids['live-1']!)).toBe('read');
    });

    it('markRead of a deleted organization\'s message whose delivered receipt never landed inserts no receipt', async () => {
        const { ql, messaging, ids } = await bootInbox();
        await ql.delete(RECEIPT_OBJECT, { where: { notification_id: ids['gone-2']! }, multi: true, ...SYSTEM } as any);

        expect(await messaging.markRead('user_1', [ids['gone-2']!])).toEqual({ success: true, readCount: 0 });
        expect(await receiptState(ql, ids['gone-2']!)).toBeUndefined();
    });
});
