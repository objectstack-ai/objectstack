// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { createRestConnector } from './rest-connector.js';

// ─── Helpers ─────────────────────────────────────────────────────────

interface CapturedCall {
    url: string;
    init: RequestInit;
}

/** A fetch stub that records calls and returns a fixed JSON response. */
function stubFetch(responseBody: unknown = { ok: true }, status = 200) {
    const calls: CapturedCall[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            status,
            ok: status >= 200 && status < 300,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
            json: async () => responseBody,
            text: async () => JSON.stringify(responseBody),
        };
    }) as unknown as typeof fetch;
    return { impl, calls };
}

function headersOf(call: CapturedCall): Record<string, string> {
    return (call.init.headers ?? {}) as Record<string, string>;
}

// ─── request action ──────────────────────────────────────────────────

describe('createRestConnector — request action', () => {
    it('builds the URL from base + path + query and returns the parsed body', async () => {
        const { impl, calls } = stubFetch({ id: 1, name: 'Ada' });
        const { def, handlers } = createRestConnector({ baseUrl: 'https://api.example.com/', fetchImpl: impl });

        expect(def.name).toBe('rest');
        expect(def.actions?.[0].key).toBe('request');

        const out = await handlers.request({ path: '/users', query: { page: 2, active: true } }, {});

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.example.com/users?page=2&active=true');
        expect(calls[0].init.method).toBe('GET');
        expect(out).toEqual({ status: 200, ok: true, body: { id: 1, name: 'Ada' } });
    });

    it('retries a transient 503 then returns the success (P1-1)', async () => {
        let n = 0;
        const calls: number[] = [];
        const impl = (async () => {
            calls.push(1);
            const status = n++ === 0 ? 503 : 200;
            return {
                status,
                ok: status >= 200 && status < 300,
                headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
                json: async () => ({ ok: status === 200 }),
                text: async () => '',
            };
        }) as unknown as typeof fetch;
        const { handlers } = createRestConnector({ baseUrl: 'https://api.example.com', fetchImpl: impl });

        const out = await handlers.request({ path: '/x' }, {});
        expect(calls.length).toBe(2); // retried the 503 once
        expect(out.status).toBe(200);
    });

    it('JSON-encodes the body and sets Content-Type for non-GET', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({ baseUrl: 'https://api.example.com', fetchImpl: impl });

        await handlers.request({ method: 'post', path: 'items', body: { name: 'x' } }, {});

        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.body).toBe('{"name":"x"}');
        expect(headersOf(calls[0])['Content-Type']).toBe('application/json');
    });

    it('does not send a body on GET', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({ baseUrl: 'https://api.example.com', fetchImpl: impl });

        await handlers.request({ method: 'GET', path: '/ping', body: { ignored: true } }, {});
        expect(calls[0].init.body).toBeUndefined();
    });
});

// ─── request URL: a base URL that carries its own query ──────────────

describe('createRestConnector — base URL with a query string', () => {
    /** The URL one `request` dispatch sent, for a base URL and an action input. */
    async function sentUrl(baseUrl: string, input: Record<string, unknown>, auth?: Parameters<typeof createRestConnector>[0]['auth']) {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({ baseUrl, auth, fetchImpl: impl });
        await handlers.request(input, {});
        expect(calls).toHaveLength(1);
        return calls[0].url;
    }

    it.each([
        ['a path', 'https://api.example.com/v1?region=eu', '/items', 'https://api.example.com/v1/items?region=eu'],
        ['a path without its leading slash', 'https://api.example.com/v1?region=eu', 'items', 'https://api.example.com/v1/items?region=eu'],
        ['a base with a trailing slash', 'https://api.example.com/v1/?region=eu', '/items', 'https://api.example.com/v1/items?region=eu'],
        ['a base with no path', 'https://api.example.com?api-version=2024-01', '/items', 'https://api.example.com/items?api-version=2024-01'],
        ['several base parameters', 'https://api.example.com/v1?region=eu&api-version=2024-01', '/items/7', 'https://api.example.com/v1/items/7?region=eu&api-version=2024-01'],
        ['an empty path', 'https://api.example.com/v1?region=eu', '', 'https://api.example.com/v1?region=eu'],
    ])('%s: the path joins the base path and the base query stays the query', async (_label, baseUrl, path, expected) => {
        expect(await sentUrl(baseUrl, { path })).toBe(expected);
    });

    it('merges the action query after the base query', async () => {
        expect(await sentUrl('https://api.example.com/v1?region=eu', { path: '/items', query: { page: 2 } }))
            .toBe('https://api.example.com/v1/items?region=eu&page=2');
    });

    it('a clash with the base parameter: the action query wins', async () => {
        // `query` replaces the value where the parameter already stands.
        expect(await sentUrl('https://api.example.com/v1?region=eu&api-version=1', { path: '/items', query: { region: 'us' } }))
            .toBe('https://api.example.com/v1/items?region=us&api-version=1');
    });

    it('a clash with the base parameter: a query written inline in the path wins too', async () => {
        expect(await sentUrl('https://api.example.com/v1?region=eu&api-version=1', { path: '/items?region=us&page=2' }))
            .toBe('https://api.example.com/v1/items?api-version=1&region=us&page=2');
    });

    it('an api-key query parameter rides beside the base query', async () => {
        expect(await sentUrl('https://api.example.com/v1?region=eu', { path: '/me' }, { type: 'api-key', key: 'k-1', paramName: 'api_key' }))
            .toBe('https://api.example.com/v1/me?region=eu&api_key=k-1');
    });

    it('a base fragment keeps the place the text join gave it', async () => {
        expect(await sentUrl('https://api.example.com/v1?region=eu#frag', { path: '/items' }))
            .toBe('https://api.example.com/v1?region=eu#frag/items');
        expect(await sentUrl('https://api.example.com/v1#frag', { path: '/items' }))
            .toBe('https://api.example.com/v1#frag/items');
    });

    it.each([
        ['no query', 'https://api.example.com/v1'],
        ['a query', 'https://api.example.com/v1?region=eu'],
    ])('a path never leaves the base origin (base with %s)', async (_label, baseUrl) => {
        for (const path of ['//evil.example/x', 'https://evil.example/x', '\\\\evil.example/x', '/@evil.example/x', '/../../x']) {
            const sent = new URL(await sentUrl(baseUrl, { path }));
            expect(sent.origin, path).toBe('https://api.example.com');
            expect(sent.username, path).toBe('');
            expect(sent.search, path).toBe(new URL(baseUrl).search);
        }
    });

    it('a base without a query sends the URL the text join sent', async () => {
        const cases: Array<[string, string, string]> = [
            ['https://api.example.com/v1', '/items?page=2', 'https://api.example.com/v1/items?page=2'],
            ['https://api.example.com/v1/', 'items', 'https://api.example.com/v1/items'],
            ['https://api.example.com/v1', '//evil.example/x', 'https://api.example.com/v1//evil.example/x'],
            ['https://api.example.com/v1', 'https://evil.example/x', 'https://api.example.com/v1/https://evil.example/x'],
            ['https://api.example.com', '', 'https://api.example.com/'],
        ];
        for (const [baseUrl, path, expected] of cases) expect(await sentUrl(baseUrl, { path }), `${baseUrl} + ${path}`).toBe(expected);
    });
});

// ─── auth injection ──────────────────────────────────────────────────

describe('createRestConnector — static auth', () => {
    it('injects a bearer token', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({
            baseUrl: 'https://api.example.com',
            auth: { type: 'bearer', token: 'tok-123' },
            fetchImpl: impl,
        });
        await handlers.request({ path: '/me' }, {});
        expect(headersOf(calls[0])['Authorization']).toBe('Bearer tok-123');
    });

    it('injects a basic auth header', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({
            baseUrl: 'https://api.example.com',
            auth: { type: 'basic', username: 'user', password: 'pass' },
            fetchImpl: impl,
        });
        await handlers.request({ path: '/me' }, {});
        const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
        expect(headersOf(calls[0])['Authorization']).toBe(expected);
    });

    it('injects an api-key header by default', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({
            baseUrl: 'https://api.example.com',
            auth: { type: 'api-key', key: 'k-1', headerName: 'X-Api-Key' },
            fetchImpl: impl,
        });
        await handlers.request({ path: '/me' }, {});
        expect(headersOf(calls[0])['X-Api-Key']).toBe('k-1');
    });

    it('injects an api-key as a query param when paramName is set', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({
            baseUrl: 'https://api.example.com',
            auth: { type: 'api-key', key: 'k-1', headerName: 'X-API-Key', paramName: 'api_key' },
            fetchImpl: impl,
        });
        await handlers.request({ path: '/me' }, {});
        expect(calls[0].url).toBe('https://api.example.com/me?api_key=k-1');
        expect(headersOf(calls[0])['X-API-Key']).toBeUndefined();
    });

    it('adds no auth for type none', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({ baseUrl: 'https://api.example.com', fetchImpl: impl });
        await handlers.request({ path: '/public' }, {});
        expect(headersOf(calls[0])['Authorization']).toBeUndefined();
    });

    it('merges defaultHeaders, with per-request headers winning', async () => {
        const { impl, calls } = stubFetch();
        const { handlers } = createRestConnector({
            baseUrl: 'https://api.example.com',
            defaultHeaders: { 'X-Trace': 'on', 'X-Env': 'prod' },
            fetchImpl: impl,
        });
        await handlers.request({ path: '/x', headers: { 'X-Env': 'dev' } }, {});
        const h = headersOf(calls[0]);
        expect(h['X-Trace']).toBe('on');
        expect(h['X-Env']).toBe('dev');
    });
});
