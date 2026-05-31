// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createInboxChannel, INBOX_OBJECT } from './inbox-channel.js';
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

/** A fake data engine capturing inserts. */
function fakeData(insertImpl?: (obj: string, row: any) => any) {
    const inserts: Array<{ object: string; row: any }> = [];
    return {
        inserts,
        engine: {
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                return insertImpl ? insertImpl(object, row) : { id: 'inbox_1', ...row };
            },
            async find() { return []; },
            async findOne() { return null; },
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
        expect(data.inserts).toHaveLength(1);
        expect(data.inserts[0].object).toBe(INBOX_OBJECT);
        expect(data.inserts[0].row).toEqual({
            user_id: 'user_42',
            topic: 'deal.won',
            title: 'Deal closed',
            body_md: 'Acme signed 🎉',
            severity: 'info',
            action_url: '/opportunities/42',
            read: false,
            created_at: '2026-06-01T00:00:00.000Z',
        });
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
});
