// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createSlackConnector } from './slack-connector.js';

// ─── Helpers ─────────────────────────────────────────────────────────

interface CapturedCall {
    url: string;
    init: RequestInit;
}

/**
 * A fetch stub mimicking the Slack Web API: always HTTP 200, with the logical
 * outcome carried in the JSON body's `ok` field.
 */
function stubSlack(responseBody: Record<string, unknown> = { ok: true }) {
    const calls: CapturedCall[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => responseBody,
            text: async () => JSON.stringify(responseBody),
        };
    }) as unknown as typeof fetch;
    return { impl, calls };
}

function headersOf(call: CapturedCall): Record<string, string> {
    return (call.init.headers ?? {}) as Record<string, string>;
}

// ─── definition ──────────────────────────────────────────────────────

describe('createSlackConnector — definition', () => {
    it('declares a slack connector with the expected actions and bearer auth', () => {
        const { def, handlers } = createSlackConnector({ token: 'xoxb-1' });

        expect(def.name).toBe('slack');
        expect(def.type).toBe('api');
        expect(def.authentication).toEqual({ type: 'bearer', token: 'xoxb-1' });

        const keys = (def.actions ?? []).map((a) => a.key);
        expect(keys).toEqual(['chat.postMessage', 'chat.update', 'call']);
        // Every declared action has a handler (the registry enforces this too).
        for (const k of keys) expect(typeof handlers[k]).toBe('function');
    });
});

// ─── chat.postMessage ────────────────────────────────────────────────

describe('createSlackConnector — chat.postMessage', () => {
    it('POSTs JSON to the method URL with a bearer token and returns ok from the payload', async () => {
        const { impl, calls } = stubSlack({ ok: true, ts: '1700000000.000100', channel: 'C123' });
        const { handlers } = createSlackConnector({ token: 'xoxb-secret', fetchImpl: impl });

        const out = await handlers['chat.postMessage'](
            { channel: 'C123', text: 'hello', thread_ts: '1699999999.0001' },
            {},
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage');
        expect(calls[0].init.method).toBe('POST');
        expect(headersOf(calls[0]).Authorization).toBe('Bearer xoxb-secret');
        expect(calls[0].init.body).toBe('{"channel":"C123","text":"hello","thread_ts":"1699999999.0001"}');

        expect(out.ok).toBe(true);
        expect(out.status).toBe(200);
        expect(out.body).toEqual({ ok: true, ts: '1700000000.000100', channel: 'C123' });
        expect(out.error).toBeUndefined();
    });

    it('surfaces a Slack logical failure (HTTP 200, ok:false) without throwing', async () => {
        const { impl } = stubSlack({ ok: false, error: 'channel_not_found' });
        const { handlers } = createSlackConnector({ token: 'xoxb-1', fetchImpl: impl });

        const out = await handlers['chat.postMessage']({ channel: 'nope', text: 'hi' }, {});

        expect(out.ok).toBe(false);
        expect(out.error).toBe('channel_not_found');
        expect(out.status).toBe(200);
    });
});

// ─── chat.update + call ───────────────────────────────────────────────

describe('createSlackConnector — chat.update & generic call', () => {
    it('chat.update hits the chat.update method', async () => {
        const { impl, calls } = stubSlack({ ok: true });
        const { handlers } = createSlackConnector({ token: 'xoxb-1', fetchImpl: impl });

        await handlers['chat.update']({ channel: 'C1', ts: '170.1', text: 'edited' }, {});
        expect(calls[0].url).toBe('https://slack.com/api/chat.update');
        expect(calls[0].init.body).toBe('{"channel":"C1","ts":"170.1","text":"edited"}');
    });

    it('call dispatches to an arbitrary Web API method with params', async () => {
        const { impl, calls } = stubSlack({ ok: true, channels: [] });
        const { handlers } = createSlackConnector({ token: 'xoxb-1', fetchImpl: impl });

        const out = await handlers.call({ method: 'conversations.list', params: { limit: 50 } }, {});
        expect(calls[0].url).toBe('https://slack.com/api/conversations.list');
        expect(calls[0].init.body).toBe('{"limit":50}');
        expect(out.ok).toBe(true);
    });

    it('call throws when method is missing', async () => {
        const { impl } = stubSlack();
        const { handlers } = createSlackConnector({ token: 'xoxb-1', fetchImpl: impl });
        await expect(handlers.call({ params: {} }, {})).rejects.toThrow(/method.*required/);
    });

    it('honours a custom baseUrl and merges defaultHeaders', async () => {
        const { impl, calls } = stubSlack();
        const { handlers } = createSlackConnector({
            token: 'xoxb-1',
            baseUrl: 'https://slack.example.test/api/',
            defaultHeaders: { 'X-Trace': 'on' },
            fetchImpl: impl,
        });

        await handlers['chat.postMessage']({ channel: 'C1', text: 'x' }, {});
        expect(calls[0].url).toBe('https://slack.example.test/api/chat.postMessage');
        expect(headersOf(calls[0])['X-Trace']).toBe('on');
        // Auth still wins over defaultHeaders.
        expect(headersOf(calls[0]).Authorization).toBe('Bearer xoxb-1');
    });
});
