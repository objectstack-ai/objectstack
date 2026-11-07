// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28056] A failed read of the organization's default currency is not a read
 * that found none. A `{{ amount | currency }}` hole with no argument that meets
 * no tenant default refuses its node as a guard refusal: the metadata needs a
 * setting, a `fault` edge does not route it. That grade is right only when the
 * read succeeded. When the read FAILED (the tenant-currency resolver rejected,
 * which the automation plugin does when `resolveLocalizationContext` answers
 * `readFailed`), nothing was learned, and a refusal a default would have cured
 * is an ordinary runtime failure: a `fault` edge routes it, and the run
 * succeeds once the read does. The messaging channels grade the same refusal
 * the same way (#27257).
 */

import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { AutomationServicePlugin } from '../plugin.js';
import { isGuardRefusal } from '../guard-refusal.js';
import { installBuiltinNodes } from './index.js';
import type { MessagingServiceSurface } from './notify-node.js';
import {
    FlowTextTemplateError,
    gradeAfterTenantCurrencyReadFault,
    noteTenantCurrencyReadFault,
    renderTextSlot,
} from './template.js';

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

/**
 * A notify whose title formats in the tenant default, with a `fault` edge to a
 * handler that notifies `$error.message`, so what the edge carried is visible.
 */
function flowWith(extra: Record<string, unknown> = {}) {
    return {
        name: 'deal_won_notice',
        label: 'Deal Won Notice',
        type: 'autolaunched' as const,
        variables: [{ name: 'amount', type: 'number' as const, isInput: true }],
        ...extra,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            {
                id: 'notify',
                type: 'notify' as const,
                label: 'Notify',
                config: { recipients: ['user_1'], title: 'Won {{ amount | currency }}', message: 'Booked' },
            },
            {
                id: 'handled',
                type: 'notify' as const,
                label: 'Handled',
                config: { recipients: ['ops'], title: 'Not sent', message: '{{ $error.message }}' },
            },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
            { id: 'f1', source: 'notify', target: 'handled', type: 'fault' as const },
        ],
    };
}

function engineWith(flow: ReturnType<typeof flowWith>, store?: InMemorySuspendedRunStore) {
    const messaging = fakeMessaging();
    const engine = new AutomationEngine(createTestLogger(), store);
    installBuiltinNodes(engine, {
        logger: createTestLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging.service : undefined),
    } as never);
    engine.registerFlow(flow.name, flow);
    return { engine, messaging };
}

/** Each node's status in the run's summary. */
function statusOf(result: unknown, nodeId: string): string | undefined {
    const nodes = ((result as { summary?: { nodes?: Array<{ nodeId: string; status: string }> } }).summary?.nodes ?? []);
    return nodes.find((n) => n.nodeId === nodeId)?.status;
}

/** What the fault handler was handed: the `$error.message` it notified, if it ran. */
function handledError(emitted: ReturnType<typeof fakeMessaging>['emitted']): string | undefined {
    const handled = emitted.find((n) => (n.payload as { title?: string }).title === 'Not sent');
    return handled ? String((handled.payload as { body?: string }).body) : undefined;
}

/** The notifications the guarded notify itself sent. */
function sent(emitted: ReturnType<typeof fakeMessaging>['emitted']) {
    return emitted.filter((n) => (n.payload as { title?: string }).title !== 'Not sent');
}

describe('notify — a currency hole refused after a FAILED tenant-settings read is a runtime failure', () => {
    it('a fault edge routes it, and $error names the failed read rather than a missing setting', async () => {
        const { engine, messaging } = engineWith(flowWith());
        engine.setTenantCurrencyResolver(() => { throw new Error('the localization settings could not be read'); });

        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn' } as any);

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(statusOf(result, 'notify')).toBe('failure');
        expect(statusOf(result, 'handled')).toBe('success');
        const handled = handledError(messaging.emitted);
        expect(handled).toContain('{{ amount | currency }}');
        expect(handled).toContain('could not be read');
        expect(handled).not.toContain('Set the default currency');
        expect(sent(messaging.emitted)).toHaveLength(0);
    });

    it('under errorHandling retry the run succeeds once the read does, and the title formats in the default', async () => {
        const flow = flowWith({ errorHandling: { strategy: 'retry', maxRetries: 2, backoffMs: 1 } });
        flow.edges = flow.edges.filter((e) => e.type !== 'fault');
        const { engine, messaging } = engineWith(flow);
        let reads = 0;
        engine.setTenantCurrencyResolver(() => {
            reads += 1;
            if (reads === 1) throw new Error('the localization settings could not be read');
            return 'CNY';
        });

        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn' } as any);

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(reads).toBe(2);
        expect(messaging.emitted[0]?.payload).toMatchObject({ title: 'Won CN¥1,234.50' });
    });

    it('a read that SUCCEEDED and found no default keeps the guard refusal: the fault edge does not route it', async () => {
        const { engine, messaging } = engineWith(flowWith());
        engine.setTenantCurrencyResolver(() => undefined);

        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_none' } as any);

        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('Set the default currency');
        expect(statusOf(result, 'handled')).toBeUndefined();
        expect(messaging.emitted).toHaveLength(0);
    });

    it('a read that succeeded with a default is unchanged: the notification goes out in it', async () => {
        const { engine, messaging } = engineWith(flowWith());
        engine.setTenantCurrencyResolver(() => 'CNY');

        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn' } as any);

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(statusOf(result, 'notify')).toBe('success');
        expect(statusOf(result, 'handled')).toBeUndefined();
        expect(messaging.emitted[0]?.payload).toMatchObject({ title: 'Won CN¥1,234.50' });
    });
});

describe('a resumed segment whose tenant-settings read fails grades the refusal the same way', () => {
    it('the resumed notify\'s refusal is routed by its fault edge', async () => {
        const parked = flowWith();
        parked.type = 'screen' as never;
        parked.nodes.splice(1, 0, {
            id: 'ask',
            type: 'screen' as never,
            label: 'Ask',
            config: { waitForInput: true, title: 'Confirm', fields: [{ name: 'ok', label: 'OK', type: 'checkbox' }] } as never,
        });
        parked.edges[0] = { id: 'e0', source: 'start', target: 'ask' };
        parked.edges.push({ id: 'e1b', source: 'ask', target: 'notify' });

        const store = new InMemorySuspendedRunStore();
        // Parked by an engine with no resolver: the persisted context carries no currency.
        const paused = await engineWith(parked, store).engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn' } as any);
        expect(paused.status).toBe('paused');

        const { engine, messaging } = engineWith(parked, store);
        engine.setTenantCurrencyResolver(() => { throw new Error('the localization settings could not be read'); });
        const resumed = await engine.resume(paused.runId!, { variables: { ok: true } } as never);

        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        expect(statusOf(resumed, 'handled')).toBe('success');
        expect(handledError(messaging.emitted)).toContain('could not be read');
        expect(sent(messaging.emitted)).toHaveLength(0);
        // The persisted context is left as it parked.
        expect((await store.load(paused.runId!))?.context ?? {}).not.toHaveProperty('currency');
    });
});

describe('gradeAfterTenantCurrencyReadFault — the probe decides', () => {
    const vars = new Map<string, unknown>([['amount', 5]]);
    const refusalOf = (source: string): FlowTextTemplateError => {
        try {
            renderTextSlot(source, vars);
        } catch (err) {
            return err as FlowTextTemplateError;
        }
        throw new Error(`expected '${source}' to refuse`);
    };

    it('a refusal a default would cure, after a failed read, becomes an unbranded runtime failure', () => {
        const context = {};
        noteTenantCurrencyReadFault(context, new Error('connection reset'));
        const graded = gradeAfterTenantCurrencyReadFault(refusalOf('{{ amount | currency }}'), vars, context);
        expect(graded).toBeInstanceOf(Error);
        expect(graded).not.toBeInstanceOf(FlowTextTemplateError);
        expect(isGuardRefusal(graded)).toBe(false);
        expect((graded as Error).message).toContain('connection reset');
    });

    it('a refusal a default would NOT cure stays the guard refusal, even after a failed read', () => {
        const context = {};
        noteTenantCurrencyReadFault(context, new Error('connection reset'));
        const refusal = refusalOf('{{ amount | currency }} {{ amount | bogus }}');
        expect(gradeAfterTenantCurrencyReadFault(refusal, vars, context)).toBe(refusal);
    });

    it('with no failed read on the context, every refusal is returned as it stands', () => {
        const refusal = refusalOf('{{ amount | currency }}');
        expect(gradeAfterTenantCurrencyReadFault(refusal, vars, {})).toBe(refusal);
        expect(gradeAfterTenantCurrencyReadFault(refusal, vars, undefined)).toBe(refusal);
        expect(isGuardRefusal(refusal)).toBe(true);
    });
});

describe('the automation plugin\'s tenant-currency resolver rejects a failed read', () => {
    /** Boot the plugin over an ObjectQL whose `sys_setting` read answers `rows`, or throws. */
    async function boot(settingRows: Array<Record<string, unknown>> | 'throws') {
        const messaging = fakeMessaging();
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use({
            name: 'test.harness',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: any) {
                ctx.registerService('objectql', {
                    async find(object: string) {
                        if (object !== 'sys_setting') return [];
                        if (settingRows === 'throws') throw new Error('connection reset reading sys_setting');
                        return settingRows;
                    },
                });
                ctx.registerService('messaging', messaging.service);
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        const engine = kernel.getService('automation') as AutomationEngine;
        engine.registerFlow('deal_won_notice', flowWith());
        return { engine, messaging };
    }

    it('a sys_setting read that throws: the fault edge routes the refusal', async () => {
        const { engine, messaging } = await boot('throws');
        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn', runAs: 'system' } as any);
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(handledError(messaging.emitted)).toContain('could not be read');
        expect(sent(messaging.emitted)).toHaveLength(0);
    });

    it('a sys_setting read that finds no default: the guard refusal stands', async () => {
        const { engine } = await boot([]);
        const result = await engine.execute('deal_won_notice', { params: { amount: 1234.5 }, tenantId: 'org_cn', runAs: 'system' } as any);
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('Set the default currency');
    });
});
