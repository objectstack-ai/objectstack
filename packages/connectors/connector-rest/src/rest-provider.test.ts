// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0096 — the `rest` provider factory: materialize a declarative
// `provider: 'rest'` connector instance from providerConfig + resolved auth.

import { describe, it, expect } from 'vitest';
import type { ConnectorProviderContext } from '@objectstack/spec/integration';
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

describe('rest provider factory (ADR-0096)', () => {
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
});
