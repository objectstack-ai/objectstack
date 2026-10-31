// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { connectorFetchOptions, readConnectorResponse, type ConnectorFetchPolicy } from './connector-fetch-policy';
import type { ConnectorRequestSigner, ConnectorSignableRequest } from './connector-provider';
import { resilientFetch } from '../shared/resilient-fetch';

describe('connectorFetchOptions', () => {
    it('leaves the wrapper on its own defaults when nothing is declared', () => {
        // The no-policy path is what keeps every connector that declares
        // nothing on exactly its prior behaviour, so it is pinned first.
        expect(connectorFetchOptions({})).toEqual({});
    });

    it('maps requestTimeoutMs onto the per-attempt timeout', () => {
        expect(connectorFetchOptions({ requestTimeoutMs: 4500 }).timeoutMs).toBe(4500);
    });

    it('⛔ does NOT map connectionTimeoutMs — one fetch signal cannot bound the connect phase', () => {
        // The key is absent from ConnectorFetchPolicy, so the only way it could
        // reach the wrapper is an alias onto `timeoutMs`. This pin goes red the
        // moment someone adds one, which is the whole reason it exists: two keys
        // silently meaning one thing is the shape this mapping removes, not a
        // shape it may introduce elsewhere.
        //
        // The key is now RETIRED from `ConnectorSchema` and from
        // `ConnectorProviderContext` (ADR-0049) — precisely because it could
        // never be mapped here. The pin survives the retirement on purpose: it
        // is what makes a re-introduction as a silent alias fail, and a stray
        // leftover in a caller-built policy object still has to reach nothing.
        const opts = connectorFetchOptions(
            { connectionTimeoutMs: 1500 } as unknown as ConnectorFetchPolicy,
        );
        expect(opts.timeoutMs).toBeUndefined();
        expect(opts).toEqual({});
    });

    it('applies the schema defaults for an empty retryConfig', () => {
        const opts = connectorFetchOptions({ retryConfig: {} });
        expect(opts.strategy).toBe('exponential_backoff');
        // `maxAttempts` counts TOTAL calls, so the default 3 is 3 calls —
        // which is also exactly what the wrapper defaults to on its own.
        expect(opts.retries).toBe(3);
        expect(opts.backoffBaseMs).toBe(1000);
        expect(opts.backoffMultiplier).toBe(2);
        expect(opts.maxDelayMs).toBe(60000);
        expect(opts.jitter).toBe(true);
        expect(opts.retryOnNetworkError).toBe(true);
    });

    it('turns retryableStatusCodes into the wrapper predicate', () => {
        const opts = connectorFetchOptions({ retryConfig: { retryableStatusCodes: [429, 503] } });
        expect(opts.retryableStatus?.(429)).toBe(true);
        expect(opts.retryableStatus?.(503)).toBe(true);
        // A narrower list must actually narrow: 500 is in the schema DEFAULT
        // list, so a mapping that ignored the authored value would pass it.
        expect(opts.retryableStatus?.(500)).toBe(false);
    });

    it('the default status list is the one the docs cite for a 429', () => {
        const opts = connectorFetchOptions({ retryConfig: {} });
        for (const code of [408, 429, 500, 502, 503, 504]) {
            expect(opts.retryableStatus?.(code)).toBe(true);
        }
        expect(opts.retryableStatus?.(404)).toBe(false);
    });

    it('maxAttempts: 0 passes straight through — the wrapper owns the floor', () => {
        // `min(0)` admits it and it means "make the call, never retry". The
        // floor is `resilientFetch`'s (`Math.max(1, retries)`), so this mapping
        // does no arithmetic of its own and there is only one owner of it.
        expect(connectorFetchOptions({ retryConfig: { maxAttempts: 0 } }).retries).toBe(0);
    });

    it('carries every declared knob through', () => {
        const opts = connectorFetchOptions({
            retryConfig: {
                strategy: 'linear_backoff',
                maxAttempts: 5,
                initialDelayMs: 250,
                maxDelayMs: 9000,
                backoffMultiplier: 3,
                jitter: false,
                retryOnNetworkError: false,
            },
            requestTimeoutMs: 1234,
        });
        expect(opts).toMatchObject({
            strategy: 'linear_backoff',
            retries: 5,
            backoffBaseMs: 250,
            maxDelayMs: 9000,
            backoffMultiplier: 3,
            jitter: false,
            retryOnNetworkError: false,
            timeoutMs: 1234,
        });
    });

    it('keeps the caller injections it was handed', () => {
        const fetchImpl = (async () => new Response()) as unknown as typeof fetch;
        const sleep = async (): Promise<void> => {};
        const opts = connectorFetchOptions({ retryConfig: {} }, { fetchImpl, sleep });
        expect(opts.fetchImpl).toBe(fetchImpl);
        expect(opts.sleep).toBe(sleep);
    });

    it('refuses an out-of-bounds policy rather than silently clamping it', () => {
        // `maxAttempts` is bounded max(10) on the schema. Parsing here is what
        // makes the bound real at the execution site too.
        expect(() => connectorFetchOptions({ retryConfig: { maxAttempts: 99 } })).toThrow();
    });
});

describe('connectorFetchOptions — a signed instance is signed per attempt (ADR-0143 D2.3)', () => {
    /** A signer double: each call answers a fresh nonce, and records what it was asked to sign. */
    function countingSigner(over: Partial<ConnectorRequestSigner> = {}) {
        const seen: ConnectorSignableRequest[] = [];
        const signer: ConnectorRequestSigner = {
            connector: 'vendor',
            scheme: 'aliyun-acs3-hmac-sha256',
            async sign(request) {
                seen.push(request);
                return { headers: { Authorization: `Sig n${seen.length}`, 'X-Nonce': `n${seen.length}` } };
            },
            ...over,
        };
        return { signer, seen };
    }

    /** A fetch double answering the queued statuses in order, recording each call. */
    function scriptedFetch(statuses: number[]) {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
            calls.push({ url: String(input), init });
            return new Response('{}', { status: statuses.shift() ?? 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        return { impl, calls };
    }

    it('CONTROL: without a signer the caller\'s fetch is handed through untouched', () => {
        const { impl } = scriptedFetch([]);
        expect(connectorFetchOptions({}, { fetchImpl: impl }).fetchImpl).toBe(impl);
    });

    it('signs every attempt afresh, so a retry never replays a signature', async () => {
        const { signer, seen } = countingSigner();
        const { impl, calls } = scriptedFetch([503, 200]);
        const opts = connectorFetchOptions({}, { fetchImpl: impl, sleep: async () => {} }, signer);
        const res = await resilientFetch('https://api.example.com/v1/items?q=1', {
            method: 'post',
            headers: { 'Content-Type': 'application/json' },
            body: '{"a":1}',
        }, opts);
        expect(res.status).toBe(200);
        expect(seen).toHaveLength(2);
        expect(calls.map((c) => (c.init.headers as Record<string, string>)['x-nonce'])).toEqual(['n1', 'n2']);
        expect(seen[0]).toEqual({
            method: 'POST',
            url: 'https://api.example.com/v1/items?q=1',
            headers: { 'content-type': 'application/json' },
            body: '{"a":1}',
        });
    });

    it('a signer header replaces a same-named request header, whatever its case', async () => {
        const { signer } = countingSigner();
        const { impl, calls } = scriptedFetch([200]);
        await resilientFetch('https://api.example.com/', { headers: { authorization: 'Bearer stale' } },
            connectorFetchOptions({}, { fetchImpl: impl }, signer));
        expect(calls[0]!.init.headers).toEqual({ authorization: 'Sig n1', 'x-nonce': 'n1' });
    });

    it('sends the URL a signer answers, when its scheme signs a canonical query', async () => {
        const { signer } = countingSigner({
            async sign() { return { headers: {}, url: 'https://api.example.com/?a=x%20y' }; },
        });
        const { impl, calls } = scriptedFetch([200]);
        await resilientFetch('https://api.example.com/?a=x+y', {}, connectorFetchOptions({}, { fetchImpl: impl }, signer));
        expect(calls[0]!.url).toBe('https://api.example.com/?a=x%20y');
    });

    it('refuses a body that is not text, and a Request object, rather than sign something else', async () => {
        const { signer } = countingSigner();
        const { impl, calls } = scriptedFetch([]);
        const opts = connectorFetchOptions({}, { fetchImpl: impl, sleep: async () => {} }, signer);
        await expect(opts.fetchImpl!('https://api.example.com/', { method: 'POST', body: new Uint8Array([1]) }))
            .rejects.toThrow(/body must be text/);
        await expect(opts.fetchImpl!(new Request('https://api.example.com/'))).rejects.toThrow(/not as a Request object/);
        expect(calls).toHaveLength(0);
    });
});

describe('readConnectorResponse', () => {
    const json = (body: string, status = 200) =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } });

    it('CONTROL: parses JSON and passes text through, as the HTTP connectors always did', async () => {
        expect(await readConnectorResponse(json('{"a":1}'))).toEqual({ status: 200, ok: true, body: { a: 1 } });
        expect(await readConnectorResponse(new Response('plain', { status: 404 })))
            .toEqual({ status: 404, ok: false, body: 'plain' });
    });

    it('CONTROL: a signer without response verification reads exactly as no signer', async () => {
        const signer: ConnectorRequestSigner = { connector: 'v', scheme: 'aliyun-acs3-hmac-sha256', sign: async () => ({ headers: {} }) };
        expect(await readConnectorResponse(json('{"a":1}'), signer)).toEqual({ status: 200, ok: true, body: { a: 1 } });
    });

    it('runs verifyResponse over the raw body before parsing', async () => {
        const verified: string[] = [];
        const signer: ConnectorRequestSigner = {
            connector: 'v',
            scheme: 'aliyun-acs3-hmac-sha256',
            sign: async () => ({ headers: {} }),
            async verifyResponse(response) {
                verified.push(`${response.status} ${response.headers.get('x-sig')} ${response.body}`);
            },
        };
        const res = new Response('{ "a" : 1 }', { headers: { 'content-type': 'application/json', 'x-sig': 'ok' } });
        expect(await readConnectorResponse(res, signer)).toEqual({ status: 200, ok: true, body: { a: 1 } });
        expect(verified).toEqual(['200 ok { "a" : 1 }']);
    });

    it('a response that fails verification throws, and its body is never returned', async () => {
        const signer: ConnectorRequestSigner = {
            connector: 'v',
            scheme: 'aliyun-acs3-hmac-sha256',
            sign: async () => ({ headers: {} }),
            async verifyResponse() { throw new Error('response signature does not verify'); },
        };
        await expect(readConnectorResponse(json('{"forged":true}'), signer)).rejects.toThrow(/does not verify/);
    });
});
