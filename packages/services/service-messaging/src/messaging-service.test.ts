// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
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
            // Inline fan-out leaves nothing in flight — the counterpart to the
            // outbox pin below, and what keeps `delivered` a terminal count on
            // BOTH paths rather than a name two things share (#7747).
            expect(result.enqueued).toBe(0);
            expect(result.notificationId).toMatch(/^evt_/); // synthesized w/o data layer
            expect(result.deliveries[0]).toMatchObject({ channel: 'inbox', recipient: 'user_1', ok: true, externalId: 'row_1' });
        });

        it('synthesizes an action_url from source when no explicit url is given (ADR-0030 L5 deep-link)', async () => {
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            await service.emit({
                topic: 'collab.assignment',
                audience: ['user_1'],
                payload: { title: 'Assigned to you' },
                source: { object: 'showcase_task', id: 't_42' },
            });
            // The materialization carries a navigable link the bell can follow,
            // even though the producer didn't set payload.url.
            expect(inbox.seen[0].notification.actionUrl).toBe('/showcase_task/t_42');
        });

        it('prefers an explicit payload.url over the source-derived link', async () => {
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            await service.emit({
                topic: 't',
                audience: ['user_1'],
                payload: { title: 'Hi', url: '/custom/landing' },
                source: { object: 'showcase_task', id: 't_42' },
            });
            expect(inbox.seen[0].notification.actionUrl).toBe('/custom/landing');
        });

        it('leaves action_url undefined when there is neither a url nor a source', async () => {
            const inbox = recordingChannel('inbox');
            service.registerChannel(inbox.channel);
            await service.emit({ topic: 't', audience: ['user_1'], payload: { title: 'Hi' } });
            expect(inbox.seen[0].notification.actionUrl).toBeUndefined();
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

        it('applies the preference filter — a muted channel is dropped, a mandatory topic bypasses it', async () => {
            // Engine returns a preference muting `email` for user_1 on topic 't'.
            const prefRow = { user_id: 'user_1', topic: 't', channel: 'email', enabled: false };
            const engine = {
                async insert(_o: string, row: any) { return { id: 'evt_1', ...row }; },
                async find(object: string, query: any) {
                    if (object === 'sys_notification_preference') {
                        return query?.where?.topic === 't' ? [prefRow] : [];
                    }
                    return [];
                },
                async findOne() { return null; },
                async update() { return {}; },
                async delete() { return {}; },
                async count() { return 0; },
                async aggregate() { return []; },
            } as any;

            // Non-mandatory topic 't': email is muted → only inbox delivered.
            const svc = new MessagingService({ logger: silentLogger(), getData: () => engine });
            const inbox = recordingChannel('inbox');
            const email = recordingChannel('email');
            svc.registerChannel(inbox.channel);
            svc.registerChannel(email.channel);
            const r1 = await svc.emit({ topic: 't', audience: ['user_1'], channels: ['inbox', 'email'], payload: { title: 'Hi' } });
            expect(inbox.seen).toHaveLength(1);
            expect(email.seen).toHaveLength(0); // muted
            expect(r1.delivered).toBe(1);

            // Same mute, but topic is mandatory → bypass → both channels delivered.
            const mandatory = new MessagingService({ logger: silentLogger(), getData: () => engine, mandatoryTopics: ['t'] });
            const inbox2 = recordingChannel('inbox');
            const email2 = recordingChannel('email');
            mandatory.registerChannel(inbox2.channel);
            mandatory.registerChannel(email2.channel);
            const r2 = await mandatory.emit({ topic: 't', audience: ['user_1'], channels: ['inbox', 'email'], payload: { title: 'Hi' } });
            expect(inbox2.seen).toHaveLength(1);
            expect(email2.seen).toHaveLength(1); // mandatory bypass
            expect(r2.delivered).toBe(2);
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

    describe('emit() with a delivery outbox (P1)', () => {
        it('enqueues a pending delivery per (recipient × channel) instead of fanning out inline', async () => {
            const outbox = new MemoryNotificationOutbox(1);
            const inbox = recordingChannel('inbox');
            service = new MessagingService({ logger: silentLogger(), outbox });
            service.registerChannel(inbox.channel);

            const result = await service.emit({
                topic: 'deal.won',
                audience: ['user_1', 'user_2'],
                payload: { title: 'Deal closed', body: 'Acme' },
            });

            // Nothing sent inline — the dispatcher owns the send.
            expect(inbox.seen).toHaveLength(0);
            // …so nothing is DELIVERED yet, and the result says so (#7747). This
            // pin used to read `delivered: 2` with the comment "2 enqueued
            // (accepted)" — the conflation itself, written down: callers were
            // handed an enqueue count under the name `delivered`, and it stayed
            // put when the dispatcher later dead-lettered the row.
            expect(result.enqueued).toBe(2);
            expect(result.delivered).toBe(0);
            expect(result.failed).toBe(0);
            const rows = await outbox.list();
            expect(rows).toHaveLength(2);
            expect(rows.every((r) => r.status === 'pending')).toBe(true);
            expect(rows[0].payload).toMatchObject({ title: 'Deal closed', body: 'Acme', severity: 'info' });
            expect(rows.map((r) => r.recipientId).sort()).toEqual(['user_1', 'user_2']);
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

        it('converges to the winner when a concurrent emit wins the dedup_key unique index', async () => {
            // Simulate the race: the fast-path findOne misses (no prior event),
            // but the event insert hits the UNIQUE(dedup_key) violation because a
            // concurrent emit inserted first. We must catch it and converge to
            // that winner rather than throwing or double-emitting.
            let firstLookup = true;
            const engine = {
                async insert(object: string) {
                    if (object === 'sys_notification') throw new Error('UNIQUE constraint failed: sys_notification.dedup_key');
                    return { id: 'row' };
                },
                async find() { return []; },
                async findOne(object: string) {
                    if (object !== 'sys_notification') return null;
                    // First call = the fast-path miss; second = post-conflict lookup finds the winner.
                    if (firstLookup) { firstLookup = false; return null; }
                    return { id: 'evt_winner' };
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
                topic: 'task.assigned',
                audience: ['user_1'],
                dedupKey: 'task.assigned:t_7:user_1',
                payload: { title: 'Assigned' },
            });

            expect(result.deduped).toBe(true);
            expect(result.notificationId).toBe('evt_winner');
            expect(inbox.seen).toHaveLength(0); // loser does not re-fan
        });

        it('rethrows an event insert error that is not a dedup conflict', async () => {
            // No dedupKey ⇒ no convergence path ⇒ a genuine write failure surfaces.
            const engine = {
                async insert() { throw new Error('disk full'); },
                async find() { return []; },
                async findOne() { return null; },
                async update() { return {}; },
                async delete() { return {}; },
                async count() { return 0; },
                async aggregate() { return []; },
            } as any;
            service = new MessagingService({ logger: silentLogger(), getData: () => engine });
            service.registerChannel(recordingChannel('inbox').channel);

            await expect(
                service.emit({ topic: 't', audience: ['user_1'], payload: { title: 'x' } }),
            ).rejects.toThrow('disk full');
        });
    });
});

/**
 * A stateful in-memory engine for the inbox read API (ADR-0030). Supports the
 * flat-equality `where` filters listInbox/markRead/markAllRead issue, plus
 * `update(..., { where: { id } })` mutation and `insert`.
 */
function inboxEngine(seed: { inbox?: any[]; receipts?: any[] } = {}) {
    const store: Record<string, any[]> = {
        sys_inbox_message: [...(seed.inbox ?? [])],
        sys_notification_receipt: [...(seed.receipts ?? [])],
    };
    let seq = 0;
    const matches = (row: any, where: any = {}) =>
        Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return String(row[k]) === String(v);
        });
    const engine = {
        store,
        async find(object: string, query: any = {}) {
            let rows = (store[object] ?? []).filter((r) => matches(r, query.where));
            const ob = Array.isArray(query.orderBy) ? query.orderBy : [];
            if (ob.some((o: any) => o.field === 'created_at' && o.order === 'desc')) {
                rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            }
            return typeof query.limit === 'number' ? rows.slice(0, query.limit) : rows;
        },
        async findOne(object: string, query: any = {}) {
            return (store[object] ?? []).find((r) => matches(r, query.where)) ?? null;
        },
        async insert(object: string, row: any) {
            const created = { id: `row_${++seq}`, ...row };
            (store[object] ??= []).push(created);
            return created;
        },
        async update(object: string, data: any, options: any = {}) {
            for (const r of store[object] ?? []) {
                if (matches(r, options.where)) Object.assign(r, data);
            }
            return {};
        },
        async delete() { return {}; },
        async count() { return 0; },
        async aggregate() { return []; },
    };
    return engine as any;
}

describe('MessagingService — inbox read API (ADR-0030)', () => {
    const logger = silentLogger();

    it('lists inbox rows joined with receipt read-state and counts unread', async () => {
        const engine = inboxEngine({
            inbox: [
                { id: 'm1', user_id: 'u1', notification_id: 'n1', topic: 'collab.mention', title: 'A', body_md: 'a', action_url: '/x', created_at: '2026-01-01T00:00:01Z' },
                { id: 'm2', user_id: 'u1', notification_id: 'n2', topic: 'task.assigned', title: 'B', body_md: 'b', created_at: '2026-01-01T00:00:02Z' },
                { id: 'm3', user_id: 'u2', notification_id: 'n3', topic: 'x', title: 'C', created_at: '2026-01-01T00:00:03Z' },
            ],
            receipts: [
                { id: 'r1', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'read' },
                { id: 'r2', notification_id: 'n2', user_id: 'u1', channel: 'inbox', state: 'delivered' },
            ],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.listInbox('u1');
        // Only u1's rows; newest first; n2 unread, n1 read.
        expect(res.notifications.map((n) => n.id)).toEqual(['n2', 'n1']);
        expect(res.unreadCount).toBe(1);
        const n1 = res.notifications.find((n) => n.id === 'n1')!;
        expect(n1).toMatchObject({ type: 'collab.mention', title: 'A', body: 'a', read: true, actionUrl: '/x' });
        expect(res.notifications.find((n) => n.id === 'n2')!.read).toBe(false);
    });

    it('filters by read state when requested', async () => {
        const engine = inboxEngine({
            inbox: [
                { id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' },
                { id: 'm2', user_id: 'u1', notification_id: 'n2', title: 'B', created_at: '2' },
            ],
            receipts: [{ id: 'r1', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'read' }],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.listInbox('u1', { read: false })).notifications.map((n) => n.id)).toEqual(['n2']);
        expect((await svc.listInbox('u1', { read: true })).notifications.map((n) => n.id)).toEqual(['n1']);
    });

    it('markRead updates the existing delivered receipt in place (no duplicate)', async () => {
        const engine = inboxEngine({
            inbox: [{ id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' }],
            receipts: [{ id: 'r1', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered' }],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markRead('u1', ['n1']);
        expect(res).toEqual({ success: true, readCount: 1 });
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(1); // updated in place, not duplicated
        expect(receipts[0]).toMatchObject({ id: 'r1', state: 'read' });
        expect(receipts[0].at).toBeTruthy();
    });

    it('markRead inserts a read receipt when none exists yet', async () => {
        const engine = inboxEngine({
            inbox: [{ id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' }],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markRead('u1', ['n1']);
        expect(res.readCount).toBe(1);
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'read' });
    });

    it('markRead survives a unique-index race on the receipt insert', async () => {
        // No receipt seeded, so the fast-path findOne misses. The insert then
        // hits the UNIQUE(notification_id, user_id, channel) index because a
        // concurrent mark-read (or the best-effort `delivered` write) created
        // the row first. We must catch it and converge to the existing row.
        const engine = inboxEngine({
            inbox: [{ id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' }],
        });
        const realInsert = engine.insert.bind(engine);
        let raced = false;
        engine.insert = async (object: string, row: any) => {
            if (object === 'sys_notification_receipt' && !raced) {
                raced = true;
                // A concurrent writer wins the index, then our insert collides.
                engine.store.sys_notification_receipt.push({
                    id: 'r_concurrent', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered',
                });
                throw new Error('UNIQUE constraint failed: sys_notification_receipt.notification_id, sys_notification_receipt.user_id, sys_notification_receipt.channel');
            }
            return realInsert(object, row);
        };
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markRead('u1', ['n1']);
        expect(res).toEqual({ success: true, readCount: 1 });
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(1); // converged, not duplicated
        expect(receipts[0]).toMatchObject({ id: 'r_concurrent', state: 'read' });
    });

    it('markRead converges when the conflict arrives wrapped in a cause chain (#6542)', async () => {
        // Pool and query-builder layers re-throw with the driver error attached
        // as `cause`. The retired local isUniqueViolation() read only the
        // top-level code/message, judged this wrapper "not a conflict", and
        // rethrew — markRead logged the failure and reported readCount 0 with
        // the receipt stuck at `delivered`. The shared isUniqueViolationError
        // (@objectstack/types, #6250) follows the bounded cause chain, so the
        // race fallback now converges exactly as it does for a bare driver
        // error. This is the ONE behaviour change of the migration, in the
        // direction the call site wants: a wrapped conflict is still a conflict.
        const engine = inboxEngine({
            inbox: [{ id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' }],
        });
        const realInsert = engine.insert.bind(engine);
        let raced = false;
        engine.insert = async (object: string, row: any) => {
            if (object === 'sys_notification_receipt' && !raced) {
                raced = true;
                engine.store.sys_notification_receipt.push({
                    id: 'r_concurrent', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered',
                });
                // The wrapper's own text deliberately matches neither the codes
                // nor the message substrings the predicate knows — only the
                // attached driver error carries the conflict signal.
                const wrapper = new Error('receipt insert failed (pool retry exhausted)');
                (wrapper as Error & { cause?: unknown }).cause = {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "sys_notification_receipt_notification_id_user_id_channel_key"',
                };
                throw wrapper;
            }
            return realInsert(object, row);
        };
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markRead('u1', ['n1']);
        expect(res).toEqual({ success: true, readCount: 1 });
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(1); // converged, not duplicated
        expect(receipts[0]).toMatchObject({ id: 'r_concurrent', state: 'read' });
    });

    it.each([
        ['postgres', { code: '23505', message: 'duplicate key value violates unique constraint "sys_notification_receipt_uniq"' }],
        ['mysql', { code: 'ER_DUP_ENTRY', errno: 1062, message: "Duplicate entry 'n1-u1-inbox' for key 'sys_notification_receipt_uniq'" }],
        ['sqlite', { message: 'UNIQUE constraint failed: sys_notification_receipt.notification_id, sys_notification_receipt.user_id, sys_notification_receipt.channel' }],
    ])('markRead race fallback is unchanged for a plain (unwrapped) %s conflict (#6542)', async (_dialect, shape) => {
        // Pin that the migration onto the shared predicate did not move any
        // verdict the old local copy already gave: a bare three-dialect driver
        // error still converges identically.
        const engine = inboxEngine({
            inbox: [{ id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' }],
        });
        const realInsert = engine.insert.bind(engine);
        let raced = false;
        engine.insert = async (object: string, row: any) => {
            if (object === 'sys_notification_receipt' && !raced) {
                raced = true;
                engine.store.sys_notification_receipt.push({
                    id: 'r_concurrent', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered',
                });
                throw Object.assign(new Error(shape.message), shape);
            }
            return realInsert(object, row);
        };
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markRead('u1', ['n1']);
        expect(res).toEqual({ success: true, readCount: 1 });
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ id: 'r_concurrent', state: 'read' });
    });

    it('markAllRead flips every unread message and leaves already-read ones', async () => {
        const engine = inboxEngine({
            inbox: [
                { id: 'm1', user_id: 'u1', notification_id: 'n1', title: 'A', created_at: '1' },
                { id: 'm2', user_id: 'u1', notification_id: 'n2', title: 'B', created_at: '2' },
            ],
            receipts: [{ id: 'r1', notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'read' }],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markAllRead('u1');
        expect(res.readCount).toBe(1); // only n2 was unread
        expect((await svc.listInbox('u1')).unreadCount).toBe(0);
    });

    it('degrades to empty without a data engine or user id', async () => {
        const noData = new MessagingService({ logger });
        expect(await noData.listInbox('u1')).toEqual({ notifications: [], unreadCount: 0 });
        expect(await noData.markRead('u1', ['n1'])).toEqual({ success: true, readCount: 0 });

        const svc = new MessagingService({ logger, getData: () => inboxEngine() });
        expect(await svc.listInbox('')).toEqual({ notifications: [], unreadCount: 0 });
    });
});

/**
 * `n` inbox rows for one user, oldest first. `created_at` carries a padded
 * millisecond index so the fake engine's lexicographic `desc` sort is the real
 * newest-first order for any `n` — the window tests below all depend on
 * knowing exactly WHICH rows a truncated window holds.
 */
function seedInbox(
    userId: string,
    n: number,
    topicAt: (i: number) => string = () => 'task.assigned',
): Array<Record<string, unknown>> {
    return Array.from({ length: n }, (_, i) => ({
        id: `m${i + 1}`,
        user_id: userId,
        notification_id: `n${i + 1}`,
        topic: topicAt(i),
        title: `Notification ${i + 1}`,
        body_md: 'body',
        created_at: `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z`,
    }));
}

/** An inbox receipt in a read state, for the message `seedInbox` numbered `i`. */
function readReceipt(userId: string, i: number): Record<string, unknown> {
    return { id: `r${i}`, notification_id: `n${i}`, user_id: userId, channel: 'inbox', state: 'read' };
}

/**
 * Record every `find` an existing engine is asked to run, in order. Wraps the
 * double rather than declaring another one: the cost claims below are about how
 * many reads `listInbox` issues, which is only observable at the call site.
 */
function recordFinds(engine: any): Array<{ object: string; query: any }> {
    const calls: Array<{ object: string; query: any }> = [];
    const real = engine.find.bind(engine);
    engine.find = async (object: string, query: any = {}) => {
        calls.push({ object, query });
        return real(object, query);
    };
    return calls;
}

/**
 * [#6363] `ListNotificationsResponseSchema.unreadCount` is published into the
 * API reference as "Total number of unread notifications". It was counted
 * inside `rows.map(...)`, i.e. over the `limit`-truncated window, so the badge
 * saturated at the window size forever: measured on a real stack with 60
 * unread, the route answered `unreadCount: 50` unfiltered and `10` at
 * `?limit=10`. Maintainer ruling (2026-08-07, Option A): make the declaration
 * true — count the total — and leave the list itself windowed.
 *
 * The fixtures below are the issue's measured shape (60 unread, `limit=10`).
 */
describe('[#6363] listInbox — unreadCount is the TOTAL unread, not the fetched window', () => {
    const logger = silentLogger();

    it('counts every unread message when the window truncates the inbox', async () => {
        const engine = inboxEngine({ inbox: seedInbox('u1', 60) });
        const svc = new MessagingService({ logger, getData: () => engine });

        // No `limit`: the default clamp windows the LIST at 50 — unchanged.
        const unfiltered = await svc.listInbox('u1');
        expect(unfiltered.notifications).toHaveLength(50);
        expect(unfiltered.unreadCount).toBe(60); // was 50 — the window's size

        // `?limit=10`: the list shrinks with the window, the badge does not.
        const windowed = await svc.listInbox('u1', { limit: 10 });
        expect(windowed.notifications).toHaveLength(10);
        expect(windowed.unreadCount).toBe(60); // was 10 — the window's size
    });

    it('subtracts read-state across the whole inbox, not just inside the window', async () => {
        // The 20 read messages are the OLDEST, so none of them is inside a
        // newest-first `limit=10` window: a window-scoped count cannot see
        // them, and a total that ignored receipts would answer 60.
        const engine = inboxEngine({
            inbox: seedInbox('u1', 60),
            receipts: Array.from({ length: 20 }, (_, i) => readReceipt('u1', i + 1)),
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.listInbox('u1', { limit: 10 });
        expect(res.notifications).toHaveLength(10);
        expect(res.notifications.every((n) => n.read === false)).toBe(true); // window is all-unread
        expect(res.unreadCount).toBe(40);
    });

    it('counts rows carrying no notification_id — never receipted, so never read', async () => {
        const inbox = seedInbox('u1', 60);
        // A synthetic/legacy row with no event id keys no receipt at all.
        for (const row of inbox.slice(0, 5)) row.notification_id = null;
        const engine = inboxEngine({ inbox });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.listInbox('u1', { limit: 10 })).unreadCount).toBe(60);
    });

    it('answers the `type` filter it was asked, over the whole inbox', async () => {
        // 60 messages alternating between two topics ⇒ 30 of each.
        const engine = inboxEngine({
            inbox: seedInbox('u1', 60, (i) => (i % 2 === 0 ? 'deal.won' : 'task.assigned')),
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.listInbox('u1', { type: 'deal.won', limit: 10 });
        expect(res.notifications).toHaveLength(10);
        expect(res.notifications.every((n) => n.type === 'deal.won')).toBe(true);
        expect(res.unreadCount).toBe(30);
    });

    it('counts only the addressed user, at any window size', async () => {
        const engine = inboxEngine({ inbox: [...seedInbox('u1', 60), ...seedInbox('u2', 7)] });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.listInbox('u1', { limit: 10 })).unreadCount).toBe(60);
        expect((await svc.listInbox('u2', { limit: 10 })).unreadCount).toBe(7);
    });

    it('the `read` filter narrows the list and never the badge', async () => {
        const engine = inboxEngine({
            inbox: seedInbox('u1', 60),
            receipts: Array.from({ length: 20 }, (_, i) => readReceipt('u1', i + 1)),
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        // Asking for the READ half does not mean the unread badge is zero.
        const readOnly = await svc.listInbox('u1', { read: true, limit: 10 });
        expect(readOnly.notifications).toEqual([]); // the newest 10 are all unread
        expect(readOnly.unreadCount).toBe(40);

        const unreadOnly = await svc.listInbox('u1', { read: false, limit: 10 });
        expect(unreadOnly.notifications).toHaveLength(10);
        expect(unreadOnly.unreadCount).toBe(40);
    });

    it('a window that came back SHORT costs no second read', async () => {
        // Nothing was truncated, so the window count already IS the total and
        // the reverse join would re-read what the first `find` returned.
        const engine = inboxEngine({ inbox: seedInbox('u1', 3) });
        const calls = recordFinds(engine);
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.listInbox('u1');
        expect(res.unreadCount).toBe(3);
        expect(calls.filter((c) => c.object === 'sys_inbox_message')).toHaveLength(1);
    });

    it('the total read is one narrow projection, unwindowed, over the same predicate', async () => {
        const engine = inboxEngine({ inbox: seedInbox('u1', 60) });
        const calls = recordFinds(engine);
        const svc = new MessagingService({ logger, getData: () => engine });

        await svc.listInbox('u1', { type: 'task.assigned', limit: 10 });

        const inboxReads = calls.filter((c) => c.object === 'sys_inbox_message');
        expect(inboxReads).toHaveLength(2);
        const [windowRead, totalRead] = inboxReads;
        expect(windowRead.query.limit).toBe(10);
        // Same predicate as the windowed read — the count answers the same
        // question, minus the window — and one column, so the extra work stays
        // the same order as the receipt scan `listInbox` already performs.
        expect(totalRead.query.where).toEqual(windowRead.query.where);
        expect(totalRead.query.limit).toBeUndefined();
        expect(totalRead.query.fields).toEqual(['notification_id']);
    });

    it('a failing total read is NOT swallowed into a window-sized answer', async () => {
        // The receipt read degrades (different object, may be absent from a
        // minimal stack); this one re-reads the object whose `find` just
        // succeeded, so a failure is a data-layer outage — not a licence to
        // quietly re-tell the window-sized lie.
        const engine = inboxEngine({ inbox: seedInbox('u1', 60) });
        const real = engine.find.bind(engine);
        engine.find = async (object: string, query: any = {}) => {
            if (object === 'sys_inbox_message' && query.fields) throw new Error('connection lost');
            return real(object, query);
        };
        const svc = new MessagingService({ logger, getData: () => engine });

        await expect(svc.listInbox('u1', { limit: 10 })).rejects.toThrow('connection lost');
    });

    /* ------------------------------------------------------------------ */
    /*  The other half of the ruling: the LIST window is unchanged.        */
    /* ------------------------------------------------------------------ */

    it('the list keeps its window: default 50, hard cap 200, floor 1, newest first', async () => {
        const engine = inboxEngine({ inbox: seedInbox('u1', 250) });
        const svc = new MessagingService({ logger, getData: () => engine });

        const dflt = await svc.listInbox('u1');
        expect(dflt.notifications).toHaveLength(50);
        expect(dflt.notifications[0].id).toBe('n250'); // newest first, still
        expect(dflt.unreadCount).toBe(250);

        expect((await svc.listInbox('u1', { limit: 500 })).notifications).toHaveLength(200);
        expect((await svc.listInbox('u1', { limit: 0 })).notifications).toHaveLength(1);
        expect((await svc.listInbox('u1', { limit: 120 })).notifications).toHaveLength(120);
    });
});

/**
 * [#6436] `markAllRead` swept `listInbox(userId, { read: false, limit: 200 })`
 * — one page of the LIST — and `200` is that list's hard cap, so the route
 * documented as "mark **every** currently-unread inbox message as read"
 * cleared at most 200 receipts per call.
 *
 * #6363 did not introduce this; it removed the cover. While `unreadCount` was
 * counted over the window the truncation was self-consistent and invisible
 * (clear 200, poll, see a window with nothing unread in it, badge 0). Now that
 * the badge is the true total, one response pair states the contradiction on
 * its own: `POST /read/all → { readCount: 200 }` then
 * `GET /notifications → { unreadCount: 150 }`.
 *
 * Route C — redefine "all" as "the current window" — was excluded by the
 * maintainer's #6363 Option A ruling (make the declaration true). The sweep now
 * reads the unread SET directly instead of a page of the list.
 */
describe('[#6436] markAllRead — sweeps the whole inbox, not one 200-row window', () => {
    const logger = silentLogger();

    it("clears an inbox holding more unread than the list's hard cap (the issue's 350)", async () => {
        const engine = inboxEngine({ inbox: seedInbox('u1', 350) });
        const svc = new MessagingService({ logger, getData: () => engine });

        const res = await svc.markAllRead('u1');
        // Before: `readCount: 200`, and 150 messages still unread behind a
        // badge that — since #6363 — reported them correctly.
        expect(res).toEqual({ success: true, readCount: 350 });
        expect((await svc.listInbox('u1')).unreadCount).toBe(0);

        // Persisted read-state, not a view-layer computation: one receipt per
        // notification, every one of them `read`.
        const receipts = engine.store.sys_notification_receipt;
        expect(receipts).toHaveLength(350);
        expect(receipts.every((r: any) => r.state === 'read')).toBe(true);
    });

    it('marks the older unread even when the newest 200 are already read', async () => {
        // The sharper face of the same defect, and the reason "loop `listInbox`
        // until it comes back empty" is not merely costly but WRONG: the window
        // is `created_at desc` over ALL rows and the `read` filter is applied
        // in memory AFTER the truncation. An inbox whose newest 200 are read
        // therefore handed the sweep an EMPTY id list — it marked nothing at
        // all, however much older unread sat behind it, and a paging loop would
        // have exited on that same empty first page. Reading the unread SET
        // makes a message's position in the inbox stop mattering.
        const engine = inboxEngine({
            inbox: seedInbox('u1', 350),
            // m151…m350 are the NEWEST 200 (created_at .150 … .349).
            receipts: Array.from({ length: 200 }, (_, i) => readReceipt('u1', i + 151)),
        });
        const svc = new MessagingService({ logger, getData: () => engine });
        expect((await svc.listInbox('u1')).unreadCount).toBe(150);

        expect((await svc.markAllRead('u1')).readCount).toBe(150); // before: 0
        expect((await svc.listInbox('u1')).unreadCount).toBe(0);
    });

    it('a small inbox behaves exactly as before — only the unread flip', async () => {
        const engine = inboxEngine({
            inbox: seedInbox('u1', 10),
            receipts: [readReceipt('u1', 1), readReceipt('u1', 2)],
        });
        const before = engine.store.sys_notification_receipt.map((r: any) => ({ ...r }));
        const svc = new MessagingService({ logger, getData: () => engine });

        expect(await svc.markAllRead('u1')).toEqual({ success: true, readCount: 8 });
        expect((await svc.listInbox('u1')).unreadCount).toBe(0);

        // The two already-read receipts are not re-stamped: an inbox smaller
        // than the old window is the case that was never broken, and it must
        // not start doing extra writes to prove it.
        const after = engine.store.sys_notification_receipt;
        expect(after).toHaveLength(10);
        expect(after.slice(0, 2)).toEqual(before);
    });

    it('costs a fixed two reads however large the inbox is — no paging loop', async () => {
        for (const n of [10, 350]) {
            const engine = inboxEngine({ inbox: seedInbox('u1', n) });
            const calls = recordFinds(engine);
            const svc = new MessagingService({ logger, getData: () => engine });

            await svc.markAllRead('u1');

            expect(calls, `inbox of ${n}`).toHaveLength(2);
            const inboxRead = calls.find((c) => c.object === 'sys_inbox_message')!;
            // Unwindowed, unordered and one column wide — the same projection
            // #6363's `countUnreadTotal` already reads to answer the badge, so
            // the sweep asks the data layer for nothing the bell poll does not
            // ask it on every saturated page.
            expect(inboxRead.query.where).toEqual({ user_id: 'u1' });
            expect(inboxRead.query.fields).toEqual(['notification_id']);
            expect(inboxRead.query.limit).toBeUndefined();
            expect(inboxRead.query.orderBy).toBeUndefined();
            expect(calls.filter((c) => c.object === 'sys_notification_receipt')).toHaveLength(1);
        }
    });

    it('touches only the addressed user', async () => {
        const engine = inboxEngine({
            inbox: [
                ...seedInbox('u1', 350),
                { id: 'x1', user_id: 'u2', notification_id: 'xn1', title: 'X', body_md: 'x', created_at: '2026-01-01T00:00:00.900Z' },
                { id: 'x2', user_id: 'u2', notification_id: 'xn2', title: 'Y', body_md: 'y', created_at: '2026-01-01T00:00:00.901Z' },
            ],
        });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.markAllRead('u1')).readCount).toBe(350);
        expect((await svc.listInbox('u2')).unreadCount).toBe(2);
        expect(engine.store.sys_notification_receipt.every((r: any) => r.user_id === 'u1')).toBe(true);
    });

    it('is idempotent — a second sweep writes nothing and reports 0', async () => {
        const engine = inboxEngine({ inbox: seedInbox('u1', 350) });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.markAllRead('u1')).readCount).toBe(350);
        expect((await svc.markAllRead('u1')).readCount).toBe(0);
        expect(engine.store.sys_notification_receipt).toHaveLength(350);
    });

    it('counts a notification once when several inbox rows materialize it', async () => {
        // `readCount` reports NOTIFICATIONS flipped, and the receipt is keyed
        // `(notification_id, user_id, channel)` — one row per notification
        // however many inbox rows point at it. Feeding the id twice would have
        // counted a second upsert that wrote nothing new.
        const inbox = seedInbox('u1', 3);
        inbox[2].notification_id = 'n1'; // m3 re-materializes n1
        const engine = inboxEngine({ inbox });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.markAllRead('u1')).readCount).toBe(2);
        expect(engine.store.sys_notification_receipt).toHaveLength(2);
        expect((await svc.listInbox('u1')).unreadCount).toBe(0);
    });

    it('reads the receipt spine best-effort, exactly as listInbox does', async () => {
        // Read-state lives on a DIFFERENT object which a minimal stack may not
        // have registered (`listInbox` degrades to "everything unread" for the
        // same reason). Degrading to "sweep them all" is the safe direction:
        // re-marking a read message is idempotent, skipping an unread one is
        // the defect this issue is about.
        const engine = inboxEngine({
            inbox: seedInbox('u1', 3),
            receipts: [readReceipt('u1', 1)],
        });
        const real = engine.find.bind(engine);
        engine.find = async (object: string, query: any = {}) => {
            if (object === 'sys_notification_receipt') throw new Error('receipts unavailable');
            return real(object, query);
        };
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.markAllRead('u1')).readCount).toBe(3);
    });

    it('skips rows carrying no event id — they key no receipt at all', async () => {
        // Recorded, NOT endorsed. Read-state is keyed by the EVENT id
        // (ADR-0030) and the inbox channel writes no receipt for a row without
        // one, so there is nothing this sweep can write for it. The old code
        // fed `markRead` the inbox ROW id (`listInbox` views it as `nid ??
        // String(m.id)`), which inserted a receipt the join never reads back —
        // it could not make the row read and still counted itself into
        // `readCount`. Skipping it keeps `readCount` honest; #6363's count goes
        // on reporting the row as unread, which is the true state. Whether such
        // a row should be readable at all is #6448 — a gap in the receipt KEY,
        // not in this sweep, and dormant: the single `emit()` ingress always
        // carries an event id, so only data written around it can be null.
        const inbox = seedInbox('u1', 3);
        inbox[0].notification_id = null;
        const engine = inboxEngine({ inbox });
        const svc = new MessagingService({ logger, getData: () => engine });

        expect((await svc.markAllRead('u1')).readCount).toBe(2);
        expect(engine.store.sys_notification_receipt).toHaveLength(2);
        expect((await svc.listInbox('u1')).unreadCount).toBe(1);
    });

    it('still degrades to a no-op without a data engine or user id', async () => {
        const noData = new MessagingService({ logger });
        expect(await noData.markAllRead('u1')).toEqual({ success: true, readCount: 0 });

        const svc = new MessagingService({ logger, getData: () => inboxEngine({ inbox: seedInbox('u1', 3) }) });
        expect(await svc.markAllRead('')).toEqual({ success: true, readCount: 0 });
    });
});
