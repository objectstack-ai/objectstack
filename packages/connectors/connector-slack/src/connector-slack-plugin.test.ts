// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorSlackPlugin } from './connector-slack-plugin.js';

/** A fetch stub mimicking the Slack Web API (HTTP 200 + ok in the body). */
function stubSlack() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ ok: true, ts: '1700000000.000200', channel: 'C42' }),
            text: async () => '{"ok":true}',
        };
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('ConnectorSlackPlugin — end to end with the automation engine', () => {
    it('registers the Slack connector so a connector_action flow can post a message', async () => {
        const { impl, calls } = stubSlack();

        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorSlackPlugin({ token: 'xoxb-secret-token', fetchImpl: impl }));
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');

        // The baseline dispatch node and the plugin-contributed connector are both present.
        expect(engine.getRegisteredNodeTypes()).toContain('connector_action');
        expect(engine.getRegisteredConnectors()).toContain('slack');

        engine.registerFlow('notify_channel', {
            name: 'notify_channel',
            label: 'Post to Slack',
            type: 'autolaunched',
            variables: [{ name: 'post.ok', type: 'boolean', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'post',
                    type: 'connector_action',
                    label: 'Post to #sales',
                    connectorConfig: {
                        connectorId: 'slack',
                        actionId: 'chat.postMessage',
                        input: { channel: 'C42', text: 'Deal closed 🎉' },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'post' },
                { id: 'e2', source: 'post', target: 'end' },
            ],
        });

        const result = await engine.execute('notify_channel');

        expect(result.success).toBe(true);
        // The Slack connector handled the dispatch: one POST with bearer auth + JSON body.
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage');
        expect(calls[0].init.method).toBe('POST');
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-secret-token');
        expect(calls[0].init.body).toBe('{"channel":"C42","text":"Deal closed 🎉"}');
        // Slack's logical `ok` propagated back into the flow output.
        expect(result.output).toEqual({ 'post.ok': true });

        await kernel.shutdown();
    });
});
