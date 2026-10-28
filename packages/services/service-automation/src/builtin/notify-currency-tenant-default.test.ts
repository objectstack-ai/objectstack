// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A flow text slot's `{{ amount | currency }}` hole with no argument formats
 * in the run's organization's default currency (`localization.currency`).
 * Run setup seeds it once (`AutomationContext.currency`) through the host's
 * localization read (`setTenantCurrencyResolver`, which the automation plugin
 * bridges to `@objectstack/core`'s `resolveLocalizationContext`). With none,
 * the node is refused with a message naming the hole, and nothing is sent: the
 * amount is never formatted in USD or any other guess.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import type { MessagingServiceSurface } from './notify-node.js';
import { FlowTextTemplateError, renderTextSlot } from './template.js';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

function fakeMessaging() {
    const emitted: Array<Parameters<MessagingServiceSurface['emit']>[0]> = [];
    const service: MessagingServiceSurface = {
        async emit(n) {
            emitted.push(n);
            return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
        },
    };
    return { service, emitted };
}

const FLOW = {
    name: 'deal_won_notice',
    label: 'Deal Won Notice',
    type: 'autolaunched' as const,
    variables: [{ name: 'amount', type: 'number' as const, isInput: true }],
    nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        {
            id: 'notify',
            type: 'notify' as const,
            label: 'Notify',
            config: { recipients: ['user_1'], title: 'Won {{ amount | currency }}', message: 'Booked {{ amount | currency:EUR }}' },
        },
        { id: 'end', type: 'end' as const, label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'notify' },
        { id: 'e2', source: 'notify', target: 'end' },
    ],
};

describe('notify — a no-argument currency hole formats in the run organization\'s default', () => {
    let engine: AutomationEngine;
    let messaging: ReturnType<typeof fakeMessaging>;

    beforeEach(() => {
        messaging = fakeMessaging();
        engine = new AutomationEngine(createTestLogger());
        registerNotifyNode(engine, {
            logger: createTestLogger(),
            getService: (name: string) => (name === 'messaging' ? messaging.service : undefined),
        } as any);
        engine.registerFlow('deal_won_notice', FLOW);
    });

    it('run setup reads the run organization\'s default once, and the title formats in it', async () => {
        const reads: Array<string | undefined> = [];
        engine.setTenantCurrencyResolver((tenantId) => {
            reads.push(tenantId);
            return tenantId === 'org_cn' ? 'CNY' : undefined;
        });
        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn' } as any);
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(reads).toEqual(['org_cn']);
        expect(messaging.emitted[0]?.payload).toMatchObject({ title: 'Won CN¥1,234.50', body: 'Booked €1,234.50' });
    });

    it('a context that already carries a currency keeps it, and the resolver is not asked', async () => {
        let asked = 0;
        engine.setTenantCurrencyResolver(() => { asked += 1; return 'CNY'; });
        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn', currency: 'JPY' } as any);
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(asked).toBe(0);
        expect(messaging.emitted[0]?.payload).toMatchObject({ title: 'Won ¥1,235' });
    });

    it.each([
        ['no resolver is wired', undefined],
        ['the organization has no default', () => undefined],
        ['the read fails', () => { throw new Error('settings unavailable'); }],
    ])('refuses the node by name when %s, and sends nothing', async (_label, resolver) => {
        if (resolver) engine.setTenantCurrencyResolver(resolver as never);
        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_none' } as any);
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('{{ amount | currency }}');
        expect(String(result.error)).toContain('localization.currency');
        expect(String(result.error)).not.toContain('$');
        expect(messaging.emitted).toHaveLength(0);
    });
});

describe('renderTextSlot — the tenant default on the engine\'s reserved channel', () => {
    const vars = new Map<string, unknown>([['amount', 1234.5], ['currency', 'EUR']]);

    it('formats a no-argument hole in the currency it is handed', () => {
        expect(renderTextSlot('Due {{ amount | currency }}', vars, 'CNY')).toBe('Due CN¥1,234.50');
    });

    it('a flow variable named `currency` is a value, never the tenant default', () => {
        expect(() => renderTextSlot('Due {{ amount | currency }} ({{ currency }})', vars)).toThrow(FlowTextTemplateError);
    });

    it('throws the guard refusal without one, naming the hole', () => {
        expect(() => renderTextSlot('Due {{ amount | currency }}', vars)).toThrow(/\{\{ amount \| currency \}\}/);
    });
});
