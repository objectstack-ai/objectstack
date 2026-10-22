// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25194] A notification delivery's record title names the PERSON it is for,
 * and the address itself where the recipient is not a user.
 *
 * `recipient_id` stays a text column: a recipient is a `sys_user` id, or an
 * address kept verbatim — an email no user holds (`RecipientResolver`), a
 * phone number the SMS channel texts directly — and the outbox writes past the
 * engine's reference check, so a lookup there would store each address as a
 * dangling reference. The person rides in `recipient_user_id`, a `sys_user`
 * reference the enqueue stamps from one `sys_user` read per emit; the title
 * reads it one hop, the shape `sys_notification_preference` takes (PR #25178).
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3) with the real
 * `sys_user`, through `MessagingService.emit` and `SqlNotificationOutbox`:
 *
 *  1. the declaration: `recipient_id` text, `recipient_user_id` an optional
 *     `sys_user` reference that nulls when the user goes;
 *  2. the enqueue stamps `recipient_user_id` for a recipient a user holds, and
 *     only for one: an unmatched email, a phone number and an id nobody holds
 *     stay empty;
 *  3. the title: the name; the email where the name is blank; the address for
 *     an address recipient; the raw recipient once the user is deleted;
 *  4. a failed `sys_user` read stamps nothing and fails no emit — the rows
 *     land titled by the raw recipient, and the failure is said once;
 *  5. the title still never has a NULL part, and adds no stored column.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysNotification, SysUser } from '@objectstack/platform-objects';
import { MessagingService } from './messaging-service.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import type { MessagingChannel } from './channel.js';
import { NotificationDelivery, NotificationPreference } from './objects/index.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID } } as any;

const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot(): Promise<{ ql: ObjectQL; driver: SqlDriver }> {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(driver, true);
    await ql.init();
    for (const def of [SysUser, SysNotification, NotificationDelivery, NotificationPreference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    await installDefaultOrganization(ql as any);
    engine = ql;
    return { ql, driver };
}

async function user(ql: ObjectQL, name: string, email: string): Promise<string> {
    return String((await ql.insert('sys_user', { name, email }, SYS)).id);
}

/** A mounted channel that is never reached: the outbox path only enqueues. */
function channel(id: string): MessagingChannel {
    return { id, send: async () => { throw new Error(`${id}: the enqueue path never sends`); } } as MessagingChannel;
}

function messaging(data: unknown, logger: any = silent): MessagingService {
    const outbox = new SqlNotificationOutbox(data as any, { partitionCount: 1 });
    const service = new MessagingService({ logger, getData: () => data as any, outbox });
    service.registerChannel(channel('email'));
    service.registerChannel(channel('sms'));
    return service;
}

interface Delivery { recipient_id: string; recipient_user_id: string | null; channel: string; display_title: string | null }

async function deliveries(ql: ObjectQL): Promise<Delivery[]> {
    const rows = (await ql.find(DELIVERY_OBJECT, { fields: ['recipient_id', 'recipient_user_id', 'channel', 'display_title'] }, SYS)) ?? [];
    return rows
        .map((r: any) => ({
            recipient_id: r.recipient_id,
            recipient_user_id: r.recipient_user_id ?? null,
            channel: r.channel,
            display_title: r.display_title ?? null,
        }))
        .sort((a: Delivery, b: Delivery) => `${a.channel}|${a.recipient_id}`.localeCompare(`${b.channel}|${b.recipient_id}`));
}

describe('the declaration', () => {
    it('recipient_id stays text; recipient_user_id is an optional sys_user reference that nulls when the user goes', () => {
        const fields = (NotificationDelivery as any).fields;
        expect(fields.recipient_id.type).toBe('text');
        expect(fields.recipient_id.required).toBe(true);
        const ref = fields.recipient_user_id;
        expect(ref.type).toBe('lookup');
        expect(ref.reference).toBe('sys_user');
        expect(ref.required).toBe(false);
        // The lookup default: the delivery is history and outlives the user.
        expect(ref.deleteBehavior ?? 'set_null').toBe('set_null');
        expect(ref.maxLength).toBeUndefined();
    });
});

describe('the enqueue stamps recipient_user_id for a recipient a user holds, and only for one', () => {
    it('a user (bare id and email-resolved) is stamped; an unmatched email, a phone number and an unheld id are not', async () => {
        const { ql } = await boot();
        const bea = await user(ql, 'Bea Person', 'bea@example.com');
        const cal = await user(ql, 'Cal Person', 'cal@example.com');

        const result = await messaging(ql).emit({
            topic: 'deal.won',
            audience: [bea, 'cal@example.com', 'outside@example.org', '+15550100', 'usr_nobody'],
            channels: ['email'],
            payload: { title: 'Won', body: 'A deal was won.' },
        });
        expect(result.enqueued).toBe(5);

        expect((await deliveries(ql)).map((d) => [d.recipient_id, d.recipient_user_id])).toEqual([
            ['+15550100', null],
            [bea, bea],
            [cal, cal],
            ['outside@example.org', null],
            ['usr_nobody', null],
        ].sort((a, b) => `email|${a[0]}`.localeCompare(`email|${b[0]}`)));
    });
});

describe('the record title names the person, and the address where there is none', () => {
    it('name; email where the name is blank; the address for an address recipient', async () => {
        const { ql, driver } = await boot();
        const bea = await user(ql, 'Bea Person', 'bea@example.com');
        const blank = await user(ql, 'Placeholder', 'no-name@example.com');
        await driver.getKnex()('sys_user').where({ id: blank }).update({ name: '  ' });

        await messaging(ql).emit({ topic: 'deal.won', audience: [bea, blank, 'outside@example.org'], channels: ['email'], title: 't', body: 'b' } as any);
        await messaging(ql).emit({ topic: 'deal.won', audience: ['+15550100'], channels: ['sms'], title: 't', body: 'b' } as any);

        const titles = Object.fromEntries((await deliveries(ql)).map((d) => [d.recipient_id, d.display_title]));
        expect(titles).toEqual({
            [bea]: 'email → Bea Person',
            [blank]: 'email → no-name@example.com',
            'outside@example.org': 'email → outside@example.org',
            '+15550100': 'sms → +15550100',
        });
        // Reversed: the raw user id was the title before.
        expect(titles[bea]).not.toContain(bea);
    });

    it('deleting the user empties the reference, and the row is titled by the raw recipient again', async () => {
        const { ql } = await boot();
        const eve = await user(ql, 'Eve Person', 'eve@example.com');
        await messaging(ql).emit({ topic: 'deal.won', audience: [eve], channels: ['email'], title: 't', body: 'b' } as any);
        expect((await deliveries(ql))[0]).toMatchObject({ recipient_user_id: eve, display_title: 'email → Eve Person' });

        await ql.delete('sys_user', { where: { id: eve }, context: { isSystem: true } });

        // The delivery history stays; only the person leaves the title.
        expect(await deliveries(ql)).toEqual([
            { recipient_id: eve, recipient_user_id: null, channel: 'email', display_title: `email → ${eve}` },
        ]);
    });
});

describe('a failed sys_user read stamps nothing and fails no emit', () => {
    it('the rows land titled by the raw recipient, and the failure is said once at warn', async () => {
        const { ql } = await boot();
        const bea = await user(ql, 'Bea Person', 'bea@example.com');
        // The real engine, with its sys_user list read failing.
        const failing = new Proxy(ql, {
            get(target, prop, receiver) {
                if (prop === 'find') {
                    return (object: string, ...rest: unknown[]) => object === 'sys_user'
                        ? Promise.reject(new Error('directory unavailable'))
                        : (target.find as any)(object, ...rest);
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const logger = { ...silent, warn: vi.fn() };

        const result = await messaging(failing, logger).emit({ topic: 'deal.won', audience: [bea, 'outside@example.org'], channels: ['email'], title: 't', body: 'b' } as any);

        expect(result.enqueued).toBe(2);
        expect((await deliveries(ql)).map((d) => [d.recipient_user_id, d.display_title])).toEqual([
            [null, `email → ${bea}`],
            [null, 'email → outside@example.org'],
        ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
        const said = logger.warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("'sys_user' read"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain('directory unavailable');
    });
});

describe('the title keeps the guarantees it had', () => {
    it('a row missing channel or recipient_id is refused, so the title never has a NULL part', async () => {
        const { ql } = await boot();
        const NOW = new Date('2026-10-22T00:00:00Z');
        for (const omit of ['channel', 'recipient_id']) {
            const row: Record<string, unknown> = {
                notification_id: `ntf_${omit}`, recipient_id: 'usr_alice', channel: 'email',
                status: 'pending', created_at: NOW, updated_at: NOW,
            };
            delete row[omit];
            await expect(ql.insert(DELIVERY_OBJECT, row, SYS)).rejects.toMatchObject({
                code: 'VALIDATION_FAILED',
                fields: expect.arrayContaining([expect.objectContaining({ field: omit, code: 'required' })]),
            });
        }
    });

    it('the registered body points at display_title, which adds no stored column', async () => {
        const { ql, driver } = await boot();
        const registered = ql.registry.getObject(DELIVERY_OBJECT) as any;
        expect(registered.nameField).toBe('display_title');
        expect(registered.fields.display_title?.type).toBe('formula');
        const columns = Object.keys(await driver.getKnex()(DELIVERY_OBJECT).columnInfo());
        expect(columns).toContain('recipient_user_id');
        expect(columns).not.toContain('display_title');
    });
});
