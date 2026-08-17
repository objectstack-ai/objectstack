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

function channel(getEmail: () => any, data: any) {
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

    // ── #9205 — notify `template` references route through sendTemplate ─────
    describe('notify template path (#9205)', () => {
        /** Email service double whose sendTemplate records its calls. */
        function fakeTemplateEmail(result: any = { id: 'email_row_9', status: 'sent' }) {
            const sent: any[] = [];
            const templated: any[] = [];
            return {
                sent,
                templated,
                service: {
                    async send(input: any) { sent.push(input); return { id: 'email_row_1' }; },
                    async sendTemplate(input: any) {
                        templated.push(input);
                        if (result instanceof Error) throw result;
                        return result;
                    },
                },
            };
        }

        function templateDelivery(payload: Record<string, unknown>, recipient = 'user_1') {
            return delivery({
                // The notify executor sets no inline title/body on this path;
                // the messaging service defaults payload.title/notification
                // title from the topic. Mirror that shape.
                title: 'deal.won',
                body: '',
                payload,
            }, recipient);
        }

        it('resolves the recipient address and hands template + data + locale to sendTemplate — never send()', async () => {
            const email = fakeTemplateEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                getDefaultTemplateLocale: () => 'ja-JP',
            });
            const r = await ch.send(silentCtx(), templateDelivery({
                template: 'crm.large_deal_won',
                templateData: { dealName: 'Acme' },
            }));
            expect(r.ok).toBe(true);
            expect(r.externalId).toBe('email_row_9');
            expect(email.templated).toEqual([{
                template: 'crm.large_deal_won',
                to: 'ada@example.com',
                data: { dealName: 'Acme' },
                locale: 'ja-JP',
            }]);
            // The preservation half's negative face: the fallback/send path and
            // the sys_notification_template renderer were never consulted.
            expect(email.sent).toHaveLength(0);
        });

        it('a producer-supplied payload.locale wins over the deployment default', async () => {
            const email = fakeTemplateEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                getDefaultTemplateLocale: () => 'ja-JP',
            });
            await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won', locale: 'es-ES' }));
            expect(email.templated[0].locale).toBe('es-ES');
        });

        it('with no deployment default, no locale is passed — sendTemplate resolves its documented en-US default', async () => {
            const email = fakeTemplateEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won' }));
            expect(email.templated[0]).not.toHaveProperty('locale');
        });

        it('fails LOUDLY when the registered email service has no sendTemplate — no silent downgrade to unlocalized content', async () => {
            const email = fakeEmail(); // send() only, like an older implementation
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            const r = await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won' }));
            expect(r.ok).toBe(false);
            expect(r.error).toContain('TEMPLATE_UNSUPPORTED');
            expect(r.error).toContain('crm.large_deal_won');
            expect(email.sent).toHaveLength(0);
            // …and the failure is graded permanent: re-trying cannot grow the capability.
            expect(ch.classifyError?.(r.error)).toBe('permanent');
        });

        it("surfaces sendTemplate's own failure vocabulary and grades it permanent (metadata, not transport)", async () => {
            const email = fakeTemplateEmail(new Error('TEMPLATE_NOT_FOUND: crm.large_deal_won (locale=ja-JP)'));
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            const r = await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won' }));
            expect(r.ok).toBe(false);
            // The code stays at the FRONT of the delivery row's error — it is
            // what classifyError greps and what an operator searches for.
            expect(r.error).toMatch(/^TEMPLATE_NOT_FOUND/);
            expect(ch.classifyError?.(r.error)).toBe('permanent');
        });

        it("a sendTemplate result of status:'failed' (transport failure) reports ok:false and stays retryable", async () => {
            const email = fakeTemplateEmail({ id: 'row', status: 'failed', error: 'smtp down' });
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            const r = await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won' }));
            expect(r.ok).toBe(false);
            expect(r.error).toContain('smtp down');
            expect(ch.classifyError?.(r.error)).toBe('retryable');
        });

        it('a payload WITHOUT a template reference keeps the pre-#9205 path byte-identically', async () => {
            const email = fakeTemplateEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                getDefaultTemplateLocale: () => 'ja-JP',
            });
            const r = await ch.send(silentCtx(), delivery());
            expect(r.ok).toBe(true);
            expect(email.templated).toHaveLength(0);
            expect(email.sent[0]).toEqual({ to: 'ada@example.com', subject: 'Deal closed', text: 'Acme signed' });
        });
    });
});
