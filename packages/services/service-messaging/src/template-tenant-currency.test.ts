// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The notification channels hand a templated mail render its organization's
 * default currency (`localization.currency`), the code a
 * `{{ amount | currency }}` hole with no argument formats in. The read is the
 * delivery's own organization's; with none, no `currency` key is passed and
 * the render refuses such a hole (`TEMPLATE_INVALID`) instead of guessing.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { createEmailChannel } from './email-channel.js';
import { createInboxChannel } from './inbox-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import type { Delivery } from './channel.js';

function silentCtx() {
    return { logger: { info: () => {}, warn: () => {}, error: () => {} } };
}

function templateDelivery(channel: 'email' | 'inbox', organizationId?: string): Delivery {
    return {
        channel,
        recipient: 'user_1',
        notification: {
            notificationId: 'evt_1',
            topic: 'deal.won',
            title: 'deal.won',
            body: '',
            severity: 'info',
            recipients: ['user_1'],
            payload: { template: 'crm.large_deal_won', templateData: { amount: 1234.5 } },
            ...(organizationId ? { organizationId } : {}),
        },
    };
}

function fakeData() {
    return {
        async findOne(object: string, query: any) {
            assertEngineFindOnePredicate(object, query);
            return object === 'sys_user' && query?.where?.id === 'user_1' ? { email: 'ada@example.com' } : null;
        },
        async find() { return []; },
        async insert(_o: string, r: any) { return { id: 'x', ...r }; },
        async update(_o: string, d: any, options: any) { assertEngineUpdateDispatch(d, options); return {}; },
        async delete(_o: string, options: any) { assertEngineDeleteDispatch(options); return {}; },
    } as any;
}

/** The tenant default per organization, recording every read. */
function tenantCurrencies(byOrg: Record<string, string>) {
    const reads: Array<string | undefined> = [];
    return {
        reads,
        getTenantCurrency: async (organizationId: string | undefined) => {
            reads.push(organizationId);
            return organizationId ? byOrg[organizationId] : undefined;
        },
    };
}

describe('email channel: the template arm carries the organization\'s default currency', () => {
    function emailDouble() {
        const templated: any[] = [];
        return {
            templated,
            service: {
                async send() { return { id: 'email_row_1' }; },
                async sendTemplate(input: any) { templated.push(input); return { id: 'email_row_9', status: 'sent' }; },
            },
        };
    }

    it('reads the delivery organization\'s default and hands it to sendTemplate as `currency`', async () => {
        const email = emailDouble();
        const data = fakeData();
        const tenant = tenantCurrencies({ org_apex: 'CNY', org_other: 'EUR' });
        const ch = createEmailChannel({
            getEmail: () => email.service,
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
            getTenantCurrency: tenant.getTenantCurrency,
        });
        const r = await ch.send(silentCtx(), templateDelivery('email', 'org_apex'));
        expect(r.ok).toBe(true);
        expect(tenant.reads).toEqual(['org_apex']);
        expect(email.templated).toEqual([{
            template: 'crm.large_deal_won',
            to: 'ada@example.com',
            data: { amount: 1234.5 },
            currency: 'CNY',
            organizationId: 'org_apex',
        }]);
    });

    it('an organization with no default passes no `currency` key: the render then refuses such a hole', async () => {
        const email = emailDouble();
        const data = fakeData();
        const ch = createEmailChannel({
            getEmail: () => email.service,
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
            getTenantCurrency: tenantCurrencies({}).getTenantCurrency,
        });
        await ch.send(silentCtx(), templateDelivery('email', 'org_apex'));
        expect(email.templated).toHaveLength(1);
        expect(email.templated[0]).not.toHaveProperty('currency');
    });

    it('a TEMPLATE_INVALID refusal of such a hole reaches the delivery row, graded permanent', async () => {
        const data = fakeData();
        const refusal = 'TEMPLATE_INVALID: email template crm.large_deal_won (locale=en-US): the hole {{ amount | currency }} has no currency argument';
        const ch = createEmailChannel({
            getEmail: () => ({
                async send() { return { id: 'x' }; },
                async sendTemplate() { throw new Error(refusal); },
            }),
            getData: () => data,
            store: new NotificationTemplateStore({ getData: () => data }),
        });
        const r = await ch.send(silentCtx(), templateDelivery('email', 'org_apex'));
        expect(r).toEqual({ ok: false, error: refusal });
        expect(ch.classifyError?.(refusal)).toBe('permanent');
    });
});

describe('inbox channel: the template arm carries the organization\'s default currency', () => {
    function rendererDouble() {
        const calls: any[] = [];
        return {
            calls,
            email: {
                async send() { return {}; },
                async renderTemplate(input: any) {
                    calls.push(input);
                    return { subject: 'Deal won', html: '<p>x</p>', text: 'x' };
                },
            },
        };
    }

    it('reads the delivery organization\'s default and hands it to renderTemplate as `currency`', async () => {
        const r = rendererDouble();
        const tenant = tenantCurrencies({ org_apex: 'JPY' });
        const ch = createInboxChannel({ getData: () => fakeData(), getEmail: () => r.email, getTenantCurrency: tenant.getTenantCurrency });
        const result = await ch.send(silentCtx(), templateDelivery('inbox', 'org_apex'));
        expect(result.ok).toBe(true);
        expect(tenant.reads).toEqual(['org_apex']);
        expect(r.calls).toEqual([{ template: 'crm.large_deal_won', data: { amount: 1234.5 }, currency: 'JPY' }]);
    });

    it('an organization with no default passes no `currency` key', async () => {
        const r = rendererDouble();
        const ch = createInboxChannel({ getData: () => fakeData(), getEmail: () => r.email, getTenantCurrency: tenantCurrencies({}).getTenantCurrency });
        await ch.send(silentCtx(), templateDelivery('inbox'));
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0]).not.toHaveProperty('currency');
    });
});

// [#27257] Through the plugin's own wiring: `getTenantCurrency` is
// `resolveLocalizationContext` over the `data` engine, and a `sys_setting` read
// that FAILED must not be graded like one that found no default. The first
// learned nothing, so a refusal it caused is retried; only the second is
// permanent, with the render's prescription on the row.
describe('a failed settings read is retried; a read that finds no default is permanent', () => {
    const REFUSAL =
        'TEMPLATE_INVALID: email template crm.large_deal_won (locale=en-US): the hole {{ amount | currency }} has no currency argument and the organization has no default currency; set localization.currency, or write currency:EUR';

    /** The plugin's `data` engine: its `sys_setting` read answers `rows`, or throws when `broken`. */
    function settingsEngine(opts: { broken: boolean }, rows: Array<Record<string, unknown>> = []) {
        const base = fakeData();
        const reads: string[] = [];
        const healthyFind = async (object: string, query: any) => {
            if (object !== 'sys_setting') return [];
            reads.push(object);
            const where = query?.where ?? {};
            const matched = rows.filter((r) => r.organization_id === where.organization_id && where.key?.$in?.includes(r.key));
            // Hold the caller's bound, after the filter and by presence.
            return typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
        };
        const brokenFind = async (object: string): Promise<unknown[]> => {
            if (object !== 'sys_setting') return [];
            reads.push(object);
            throw new Error('connection reset reading sys_setting');
        };
        return { reads, engine: { ...base, find: opts.broken ? brokenFind : healthyFind } };
    }

    /** The render the real `email` service does: a no-argument hole needs a `currency`. */
    /** A refusal no default cures: a `currency:@path` hole whose value is not a code. */
    const PATH_REFUSAL =
        "TEMPLATE_INVALID: email template crm.large_deal_won (locale=en-US): the hole {{ amount | currency:@deal.code }} reads 'dollars' at deal.code, which is not an ISO 4217 code";

    /**
     * The render the real `email` service does. `missing-currency`: a no-argument
     * hole needs a `currency`. `path-value`: an `@path` hole refuses whatever the
     * default. `both`: the first refusal met is the missing default, and with a
     * default the `@path` one still stands.
     */
    function mailService(opts: { refuses?: 'missing-currency' | 'path-value' | 'both' | 'not-found' } = {}) {
        const calls: any[] = [];
        let sent = 0;
        const render = (input: any) => {
            calls.push(input);
            if (opts.refuses === 'not-found') throw new Error('TEMPLATE_NOT_FOUND: email template crm.large_deal_won');
            const needsDefault = opts.refuses === 'missing-currency' || opts.refuses === 'both';
            if (needsDefault && !input.currency) throw new Error(REFUSAL);
            if (opts.refuses === 'path-value' || opts.refuses === 'both') throw new Error(PATH_REFUSAL);
            return { subject: 'Deal won', html: '<p>x</p>', text: `Won ${input.currency ?? ''}` };
        };
        return {
            calls,
            sent: () => sent,
            service: {
                async send() { return { id: 'x' }; },
                async sendTemplate(input: any) { render(input); sent += 1; return { id: 'email_row_1', status: 'sent' }; },
                async renderTemplate(input: any) { return render(input); },
            },
        };
    }

    async function bootPlugin(engine: unknown, email: unknown) {
        const services = new Map<string, unknown>([['data', engine], ['email', email], ['manifest', { register() {} }]]);
        const readyHooks: Array<() => Promise<void> | void> = [];
        const ctx = {
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ctx.logger },
            getService(name: string) {
                if (!services.has(name)) throw new Error(`service '${name}' is not registered`);
                return services.get(name);
            },
            registerService(name: string, svc: unknown) { services.set(name, svc); },
            hook(event: string, fn: () => Promise<void> | void) { if (event === 'kernel:ready') readyHooks.push(fn); },
        } as any;
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        for (const fn of readyHooks) await fn();
        return { ctx, messaging: services.get('messaging') as MessagingService };
    }

    for (const channelId of ['email', 'inbox'] as const) {
        describe(`${channelId} channel`, () => {
            it('a failed read renders without a currency; the refusal it causes is graded retryable, never TEMPLATE_*', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService({ refuses: 'missing-currency' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                const r = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(data.reads).toHaveLength(1);
                expect(mail.calls[0]).not.toHaveProperty('currency');
                // The probe: rendered once more with the "no currency" code, never sent.
                expect(mail.calls).toHaveLength(2);
                expect(mail.calls[1].currency).toBe('XXX');
                expect(mail.sent()).toBe(0);
                expect(r.ok).toBe(false);
                expect(r.error).not.toMatch(/TEMPLATE_/);
                expect(r.error).toContain("organization 'org_apex'");
                expect(channel.classifyError?.(r.error)).toBe('retryable');
            });

            it('a failed read served from the failure memo keeps its kind: retryable again, with no second read', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService({ refuses: 'missing-currency' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                const again = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(data.reads).toHaveLength(1);
                expect(channel.classifyError?.(again.error)).toBe('retryable');
            });

            it('a read that SUCCEEDS and finds no default is refused TEMPLATE_INVALID, permanent, with the prescription', async () => {
                const data = settingsEngine({ broken: false });
                const mail = mailService({ refuses: 'missing-currency' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                const r = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(data.reads).toHaveLength(1);
                expect(r).toEqual({ ok: false, error: REFUSAL });
                expect(channel.classifyError?.(r.error)).toBe('permanent');
            });

            it('a failed read leaves a refusal no default cures as it stands: permanent, its own sentence on the row', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService({ refuses: 'path-value' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                const r = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(r).toEqual({ ok: false, error: PATH_REFUSAL });
                expect(channel.classifyError?.(r.error)).toBe('permanent');
            });

            it('a failed read, a template with the default hole AND a refusal no default cures: the standing refusal, permanent', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService({ refuses: 'both' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                const r = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(r).toEqual({ ok: false, error: PATH_REFUSAL });
                expect(channel.classifyError?.(r.error)).toBe('permanent');
                expect(mail.sent()).toBe(0);
            });

            it('a failed read does not stop a template that needs no default: it is delivered', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService();
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const r = await messaging.getChannel(channelId)!.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(r.ok).toBe(true);
                expect(mail.calls[0]).not.toHaveProperty('currency');
            });

            it('a failed read leaves every other template failure as it was: TEMPLATE_NOT_FOUND stays permanent', async () => {
                const data = settingsEngine({ broken: true });
                const mail = mailService({ refuses: 'not-found' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const channel = messaging.getChannel(channelId)!;
                const r = await channel.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(r.error).toMatch(/^TEMPLATE_NOT_FOUND: /);
                expect(channel.classifyError?.(r.error)).toBe('permanent');
            });

            it('a read that finds the default formats in it', async () => {
                const data = settingsEngine({ broken: false }, [
                    { namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'org_apex', value: 'CNY' },
                ]);
                const mail = mailService({ refuses: 'missing-currency' });
                const { ctx, messaging } = await bootPlugin(data.engine, mail.service);
                const r = await messaging.getChannel(channelId)!.send(ctx, templateDelivery(channelId, 'org_apex'));
                expect(r.ok).toBe(true);
                expect(mail.calls[0].currency).toBe('CNY');
            });
        });
    }
});
