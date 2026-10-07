// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] The messaging plumbing that used to reach the data engine with no
 * principal and no system opt-in carries the explicit opt-in (`isSystem:
 * true`) on every engine call:
 *
 *  - the dispatcher CLAIM path — `SqlNotificationOutbox.claim` / `claimDigest`
 *    / the visibility-timeout reap, and `SqlHttpOutbox.claim` / its reap: the
 *    candidate read, the claiming UPDATE and the read-back, each;
 *  - the emit FAN-OUT — `writeEvent`'s `sys_notification` row,
 *    `RecipientResolver.resolveEmail`'s `sys_user` read,
 *    `PreferenceResolver.loadRows`' two `sys_notification_preference` reads, and
 *    the inbox channel's `send`: its recipient-locale read, the
 *    `sys_inbox_message` row and the delivered receipt.
 *
 * Those calls passed the security middleware only through its principal-less
 * hand-off (ADR-0096 E1), which D5 closes; on a dispatcher tick there is no
 * caller at all, and in the fan-out every row belongs to a recipient rather
 * than the emitter. The double answers the claim path's candidate read with a
 * row, so the UPDATE and the read-back really run and are counted below.
 */

import { describe, it, expect } from 'vitest';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';
import { RecipientResolver } from './recipient-resolver.js';
import { createEmailChannel } from './email-channel.js';
import { createSmsChannel } from './sms-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

type Call = { verb: string; object: string; context: unknown; query?: any; data?: any; options?: any; answered?: unknown };

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

/**
 * An `IDataEngine`-shaped double that records the context each call carried —
 * the trailing options argument, or the query bag for a read that put it there
 * (the contract accepts both; options wins).
 */
function recordingEngine(answer: (verb: string, object: string, query: any) => unknown) {
    const calls: Call[] = [];
    const ctxOf = (query: any, options: any) => options?.context ?? query?.context;
    const engine = {
        async find(object: string, query: any, options?: any) {
            // Recorded before it is answered, so a read the double fails is counted too.
            const call: Call = { verb: 'find', object, context: ctxOf(query, options), query };
            calls.push(call);
            const rows = (answer('find', object, query) as unknown[]) ?? [];
            // [#21908] The caller's bound holds here as it does on the engine.
            call.answered = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
            return call.answered;
        },
        async findOne(object: string, query: any, options?: any) {
            assertEngineFindOnePredicate(object, query);
            const call: Call = { verb: 'findOne', object, context: ctxOf(query, options), query };
            calls.push(call);
            call.answered = answer('findOne', object, query) ?? null;
            return call.answered;
        },
        async insert(object: string, data: Record<string, unknown>, options?: any) {
            calls.push({ verb: 'insert', object, context: options?.context, data, options });
            return { id: `${object}_1`, ...data };
        },
        async update(object: string, data: Record<string, unknown>, options?: any) {
            assertEngineUpdateDispatch(data, options);
            calls.push({ verb: 'update', object, context: options?.context, data, options });
            return 1;
        },
        async count() { return 0; },
        async aggregate() { return []; },
    };
    return { engine: engine as any, calls };
}

function expectAllSystem(calls: Call[]): void {
    for (const call of calls) {
        expect(call.context, `${call.verb} on ${call.object}`).toEqual({ isSystem: true });
    }
}

const NOW = 1_800_000_000_000;

describe('[#21913] the dispatcher claim path carries the explicit system opt-in', () => {
    it('SqlNotificationOutbox: claim, claimDigest and reap — candidate read, claiming UPDATE and read-back', async () => {
        const { engine, calls } = recordingEngine((verb, _object, query) => {
            if (verb !== 'find') return null;
            // The candidate read projects `id` alone; the read-back asks for whole rows.
            if (Array.isArray(query?.fields) && query.fields.length === 1) return [{ id: 'd1' }];
            return [{
                id: 'd1', notification_id: 'n1', recipient_id: 'u1', channel: 'inbox', payload: '{}',
                partition_key: 0, status: 'in_flight', attempts: 0, claimed_by: 'node-a', claimed_at: NOW,
                created_at: NOW, updated_at: NOW,
            }];
        });
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 1 });

        expect(await outbox.claim({ nodeId: 'node-a', limit: 5, claimTtlMs: 60_000, now: NOW })).toHaveLength(1);
        expect(await outbox.claimDigest({ nodeId: 'node-a', limit: 5, claimTtlMs: 60_000, now: NOW })).toHaveLength(1);
        await outbox.reap({ claimTtlMs: 60_000, now: NOW });

        // The population first: each claim ran reap + candidate read + UPDATE +
        // read-back, and the standalone reap ran once more.
        expect(calls.filter((c) => c.verb === 'find')).toHaveLength(4);
        expect(calls.filter((c) => c.verb === 'update')).toHaveLength(5);
        expect(calls.every((c) => c.object === 'sys_notification_delivery')).toBe(true);
        expectAllSystem(calls);
    });

    it('SqlHttpOutbox: claim and reap — candidate read, claiming UPDATE and read-back', async () => {
        const { engine, calls } = recordingEngine((verb, _object, query) => {
            if (verb !== 'find') return null;
            if (Array.isArray(query?.fields) && query.fields.length === 1) return [{ id: 'h1' }];
            return [{
                id: 'h1', source: 'webhook', ref_id: 'wh1', dedup_key: 'k1', url: 'https://example.test/hook',
                payload_json: '{}', status: 'in_flight', attempts: 0, partition_key: 0,
                claimed_by: 'node-a', claimed_at: NOW, created_at: NOW, updated_at: NOW,
            }];
        });
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 1 });

        expect(await outbox.claim({ nodeId: 'node-a', limit: 5, claimTtlMs: 60_000, now: NOW })).toHaveLength(1);
        await outbox.reap({ claimTtlMs: 60_000, now: NOW });

        expect(calls.filter((c) => c.verb === 'find')).toHaveLength(2);
        expect(calls.filter((c) => c.verb === 'update')).toHaveLength(3);
        expect(calls.every((c) => c.object === 'sys_http_delivery')).toBe(true);
        expectAllSystem(calls);
    });
});

describe('[#21913] the emit fan-out carries the explicit system opt-in', () => {
    it('writeEvent, resolveEmail, the preference reads and the inbox send (locale read, row, receipt)', async () => {
        const { engine, calls } = recordingEngine((verb, object, query) => {
            if (verb === 'findOne' && object === 'sys_user' && query?.where?.email) return { id: 'usr_ada' };
            if (verb === 'findOne' && object === 'sys_user') return { locale: 'ja-JP' };
            return verb === 'find' ? [] : null;
        });
        const service = new MessagingService({ logger: silentLogger(), getData: () => engine } as any);
        service.registerChannel(createInboxChannel({
            getData: () => engine,
            // The template path is the one that reads the recipient's locale.
            getEmail: () => ({
                renderTemplate: async () => ({ subject: 'subject', text: 'body' }),
            }) as any,
            getDefaultTemplateLocale: () => 'en-US',
        }));

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['ada@example.com'],
            channels: ['inbox'],
            payload: { template: 'deal_won' },
        } as any);
        expect(result.delivered).toBe(1);

        // The population first: every producer this pin names actually ran.
        const seen = calls.map((c) => `${c.verb}:${c.object}`);
        expect(seen).toEqual(expect.arrayContaining([
            'insert:sys_notification',
            'findOne:sys_user',
            'find:sys_notification_preference',
            'insert:sys_inbox_message',
            'insert:sys_notification_receipt',
        ]));
        expect(calls.filter((c) => c.object === 'sys_user')).toHaveLength(2); // address + locale
        expect(calls.filter((c) => c.object === 'sys_notification_preference')).toHaveLength(2);
        expectAllSystem(calls);
    });
});

// ---------------------------------------------------------------------------
// [#21908] Stage 1 of the closure: the producers the services-lane slice left.
// ---------------------------------------------------------------------------

/** Plain-equality `where` over seeded rows — anything else is refused, loudly. */
function matchRows(rows: Array<Record<string, unknown>>, where: Record<string, unknown> = {}) {
    return rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`recording engine: unimplemented combinator ${k}`);
        return (r[k] ?? null) === (v ?? null);
    }));
}

const USER_SCOPED = new Set(['sys_inbox_message', 'sys_notification_receipt']);

/**
 * Two users' inbox rows and receipts, and the events they are about. Every read
 * answers only what its `where` selects, so a call that dropped its `user_id`
 * term would be answered the other user's rows — and the negative pin sees it.
 */
function twoUserInbox() {
    const rows: Record<string, Array<Record<string, unknown>>> = {
        sys_inbox_message: [
            { id: 'm1', user_id: 'u_a', notification_id: 'n1', topic: 't', title: 'a1', created_at: '2026-01-03' },
            { id: 'm2', user_id: 'u_b', notification_id: 'n2', topic: 't', title: 'b1', created_at: '2026-01-02' },
            { id: 'm3', user_id: 'u_a', notification_id: 'n3', topic: 't', title: 'a2', created_at: '2026-01-01' },
        ],
        sys_notification_receipt: [
            { id: 'r1', notification_id: 'n1', user_id: 'u_a', channel: 'inbox', state: 'delivered' },
            { id: 'r2', notification_id: 'n2', user_id: 'u_b', channel: 'inbox', state: 'delivered' },
        ],
        sys_notification: [
            { id: 'n1', organization_id: 'org_1' },
            { id: 'n2', organization_id: 'org_2' },
            { id: 'n3', organization_id: 'org_1' },
        ],
    };
    return recordingEngine((verb, object, query) => {
        const hits = matchRows(rows[object] ?? [], query?.where);
        return verb === 'find' ? hits : (hits[0] ?? null);
    });
}

async function driveInboxAs(engine: any, userId: string) {
    const service = new MessagingService({ logger: silentLogger(), getData: () => engine } as any);
    // A saturated window, so `countUnreadTotal` runs too.
    const listed = await service.listInbox(userId, { limit: 2 });
    // n1 has a receipt (the update branch); n3 has none (the insert branch,
    // which reads the event's organization).
    await service.markRead(userId, ['n1']);
    await service.markRead(userId, ['n3']);
    const swept = await service.markAllRead(userId);
    return { listed, swept };
}

describe('[#21908] Q1 — the inbox read-state producers: the opt-in inside the service, the door-derived user scope kept', () => {
    it('every call carries isSystem, and every call on the user’s rows carries the user id in its where or its stamp', async () => {
        const { engine, calls } = twoUserInbox();
        const { listed } = await driveInboxAs(engine, 'u_a');
        expect(listed.notifications.map((n) => n.id)).toEqual(['n1', 'n3']);

        // The population first: every producer the ruling names actually ran —
        // listInbox's window and countUnreadTotal, readReceiptStates,
        // unreadNotificationIds, upsertReadReceipt's read, update and insert,
        // and notificationOrganization.
        const seen = (verb: string, object: string) => calls.filter((c) => c.verb === verb && c.object === object);
        expect(seen('find', 'sys_inbox_message').length).toBeGreaterThanOrEqual(3);
        expect(seen('find', 'sys_notification_receipt').length).toBeGreaterThanOrEqual(2);
        expect(seen('findOne', 'sys_notification_receipt').length).toBeGreaterThanOrEqual(2);
        // (The double keeps no write state, so mark-all-read re-flips n1 and
        // re-inserts n3's receipt: each branch runs at least once.)
        expect(seen('update', 'sys_notification_receipt').length).toBeGreaterThanOrEqual(1);
        expect(seen('insert', 'sys_notification_receipt').length).toBeGreaterThanOrEqual(1);
        expect(seen('findOne', 'sys_notification').length).toBeGreaterThanOrEqual(1);
        expectAllSystem(calls);

        // Reads of the user's rows: keyed on the door-derived user id.
        for (const c of calls.filter((x) => (x.verb === 'find' || x.verb === 'findOne') && USER_SCOPED.has(x.object))) {
            expect(c.query?.where?.user_id, `${c.verb} on ${c.object}`).toBe('u_a');
        }
        // The receipt it inserts: stamped with it.
        for (const insert of seen('insert', 'sys_notification_receipt')) {
            expect(insert.data).toMatchObject({ user_id: 'u_a', notification_id: 'n3', organization_id: 'org_1' });
        }
        // The receipt it updates: addressed by an id a user-keyed read returned, and by nothing else.
        const returnedIds = seen('findOne', 'sys_notification_receipt').map((c) => (c.answered as any)?.id).filter(Boolean);
        for (const update of seen('update', 'sys_notification_receipt')) {
            expect(update.options.where).toEqual({ id: 'r1' });
        }
        expect(returnedIds).toContain('r1');
        // The event read: one row by id, two columns, used only as the stamp.
        for (const event of seen('findOne', 'sys_notification')) {
            expect(event.query).toEqual({ where: { id: 'n3' }, fields: ['id', 'organization_id'] });
        }
    });

    it('⛔ negative: no call made for one user reads, writes or addresses another user’s rows', async () => {
        const { engine, calls } = twoUserInbox();
        await driveInboxAs(engine, 'u_a');

        // Every row any read answered belongs to the caller…
        for (const c of calls.filter((x) => USER_SCOPED.has(x.object) && (x.verb === 'find' || x.verb === 'findOne'))) {
            const answered = c.verb === 'find' ? (c.answered as any[]) : [c.answered].filter(Boolean);
            for (const row of answered) expect(row.user_id, `${c.verb} on ${c.object}`).toBe('u_a');
        }
        // …and nothing is written as, or onto, u_b: not their receipt r2, not their inbox row.
        for (const c of calls.filter((x) => x.verb === 'insert' || x.verb === 'update')) {
            expect(c.data?.user_id ?? 'u_a').toBe('u_a');
            expect(c.options?.where?.id).not.toBe('r2');
        }
    });
});

describe('[#21908] Q2 — `owner_of:` carries the opt-in, reads only the owner fields, and yields only recipient ids', () => {
    it('resolveOwnerOf: isSystem, a projection of id plus the owner fields, and the owner id alone back', async () => {
        const { engine, calls } = recordingEngine((verb, object) =>
            verb === 'findOne' && object === 'deal'
                ? { id: 'd1', owner_id: 'u_owner', name: 'Confidential deal', amount: 900_000 }
                : null);
        const resolver = new RecipientResolver({ getData: () => engine, logger: silentLogger() });

        const ids = await resolver.resolve(['owner_of:deal:d1', { ownerOf: { object: 'deal', id: 'd1' } } as any]);

        // Only the recipient id leaves the resolver — never a value the record carried.
        expect(ids).toEqual(['u_owner']);
        const reads = calls.filter((c) => c.object === 'deal');
        expect(reads).toHaveLength(2);
        for (const read of reads) {
            expect(read.context).toEqual({ isSystem: true });
            expect(read.query).toEqual({
                where: { id: 'd1' },
                fields: ['id', 'owner_id', 'assigned_to', 'assignee_id', 'owner', 'assignee'],
            });
        }
    });

    it('nothing the read returns reaches the emitter: emit() answers recipient ids and counts only', async () => {
        const { engine } = recordingEngine((verb, object) =>
            verb === 'findOne' && object === 'deal'
                ? { id: 'd1', owner_id: 'u_owner', name: 'Confidential deal' }
                : (verb === 'find' ? [] : null));
        const service = new MessagingService({ logger: silentLogger(), getData: () => engine } as any);
        service.registerChannel(createInboxChannel({ getData: () => engine }));

        const result = await service.emit({ topic: 'deal.won', audience: ['owner_of:deal:d1'], channels: ['inbox'], title: 't', body: 'b' } as any);

        expect(result.delivered).toBe(1);
        expect(JSON.stringify(result)).not.toContain('Confidential deal');
    });
});

describe('[#21908] rows 24 onward — the remaining fan-out and outbox calls carry the explicit system opt-in', () => {
    it('resolveRole and resolveTeam', async () => {
        const { engine, calls } = recordingEngine((verb) => (verb === 'find' ? [{ user_id: 'u1' }] : null));
        const resolver = new RecipientResolver({ getData: () => engine, logger: silentLogger() });
        expect(await resolver.resolve(['role:admin', 'team:t1'], { organizationId: 'org_1' })).toEqual(['u1']);
        expect(calls.map((c) => c.object)).toEqual(['sys_member', 'sys_team_member']);
        expectAllSystem(calls);
    });

    it('emit()’s dedup lookup', async () => {
        const { engine, calls } = recordingEngine((verb, object, query) =>
            verb === 'findOne' && object === 'sys_notification' && query?.where?.dedup_key ? { id: 'n_prior' } : null);
        const service = new MessagingService({ logger: silentLogger(), getData: () => engine } as any);
        const result = await service.emit({ topic: 't', audience: ['u1'], channels: ['inbox'], dedupKey: 'k1', title: 't', body: 'b' } as any);
        expect(result).toMatchObject({ notificationId: 'n_prior', deduped: true });
        expect(calls).toHaveLength(1);
        expectAllSystem(calls);
    });

    it('SqlNotificationOutbox: enqueue (dedup read, insert, race read-back), ack (state read, CAS write, read-back) and list', async () => {
        let inserted = false;
        const { engine, calls } = recordingEngine((verb, _object, query) => {
            if (verb === 'findOne' && query?.where?.notification_id) return inserted ? { id: 'd_winner' } : null;
            if (verb === 'findOne' && Array.isArray(query?.fields) && query.fields.includes('claimed_by')) {
                return { status: 'in_flight', attempts: 0, claimed_by: 'node-a', claimed_at: NOW };
            }
            if (verb === 'findOne') return { status: 'success', attempts: 1 };
            return [];
        });
        // The insert loses a dedup race once, so the winner read-back runs too.
        const realInsert = engine.insert;
        engine.insert = async (...args: any[]) => { await realInsert(...args); inserted = true; throw new Error('unique violation'); };
        const outbox = new SqlNotificationOutbox(engine, { partitionCount: 1 });

        expect(await outbox.enqueue({ notificationId: 'n1', recipientId: 'u1', channel: 'inbox' } as any)).toBe('d_winner');
        await outbox.ack({ id: 'd1', claimedBy: 'node-a', claimedAt: NOW } as any, { success: true } as any);
        await outbox.list({ status: 'success' });

        expect(calls.map((c) => c.verb)).toEqual(['findOne', 'insert', 'findOne', 'findOne', 'update', 'findOne', 'find']);
        expectAllSystem(calls);
    });

    it('SqlHttpOutbox: enqueue and recordUndeliverable, ack (both arities) and list', async () => {
        const { engine, calls } = recordingEngine((verb, _object, query) => {
            if (verb === 'findOne' && query?.where?.dedup_key) return null;
            if (verb === 'findOne' && Array.isArray(query?.fields) && query.fields.includes('claimed_by')) {
                return { status: 'in_flight', attempts: 0, claimed_by: 'node-a', claimed_at: NOW };
            }
            if (verb === 'findOne' && Array.isArray(query?.fields) && query.fields.length === 1) return { attempts: 0 };
            if (verb === 'findOne') return { status: 'success', attempts: 1 };
            return [];
        });
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 1 });
        const base = { source: 'webhook', refId: 'wh1', url: 'https://example.test/hook', payload: {} };

        await outbox.enqueue({ ...base, dedupKey: 'k1' } as any);
        await outbox.recordUndeliverable({ ...base, dedupKey: 'k2', reason: 'no secret' } as any);
        await outbox.ack('h1', { success: true } as any, { claimedBy: 'node-a', claimedAt: NOW } as any);
        await outbox.ack('h2', { success: false, error: 'x' } as any);
        await outbox.list({ source: 'webhook' });

        expect(calls.map((c) => c.verb)).toEqual([
            'findOne', 'insert', 'findOne', 'insert', // enqueue, recordUndeliverable
            'findOne', 'update', 'findOne', // the credentialed ack
            'findOne', 'update', // the by-id ack
            'find', // list
        ]);
        expect(calls.every((c) => c.object === 'sys_http_delivery')).toBe(true);
        expectAllSystem(calls);
    });

    it('the email and SMS recipient reads — the first read and the address-only retry — and the template read', async () => {
        let failFirst = true;
        const { engine, calls } = recordingEngine((verb, object, query) => {
            if (verb !== 'findOne') return [];
            if (object === 'sys_user' && failFirst && query?.fields?.length === 2) {
                failFirst = false;
                throw new Error('no locale column');
            }
            if (object === 'sys_user') return { email: 'ada@example.com', phone_number: '+15555550100' };
            return null;
        });
        const store = new NotificationTemplateStore({ getData: () => engine });
        const email = createEmailChannel({ getEmail: () => ({ async send() { return { id: 'e1' }; } }) as any, getData: () => engine, store });
        const sms = createSmsChannel({ getSms: () => ({ async send() { return { id: 's1' }; } }) as any, getData: () => engine, store });
        const notification = { title: 't', body: 'b', recipients: ['u1'], topic: 'deal.won' };

        expect((await email.send({ logger: silentLogger() }, { notification, channel: 'email', recipient: 'u1' } as any)).ok).toBe(true);
        expect((await sms.send({ logger: silentLogger() }, { notification, channel: 'sms', recipient: 'u1' } as any)).ok).toBe(true);

        // email: failed read + retry; sms: one read; and the template reads.
        expect(calls.filter((c) => c.object === 'sys_user')).toHaveLength(3);
        expect(calls.filter((c) => c.object === 'sys_notification_template').length).toBeGreaterThanOrEqual(2);
        expectAllSystem(calls);
    });
});

describe('[#21908] SqlHttpOutbox.redeliver carries the explicit system opt-in beside its threaded tenant', () => {
    /** A terminal, genuinely-attempted row on the first read; `pending` on the read-back. */
    function redeliverEngine() {
        let reads = 0;
        return recordingEngine((verb) => {
            if (verb !== 'findOne') return [];
            reads += 1;
            return {
                id: 'h1', source: 'webhook', ref_id: 'wh1', dedup_key: 'k1', url: 'https://example.test/hook',
                payload_json: '{}', signature: 'sig', organization_id: 'org_a', partition_key: 0,
                status: reads === 1 ? 'dead' : 'pending', attempts: reads === 1 ? 2 : 0,
                created_at: NOW, updated_at: NOW,
            };
        });
    }

    it('both reads and the reset write: isSystem, the caller’s tenantId on the bag, and the audit stated armed', async () => {
        const { engine, calls } = redeliverEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 1 });

        const row = await outbox.redeliver('h1', { tenantId: 'org_a' });
        expect(row.status).toBe('pending');

        expect(calls.map((c) => c.verb)).toEqual(['findOne', 'update', 'findOne']);
        expect(calls.every((c) => c.object === 'sys_http_delivery')).toBe(true);
        expectAllSystem(calls);
        // The scope stays the driver-level tenant on every call, never moved
        // into the context and never dropped.
        expect(calls[0].query).toMatchObject({ where: { id: 'h1' }, tenantId: 'org_a' });
        expect(calls[2].query).toMatchObject({ where: { id: 'h1' }, tenantId: 'org_a' });
        expect(calls[1].options).toMatchObject({
            where: { id: 'h1', status: { $in: ['success', 'failed', 'dead'] } },
            multi: true,
            tenantId: 'org_a',
            bypassTenantAudit: false,
        });
    });

    it('⛔ a caller with no tenant gets no tenant invented, and still no audit bypass', async () => {
        const { engine, calls } = redeliverEngine();
        const outbox = new SqlHttpOutbox(engine, { partitionCount: 1 });

        await outbox.redeliver('h1', { tenantId: undefined });

        expectAllSystem(calls);
        for (const c of calls) {
            const bag = c.verb === 'update' ? c.options : c.query;
            expect(bag).toHaveProperty('tenantId', undefined);
        }
        expect(calls[1].options.bypassTenantAudit).toBe(false);
    });
});
