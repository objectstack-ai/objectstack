// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { LiteKernel, type PluginContext } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorSlackPlugin } from './connector-slack-plugin.js';
import type { SlackClientService } from './slack-connector.js';

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

describe('ConnectorSlackPlugin — the `slack` client service', () => {
    it('hands out a client for the caller\'s own token, over the plugin\'s transport options', async () => {
        const { impl, calls } = stubSlack();
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorSlackPlugin({ token: 'xoxb-flow-token', fetchImpl: impl }));
        await kernel.bootstrap();

        const slack = kernel.getService<SlackClientService>('slack');
        const out = await slack.client('xoxb-organization-token').call({ method: 'conversations.open', params: { users: 'U1' } });

        expect(out.ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://slack.com/api/conversations.open');
        // The caller's token, never the plugin's static one.
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-organization-token');
        expect(calls[0].init.body).toBe('{"users":"U1"}');

        await kernel.shutdown();
    });
});

describe('ConnectorSlackPlugin — composed without a static bot token', () => {
    it('registers only the client service: no flow connector, and the client still sends with the caller\'s token', async () => {
        const { impl, calls } = stubSlack();
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorSlackPlugin({ fetchImpl: impl }));
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');
        // The automation engine is up (positive control), yet no Slack connector was registered.
        expect(engine.getRegisteredNodeTypes()).toContain('connector_action');
        expect(engine.getRegisteredConnectors()).not.toContain('slack');

        const slack = kernel.getService<SlackClientService>('slack');
        const out = await slack.client('xoxb-organization-token').call({ method: 'chat.postMessage', params: { channel: 'D1', text: 'hi' } });
        expect(out.ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-organization-token');

        await kernel.shutdown();
    });

    it('composes with no options at all', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorSlackPlugin());
        await kernel.bootstrap();

        expect(kernel.getService<AutomationEngine>('automation').getRegisteredConnectors()).not.toContain('slack');
        expect(typeof kernel.getService<SlackClientService>('slack').client).toBe('function');

        await kernel.shutdown();
    });

    it.each([
        ['omitted', undefined],
        ['empty', ''],
    ])('says so once at boot and never touches the connector registry (token %s)', async (_label, token) => {
        const infos: string[] = [];
        const registered: string[] = [];
        const services = new Map<string, unknown>();
        services.set('automation', {
            registerConnector: (def: { name: string }) => { registered.push(def.name); },
            unregisterConnector: () => {},
        });
        const ctx = {
            registerService: (name: string, svc: unknown) => { services.set(name, svc); },
            getService: (name: string) => services.get(name),
            logger: { info: (msg: string) => { infos.push(msg); }, warn: () => {}, error: () => {}, debug: () => {} },
        } as unknown as PluginContext;

        const plugin = new ConnectorSlackPlugin(token === undefined ? {} : { token });
        await plugin.init(ctx);
        await plugin.start(ctx);

        expect(registered).toEqual([]);
        expect(services.has('slack')).toBe(true);
        const tokenLines = infos.filter((m) => m.includes('no static bot token'));
        expect(tokenLines).toHaveLength(1);
        expect(infos).toHaveLength(1);

        // Teardown with nothing registered is a no-op, not a throw.
        await plugin.destroy();
    });

    it('with a token, the same harness registers the connector (control for the skip)', async () => {
        const registered: string[] = [];
        const services = new Map<string, unknown>([[
            'automation',
            { registerConnector: (def: { name: string }) => { registered.push(def.name); }, unregisterConnector: () => {} },
        ]]);
        const ctx = {
            registerService: (name: string, svc: unknown) => { services.set(name, svc); },
            getService: (name: string) => services.get(name),
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        } as unknown as PluginContext;

        const plugin = new ConnectorSlackPlugin({ token: 'xoxb-flow-token' });
        await plugin.init(ctx);
        await plugin.start(ctx);

        expect(registered).toEqual(['slack']);
    });
});
