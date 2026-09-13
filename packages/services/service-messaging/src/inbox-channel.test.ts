// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
import type { Delivery } from './channel.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { NotificationDispatcher } from './dispatcher.js';

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
                assertEngineFindOnePredicate(object, query);
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
            // #16974 — the column exists on every row; this delivery carries no
            // actor, so it materializes null rather than being absent.
            actor_id: null,
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

    // ── The localizable template path (#9225): a notify `template` reference
    // rides in the payload; the channel consumes the email service's
    // render-only face (`IEmailService.renderTemplate`) the way the email
    // channel consumes `sendTemplate` — one resolver, two channels.
    describe('notify template path (#9225)', () => {
        /** A fake render-only email surface recording every renderTemplate call. */
        function fakeRenderer(impl?: (input: any) => { subject: string; html: string; text: string }) {
            const calls: any[] = [];
            return {
                calls,
                email: {
                    async send() { return {}; },
                    async renderTemplate(input: any) {
                        calls.push(input);
                        if (impl) return impl(input);
                        return {
                            subject: `[${input.locale ?? 'no-locale'}] subject for ${input.template}`,
                            html: '<p>html body</p>',
                            text: 'text body',
                        };
                    },
                },
            };
        }

        const templateDelivery = () => delivery({
            // The emit-time degraded fallback (title=topic, body='') that the
            // renderer must REPLACE.
            title: 'deal.won',
            body: '',
            payload: {
                template: 'deal.won_email',
                templateData: { deal: 'Acme' },
            },
        });

        /**
         * #13881 — the recipient's own `sys_user.locale`, answered off the
         * row the channel reads on the template path. `undefined` ⇒ the user
         * row exists but carries no locale.
         */
        const userWithLocale = (locale: unknown) => (obj: string, query: any) =>
            obj === 'sys_user' && query?.where?.id === 'user_1' ? { locale } : null;

        it('renders title/body_md through renderTemplate: subject → title, text → body_md', async () => {
            const data = fakeData(undefined, userWithLocale('zh-CN'));
            const r = fakeRenderer();
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(true);
            expect(r.calls).toEqual([{
                template: 'deal.won_email',
                data: { deal: 'Acme' },
                locale: 'zh-CN',
            }]);
            expect(data.inserts[0].row.title).toBe('[zh-CN] subject for deal.won_email');
            expect(data.inserts[0].row.body_md).toBe('text body');
        });

        it('falls back to the deployment default locale when the recipient has none (#13881 rung 2)', async () => {
            const data = fakeData(undefined, userWithLocale(undefined));
            const r = fakeRenderer();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => r.email,
                getDefaultTemplateLocale: () => 'ja-JP',
            });

            await ch.send(silentCtx(), templateDelivery());

            expect(r.calls[0].locale).toBe('ja-JP');
            // The locale was read off the recipient's own row — the same
            // chain the email channel resolves — and only on this path.
            expect(data.findOnes.filter((q) => q.object === 'sys_user')).toEqual([
                { object: 'sys_user', query: { where: { id: 'user_1' }, fields: ['locale'] } },
            ]);
        });

        it("the recipient's own sys_user.locale outranks the deployment default (#13881 rung 1)", async () => {
            const data = fakeData(undefined, userWithLocale('es-ES'));
            const r = fakeRenderer();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => r.email,
                getDefaultTemplateLocale: () => 'ja-JP',
            });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(true);
            expect(r.calls[0].locale).toBe('es-ES');
            expect(data.inserts[0].row.title).toBe('[es-ES] subject for deal.won_email');
        });

        it('a producer-set payload.locale is NOT consulted (#13881 retired the pre-fan-out single value)', async () => {
            const data = fakeData(undefined, userWithLocale('zh-CN'));
            const r = fakeRenderer();
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            await ch.send(silentCtx(), delivery({
                title: 'deal.won',
                body: '',
                payload: { template: 'deal.won_email', templateData: { deal: 'Acme' }, locale: 'es-ES' },
            }));

            expect(r.calls[0].locale).toBe('zh-CN');
        });

        it('dead-letter pin: the literal "undefined" in the column falls to the deployment default, never through', async () => {
            const data = fakeData(undefined, userWithLocale('undefined'));
            const r = fakeRenderer();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => r.email,
                getDefaultTemplateLocale: () => 'ja-JP',
            });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(true);
            expect(r.calls[0].locale).toBe('ja-JP');
        });

        it('a failing locale read costs the language, never the delivery (ruling item 3)', async () => {
            const data = fakeData(undefined, (obj: string) => {
                if (obj === 'sys_user') throw new Error("Unknown field 'locale' on object 'sys_user'");
                return null;
            });
            const r = fakeRenderer();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => r.email,
                getDefaultTemplateLocale: () => 'ja-JP',
            });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(true);
            expect(r.calls[0].locale).toBe('ja-JP');
            expect(data.inserts).toHaveLength(1);
        });

        it('the inline (non-template) path never reads the recipient row — no localized row to pick', async () => {
            const data = fakeData(undefined, userWithLocale('zh-CN'));
            const ch = createInboxChannel({ getData: () => data.engine });

            await ch.send(silentCtx(), delivery());

            expect(data.findOnes.filter((q) => q.object === 'sys_user')).toHaveLength(0);
        });

        it('fails LOUDLY (TEMPLATE_UNSUPPORTED) when no email service is registered', async () => {
            const data = fakeData();
            const ch = createInboxChannel({ getData: () => data.engine });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/^TEMPLATE_UNSUPPORTED:/);
            expect(result.error).toContain("no 'email' service is registered");
            expect(data.inserts).toHaveLength(0);
            // Wrong wiring, not a transient fault — never burn the retry schedule.
            expect(ch.classifyError?.(result.error)).toBe('permanent');
        });

        it('fails LOUDLY when the registered email service has no renderTemplate()', async () => {
            const data = fakeData();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => ({ async send() { return {}; } }),
            });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/^TEMPLATE_UNSUPPORTED:/);
            expect(result.error).toContain('does not provide it');
            expect(data.inserts).toHaveLength(0);
        });

        it('surfaces renderTemplate failure codes on the delivery row and grades them permanent', async () => {
            const data = fakeData(undefined, userWithLocale('zh-CN'));
            const r = fakeRenderer(() => {
                throw new Error('TEMPLATE_NOT_FOUND: deal.won_email (locale=zh-CN)');
            });
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            const result = await ch.send(silentCtx(), templateDelivery());

            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/^TEMPLATE_NOT_FOUND:/);
            expect(data.inserts).toHaveLength(0);
            expect(ch.classifyError?.(result.error)).toBe('permanent');
            // The general grading is untouched: a plain insert failure stays retryable.
            expect(ch.classifyError?.(new Error('db down'))).toBe('retryable');
        });

        it('never consults the renderer for a non-template delivery', async () => {
            const data = fakeData();
            const r = fakeRenderer();
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            await ch.send(silentCtx(), delivery());

            expect(r.calls).toHaveLength(0);
            expect(data.inserts[0].row.title).toBe('Deal closed');
            expect(data.inserts[0].row.body_md).toBe('Acme signed 🎉');
        });
    });
});

/**
 * #16974 — the actor travels END TO END, and the last leg lands here.
 *
 * `sys_inbox_message` carried no actor at all, so a client could not answer
 * "did I cause this?" without a read of `sys_notification` — an object the
 * default permission sets do not grant a member. The ruling (issue #16974,
 * decision batch #119 item 5) is that the actor travels with the delivery:
 *
 *   EmitInput.actorId → Notification.actorId → (P1) the delivery row's
 *   snapshotted payload → back onto Notification in the dispatcher →
 *   sys_inbox_message.actor_id
 *
 * The legs before this file are pinned in `messaging-service.test.ts` (emit's
 * P0 literal and the enqueue snapshot) and `dispatcher.test.ts` (the read-back,
 * and the digest group's deliberate absence). Here we pin the channel's own leg
 * and then one whole-path run through the real service, outbox and dispatcher,
 * because four green legs do not prove a connected path.
 */
describe('inbox channel — actor materialization (#16974)', () => {
    it('writes the notification actor onto the row', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine, now: () => '2026-06-01T00:00:00.000Z' });

        await ch.send(silentCtx(), delivery({ actorId: 'user_9' }, 'user_42'));

        expect(data.inserts[0].row.actor_id).toBe('user_9');
    });

    it('materializes null — never undefined — when the delivery carries no actor', async () => {
        const data = fakeData();
        const ch = createInboxChannel({ getData: () => data.engine, now: () => '2026-06-01T00:00:00.000Z' });

        await ch.send(silentCtx(), delivery({}, 'user_42'));

        // `in` rather than a truthiness check: an absent key and a null value
        // are different rows to the driver, and the column is declared.
        expect('actor_id' in data.inserts[0].row).toBe(true);
        expect(data.inserts[0].row.actor_id).toBeNull();
    });

    it('carries the actor through emit → outbox snapshot → dispatcher → row (P1)', async () => {
        const data = fakeData();
        const outbox = new MemoryNotificationOutbox(1);
        const inbox = createInboxChannel({ getData: () => data.engine, now: () => '2026-06-01T00:00:00.000Z' });

        const service = new MessagingService({
            logger: silentCtx().logger,
            getData: () => data.engine,
            outbox,
        });
        service.registerChannel(inbox);

        await service.emit({
            topic: 'deal.won',
            audience: ['user_42'],
            actorId: 'user_9',
            payload: { title: 'Deal closed', body: 'Acme signed' },
        });

        // Nothing materialized yet — the dispatcher owns the send on this path.
        expect(data.inserts.filter((i) => i.object === INBOX_OBJECT)).toHaveLength(0);
        // The actor is on the DELIVERY ROW's snapshot, so an event edited after
        // enqueue cannot rewrite who caused an in-flight send.
        const [row] = await outbox.list();
        expect(row.payload.actorId).toBe('user_9');

        await new NotificationDispatcher({
            nodeId: 'node-test',
            outbox,
            channels: { getChannel: (id: string) => (id === 'inbox' ? inbox : undefined) },
            channelContext: silentCtx(),
            intervalMs: 10_000,
        }).tick();

        const inboxRows = data.inserts.filter((i) => i.object === INBOX_OBJECT);
        expect(inboxRows).toHaveLength(1);
        expect(inboxRows[0].row.actor_id).toBe('user_9');
        // …and no read of `sys_notification` was needed to get it there.
        expect(data.findOnes.some((f) => f.object === 'sys_notification')).toBe(false);
    });
});
