// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { connectorFetchOptions, type ConnectorFetchPolicy } from './connector-fetch-policy';

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
