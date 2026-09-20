// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 — the `rest` provider factory: materialize a declarative
// `provider: 'rest'` connector instance from providerConfig + resolved auth.

import { describe, it, expect } from 'vitest';
import type { ConnectorProviderContext, RetryConfig } from '@objectstack/spec/integration';
import { RetryConfigSchema } from '@objectstack/spec/integration';
import { createRestProviderFactory, REST_PROVIDER_KEY } from './rest-provider.js';

function stubFetch() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            status: 200,
            ok: true,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
            json: async () => ({ ok: true }),
            text: async () => '{}',
        };
    }) as unknown as typeof fetch;
    return { impl, calls };
}

function ctx(partial: Partial<ConnectorProviderContext> & Pick<ConnectorProviderContext, 'providerConfig'>): ConnectorProviderContext {
    return { name: 'svc', label: 'Svc', type: 'api', ...partial };
}

/**
 * A RESOLVED policy, built the same way the materializer builds it — through
 * the schema, so the defaults under each override are the declared ones and
 * this file never becomes a second copy of them.
 */
function policy(over: RetryConfig = {}): ConnectorProviderContext['retryConfig'] {
    return RetryConfigSchema.parse(over);
}

describe('rest provider factory (ADR-0097)', () => {
    it('advertises the rest provider key', () => {
        expect(REST_PROVIDER_KEY).toBe('rest');
    });

    it('builds a def + request handler from providerConfig.baseUrl and applies resolved auth', async () => {
        const { impl, calls } = stubFetch();
        const factory = createRestProviderFactory({ fetchImpl: impl });
        const { def, handlers } = await factory(
            ctx({ name: 'billing', label: 'Billing', providerConfig: { baseUrl: 'https://api.example.com' }, auth: { type: 'bearer', token: 'tok' } }),
        );

        expect(def.name).toBe('billing');
        expect(Object.keys(handlers)).toEqual(['request']);

        const out = await handlers.request({ path: '/ping' }, {});
        expect(out).toMatchObject({ status: 200, ok: true });
        expect(calls[0].url).toBe('https://api.example.com/ping');
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('throws when providerConfig.baseUrl is missing', () => {
        const factory = createRestProviderFactory();
        expect(() => factory(ctx({ providerConfig: {} }))).toThrow(/baseUrl/);
    });

    it('throws when providerConfig.defaultHeaders is not a string map', () => {
        const factory = createRestProviderFactory();
        expect(() =>
            factory(ctx({ providerConfig: { baseUrl: 'https://x', defaultHeaders: { n: 1 } } })),
        ).toThrow(/defaultHeaders/);
    });

    // ── The declared retry policy is EXECUTED, not just carried (#18975) ─────
    //
    // These pins run the whole authored-metadata path — the policy arrives on
    // `ConnectorProviderContext` exactly as the materializer resolves it, and
    // what is asserted is the number of calls the upstream actually received.
    // A pin on the def's `retryConfig` field alone could not fail here: the
    // key was already storable and served back before any of this landed.
    //
    // `initialDelayMs` is the schema minimum (100) and `maxAttempts` is kept at
    // 2, so each of these costs at most one real 100ms sleep and no clock is
    // faked. ⚠️ `maxAttempts` counts TOTAL calls, the first included — the
    // contrast `content/docs/automation/flows.mdx` draws against `maxRetries`.
    describe('retryConfig on the context', () => {
        /** A fetch that answers the scripted statuses in order (last repeats). */
        function scriptedFetch(statuses: number[]) {
            const calls: string[] = [];
            const impl = (async (url: string) => {
                const status = statuses[Math.min(calls.length, statuses.length - 1)];
                calls.push(url);
                return {
                    status,
                    ok: status < 400,
                    headers: { get: () => 'application/json' },
                    json: async () => ({ status }),
                    text: async () => '{}',
                };
            }) as unknown as typeof fetch;
            return { impl, calls };
        }

        it('retries a listed status up to maxAttempts and returns the success', async () => {
            const { impl, calls } = scriptedFetch([429, 200]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({
                        strategy: 'fixed_delay',
                        maxAttempts: 2,
                        initialDelayMs: 100,
                        retryableStatusCodes: [429],
                        jitter: false,
                    }),
                }),
            );

            const out = await handlers.request({ path: '/ping' }, {});
            expect(out).toMatchObject({ status: 200, ok: true });
            expect(calls).toHaveLength(2);
        });

        it('stops at maxAttempts — a policy of 2 attempts makes exactly 2 calls', async () => {
            const { impl, calls } = scriptedFetch([429]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({
                        strategy: 'fixed_delay', maxAttempts: 2, initialDelayMs: 100,
                        retryableStatusCodes: [429], jitter: false,
                    }),
                }),
            );

            const out = await handlers.request({ path: '/ping' }, {});
            expect(out).toMatchObject({ status: 429 });
            expect(calls).toHaveLength(2);
        });

        it('maxAttempts counts TOTAL calls, the first included (⛔ not retries after it)', async () => {
            // The one pin that tells the two readings apart: under
            // "retries after the first", `maxAttempts: 3` would be FOUR calls.
            // `content/docs/automation/flows.mdx` states the contrast against
            // `maxRetries` for authors; this is that sentence, executed.
            const { impl, calls } = scriptedFetch([429]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({
                        strategy: 'fixed_delay', maxAttempts: 3, initialDelayMs: 100,
                        retryableStatusCodes: [429], jitter: false,
                    }),
                }),
            );

            await handlers.request({ path: '/ping' }, {});
            expect(calls).toHaveLength(3);
        });

        it('maxAttempts: 0 still makes the connector\'s one call, and never retries', async () => {
            const { impl, calls } = scriptedFetch([429]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({ maxAttempts: 0, initialDelayMs: 100, jitter: false }),
                }),
            );

            await handlers.request({ path: '/ping' }, {});
            expect(calls).toHaveLength(1);
        });

        it('an authored retryableStatusCodes NARROWS what is retried', async () => {
            // 500 is retryable under the wrapper's own default AND under the
            // schema default list, so a 500 answered once can only mean the
            // AUTHORED list ([429]) was the one executed.
            const { impl, calls } = scriptedFetch([500, 200]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({
                        strategy: 'fixed_delay', maxAttempts: 3, initialDelayMs: 100,
                        retryableStatusCodes: [429], jitter: false,
                    }),
                }),
            );

            const out = await handlers.request({ path: '/ping' }, {});
            expect(out).toMatchObject({ status: 500 });
            expect(calls).toHaveLength(1);
        });

        it('strategy no_retry makes exactly one call', async () => {
            const { impl, calls } = scriptedFetch([503]);
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({ strategy: 'no_retry', maxAttempts: 5, initialDelayMs: 100 }),
                }),
            );

            const out = await handlers.request({ path: '/ping' }, {});
            expect(out).toMatchObject({ status: 503 });
            expect(calls).toHaveLength(1);
        });

        it('retryOnNetworkError: false surfaces the failure on the first attempt', async () => {
            let calls = 0;
            const impl = (async () => { calls++; throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { handlers } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    retryConfig: policy({
                        strategy: 'fixed_delay', maxAttempts: 3, initialDelayMs: 100,
                        retryOnNetworkError: false, jitter: false,
                    }),
                }),
            );

            await expect(handlers.request({ path: '/ping' }, {})).rejects.toThrow(/ECONNREFUSED/);
            expect(calls).toBe(1);
        });

        it('carries the declared timeouts onto the def it registers', async () => {
            const { impl } = stubFetch();
            const factory = createRestProviderFactory({ fetchImpl: impl });
            const { def } = await factory(
                ctx({
                    providerConfig: { baseUrl: 'https://api.example.com' },
                    connectionTimeoutMs: 5000,
                    requestTimeoutMs: 7000,
                }),
            );
            expect(def.connectionTimeoutMs).toBe(5000);
            expect(def.requestTimeoutMs).toBe(7000);
        });
    });
});
