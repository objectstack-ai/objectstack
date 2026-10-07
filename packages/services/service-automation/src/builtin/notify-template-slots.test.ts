// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `notify`'s `title` / `message` are TEMPLATE slots — the two spellings of one
 * text render one notification.
 *
 * `NotifyConfigSchema` types both keys with `TemplateExpressionInputSchema`, as
 * the spec's dialect table lists notification subjects/bodies among the
 * `template` slots: an author may write the bare string or the
 * `{ dialect: 'template', source }` envelope the `tmpl` helper builds. The
 * schema normalizes the bare string to that envelope, so the executor's parsed
 * config holds an envelope in BOTH cases — and `interpolate()` walks an object
 * key by key, then `stringifyForTemplate` serializes it as JSON. The executor
 * therefore reads the envelope's `source`; these pins hold the two spellings to
 * the same delivered `payload.title` / `payload.body`, and the bare string to
 * exactly what it rendered before the slots were typed.
 *
 * A separate file from `notify-node.test.ts` on purpose: another in-flight
 * change edits that file, and these pins do not need its fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tmpl } from '@objectstack/spec';
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

function notifyFlow(config: Record<string, unknown>) {
    return {
        name: 'notify_template_flow',
        label: 'Notify Template Flow',
        type: 'autolaunched' as const,
        variables: [
            { name: 'dealName', type: 'text' as const, isInput: true },
            { name: 'stage', type: 'text' as const, isInput: true },
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

const PARAMS = { dealName: 'Acme', stage: 'won' };
const TITLE = '[{stage}] Deal {dealName}';
const BODY = 'Congrats on {dealName}';
const RENDERED = { title: '[won] Deal Acme', body: 'Congrats on Acme' };

describe('notify — title / message are template slots', () => {
    let engine: AutomationEngine;
    let messaging: ReturnType<typeof fakeMessaging>;

    beforeEach(() => {
        messaging = fakeMessaging();
        engine = new AutomationEngine(createTestLogger());
        registerNotifyNode(engine, {
            logger: createTestLogger(),
            getService: (name: string) => (name === 'messaging' ? messaging.service : undefined),
        } as any);
    });

    async function deliveredFor(config: Record<string, unknown>) {
        engine.registerFlow('notify_template_flow', notifyFlow({ recipients: ['user_1'], ...config }));
        const result = await engine.execute('notify_template_flow', { params: PARAMS } as any);
        return { result, payload: messaging.emitted[messaging.emitted.length - 1]?.payload };
    }

    it('renders the bare string exactly as before the slots were typed', async () => {
        const { result, payload } = await deliveredFor({ title: TITLE, message: BODY });
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(payload).toMatchObject(RENDERED);
    });

    it('renders the template envelope to the SAME text — its `source`, never the serialized envelope', async () => {
        const { result, payload } = await deliveredFor({
            title: tmpl`[{stage}] Deal {dealName}`,
            message: { dialect: 'template', source: BODY },
        });
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(payload).toMatchObject(RENDERED);
        // The failure this replaces is specific: reading the parsed slot whole
        // delivered `{"dialect":"template","source":"…"}` as the title.
        expect(String(payload?.title)).not.toContain('dialect');
    });

    it('mixes the spellings freely across the two slots', async () => {
        const { payload } = await deliveredFor({ title: { dialect: 'template', source: TITLE }, message: BODY });
        expect(payload).toMatchObject(RENDERED);
    });

    it('refuses a value that is neither a string nor a template envelope at the contract parse, before anything is sent', async () => {
        const { result } = await deliveredFor({ title: 42 });
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('does not satisfy the notify contract');
        expect(String(result.error)).toContain('config.title');
        expect(messaging.emitted).toHaveLength(0);
    });
});
