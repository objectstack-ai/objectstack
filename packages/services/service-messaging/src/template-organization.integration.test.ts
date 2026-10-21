// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A notification template is resolved in the recipient's organization.
 *
 * `sys_notification_template` is organization-owned (ADR-0131: organization
 * ownership is total — the table carries `organization_id` and the
 * platform-object tenancy census lists it), so the row a delivery renders is
 * one the delivery's own organization authored. `NotificationTemplateStore`
 * keys its read by the delivery's organization, the spelling
 * `PreferenceResolver` scopes its rows by; a call that names no organization
 * reads no row.
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3) holding two
 * organizations, under each walled posture, through the real email and SMS
 * channels:
 *
 *  - each organization's delivery renders its own organization's row;
 *  - an organization that authored no row renders the producer's own title
 *    and body (the renderer's documented no-template fallback);
 *  - a delivery that names no organization renders that same fallback.
 *
 * And the preservation half, under `single`: the sole organization's row
 * still renders for its own deliveries.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SqlDriver } from '@objectstack/driver-sql';
import { NotificationTemplate } from './objects/index.js';
import { NotificationTemplateStore, TEMPLATE_OBJECT } from './template-renderer.js';
import { createEmailChannel } from './email-channel.js';
import { createSmsChannel } from './sms-channel.js';
import type { Delivery, MessagingChannel } from './channel.js';

// Declared as the platform declares them: better-auth owns both tables, so the
// registration injects no organization column.
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = {
    name: 'sys_user',
    label: 'User',
    managedBy: 'better-auth',
    fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        phone_number: { type: 'text', label: 'Phone' },
        locale: { type: 'text', label: 'Locale' },
    },
};

const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const TOPIC = 'deal.won';
const silentLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
silentLogger.child = () => silentLogger;
const channelCtx = { logger: silentLogger };

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

type Posture = 'isolated' | 'group' | 'single';

/** A real engine on `posture` holding `organizations`, and one recipient per organization. */
async function boot(posture: Posture, organizations: readonly string[]): Promise<ObjectQL> {
    const ql = new ObjectQL();
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, NotificationTemplate]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => posture);
    for (const [i, id] of organizations.entries()) {
        await ql.insert('sys_organization', { id, name: id }, SYSTEM);
        await ql.insert('sys_user', { id: `user_${id}`, name: id, email: `${id}@example.test`, phone_number: `+1555000000${i}`, locale: 'en' }, SYSTEM);
    }
    engine = ql;
    return ql;
}

/** The row `organization` authors in Setup for (TOPIC, channel, 'en'), written as that organization's write lands. */
async function author(ql: ObjectQL, organization: string, channel: 'email' | 'sms', text: string): Promise<void> {
    await ql.insert(
        TEMPLATE_OBJECT,
        { topic: TOPIC, channel, locale: 'en', subject: `${text} subject`, body: `${text} body`, format: 'text', is_active: true },
        { context: { isSystem: true, tenantId: organization } as ExecutionContext },
    );
}

/** What each row is stored with — the fixture's own control, so no pin passes on a mis-stamped row. */
async function storedOrganizations(ql: ObjectQL): Promise<string[]> {
    const rows = (await ql.find(TEMPLATE_OBJECT, { fields: ['channel', 'organization_id'] }, SYSTEM)) ?? [];
    return rows.map((r: Record<string, unknown>) => `${String(r.channel)}:${String(r.organization_id ?? 'NULL')}`).sort();
}

/** The real email + SMS channels over `ql`, with transports that record what they were handed. */
function channels(ql: ObjectQL) {
    const sent: Array<{ channel: string; subject?: string; text: string }> = [];
    const store = new NotificationTemplateStore({ getData: () => ql as any });
    const email = createEmailChannel({
        getEmail: () => ({ async send(i: any) { sent.push({ channel: 'email', subject: i.subject, text: i.text ?? i.html }); return { id: 'e' }; } }) as any,
        getData: () => ql as any,
        store,
    });
    const sms = createSmsChannel({
        getSms: () => ({ async send(i: any) { sent.push({ channel: 'sms', text: i.body }); return { messageId: 's' }; } }) as any,
        getData: () => ql as any,
        store,
    });
    return { sent, email, sms };
}

function delivery(channel: 'email' | 'sms', organizationId: string | undefined, recipient: string): Delivery {
    return {
        channel,
        recipient,
        notification: {
            notificationId: 'evt_1',
            ...(organizationId !== undefined ? { organizationId } : {}),
            topic: TOPIC,
            title: 'Producer title',
            body: 'Producer body',
            recipients: [recipient],
            payload: { title: 'Producer title', body: 'Producer body' },
        },
    };
}

async function send(ch: MessagingChannel, d: Delivery): Promise<void> {
    const result = await ch.send(channelCtx as any, d);
    expect(result.ok, `${d.channel} delivery reported failure: ${result.error}`).toBe(true);
}

describe.each(['isolated', 'group'] as const)("%s, two organizations: a template is resolved in the recipient's organization", (posture) => {
    it("each organization's delivery renders its own organization's row, on email and on SMS", async () => {
        const ql = await boot(posture, ['org_a', 'org_b']);
        for (const org of ['org_a', 'org_b']) {
            await author(ql, org, 'email', org);
            await author(ql, org, 'sms', org);
        }
        expect(await storedOrganizations(ql)).toEqual(['email:org_a', 'email:org_b', 'sms:org_a', 'sms:org_b']);

        const { sent, email, sms } = channels(ql);
        for (const org of ['org_a', 'org_b']) {
            await send(email, delivery('email', org, `${org}@example.test`));
            await send(sms, delivery('sms', org, `user_${org}`));
        }

        expect(sent).toEqual([
            { channel: 'email', subject: 'org_a subject', text: 'org_a body' },
            { channel: 'sms', text: 'org_a body' },
            { channel: 'email', subject: 'org_b subject', text: 'org_b body' },
            { channel: 'sms', text: 'org_b body' },
        ]);
    });

    it("an organization that authored no row renders the producer's own title and body", async () => {
        const ql = await boot(posture, ['org_a', 'org_b']);
        await author(ql, 'org_a', 'email', 'org_a');
        await author(ql, 'org_a', 'sms', 'org_a');
        expect(await storedOrganizations(ql)).toEqual(['email:org_a', 'sms:org_a']);

        const { sent, email, sms } = channels(ql);
        await send(email, delivery('email', 'org_b', 'org_b@example.test'));
        await send(sms, delivery('sms', 'org_b', 'user_org_b'));

        expect(sent).toEqual([
            { channel: 'email', subject: 'Producer title', text: 'Producer body' },
            { channel: 'sms', text: 'Producer body' },
        ]);
    });

    it("a delivery that names no organization renders the producer's own title and body", async () => {
        const ql = await boot(posture, ['org_a', 'org_b']);
        await author(ql, 'org_a', 'email', 'org_a');
        await author(ql, 'org_a', 'sms', 'org_a');
        expect(await storedOrganizations(ql)).toEqual(['email:org_a', 'sms:org_a']);

        const { sent, email, sms } = channels(ql);
        await send(email, delivery('email', undefined, 'org_b@example.test'));
        await send(sms, delivery('sms', undefined, 'user_org_b'));

        expect(sent).toEqual([
            { channel: 'email', subject: 'Producer title', text: 'Producer body' },
            { channel: 'sms', text: 'Producer body' },
        ]);
    });
});

describe("single, one organization: the organization's own row still renders", () => {
    it("a delivery of the sole organization renders that organization's row, on email and on SMS", async () => {
        const ql = await boot('single', ['org_sole']);
        await author(ql, 'org_sole', 'email', 'org_sole');
        await author(ql, 'org_sole', 'sms', 'org_sole');
        expect(await storedOrganizations(ql)).toEqual(['email:org_sole', 'sms:org_sole']);

        const { sent, email, sms } = channels(ql);
        await send(email, delivery('email', 'org_sole', 'org_sole@example.test'));
        await send(sms, delivery('sms', 'org_sole', 'user_org_sole'));

        expect(sent).toEqual([
            { channel: 'email', subject: 'org_sole subject', text: 'org_sole body' },
            { channel: 'sms', text: 'org_sole body' },
        ]);
    });
});
