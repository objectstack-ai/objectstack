// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createSmsChannel } from './sms-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import type { Delivery } from './channel.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

function silentCtx() {
    return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
}

function delivery(over: Partial<Delivery['notification']> = {}, recipient = 'user_1'): Delivery {
    return {
        channel: 'sms',
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

/** A `sys_user` row as the channel reads it: number plus (#13881) the user's own locale. */
type FakeUser = string | { phone_number: string; locale?: unknown };

/** Fake data engine: user id → phone_number (+ locale), and template lookups. */
function fakeData(opts: { users?: Record<string, FakeUser>; templates?: any[] } = {}) {
    const users = opts.users ?? { user_1: '+8613800000000' };
    const templates = opts.templates ?? [];
    const findOnes: Array<{ object: string; query: any }> = [];
    return {
        findOnes,
        async findOne(object: string, query: any) {
            assertEngineFindOnePredicate(object, query);
            findOnes.push({ object, query });
            const w = query?.where ?? {};
            if (object === 'sys_user') {
                const user = users[String(w.id)];
                if (!user) return null;
                return typeof user === 'string' ? { phone_number: user } : { ...user };
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

function fakeSms() {
    const sent: any[] = [];
    return {
        sent,
        service: {
            async send(input: any) {
                sent.push(input);
                return { id: 'sms_1', status: 'sent', messageId: 'prov_1' };
            },
        },
    };
}

function channel(getSms: () => any, data: any) {
    const store = new NotificationTemplateStore({ getData: () => data });
    return createSmsChannel({ getSms, getData: () => data, store });
}

describe('sms channel', () => {
    it('has the stable id "sms"', () => {
        const ch = channel(() => undefined, fakeData());
        expect(ch.id).toBe('sms');
    });

    it('no-ops (success) when no sms service is registered', async () => {
        const ch = channel(() => undefined, fakeData());
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(true);
        expect(r.externalId).toBeUndefined();
    });

    it('resolves the recipient user id → phone_number and sends the fallback body', async () => {
        const sms = fakeSms();
        const ch = channel(() => sms.service, fakeData({ users: { user_1: '+8613800000000' } }));
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(true);
        expect(r.externalId).toBe('prov_1');
        expect(sms.sent).toHaveLength(1);
        expect(sms.sent[0].to).toBe('+8613800000000');
        expect(sms.sent[0].body).toBe('Acme signed');
        expect(sms.sent[0].templateParams).toEqual({ content: 'Acme signed' });
    });

    it('renders a text template when one exists for (topic, sms, locale)', async () => {
        const sms = fakeSms();
        const data = fakeData({
            templates: [{ topic: 'deal.won', channel: 'sms', locale: 'en', is_active: true, subject: 'Won', body: 'Won: {{ payload.title }}', format: 'text' }],
        });
        const ch = channel(() => sms.service, data);
        await ch.send(silentCtx(), delivery());
        expect(sms.sent[0].body).toBe('Won: Deal closed');
    });

    // ── #13881 — per-recipient locale, the same chain the email channel
    // resolves (`recipient-locale.ts`): the recipient's own `sys_user.locale`,
    // else the deployment default, read off the SAME row as the number.
    describe('per-recipient locale (#13881)', () => {
        const rows = [
            { topic: 'deal.won', channel: 'sms', locale: 'en', is_active: true, subject: 'Won', body: 'Won: {{ payload.title }}', format: 'text' },
            { topic: 'deal.won', channel: 'sms', locale: 'zh', is_active: true, subject: '成交', body: '成交: {{ payload.title }}', format: 'text' },
            { topic: 'deal.won', channel: 'sms', locale: 'ja-JP', is_active: true, subject: '成約', body: '成約: {{ payload.title }}', format: 'text' },
        ];

        it("rung 1: the recipient's own sys_user.locale picks the row (zh-CN walks the store ladder to `zh`)", async () => {
            const sms = fakeSms();
            const data = fakeData({ users: { user_1: { phone_number: '+8613800000000', locale: 'zh-CN' } }, templates: rows });
            const ch = createSmsChannel({ getSms: () => sms.service, getData: () => data, store: new NotificationTemplateStore({ getData: () => data }), getDefaultTemplateLocale: () => 'ja-JP' });
            await ch.send(silentCtx(), delivery());
            expect(sms.sent[0].body).toBe('成交: Deal closed');
            // One row read, both columns — no second read point.
            const userReads = data.findOnes.filter((q) => q.object === 'sys_user');
            expect(userReads).toHaveLength(1);
            expect(userReads[0].query).toEqual({ where: { id: 'user_1' }, fields: ['phone_number', 'locale'] });
        });

        it('rung 2: a recipient without one falls to the deployment default', async () => {
            const sms = fakeSms();
            const data = fakeData({ users: { user_1: { phone_number: '+8613800000000' } }, templates: rows });
            const ch = createSmsChannel({ getSms: () => sms.service, getData: () => data, store: new NotificationTemplateStore({ getData: () => data }), getDefaultTemplateLocale: () => 'ja-JP' });
            await ch.send(silentCtx(), delivery());
            expect(sms.sent[0].body).toBe('成約: Deal closed');
        });

        it('dead-letter pin: the literal "undefined" falls to the deployment default; nothing named lands on the `en` floor', async () => {
            const sms = fakeSms();
            const data = fakeData({ users: { user_1: { phone_number: '+8613800000000', locale: 'undefined' } }, templates: rows });
            await createSmsChannel({ getSms: () => sms.service, getData: () => data, store: new NotificationTemplateStore({ getData: () => data }), getDefaultTemplateLocale: () => 'ja-JP' }).send(silentCtx(), delivery());
            expect(sms.sent[0].body).toBe('成約: Deal closed');
            await channel(() => sms.service, data).send(silentCtx(), delivery());
            expect(sms.sent[1].body).toBe('Won: Deal closed');
        });

        it('a producer-set payload.locale is NOT consulted', async () => {
            const sms = fakeSms();
            const data = fakeData({ users: { user_1: { phone_number: '+8613800000000', locale: 'zh-CN' } }, templates: rows });
            await channel(() => sms.service, data).send(silentCtx(), delivery({ payload: { title: 'Deal closed', body: 'Acme signed', locale: 'ja-JP' } }));
            expect(sms.sent[0].body).toBe('成交: Deal closed');
        });

        it('a failing locale read costs the language, never the delivery (ruling item 3)', async () => {
            const sms = fakeSms();
            const base = fakeData({ users: { user_1: { phone_number: '+8613800000000', locale: 'zh-CN' } }, templates: rows });
            const data = {
                ...base,
                async findOne(object: string, query: any) {
                    if (object === 'sys_user' && (query?.fields ?? []).includes('locale')) throw new Error("Unknown field 'locale'");
                    return base.findOne(object, query);
                },
            };
            const r = await createSmsChannel({ getSms: () => sms.service, getData: () => data, store: new NotificationTemplateStore({ getData: () => data }), getDefaultTemplateLocale: () => 'ja-JP' }).send(silentCtx(), delivery());
            expect(r.ok).toBe(true);
            expect(sms.sent[0].to).toBe('+8613800000000');
            expect(sms.sent[0].body).toBe('成約: Deal closed');
        });
    });

    it('accepts a phone-shaped recipient verbatim (no user lookup)', async () => {
        const sms = fakeSms();
        const ch = channel(() => sms.service, fakeData({ users: {} }));
        const r = await ch.send(silentCtx(), delivery({}, '+15005550006'));
        expect(r.ok).toBe(true);
        expect(sms.sent[0].to).toBe('+15005550006');
    });

    it('falls back to the title when the notification has no body', async () => {
        const sms = fakeSms();
        const ch = channel(() => sms.service, fakeData());
        const r = await ch.send(silentCtx(), delivery({ body: '', payload: { title: 'Deal closed' } }));
        expect(r.ok).toBe(true);
        expect(sms.sent[0].body).toBe('Deal closed');
    });

    it('reports a failure when no phone number resolves (observable on the delivery row)', async () => {
        const sms = fakeSms();
        const ch = channel(() => sms.service, fakeData({ users: {} }));
        const r = await ch.send(silentCtx(), delivery({}, 'ghost'));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/no phone number/);
        expect(sms.sent).toHaveLength(0);
    });

    it('surfaces a failed send result as ok:false (dispatcher will retry)', async () => {
        const data = fakeData();
        const ch = createSmsChannel({
            getSms: () => ({ async send() { return { status: 'failed', error: 'provider down' }; } }),
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
        });
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(false);
        expect(r.error).toContain('provider down');
    });

    it('surfaces a transport throw as ok:false', async () => {
        const data = fakeData();
        const ch = createSmsChannel({
            getSms: () => ({ async send() { throw new Error('gateway timeout'); } }),
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
        });
        const r = await ch.send(silentCtx(), delivery());
        expect(r.ok).toBe(false);
        expect(r.error).toContain('gateway timeout');
        expect(ch.classifyError?.(new Error('x'))).toBe('retryable');
    });

    describe('daily SMS quota exhaustion is rate_limited, not retryable (#2814)', () => {
        /** Exactly what `SmsService.send` returns once the day's budget is spent. */
        const QUOTA_REFUSAL = { id: 'sms-1', status: 'failed', error: 'TOO_MANY_REQUESTS: daily SMS quota exhausted' };

        it('reports ok:false so the delivery lands in the outbox rather than being dropped', async () => {
            const data = fakeData();
            const ch = createSmsChannel({
                getSms: () => ({ async send() { return QUOTA_REFUSAL; } }),
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            const r = await ch.send(silentCtx(), delivery());
            expect(r.ok).toBe(false);
            expect(r.error).toContain('TOO_MANY_REQUESTS');
            // The dispatcher hands `SendResult.error` — a string — to classifyError.
            expect(ch.classifyError?.(r.error)).toBe('rate_limited');
        });

        it('classifies a thrown quota error the same way', () => {
            const data = fakeData();
            const ch = createSmsChannel({
                getSms: () => ({ async send() { return QUOTA_REFUSAL; } }),
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            expect(ch.classifyError?.(new Error('sms send failed: TOO_MANY_REQUESTS: daily SMS quota exhausted')))
                .toBe('rate_limited');
            // Everything else stays retryable — a transport hiccup is not a wall.
            expect(ch.classifyError?.('sms send failed: gateway timeout')).toBe('retryable');
            expect(ch.classifyError?.(undefined)).toBe('retryable');
        });
    });
});
