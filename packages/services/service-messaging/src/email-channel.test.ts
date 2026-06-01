// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createEmailChannel } from './email-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import type { Delivery } from './channel.js';

function silentCtx() {
    return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
}

function delivery(over: Partial<Delivery['notification']> = {}, recipient = 'user_1'): Delivery {
    return {
        channel: 'email',
        recipient,
        notification: {
            notificationId: 'evt_1',
            topic: 'deal.won',
            title: 'Deal closed',
            body: 'Acme signed',
            severity: 'info',
            recipients: [recipient],
            payload: { title: 'Deal closed', body: 'Acme signed' },
            ...over,
        },
    };
}

/** Fake data engine: user id → email, and template lookups. */
function fakeData(opts: { users?: Record<string, string>; templates?: any[] } = {}) {
    const users = opts.users ?? { user_1: 'ada@example.com' };
    const templates = opts.templates ?? [];
    return {
        async findOne(object: string, query: any) {
            const w = query?.where ?? {};
            if (object === 'sys_user') {
                const email = users[String(w.id)];
                return email ? { email } : null;
            }
            if (object === 'sys_notification_template') {
                return templates.find((t) => t.topic === w.topic && t.channel === w.channel && t.locale === w.locale && t.is_active) ?? null;
            }
            return null;
        },
        async find() { return []; },
        async insert(_o: string, r: any) { return { id: 'x', ...r }; },
        async update() { return {}; },
        async delete() { return {}; },
        async count() { return 0; },
        async aggregate() { return []; },
    } as any;
}

function fakeEmail() {
    const sent: any[] = [];
    return {
        sent,
        service: {
            async send(input: any) {
                sent.push(input);
                return { id: 'email_row_1' };
            },
        },
    };
}

function channel(getEmail: () => any, data: any, templates: any[] = []) {
    const store = new NotificationTemplateStore({ getData: () => data });
    return createEmailChannel({ getEmail, getData: () => data, store: store });
}

describe('email channel', () => {
    it('has the stable id "email"', () => {
        const ch = channel(() => undefined, fakeData());
        expect(ch.id).toBe('email');
    });

    it('no-ops (success) when no email service is registered', async () => {
        const ch = channel(() => undefined, fakeData());
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(true);
        expect(r.externalId).toBeUndefined();
    });

    it('resolves the recipient user id → email and sends the fallback subject/body', async () => {
        const email = fakeEmail();
        const ch = channel(() => email.service, fakeData({ users: { user_1: 'ada@example.com' } }));
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(true);
        expect(r.externalId).toBe('email_row_1');
        expect(email.sent).toHaveLength(1);
        expect(email.sent[0]).toEqual({ to: 'ada@example.com', subject: 'Deal closed', text: 'Acme signed' });
    });

    it('renders an HTML template when one exists for (topic, email, locale)', async () => {
        const email = fakeEmail();
        const data = fakeData({
            users: { user_1: 'ada@example.com' },
            templates: [{ topic: 'deal.won', channel: 'email', locale: 'en', is_active: true, subject: 'Won {{ payload.title }}', body: '<h1>{{ payload.title }}</h1>', format: 'html' }],
        });
        const ch = channel(() => email.service, data);
        await ch.send(silentCtx(), delivery());
        expect(email.sent[0]).toEqual({ to: 'ada@example.com', subject: 'Won Deal closed', html: '<h1>Deal closed</h1>' });
    });

    it('accepts an email-shaped recipient verbatim (no user lookup)', async () => {
        const email = fakeEmail();
        const ch = channel(() => email.service, fakeData({ users: {} }));
        const r = await ch.send(silentCtx(), delivery({}, 'bob@example.com'));
        expect(r.ok).toBe(true);
        expect(email.sent[0].to).toBe('bob@example.com');
    });

    it('reports a failure when no address resolves (observable on the delivery row)', async () => {
        const email = fakeEmail();
        const ch = channel(() => email.service, fakeData({ users: {} }));
        const r = await ch.send(silentCtx(), delivery({}, 'ghost'));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/no email address/);
        expect(email.sent).toHaveLength(0);
    });

    it('surfaces a transport failure as ok:false (dispatcher will retry)', async () => {
        const data = fakeData();
        const ch = createEmailChannel({
            getEmail: () => ({ async send() { throw new Error('smtp down'); } }),
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
        });
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(false);
        expect(r.error).toContain('smtp down');
        expect(ch.classifyError?.(new Error('x'))).toBe('retryable');
    });
});
