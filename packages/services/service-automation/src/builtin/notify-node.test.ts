// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import type { MessagingServiceSurface } from './notify-node.js';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

/**
 * A PluginContext stub whose `messaging` service can be toggled on/off, so we
 * exercise both the wired path and the degrade-when-absent path.
 */
function createCtx(messaging?: MessagingServiceSurface) {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            if (name === 'messaging') return messaging;
            return undefined;
        },
    } as any;
}

/** A fake messaging service capturing emitted notifications. */
function fakeMessaging() {
    const emitted: any[] = [];
    const service: MessagingServiceSurface = {
        async emit(n) {
            emitted.push(n);
            return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
        },
    };
    return { service, emitted };
}

function notifyFlow(config: Record<string, unknown>) {
    return {
        name: 'notify_flow',
        label: 'Notify Flow',
        type: 'autolaunched' as const,
        variables: [
            { name: 'dealName', type: 'text' as const, isInput: true },
            { name: 'dealId', type: 'text' as const, isInput: true },
            { name: 'notify.delivered', type: 'number' as const, isOutput: true },
        ],
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'notify', type: 'notify' as const, label: 'Notify', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

describe('notify (baseline node)', () => {
    it('publishes a builtin io descriptor in the action registry', () => {
        const engine = new AutomationEngine(createTestLogger());
        registerNotifyNode(engine, createCtx());
        expect(engine.getRegisteredNodeTypes()).toContain('notify');
        const descriptor = engine.getActionDescriptor('notify');
        expect(descriptor?.source).toBe('builtin');
        expect(descriptor?.category).toBe('io');
        expect(descriptor?.paradigms).toEqual(
            expect.arrayContaining(['flow', 'approval']),
        );
    });

    describe('with a messaging service registered', () => {
        let engine: AutomationEngine;
        let messaging: ReturnType<typeof fakeMessaging>;

        beforeEach(() => {
            messaging = fakeMessaging();
            engine = new AutomationEngine(createTestLogger());
            registerNotifyNode(engine, createCtx(messaging.service));
        });

        it('emits a notification, interpolating recipients/title/body, and reports delivered count', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                topic: 'deal.won',
                recipients: ['user_1', 'user_2'],
                title: 'Deal {dealName} closed',
                message: 'Congrats on {dealName}',
                channels: ['inbox', 'email'],
                severity: 'info',
                actionUrl: '/opps/{dealId}',
            }));

            const result = await engine.execute('notify_flow', {
                params: { dealName: 'Acme', dealId: '42' },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted).toHaveLength(1);
            expect(messaging.emitted[0]).toMatchObject({
                topic: 'deal.won',
                audience: ['user_1', 'user_2'],
                channels: ['inbox', 'email'],
                severity: 'info',
                payload: {
                    title: 'Deal Acme closed',
                    body: 'Congrats on Acme',
                    url: '/opps/42',
                },
            });
            expect(result.output).toMatchObject({ 'notify.delivered': 2 });
        });

        it('accepts a single recipient string and the subject/to aliases', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                to: 'user_9',
                subject: 'Heads up',
            }));
            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(true);
            expect(messaging.emitted[0]).toMatchObject({ audience: ['user_9'], payload: { title: 'Heads up' } });
        });

        it('fails the step when title is missing', async () => {
            engine.registerFlow('notify_flow', notifyFlow({ recipients: ['user_1'] }));
            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('title');
        });

        it('fails the step when no recipient is given', async () => {
            engine.registerFlow('notify_flow', notifyFlow({ title: 'Hi' }));
            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('recipient');
        });
    });

    describe('without a messaging service', () => {
        it('degrades to a no-op success (skipped) rather than failing the flow', async () => {
            const engine = new AutomationEngine(createTestLogger());
            registerNotifyNode(engine, createCtx(undefined));
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Hi',
            }));

            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(true);
        });
    });
});
