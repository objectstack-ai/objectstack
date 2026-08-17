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

        it('forwards a click-through target via sourceObject/sourceId, interpolating the id (#2675)', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Quote {dealName} approved',
                message: 'Fill in the line items',
                channels: ['inbox'],
                sourceObject: 'mtc_quotation',
                sourceId: '{dealId}',
            }));

            const result = await engine.execute('notify_flow', {
                params: { dealName: 'Acme', dealId: 'q_42' },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted[0]).toMatchObject({
                source: { object: 'mtc_quotation', id: 'q_42' },
            });
        });

        // #4045 — this now proves the CONVERSION, not executor tolerance. The
        // executor reads only the canonical `sourceObject`/`sourceId`; the nested
        // form reaches them because `registerFlow` applies
        // `flow-node-notify-config-aliases`, which lifts it. Verified by disabling
        // the lift: `source` comes back `undefined` and this test fails.
        it('accepts the nested source:{object,id} form and forwards actorId', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Assigned to you',
                source: { object: 'opportunity', id: '{dealId}' },
                actorId: '{dealName}',
            }));

            const result = await engine.execute('notify_flow', {
                params: { dealName: 'user_boss', dealId: '99' },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted[0]).toMatchObject({
                source: { object: 'opportunity', id: '99' },
                actorId: 'user_boss',
            });
        });

        it('drops a half-specified target (object without id) rather than emitting a dead link', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Heads up',
                sourceObject: 'opportunity',
                // no sourceId
            }));

            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(true);
            expect(messaging.emitted[0].source).toBeUndefined();
        });

        // The deprecated aliases (`to`/`subject`/`body`/`url`) are rewritten to
        // the canonical keys on rehydration — `registerFlow` runs the ADR-0087
        // D2 conversion 'flow-node-notify-config-aliases' (#3796) — so a stored
        // pre-protocol-17 flow keeps working while the executor reads canonical
        // keys only.
        it('canonicalizes a stored `url` key to `actionUrl` at load', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Heads up',
                url: '/opps/{dealId}',
            }));

            const result = await engine.execute('notify_flow', {
                params: { dealId: '7' },
            } as any);
            expect(result.success).toBe(true);
            expect(messaging.emitted[0].payload).toMatchObject({ url: '/opps/7' });
        });

        it('canonicalizes stored `to`/`subject` keys at load (single recipient string form)', async () => {
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

        // ── #9205 — the localizable content path: template references ────────
        it('emits the template reference + interpolated templateData instead of inline content', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                topic: 'deal.won',
                recipients: ['user_1'],
                channels: ['inbox', 'email'],
                template: 'crm.large_deal_won',
                templateData: { dealName: '{dealName}', dealUrl: '/opps/{dealId}' },
            }));

            const result = await engine.execute('notify_flow', {
                params: { dealName: 'Acme', dealId: '42' },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted).toHaveLength(1);
            const payload = messaging.emitted[0].payload;
            // The reference rides RAW (a static metadata cross-reference); its
            // render context is interpolated per run — that pair is what the
            // email channel resolves per recipient locale at delivery time.
            expect(payload.template).toBe('crm.large_deal_won');
            expect(payload.templateData).toEqual({ dealName: 'Acme', dealUrl: '/opps/42' });
            // No inline content keys on this path: a channel without template
            // support falls back to the topic, the honest degraded rendering —
            // not an empty string masquerading as content.
            expect(payload).not.toHaveProperty('title');
            expect(payload).not.toHaveProperty('body');
        });

        it('refuses a node carrying BOTH template and inline title (the contract superRefine, at the parse seam)', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                recipients: ['user_1'],
                title: 'Deal won',
                template: 'crm.large_deal_won',
            }));
            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('`template`');
            expect(result.error).toContain('`title`');
            expect(messaging.emitted).toHaveLength(0);
        });

        it('fails the step when no recipient is given', async () => {
            engine.registerFlow('notify_flow', notifyFlow({ title: 'Hi' }));
            const result = await engine.execute('notify_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('recipient');
        });

        // ── framework#3582 — unresolved recipient templates ──────────────────
        // `{record.owner.manager}` walks `.manager` on a scalar foreign-key id
        // and resolves to nothing. `String(undefined)` used to make that the
        // six-character audience member "undefined": the emit succeeded, the
        // notification addressed nobody, and nothing anywhere said so.
        it('never sends the literal "undefined" as an audience member', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                title: 'Escalated',
                recipients: ['user_1', '{record.owner.manager}'],
            }));

            const result = await engine.execute('notify_flow', {
                record: { id: 'case_1', owner: 'usr_7' },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted[0].audience).toEqual(['user_1']);
        });

        it('fails the step, naming the template, when every recipient resolves to nothing', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                title: 'Escalated',
                recipients: ['{record.owner.manager}'],
            }));

            const result = await engine.execute('notify_flow', {
                record: { id: 'case_1', owner: 'usr_7' },
            } as any);

            expect(result.success).toBe(false);
            expect(result.error).toContain('{record.owner.manager}');
            expect(result.error).toContain('expand');
            expect(messaging.emitted).toHaveLength(0);
        });

        it('resolves a recipient hop when the start node expanded the relation (#3475)', async () => {
            engine.registerFlow('notify_flow', notifyFlow({
                title: 'Escalated',
                recipients: ['{record.owner.manager}'],
            }));

            // An expanded relation arrives on the record as a nested object.
            const result = await engine.execute('notify_flow', {
                record: { id: 'case_1', owner: { id: 'usr_7', manager: 'usr_9' } },
            } as any);

            expect(result.success).toBe(true);
            expect(messaging.emitted[0].audience).toEqual(['usr_9']);
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
