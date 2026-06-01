// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
import type { Delivery } from './channel.js';

function silentCtx() {
    return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
}

function delivery(overrides: Partial<Delivery['notification']> = {}, recipient = 'user_1'): Delivery {
    return {
        channel: 'inbox',
        recipient,
        notification: {
            topic: 'deal.won',
            title: 'Deal closed',
            body: 'Acme signed 🎉',
            severity: 'info',
            actionUrl: '/opportunities/42',
            recipients: [recipient],
            ...overrides,
        },
    };
}

/** A fake data engine capturing inserts (and optionally answering findOne). */
function fakeData(
    insertImpl?: (obj: string, row: any) => any,
    findOneImpl?: (obj: string, query: any) => any,
) {
    const inserts: Array<{ object: string; row: any }> = [];
    const findOnes: Array<{ object: string; query: any }> = [];
    return {
        inserts,
        findOnes,
        engine: {
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                return insertImpl ? insertImpl(object, row) : { id: 'inbox_1', ...row };
            },
            async find() { return []; },
            async findOne(object: string, query: any) {
                findOnes.push({ object, query });
                return findOneImpl ? findOneImpl(object, query) : null;
            },
            async update() { return {}; },
            async delete() { return {}; },
        } as any,
    };
}

describe('inbox channel', () => {
    it('has the stable id "inbox"', () => {
        const ch = createInboxChannel({ getData: () => undefined });
        expect(ch.id).toBe('inbox');
    });

    it('writes one sys_inbox_message row keyed by the recipient', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine, now: () => '2026-06-01T00:00:00.000Z' });

        const result = await ch.send(silentCtx(), delivery({}, 'user_42'));

        expect(result.ok).toBe(true);
        expect(result.externalId).toBe('inbox_1');
        // No notificationId on this delivery → no receipt; just the inbox row.
        expect(data.inserts).toHaveLength(1);
        expect(data.inserts[0].object).toBe(INBOX_OBJECT);
        expect(data.inserts[0].row).toEqual({
            user_id: 'user_42',
            notification_id: null,
            topic: 'deal.won',
            title: 'Deal closed',
            body_md: 'Acme signed 🎉',
            severity: 'info',
            action_url: '/opportunities/42',
            organization_id: null,
            created_at: '2026-06-01T00:00:00.000Z',
        });
    });

    it('writes the inbox row + a delivered receipt when the event id is present', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine, now: () => '2026-06-01T00:00:00.000Z' });

        await ch.send(
            silentCtx(),
            delivery({ notificationId: 'evt_9', organizationId: 'org_1' }, 'user_42'),
        );

        expect(data.inserts.map((i) => i.object)).toEqual([INBOX_OBJECT, RECEIPT_OBJECT]);
        expect(data.inserts[0].row).toMatchObject({
            user_id: 'user_42',
            notification_id: 'evt_9',
            organization_id: 'org_1',
        });
        expect(data.inserts[1].row).toEqual({
            notification_id: 'evt_9',
            delivery_id: null,
            user_id: 'user_42',
            channel: 'inbox',
            state: 'delivered',
            at: '2026-06-01T00:00:00.000Z',
            organization_id: 'org_1',
            created_at: '2026-06-01T00:00:00.000Z',
        });
    });

    it('still delivers the inbox row when the receipt write fails (best-effort)', async () => {
        let calls = 0;
        const ch = createInboxChannel({
            getData: () => fakeData((obj) => {
                calls += 1;
                if (obj === RECEIPT_OBJECT) throw new Error('receipt table locked');
                return { id: 'inbox_1' };
            }).engine,
            now: () => '2026-06-01T00:00:00.000Z',
        });
        const result = await ch.send(silentCtx(), delivery({ notificationId: 'evt_9' }, 'user_42'));
        expect(result.ok).toBe(true);
        expect(result.externalId).toBe('inbox_1');
        expect(calls).toBe(2); // inbox insert + attempted receipt insert
    });

    it('defaults severity to info when the notification omits it', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine });
        await ch.send(silentCtx(), delivery({ severity: undefined }));
        expect(data.inserts[0].row.severity).toBe('info');
    });

    it('honours an objectName override', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine, objectName: 'custom_inbox' });
        await ch.send(silentCtx(), delivery());
        expect(data.inserts[0].object).toBe('custom_inbox');
    });

    it('reports a no-op success (not a throw) when no data engine is registered', async () => {
        const ch = createInboxChannel({ getData: () => undefined });
        const result = await ch.send(silentCtx(), delivery());
        expect(result.ok).toBe(true);
        expect(result.externalId).toBeUndefined();
    });

    it('surfaces an insert failure as ok:false', async () => {
        const ch = createInboxChannel({
            getData: () => fakeData(() => { throw new Error('db down'); }).engine,
        });
        const result = await ch.send(silentCtx(), delivery());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('db down');
    });

    it('classifies errors as retryable', () => {
        const ch = createInboxChannel({ getData: () => undefined });
        expect(ch.classifyError?.(new Error('x'))).toBe('retryable');
    });

    // Recipients arrive pre-resolved to user ids (RecipientResolver, ADR-0030
    // P1) — the channel keys the row by `recipient` verbatim and does NOT do
    // its own identity lookup.
    it('keys the inbox row by the recipient verbatim, with no user lookup', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine });
        await ch.send(silentCtx(), delivery({}, 'usr_42'));
        expect(data.findOnes).toHaveLength(0);
        expect(data.inserts[0].row.user_id).toBe('usr_42');
    });
});
