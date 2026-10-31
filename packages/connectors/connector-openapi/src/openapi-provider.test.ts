// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 — the `openapi` provider factory: materialize a declarative
// `provider: 'openapi'` connector instance from a spec document + resolved auth.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { ConnectorProviderContext, ConnectorRequestSigner } from '@objectstack/spec/integration';
import { isConnectorUpstreamUnavailable, RetryConfigSchema } from '@objectstack/spec/integration';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorOpenApiPlugin } from './connector-openapi-plugin.js';
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

// ── Only OpenAPI 3.x loads; a Swagger 2.0 document is refused at load ───────
//
// A 2.0 document carries `host` / `basePath` and `body` / `formData`
// parameters the 3.x generator never reads, so loading one would bring the
// instance up with wrong actions and no error. Each spec form (inline, URL,
// file) is refused as a plain configuration fault — fatal at boot, never the
// upstream-unavailable marker that would degrade and retry it — with the
// source named and the offline conversion as the remedy.

describe('openapi provider — refuses a document that is not OpenAPI 3.x', () => {
    const swagger2 = {
        swagger: '2.0',
        info: { title: 'Legacy', version: '1.0.0' },
        host: 'legacy.example.com',
        basePath: '/v1',
        paths: {
            '/pets': {
                post: {
                    operationId: 'createPet',
                    parameters: [{ in: 'body', name: 'pet', schema: { type: 'object' } }],
                    responses: { '200': { description: 'ok' } },
                },
            },
        },
    };

    async function refusal(result: unknown): Promise<Error> {
        const err = await Promise.resolve(result).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        return err as Error;
    }

    it('refuses a Swagger 2.0 file-path spec, naming the file and the offline conversion', async () => {
        const factory = createOpenApiProviderFactory();
        const err = await refusal(
            factory(ctx({ providerConfig: { spec: './specs/legacy.json' }, loadPackageFile: async () => JSON.stringify(swagger2) })),
        );
        expect(err.message).toContain("connector 'pets' providerConfig.spec file './specs/legacy.json'");
        expect(err.message).toContain('a Swagger "2.0" document');
        expect(err.message).toContain('Convert the document to OpenAPI 3.x offline');
    });

    it('refuses a Swagger 2.0 document fetched from a URL, naming the URL', async () => {
        const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => swagger2 }) as unknown as Response) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });
        const err = await refusal(factory(ctx({ providerConfig: { spec: 'https://legacy.example.com/swagger.json' } })));
        expect(err.message).toContain("URL 'https://legacy.example.com/swagger.json'");
        expect(err.message).toContain('a Swagger "2.0" document');
        expect(err.message).toContain('Convert the document to OpenAPI 3.x offline');
    });

    it('refuses an inline Swagger 2.0 document', async () => {
        const factory = createOpenApiProviderFactory();
        const err = await refusal(factory(ctx({ providerConfig: { spec: swagger2 } })));
        expect(err.message).toContain('(the inline document) is a Swagger "2.0" document');
    });

    it('refuses a document with no openapi field, and one declaring a version other than 3.x', async () => {
        const factory = createOpenApiProviderFactory();
        const { openapi: _omitted, ...unversioned } = petstore;
        const missing = await refusal(factory(ctx({ providerConfig: { spec: unversioned } })));
        expect(missing.message).toContain("a document with no 'openapi' version field");
        const four = await refusal(factory(ctx({ providerConfig: { spec: { ...petstore, openapi: '4.0.0' } } })));
        expect(four.message).toContain('a document declaring openapi: "4.0.0"');
    });

    it('loads every 3.x minor (3.1 included)', async () => {
        const factory = createOpenApiProviderFactory();
        for (const openapi of ['3.0.3', '3.1.0', '3.1']) {
            const { def } = await factory(ctx({ providerConfig: { spec: { ...petstore, openapi } } }));
            expect(def.actions?.map((a) => a.key), openapi).toEqual(['listPets']);
        }
    });
});

// ── providerConfig.include — a declarative operation allowlist ─────────────
//
// The same allowlist meaning as the mcp provider's `include`: only the listed
// operations become actions. An entry is an operation's action key — its
// operationId, or the generated method_path key when it has none — and an
// entry naming an operation the document does not carry is a plain (fatal)
// configuration fault at materialization, never ignored.

describe('openapi provider — providerConfig.include', () => {
    const crm = {
        openapi: '3.0.3',
        info: { title: 'CRM', version: '1.0.0' },
        servers: [{ url: 'https://crm.example.com' }],
        paths: {
            '/customers': {
                get: { operationId: 'listCustomers', responses: { '200': { description: 'ok' } } },
                post: { operationId: 'createCustomer', responses: { '201': { description: 'created' } } },
            },
            '/customers/{id}': {
                // No operationId: the action key is the generated method_path slug.
                delete: { responses: { '204': { description: 'gone' } } },
            },
        },
    };

    async function refusal(result: unknown): Promise<Error> {
        const err = await Promise.resolve(result).then(
            () => { throw new Error('expected rejection'); },
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        return err as Error;
    }

    it('without include, every operation is an action (control)', async () => {
        const { def } = await createOpenApiProviderFactory()(ctx({ providerConfig: { spec: crm } }));
        expect(def.actions?.map((a) => a.key)).toEqual(['listCustomers', 'createCustomer', 'delete_customers_id']);
    });

    it("include: ['listCustomers'] exposes exactly that action", async () => {
        const { def, handlers } = await createOpenApiProviderFactory()(
            ctx({ providerConfig: { spec: crm, include: ['listCustomers'] } }),
        );
        expect(def.actions?.map((a) => a.key)).toEqual(['listCustomers']);
        expect(Object.keys(handlers)).toEqual(['listCustomers']);
    });

    it('names an operation without an operationId by its generated method_path key', async () => {
        const { def } = await createOpenApiProviderFactory()(
            ctx({ providerConfig: { spec: crm, include: ['delete_customers_id', 'createCustomer'] } }),
        );
        // Document order, not include order — the allowlist filters, it does not reorder.
        expect(def.actions?.map((a) => a.key)).toEqual(['createCustomer', 'delete_customers_id']);
    });

    it("include: ['nope'] refuses at materialization, naming the entry and the document's keys", async () => {
        const err = await refusal(
            createOpenApiProviderFactory()(ctx({ providerConfig: { spec: crm, include: ['listCustomers', 'nope'] } })),
        );
        expect(err.message).toContain("connector 'pets' providerConfig.include names 'nope', which the OpenAPI document does not carry");
        expect(err.message).toContain("'listCustomers', 'createCustomer', 'delete_customers_id'");
        expect(err.message).not.toContain("'listCustomers', which");
    });

    it('an operation that has an operationId is not named by its method_path key', async () => {
        const err = await refusal(
            createOpenApiProviderFactory()(ctx({ providerConfig: { spec: crm, include: ['get_customers'] } })),
        );
        expect(err.message).toContain("names 'get_customers', which the OpenAPI document does not carry");
    });

    it('refuses an include that is not an array of non-empty strings, before the document is fetched', async () => {
        let fetched = 0;
        const fetchImpl = (async () => {
            fetched++;
            return { ok: true, status: 200, json: async () => crm } as unknown as Response;
        }) as unknown as typeof fetch;
        const factory = createOpenApiProviderFactory({ fetchImpl });
        for (const include of ['listCustomers', ['listCustomers', 7], [''], { listCustomers: true }, null]) {
            const err = await refusal(factory(ctx({ providerConfig: { spec: 'https://crm.example.com/openapi.json', include } })));
            expect(err.message, JSON.stringify(include)).toContain("connector 'pets' providerConfig.include must be an array of operation keys");
        }
        expect(fetched).toBe(0);
    });

    it('an empty include admits no operation, as an empty mcp include admits no tool', async () => {
        const { def } = await createOpenApiProviderFactory()(ctx({ providerConfig: { spec: crm, include: [] } }));
        expect(def.actions).toEqual([]);
    });

    describe('through a real boot (AutomationServicePlugin + ConnectorOpenApiPlugin)', () => {
        async function boot(include: unknown) {
            const declared = [
                { name: 'crm_api', label: 'CRM API', type: 'api', provider: 'openapi', providerConfig: { spec: crm, include } },
            ];
            const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
            kernel.use(new AutomationServicePlugin());
            kernel.use({
                name: 'test.connector-metadata',
                type: 'standard',
                version: '1.0.0',
                dependencies: ['com.objectstack.service-automation'],
                async init(c: { registerService(name: string, service: unknown): void }) {
                    c.registerService('objectql', {
                        registry: { listItems: (type: string) => (type === 'connector' ? declared : []) },
                    });
                },
                async start() {},
            } as never);
            kernel.use(new ConnectorOpenApiPlugin());
            return kernel;
        }

        it('a declared include reaches GET /connectors as exactly the listed action', async () => {
            const kernel = await boot(['listCustomers']);
            try {
                await kernel.bootstrap();
                const engine = kernel.getService<AutomationEngine>('automation');
                const crmApi = engine.getConnectorDescriptors().find((d) => d.name === 'crm_api');
                expect(crmApi?.state).toBe('ready');
                expect(crmApi?.actions.map((a) => a.key)).toEqual(['listCustomers']);
            } finally {
                await kernel.shutdown().catch(() => {});
            }
        });

        it('an unknown include entry fails the boot instead of degrading', async () => {
            const kernel = await boot(['nope']);
            try {
                await expect(kernel.bootstrap()).rejects.toThrow(/providerConfig\.include names 'nope'/);
                const engine = kernel.getService<AutomationEngine>('automation');
                expect(engine.getConnectorDegradedReason('crm_api')).toBeUndefined();
            } finally {
                await kernel.shutdown().catch(() => {});
            }
        });
    });
});

// ── Path-item-level `parameters` (OpenAPI 3.x Path Item Object) ─────────────
//
// A Path Item's `parameters` apply to every operation under that path, and an
// operation entry with the same `name` + `in` overrides the path-level one.
// The generator read the operation's own array only, so an id declared once on
// the path (the common vendor shape for GET / PATCH / DELETE on one resource)
// was missing from every action's input schema. One pin per shape, each read
// off the materialized action an author or the flow designer is shown.
describe('openapi provider — path-item-level parameters', () => {
    const ok = { '200': { description: 'ok' } };
    async function inputSchemaOf(paths: Record<string, unknown>, key: string) {
        const spec = { openapi: '3.0.3', info: { title: 'Pets', version: '1.0.0' }, servers: [{ url: 'https://pets.example.com' }], paths };
        const { def } = await createOpenApiProviderFactory()(ctx({ providerConfig: { spec } }));
        return def.actions?.find((a) => a.key === key)?.inputSchema;
    }

    it('a path-level parameter reaches every operation under the path, and stays required', async () => {
        const paths = {
            '/pets/{petId}': {
                parameters: [{ name: 'petId', in: 'path', required: true }],
                get: { operationId: 'getPet', responses: ok },
                delete: { operationId: 'deletePet', responses: ok },
            },
        };
        for (const key of ['getPet', 'deletePet']) {
            expect(await inputSchemaOf(paths, key), key).toEqual({
                type: 'object',
                properties: { path: { type: 'object', properties: { petId: { type: 'string' } }, required: ['petId'] } },
                required: ['path'],
            });
        }
    });

    it('an operation entry with the same name + in replaces the path-level one whole', async () => {
        const schema = await inputSchemaOf({
            '/pets': {
                parameters: [
                    { name: 'limit', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'offset', in: 'query', schema: { type: 'integer' } },
                ],
                get: {
                    operationId: 'listPets',
                    parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
                    responses: ok,
                },
            },
        }, 'listPets');
        // The operation's entry wins: its schema, and its (absent) `required` —
        // a concatenation would keep the path-level `required: ['limit']`. The
        // path-level `offset` nobody overrides still arrives.
        expect(schema).toEqual({
            type: 'object',
            properties: { query: { type: 'object', properties: { offset: { type: 'integer' }, limit: { type: 'integer' } } } },
        });
    });

    it('a path-level and an operation-level parameter that share a name but not `in` both appear', async () => {
        const schema = await inputSchemaOf({
            '/pets/{id}': {
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                get: {
                    operationId: 'getPet',
                    parameters: [{ name: 'id', in: 'header', schema: { type: 'string' } }],
                    responses: ok,
                },
            },
        }, 'getPet');
        expect(schema).toEqual({
            type: 'object',
            properties: {
                path: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
                header: { type: 'object', properties: { id: { type: 'string' } } },
            },
            required: ['path'],
        });
    });

    it('an operation with no path-level parameters keeps exactly its own (control)', async () => {
        const schema = await inputSchemaOf({
            '/pets/{petId}': {
                get: {
                    operationId: 'getPet',
                    parameters: [
                        { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
                        { name: 'detail', in: 'query', schema: { type: 'string' } },
                    ],
                    responses: ok,
                },
            },
        }, 'getPet');
        expect(schema).toEqual({
            type: 'object',
            properties: {
                path: { type: 'object', properties: { petId: { type: 'integer' } }, required: ['petId'] },
                query: { type: 'object', properties: { detail: { type: 'string' } } },
            },
            required: ['path'],
        });
    });
});

// ADR-0143 D2.3 — a `signed` instance arrives with a request signer instead of
// a credential. Every generated action signs every attempt with it (a retry
// included), runs its response verification before answering, and the
// provider says it does so — the host serves a `signed` instance on nothing less.
describe('openapi provider — a signed instance (ADR-0143 D2.3)', () => {
    function signerDouble(over: Partial<ConnectorRequestSigner> = {}) {
        const signed: string[] = [];
        const signer: ConnectorRequestSigner = {
            connector: 'pets',
            scheme: 'aliyun-acs3-hmac-sha256',
            async sign(request) {
                signed.push(`${request.method} ${request.url}`);
                return { headers: { authorization: `SIG-${signed.length}` } };
            },
            ...over,
        };
        return { signer, signed };
    }

    function statusFetch(statuses: number[]) {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const impl = (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response('[{"id":1}]', { status: statuses.shift() ?? 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch;
        return { impl, calls };
    }

    it('signs every attempt, a retry included, and says it applies the signer', async () => {
        const { signer, signed } = signerDouble();
        const { impl, calls } = statusFetch([503, 200]);
        const materialization = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({
            providerConfig: { spec: petstore },
            requestSigner: signer,
            retryConfig: policy({ strategy: 'fixed_delay', maxAttempts: 2, initialDelayMs: 100, retryableStatusCodes: [503], jitter: false }),
        }));
        expect(materialization.requestSignerApplied).toBe(true);

        const out = await materialization.handlers.listPets({ query: { limit: 2 } }, {});
        expect(out).toEqual({ status: 200, ok: true, body: [{ id: 1 }] });
        expect(signed).toEqual(['GET https://petstore.example.com/pets?limit=2', 'GET https://petstore.example.com/pets?limit=2']);
        expect(calls.map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual(['SIG-1', 'SIG-2']);
    });

    it("a response that fails the scheme's verification fails the dispatch", async () => {
        const { signer } = signerDouble({ async verifyResponse() { throw new Error('response signature does not verify'); } });
        const { impl } = statusFetch([200]);
        const { handlers } = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({
            providerConfig: { spec: petstore },
            requestSigner: signer,
        }));
        await expect(handlers.listPets({}, {})).rejects.toThrow(/does not verify/);
    });

    it('CONTROL: a static instance carries no signer acknowledgement and its credential is applied as before', async () => {
        const { impl, calls } = statusFetch([200]);
        const materialization = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({
            providerConfig: { spec: petstore },
            auth: { type: 'bearer', token: 'tok' },
        }));
        expect('requestSignerApplied' in materialization).toBe(false);
        await materialization.handlers.listPets({}, {});
        expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('refuses a static credential and a signer together', async () => {
        const { signer } = signerDouble();
        await expect(createOpenApiProviderFactory({})(ctx({
            providerConfig: { spec: petstore },
            auth: { type: 'bearer', token: 't' },
            requestSigner: signer,
        }))).rejects.toThrow(/authenticated one way/);
    });
});
