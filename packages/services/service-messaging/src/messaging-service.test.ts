// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessagingService } from './messaging-service.js';
import type { Delivery, MessagingChannel, SendResult } from './channel.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/** A channel that records every delivery it is handed. */
function recordingChannel(id: string, result: SendResult = { ok: true }): {
    channel: MessagingChannel;
    seen: Delivery[];
} {
    const seen: Delivery[] = [];
    return {
        seen,
        channel: {
            id,
            async send(_ctx, delivery) {
                seen.push(delivery);
                return result;
            },
        },
    };
}

/** A fake data engine capturing event inserts (and optionally a dedup hit). */
function fakeData(findOneImpl?: (obj: string, q: any) => any) {
    const inserts: Array<{ object: string; row: any }> = [];
    const findOnes: Array<{ object: string; query: any }> = [];
    return {
        inserts,
        findOnes,
        getData: () => ({
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                return { id: `evt_${inserts.length}`, ...row };
            },
            async find() { return []; },
            async findOne(object: string, query: any) {
                findOnes.push({ object, query });
                return findOneImpl ? findOneImpl(object, query) : null;
            },
            async update() { return {}; },
            async delete() { return {}; },
            async count() { return 0; },
            async aggregate() { return []; },
        }) as any,
    };
}

describe('MessagingService', () => {
    let service: MessagingService;

    beforeEach(() => {
        service = new MessagingService({ logger: silentLogger() });
    });

    describe('channel registry', () => {
        it('registers, lists, and resolves channels', () => {
            const { channel } = recordingChannel('inbox');
            service.registerChannel(channel);
            expect(service.getRegisteredChannels()).toEqual(['inbox']);
            expect(service.getChannel('inbox')).toBe(channel);
        });

        it('replaces a channel registered under a duplicate id', () => {
            const a = recordingChannel('inbox');
            const b = recordingChannel('inbox');
            service.registerChannel(a.channel);
            service.registerChannel(b.channel);
            expect(service.getRegisteredChannels()).toEqual(['inbox']);
            expect(service.getChannel('inbox')).toBe(b.channel);
        });

        it('unregisters a channel', () => {
            const { channel } = recordingChannel('inbox');
            service.registerChannel(channel);
            service.unregisterChannel('inbox');
            expect(service.getRegisteredChannels()).toEqual([]);
            expect(service.getChannel('inbox')).toBeUndefined();
        });
    });

    describe('emit() ingress + fan-out', () => {
        it('defaults to the inbox channel and one delivery per resolved recipient', async () => {
            const inbox = recordingChannel('inbox', { ok: true, externalId: 'row_1' });
            service.registerChannel(inbox.channel);

            const result = await service.emit({
                topic: 'deal.won',
                audience: ['user_1', 'user_2'],
                payload: { title: 'Deal closed', body: 'Acme signed 🎉' },
            });

            expect(inbox.seen.map((d) => d.recipient)).toEqual(['user_1', 'user_2']);
            expect(inbox.seen[0].channel).toBe('inbox');
            expect(inbox.seen[0].notification.title).toBe('Deal closed');
            expect(result.delivered).toBe(2);
            expect(result.failed).toBe(0);
            expect(result.notificationId).toMatch(/^evt_/); // synthesized w/o data layer
            expect(result.deliveries[0]).toMatchObject({ channel: 'inbox', recipient: 'user_1', ok: true, externalId: 'row_1' });
        });

        it('accepts a single (non-array) audience entry', async () => {
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            const result = await service.emit({ topic: 't', audience: 'user_9', payload: { title: 'Hi' } });
            expect(inbox.seen.map((d) => d.recipient)).toEqual(['user_9']);
            expect(result.delivered).toBe(1);
        });

        it('de-duplicates repeated recipients in the audience', async () => {
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            await service.emit({ topic: 't', audience: ['user_1', 'user_1'], payload: { title: 'Hi' } });
            expect(inbox.seen.map((d) => d.recipient)).toEqual(['user_1']);
        });

        it('resolves role:/team:/owner_of: to 0 recipients when no directory (data) is present', async () => {
            // Without a data engine the RecipientResolver can't query membership,
            // so these selectors yield no recipients (rather than throwing).
            // Directory-backed expansion is covered in recipient-resolver.test.ts.
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            const result = await service.emit({
                topic: 't',
                audience: ['role:admin', 'team:sales', { ownerOf: { object: 'lead', id: 'l1' } }],
                payload: { title: 'Hi' },
            });
            expect(inbox.seen).toHaveLength(0);
            expect(result.delivered).toBe(0);
            expect(result.failed).toBe(0);
        });

        it('resolves role:/team:/owner_of: through the data engine when present', async () => {
            const engine = {
                async insert(_o: string, row: any) { return { id: 'evt_x', ...row }; },
                async find(object: string) {
                    if (object === 'sys_member') return [{ user_id: 'u_admin1' }, { user_id: 'u_admin2' }];
                    if (object === 'sys_team_member') return [{ user_id: 'u_sales' }];
                    return [];
                },
                async findOne(object: string) {
                    return object === 'lead' ? { id: 'l1', owner_id: 'u_owner' } : null;
                },
                async update() { return {}; },
                async delete() { return {}; },
                async count() { return 0; },
                async aggregate() { return []; },
            } as any;
            service = new MessagingService({ logger: silentLogger(), getData: () => engine });
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);

            const result = await service.emit({
                topic: 't',
                audience: ['role:admin', 'team:sales', { ownerOf: { object: 'lead', id: 'l1' } }, 'u_admin1'],
                payload: { title: 'Hi' },
            });

            // u_admin1 de-duped against the role expansion; owner resolved from the record.
            expect(inbox.seen.map((d) => d.recipient).sort()).toEqual(
                ['u_admin1', 'u_admin2', 'u_owner', 'u_sales'].sort(),
            );
            expect(result.delivered).toBe(4);
        });

        it('fans out across every requested channel', async () => {
            const inbox = recordingChannel('inbox');
            const email = recordingChannel('email');
            service.registerChannel(inbox.channel);
            service.registerChannel(email.channel);

            const result = await service.emit({
                topic: 't',
                audience: ['user_1'],
                channels: ['inbox', 'email'],
                payload: { title: 'Hi', body: 'there' },
            });

            expect(inbox.seen).toHaveLength(1);
            expect(email.seen).toHaveLength(1);
            expect(result.delivered).toBe(2);
        });

        it('reports a failed delivery per recipient when a channel is unregistered, without throwing', async () => {
            const result = await service.emit({
                topic: 't',
                audience: ['user_1', 'user_2'],
                channels: ['email'],
                payload: { title: 'Hi' },
            });
            expect(result.delivered).toBe(0);
            expect(result.failed).toBe(2);
            expect(result.deliveries.every((d) => /not registered/.test(d.error ?? ''))).toBe(true);
        });

        it('isolates a throwing channel as a failed delivery', async () => {
            service.registerChannel({
                id: 'inbox',
                async send() {
                    throw new Error('boom');
                },
            });
            const result = await service.emit({ topic: 't', audience: ['user_1'], payload: { title: 'x' } });
            expect(result.failed).toBe(1);
            expect(result.deliveries[0].error).toContain('boom');
        });

        it('surfaces a channel-reported failure (ok:false)', async () => {
            service.registerChannel(recordingChannel('inbox', { ok: false, error: 'quota exceeded' }).channel);
            const result = await service.emit({ topic: 't', audience: ['user_1'], payload: { title: 'x' } });
            expect(result.failed).toBe(1);
            expect(result.deliveries[0].error).toBe('quota exceeded');
        });
    });

    describe('emit() L2 event persistence', () => {
        it('writes one sys_notification event row carrying topic/payload/severity/source/actor', async () => {
            const data = fakeData();
            service = new MessagingService({ logger: silentLogger(), getData: data.getData, now: () => '2026-06-01T00:00:00.000Z' });
            service.registerChannel(recordingChannel('inbox').channel);

            const result = await service.emit({
                topic: 'task.assigned',
                audience: ['user_1'],
                severity: 'warning',
                source: { object: 'task', id: 't_7' },
                actorId: 'user_admin',
                organizationId: 'org_1',
                payload: { title: 'Assigned' },
            });

            const event = data.inserts.find((i) => i.object === 'sys_notification');
            expect(event).toBeDefined();
            expect(event!.row).toMatchObject({
                topic: 'task.assigned',
                severity: 'warning',
                source_object: 'task',
                source_id: 't_7',
                actor_id: 'user_admin',
                organization_id: 'org_1',
                created_at: '2026-06-01T00:00:00.000Z',
            });
            expect(result.notificationId).toBe('evt_1');
        });

        it('is idempotent on dedupKey — a matching prior event skips fan-out', async () => {
            const data = fakeData((obj) => (obj === 'sys_notification' ? { id: 'evt_existing' } : null));
            service = new MessagingService({ logger: silentLogger(), getData: data.getData });
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);

            const result = await service.emit({
                topic: 'task.assigned',
                audience: ['user_1'],
                dedupKey: 'task.assigned:t_7:user_1',
                payload: { title: 'Assigned' },
            });

            expect(result.deduped).toBe(true);
            expect(result.notificationId).toBe('evt_existing');
            expect(inbox.seen).toHaveLength(0); // no re-fan
            expect(data.inserts.some((i) => i.object === 'sys_notification')).toBe(false);
        });
    });
});
