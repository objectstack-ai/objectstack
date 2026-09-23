// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 — the `openapi` provider factory: materialize a declarative
// `provider: 'openapi'` connector instance from a spec document + resolved auth.

import { describe, it, expect } from 'vitest';
import type { ConnectorProviderContext } from '@objectstack/spec/integration';
import { isConnectorUpstreamUnavailable, RetryConfigSchema } from '@objectstack/spec/integration';
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

/**
 * A RESOLVED policy, built the way the materializer builds it — through the
 * schema, so the defaults under each override are the declared ones.
 */
function policy(over: Parameters<typeof RetryConfigSchema.parse>[0] = {}): ConnectorProviderContext['retryConfig'] {
    return RetryConfigSchema.parse(over);
}

// ── The openapi transport goes through the shared wrapper (#18975) ──────────
//
// ⚠️ THIS FILE IS THE PIN FOR THAT ROUTING, and it exists because a sibling's
// pin is NOT one: `openapi-connector.ts` used a naked `fetch`, and restoring it
// left all 34 openapi tests green — a silent behaviour change on every shipped
// openapi connector with nothing that failed on revert. What is asserted here
// is the number of calls the upstream actually received, which is the only
// thing a naked fetch cannot produce.
describe('openapi provider factory — declared retry policy is executed (#18975)', () => {
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

    it('retries a listed status through resilientFetch and returns the success', async () => {
        const { impl, calls } = scriptedFetch([503, 200]);
        const factory = createOpenApiProviderFactory({ fetchImpl: impl });
        const { handlers } = await factory(
            ctx({
                providerConfig: { spec: petstore },
                retryConfig: policy({
                    strategy: 'fixed_delay',
                    maxAttempts: 2,
                    initialDelayMs: 100,
                    retryableStatusCodes: [503],
                    jitter: false,
                }),
            }),
        );

        const out = await handlers.listPets({}, {});
        expect(out).toMatchObject({ status: 200, ok: true });
        expect(calls).toHaveLength(2);
    });

    it('an authored retryableStatusCodes narrows what the openapi transport retries', async () => {
        // 500 is retryable under the wrapper's own default AND the schema
        // default, so answering it once can only mean the AUTHORED list ran.
        const { impl, calls } = scriptedFetch([500, 200]);
        const factory = createOpenApiProviderFactory({ fetchImpl: impl });
        const { handlers } = await factory(
            ctx({
                providerConfig: { spec: petstore },
                retryConfig: policy({
                    strategy: 'fixed_delay', maxAttempts: 3, initialDelayMs: 100,
                    retryableStatusCodes: [503], jitter: false,
                }),
            }),
        );

        const out = await handlers.listPets({}, {});
        expect(out).toMatchObject({ status: 500 });
        expect(calls).toHaveLength(1);
    });
});

describe('openapi provider factory (ADR-0097)', () => {
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

    // ── File-path specs (#3016 — ADR-0097 follow-up) ────────────────────────

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

// ── #3049 follow-up: remote-URL fetch fault classification ──────────────────
//
// A remote spec URL that is unreachable / transiently failing is an OPERATIONAL
// fault: the factory throws the CONNECTOR_UPSTREAM_UNAVAILABLE marker so the
// materializer degrades + retries the instance instead of failing boot
// (symmetric with connector-mcp's connect path). A wrong URL (non-retryable
// 4xx) or an unparseable document stays a plain, fatal configuration fault.

describe('openapi provider — remote spec fetch fault classification (#3049)', () => {
    const url = 'https://petstore.example.com/openapi.json';
    const cfg = { providerConfig: { spec: url } };

    it('classifies a network failure (fetch rejects) as upstream-unavailable, keeping the cause', async () => {
        const boom = new Error('connect ECONNREFUSED 93.184.216.34:443');
        const fetchImpl = (async () => { throw boom; }) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });

        const err = await factory(ctx(cfg)).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
        expect((err as Error).message).toMatch(/'pets' could not reach spec URL/);
        expect((err as Error).message).toContain('ECONNREFUSED');
        expect((err as { cause?: unknown }).cause).toBe(boom);
    });

    it.each([408, 429, 500, 502, 503, 504])(
        'classifies a transient HTTP %i as upstream-unavailable (retryable)',
        async (status) => {
            const fetchImpl = (async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
            const factory = createOpenApiProviderFactory({ fetchImpl });
            const err = await factory(ctx(cfg)).then(() => { throw new Error('expected rejection'); }, (e: unknown) => e);
            expect(isConnectorUpstreamUnavailable(err), `HTTP ${status} should degrade`).toBe(true);
            expect((err as Error).message).toContain(String(status));
        },
    );

    it.each([400, 401, 403, 404, 410])(
        'keeps a non-retryable HTTP %i a plain (fatal) configuration fault',
        async (status) => {
            const fetchImpl = (async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
            const factory = createOpenApiProviderFactory({ fetchImpl });
            const err = await factory(ctx(cfg)).then(() => { throw new Error('expected rejection'); }, (e: unknown) => e);
            expect(isConnectorUpstreamUnavailable(err), `HTTP ${status} should stay fatal`).toBe(false);
            expect((err as Error).message).toMatch(/failed to fetch spec/);
        },
    );

    it('keeps a 2xx-but-unparseable body a plain (fatal) content fault, not upstream-unavailable', async () => {
        const fetchImpl = (async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
        }) as unknown as Response) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });
        const err = await factory(ctx(cfg)).then(() => { throw new Error('expected rejection'); }, (e: unknown) => e);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as Error).message).toMatch(/not a parseable.*OpenAPI JSON document/s);
    });

    it('keeps a 2xx non-object body (array) a plain (fatal) content fault', async () => {
        const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => [1, 2] }) as unknown as Response) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });
        const err = await factory(ctx(cfg)).then(() => { throw new Error('expected rejection'); }, (e: unknown) => e);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as Error).message).toMatch(/not a parseable.*OpenAPI JSON document/s);
    });
});
