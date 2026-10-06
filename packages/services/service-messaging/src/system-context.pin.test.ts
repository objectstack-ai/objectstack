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
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

type Call = { verb: string; object: string; context: unknown };

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
            calls.push({ verb: 'find', object, context: ctxOf(query, options) });
            return (answer('find', object, query) as unknown[]) ?? [];
        },
        async findOne(object: string, query: any, options?: any) {
            assertEngineFindOnePredicate(object, query);
            calls.push({ verb: 'findOne', object, context: ctxOf(query, options) });
            return answer('findOne', object, query) ?? null;
        },
        async insert(object: string, data: Record<string, unknown>, options?: any) {
            calls.push({ verb: 'insert', object, context: options?.context });
            return { id: `${object}_1`, ...data };
        },
        async update(object: string, data: Record<string, unknown>, options?: any) {
            assertEngineUpdateDispatch(data, options);
            calls.push({ verb: 'update', object, context: options?.context });
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
