// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0096 — the `openapi` provider factory: materialize a declarative
// `provider: 'openapi'` connector instance from a spec document + resolved auth.

import { describe, it, expect } from 'vitest';
import type { ConnectorProviderContext } from '@objectstack/spec/integration';
import { createOpenApiProviderFactory, OPENAPI_PROVIDER_KEY } from './openapi-provider.js';

const petstore = {
    openapi: '3.0.0',
    info: { title: 'Petstore', version: '1.0.0' },
    servers: [{ url: 'https://petstore.example.com' }],
    paths: {
        '/pets': {
            get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'ok' } } },
        },
    },
};

function ctx(partial: Partial<ConnectorProviderContext> & Pick<ConnectorProviderContext, 'providerConfig'>): ConnectorProviderContext {
    return { name: 'pets', label: 'Pets', type: 'api', ...partial };
}

describe('openapi provider factory (ADR-0096)', () => {
    it('advertises the openapi provider key', () => {
        expect(OPENAPI_PROVIDER_KEY).toBe('openapi');
    });

    it('materializes actions from an inline OpenAPI document (no network at boot)', async () => {
        const factory = createOpenApiProviderFactory();
        const { def, handlers } = await factory(ctx({ providerConfig: { spec: petstore } }));
        expect(def.name).toBe('pets');
        expect(Object.keys(handlers)).toEqual(['listPets']);
        expect(def.actions?.map((a) => a.key)).toEqual(['listPets']);
    });

    it('fetches the document when spec is an http(s) URL, via the injected fetch', async () => {
        let fetched: string | undefined;
        const fetchImpl = (async (url: string) => {
            fetched = url;
            return { ok: true, status: 200, json: async () => petstore } as unknown as Response;
        }) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });
        const { def } = await factory(ctx({ providerConfig: { spec: 'https://petstore.example.com/openapi.json' } }));
        expect(fetched).toBe('https://petstore.example.com/openapi.json');
        expect(def.actions?.map((a) => a.key)).toEqual(['listPets']);
    });

    it('throws when spec is missing', async () => {
        const factory = createOpenApiProviderFactory();
        await expect(factory(ctx({ providerConfig: {} }))).rejects.toThrow(/providerConfig\.spec/);
    });

    it('rejects a bare file-path spec with a clear message', async () => {
        const factory = createOpenApiProviderFactory();
        await expect(
            factory(ctx({ providerConfig: { spec: './petstore.json' } })),
        ).rejects.toThrow(/not an http\(s\) URL/);
    });
});
