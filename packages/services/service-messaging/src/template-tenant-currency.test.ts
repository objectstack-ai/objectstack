// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The notification channels hand a templated mail render its organization's
 * default currency (`localization.currency`), the code a
 * `{{ amount | currency }}` hole with no argument formats in. The read is the
 * delivery's own organization's; with none, no `currency` key is passed and
 * the render refuses such a hole (`TEMPLATE_INVALID`) instead of guessing.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { createEmailChannel } from './email-channel.js';
import { createInboxChannel } from './inbox-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
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
        async update() { return {}; },
        async delete() { return {}; },
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
