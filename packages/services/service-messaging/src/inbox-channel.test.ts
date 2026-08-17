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

        const templateDelivery = (locale?: string) => delivery({
            // The emit-time degraded fallback (title=topic, body='') that the
            // renderer must REPLACE.
            title: 'deal.won',
            body: '',
            payload: {
                template: 'deal.won_email',
                templateData: { deal: 'Acme' },
                ...(locale ? { locale } : {}),
            },
        });

        it('renders title/body_md through renderTemplate: subject → title, text → body_md', async () => {
            const data = fakeData();
            const r = fakeRenderer();
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            const result = await ch.send(silentCtx(), templateDelivery('zh-CN'));

            expect(result.ok).toBe(true);
            expect(r.calls).toEqual([{
                template: 'deal.won_email',
                data: { deal: 'Acme' },
                locale: 'zh-CN',
            }]);
            expect(data.inserts[0].row.title).toBe('[zh-CN] subject for deal.won_email');
            expect(data.inserts[0].row.body_md).toBe('text body');
        });

        it('falls back to the deployment default locale when the payload names none', async () => {
            const data = fakeData();
            const r = fakeRenderer();
            const ch = createInboxChannel({
                getData: () => data.engine,
                getEmail: () => r.email,
                getDefaultTemplateLocale: () => 'ja-JP',
            });

            await ch.send(silentCtx(), templateDelivery());

            expect(r.calls[0].locale).toBe('ja-JP');
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
            const data = fakeData();
            const r = fakeRenderer(() => {
                throw new Error('TEMPLATE_NOT_FOUND: deal.won_email (locale=zh-CN)');
            });
            const ch = createInboxChannel({ getData: () => data.engine, getEmail: () => r.email });

            const result = await ch.send(silentCtx(), templateDelivery('zh-CN'));

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
