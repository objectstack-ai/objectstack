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

    // ── File-path specs (#3016 — ADR-0096 follow-up) ────────────────────────

    it('reads a file-path spec through the host loadPackageFile capability', async () => {
        const requested: string[] = [];
        const loadPackageFile = async (rel: string) => {
            requested.push(rel);
            return JSON.stringify(petstore);
        };
        const factory = createOpenApiProviderFactory();
        const { def, handlers } = await factory(
            ctx({ providerConfig: { spec: './specs/petstore.json' }, loadPackageFile }),
        );
        expect(requested).toEqual(['./specs/petstore.json']);
        expect(def.actions?.map((a) => a.key)).toEqual(['listPets']);
        expect(Object.keys(handlers)).toEqual(['listPets']);
    });

    it('surfaces a loader failure (missing file / traversal rejection) with the connector name', async () => {
        const loadPackageFile = async (rel: string) => {
            throw new Error(`package file ref '${rel}' could not be read`);
        };
        const factory = createOpenApiProviderFactory();
        await expect(
            factory(ctx({ providerConfig: { spec: './missing.json' }, loadPackageFile })),
        ).rejects.toThrow(/'pets' failed to read providerConfig\.spec '\.\/missing\.json'.*could not be read/s);
    });

    it('rejects an unparseable file-path spec with a clear message', async () => {
        const factory = createOpenApiProviderFactory();
        await expect(
            factory(ctx({ providerConfig: { spec: './broken.json' }, loadPackageFile: async () => 'not-json{' })),
        ).rejects.toThrow(/not a parseable.*OpenAPI JSON document/s);
        await expect(
            factory(ctx({ providerConfig: { spec: './array.json' }, loadPackageFile: async () => '[1,2]' })),
        ).rejects.toThrow(/not a parseable.*OpenAPI JSON document/s);
    });

    it('rejects a file-path spec with a clear message when the host has no package file access', async () => {
        const factory = createOpenApiProviderFactory();
        await expect(
            factory(ctx({ providerConfig: { spec: './petstore.json' } })),
        ).rejects.toThrow(/no package file access/);
    });
});
