// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createEmailChannel } from './email-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import type { Delivery } from './channel.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

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

/** A `sys_user` row as the channel reads it: address plus (#13881) the user's own locale. */
type FakeUser = string | { email: string; locale?: unknown };

/** Fake data engine: user id → email (+ locale), and template lookups. */
function fakeData(opts: { users?: Record<string, FakeUser>; templates?: any[] } = {}) {
    const users = opts.users ?? { user_1: 'ada@example.com' };
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
                return typeof user === 'string' ? { email: user } : { ...user };
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

        it('a producer-set payload.locale is NOT consulted — the recipient chain decides (#13881)', async () => {
            // Until the 2026-09-01 ruling this pin read the other way: the
            // producer's single pre-fan-out value won over the deployment
            // default. The ruling retired that value; the recipient's own
            // column and the deployment default are the whole chain now.
            const email = fakeTemplateEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                getDefaultTemplateLocale: () => 'ja-JP',
            });
            await ch.send(silentCtx(), templateDelivery({ template: 'crm.large_deal_won', locale: 'es-ES' }));
            expect(email.templated[0].locale).toBe('ja-JP');
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

    // ── #13881 — the recipient locale is resolved PER RECIPIENT, after
    // fan-out. Maintainer ruling 2026-09-01: 「解析链 = 收件人 `locale` → 部署
    // 默认,缺失恒回退,⛔ 任何路径不得死信」. Every pin below asserts WHICH row
    // was picked for WHICH recipient (identity, not "old assertion gone"),
    // and the dead-letter pin refuses the literal "undefined" shape hotcrm
    // measured. The chain itself lives in `recipient-locale.ts` and is pinned
    // there; this block pins what the email channel does with it, on BOTH
    // arms (the notify `template` path and the sys_notification_template path).
    describe('per-recipient locale (#13881)', () => {
        function templateEmail() {
            const templated: any[] = [];
            return {
                templated,
                service: {
                    async send() { return { id: 'email_row_1' }; },
                    async sendTemplate(input: any) { templated.push(input); return { id: 'email_row_9', status: 'sent' }; },
                },
            };
        }
        const templated = (recipient = 'user_1') => delivery({
            title: 'deal.won',
            body: '',
            payload: { template: 'crm.large_deal_won', templateData: { dealName: 'Acme' } },
        }, recipient);
        function build(data: any, email: any, deploymentDefault?: string) {
            return createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                ...(deploymentDefault !== undefined ? { getDefaultTemplateLocale: () => deploymentDefault } : {}),
            });
        }

        it("rung 1: the recipient's own sys_user.locale picks the row, over the deployment default", async () => {
            const email = templateEmail();
            const data = fakeData({ users: { user_1: { email: 'ada@example.com', locale: 'zh-CN' } } });
            const r = await build(data, email, 'ja-JP').send(silentCtx(), templated());
            expect(r.ok).toBe(true);
            // Identity pin: the exact input the email service received.
            expect(email.templated).toEqual([{
                template: 'crm.large_deal_won',
                to: 'ada@example.com',
                data: { dealName: 'Acme' },
                locale: 'zh-CN',
            }]);
        });

        it('two recipients of ONE notification receive different rows — resolved after fan-out, not once for all', async () => {
            // The hotcrm pull: 4 published languages, every recipient got the
            // deployment default. Same notification, two deliveries, two rows.
            const email = templateEmail();
            const data = fakeData({ users: {
                ada: { email: 'ada@example.com', locale: 'zh-CN' },
                eve: { email: 'eve@example.com', locale: 'es-ES' },
            } });
            const ch = build(data, email, 'ja-JP');
            await ch.send(silentCtx(), templated('ada'));
            await ch.send(silentCtx(), templated('eve'));
            expect(email.templated.map((t) => [t.to, t.locale])).toEqual([
                ['ada@example.com', 'zh-CN'],
                ['eve@example.com', 'es-ES'],
            ]);
        });

        it('rung 2: a recipient without a locale falls to the deployment default', async () => {
            const email = templateEmail();
            const data = fakeData({ users: { user_1: { email: 'ada@example.com' } } });
            await build(data, email, 'ja-JP').send(silentCtx(), templated());
            expect(email.templated[0].locale).toBe('ja-JP');
        });

        it.each([
            ['NULL', null],
            ['empty string', ''],
            ['whitespace', '   '],
            ['the literal "undefined"', 'undefined'],
            ['the literal "null"', 'null'],
            ['a non-string', 42],
            ['a malformed tag', 'not a locale!!'],
        ])('dead-letter pin: a recipient locale of %s resolves to the deployment default and never reaches the lookup', async (_label, raw) => {
            // hotcrm's measured dead-letter: `${pref?.value}` → "undefined" →
            // TEMPLATE_NOT_FOUND (permanent) for every user without a row.
            // Any of these shapes in the column must fall back, not fail.
            const email = templateEmail();
            const data = fakeData({ users: { user_1: { email: 'ada@example.com', locale: raw } } });
            const r = await build(data, email, 'ja-JP').send(silentCtx(), templated());
            expect(r.ok).toBe(true);
            expect(email.templated).toHaveLength(1);
            expect(email.templated[0].locale).toBe('ja-JP');
            expect(email.templated[0].locale).not.toBe('undefined');
        });

        it('nothing named anywhere ⇒ no `locale` key at all — sendTemplate resolves its documented en-US default', async () => {
            const email = templateEmail();
            const data = fakeData({ users: { user_1: { email: 'ada@example.com', locale: 'undefined' } } });
            const r = await build(data, email).send(silentCtx(), templated());
            expect(r.ok).toBe(true);
            expect(Object.prototype.hasOwnProperty.call(email.templated[0], 'locale')).toBe(false);
        });

        it('a literal email address has no row to read — the deployment default is its whole chain', async () => {
            const email = templateEmail();
            const data = fakeData({ users: {} });
            await build(data, email, 'ja-JP').send(silentCtx(), templated('bob@example.com'));
            expect(email.templated[0]).toMatchObject({ to: 'bob@example.com', locale: 'ja-JP' });
            expect(data.findOnes.filter((q: { object: string }) => q.object === 'sys_user')).toHaveLength(0);
        });

        it('reads the locale off the SAME sys_user row as the address — one query per recipient, no second read point', async () => {
            const email = templateEmail();
            const data = fakeData({ users: { user_1: { email: 'ada@example.com', locale: 'zh-CN' } } });
            await build(data, email, 'ja-JP').send(silentCtx(), templated());
            const userReads = data.findOnes.filter((q: { object: string }) => q.object === 'sys_user');
            expect(userReads).toHaveLength(1);
            expect(userReads[0].query).toEqual({ where: { id: 'user_1' }, fields: ['email', 'locale'] });
        });

        it('a locale read that fails costs the language, never the delivery (ruling item 3)', async () => {
            // A `userObject` override without the column: the projection
            // throws, the channel retries address-only and falls to the
            // deployment default. ok:true, one send, no dead letter.
            const email = templateEmail();
            const base = fakeData({ users: { user_1: { email: 'ada@example.com', locale: 'zh-CN' } } });
            const data = {
                ...base,
                async findOne(object: string, query: any) {
                    if (object === 'sys_user' && (query?.fields ?? []).includes('locale')) {
                        throw new Error("Unknown field 'locale' on object 'sys_user'");
                    }
                    return base.findOne(object, query);
                },
            };
            const warned: string[] = [];
            const ctx = { logger: { info: () => {}, warn: (m: string) => { warned.push(m); }, error: () => {} } };
            const r = await build(data, email, 'ja-JP').send(ctx, templated());
            expect(r.ok).toBe(true);
            expect(email.templated).toEqual([{
                template: 'crm.large_deal_won',
                to: 'ada@example.com',
                data: { dealName: 'Acme' },
                locale: 'ja-JP',
            }]);
            expect(warned.some((m) => /retrying address-only/.test(m))).toBe(true);
        });

        it('the sys_notification_template arm uses the SAME resolution: the recipient\'s row picks the (topic, email, locale) row', async () => {
            const email = fakeEmail();
            const data = fakeData({
                users: {
                    ada: { email: 'ada@example.com', locale: 'zh-CN' },
                    bob: { email: 'bob@example.com' },
                },
                templates: [
                    { topic: 'deal.won', channel: 'email', locale: 'en', is_active: true, subject: 'Won {{ payload.title }}', body: 'en body', format: 'text' },
                    { topic: 'deal.won', channel: 'email', locale: 'zh-CN', is_active: true, subject: '成交 {{ payload.title }}', body: 'zh body', format: 'text' },
                    { topic: 'deal.won', channel: 'email', locale: 'ja-JP', is_active: true, subject: '成約 {{ payload.title }}', body: 'ja body', format: 'text' },
                ],
            });
            const ch = build(data, email, 'ja-JP');
            await ch.send(silentCtx(), delivery({}, 'ada'));
            await ch.send(silentCtx(), delivery({}, 'bob'));
            expect(email.sent.map((s) => [s.to, s.subject])).toEqual([
                ['ada@example.com', '成交 Deal closed'],   // her own locale
                ['bob@example.com', '成約 Deal closed'],   // no locale ⇒ deployment default
            ]);
        });

        it('the sys_notification_template arm still lands on the store\'s `en` floor when nothing is named', async () => {
            const email = fakeEmail();
            const data = fakeData({
                users: { user_1: { email: 'ada@example.com', locale: 'undefined' } },
                templates: [{ topic: 'deal.won', channel: 'email', locale: 'en', is_active: true, subject: 'Won {{ payload.title }}', body: 'en body', format: 'text' }],
            });
            await build(data, email).send(silentCtx(), delivery());
            expect(email.sent[0].subject).toBe('Won Deal closed');
        });

        it('a producer-set payload.locale does not select the sys_notification_template row either', async () => {
            const email = fakeEmail();
            const data = fakeData({
                users: { user_1: { email: 'ada@example.com', locale: 'zh-CN' } },
                templates: [
                    { topic: 'deal.won', channel: 'email', locale: 'zh-CN', is_active: true, subject: '成交', body: 'zh', format: 'text' },
                    { topic: 'deal.won', channel: 'email', locale: 'es-ES', is_active: true, subject: 'Ganado', body: 'es', format: 'text' },
                ],
            });
            await build(data, email).send(silentCtx(), delivery({ payload: { title: 'x', body: 'y', locale: 'es-ES' } }));
            expect(email.sent[0].subject).toBe('成交');
        });
    });

    // ── #11741 — organization threading. This channel is the producer the
    // ruling names as HOLDING an organization (`delivery.notification
    // .organizationId`, the tenant stamp the outbox snapshots per delivery),
    // so it threads that value into the email service's input on BOTH of its
    // arms; plugin-email's writer then stamps `sys_email.organization_id`
    // verbatim. Identity pins, not counts: each pin asserts the exact value
    // THIS producer stamped. The over-denial control pins the other half of
    // the ruling: a delivery genuinely without an organization sends WITHOUT
    // one — never refused, never given a fabricated stamp.
    describe('organization threading (#11741)', () => {
        /** Email service double recording both arms' inputs. */
        function orgEmail() {
            const sent: any[] = [];
            const templated: any[] = [];
            return {
                sent,
                templated,
                service: {
                    async send(input: any) { sent.push(input); return { id: 'email_row_1' }; },
                    async sendTemplate(input: any) { templated.push(input); return { id: 'email_row_9', status: 'sent' }; },
                },
            };
        }

        it('the plain arm threads notification.organizationId into SendEmailInput (identity pin)', async () => {
            const email = orgEmail();
            const ch = channel(() => email.service, fakeData({ users: { user_1: 'ada@example.com' } }));
            const r = await ch.send(silentCtx(), delivery({ organizationId: 'org_apex' }));
            expect(r.ok).toBe(true);
            expect(email.sent).toHaveLength(1);
            // Exact shape: the stamp is the delivery's OWN organization, and
            // nothing else about the input moved.
            expect(email.sent[0]).toEqual({
                to: 'ada@example.com',
                subject: 'Deal closed',
                text: 'Acme signed',
                organizationId: 'org_apex',
            });
        });

        it('the template arm threads notification.organizationId into sendTemplate (identity pin)', async () => {
            const email = orgEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
                getDefaultTemplateLocale: () => 'ja-JP',
            });
            const r = await ch.send(silentCtx(), delivery({
                organizationId: 'org_apex',
                title: 'deal.won',
                body: '',
                payload: { template: 'crm.large_deal_won', templateData: { dealName: 'Acme' } },
            }));
            expect(r.ok).toBe(true);
            expect(email.templated).toHaveLength(1);
            expect(email.templated[0]).toEqual({
                template: 'crm.large_deal_won',
                to: 'ada@example.com',
                data: { dealName: 'Acme' },
                locale: 'ja-JP',
                organizationId: 'org_apex',
            });
        });

        it('over-denial control: an org-less delivery sends WITHOUT an organization and is not refused (both arms)', async () => {
            const email = orgEmail();
            const data = fakeData({ users: { user_1: 'ada@example.com' } });
            const ch = createEmailChannel({
                getEmail: () => email.service,
                getData: () => data,
                store: new NotificationTemplateStore({ getData: () => data }),
            });
            const plain = await ch.send(silentCtx(), delivery());
            expect(plain.ok).toBe(true);
            expect(email.sent).toHaveLength(1);
            expect(email.sent[0]).not.toHaveProperty('organizationId');

            const templated = await ch.send(silentCtx(), delivery({
                title: 'deal.won',
                body: '',
                payload: { template: 'crm.large_deal_won' },
            }));
            expect(templated.ok).toBe(true);
            expect(email.templated).toHaveLength(1);
            expect(email.templated[0]).not.toHaveProperty('organizationId');
        });
    });
});
