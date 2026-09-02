// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11984] The REST server runs the DECLARED contract of its four sibling
 * sub-objects — `crud`, `metadata`, `batch`, `routes` — at construction.
 *
 * #11637 made `RestServer.normalizeConfig` parse `config.api` against
 * `RestApiConfigSchema` before the cast the rest of the method type-checks
 * against, and deliberately left the four siblings cast-only so that ONE
 * narrowing went in front of contract review rather than five. Each sibling
 * carries declared constraints that consequently never executed
 * (`packages/spec/src/api/rest-server.zod.ts`):
 *
 *     batch.maxBatchSize:    z.number().int().min(1).max(1000).default(200)
 *     routes.nameTransform:  z.enum(['none', 'plural', 'kebab-case', 'camelCase'])
 *     crud.objectParamStyle: z.enum(['path', 'query'])
 *     metadata.cacheTtl:     z.number().int().default(3600)
 *
 * Measured on the pre-change tree (`origin/main` @ `08e49496f`): every value
 * in §A constructed a server. `batch.maxBatchSize: 0` became the live batch
 * cap (`maxBatch = batch.maxBatchSize ?? 200` — `0` is not nullish), and
 * `routes.nameTransform: 'snake_case'` sat in the normalized config as if it
 * were declared.
 *
 * ⛔ ANTI-VACUITY — the same rule as `rest-config-parse-not-cast.test.ts`: a
 * pin that asks the SCHEMA whether it refuses `maxBatchSize: 0` is green on
 * every tree (`packages/spec`'s own `rest-server.test.ts` already pins that).
 * Every case below drives the REAL `RestServer` construction — or, in §B, the
 * real plugin composition — so what it measures is whether the SERVER refuses.
 * `refusal()` answers `''` when construction succeeds, and `''` contains no
 * key name, so every `toContain` below is its own positive control.
 *
 * §C bounds the narrowing: the seam refuses exactly what the schema declares
 * and nothing this seam invented. Two bounds are named because the card that
 * filed this defect guessed them wrong: a NEGATIVE `cacheTtl` is declared
 * `.int()` only, so it stays accepted; and an UNKNOWN key inside a sub-object
 * is stripped, not refused — all four schemas are non-strict `z.object()`s.
 *
 * §D pins the consumption decision. For these four sub-objects every key
 * `normalizeConfig` reads is declared by the sub-object's schema (measured
 * key by key; the diff is empty for all four), so the PARSED output is what
 * the normalized config is built from and the schema's own defaults are the
 * defaults. `api` keeps #11637's validate-only posture — its `.omit()`ed
 * tombstone is the reason — and is not this file's subject.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { RestServerConfig } from '@objectstack/spec/api';
import { RestServer, type RestProtocol } from './rest-server.js';
import { createRestApiPlugin } from './rest-api-plugin.js';

function makeServer(): IHttpServer {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn(), close: vi.fn(),
    } as unknown as IHttpServer;
}

function makeProtocol(): RestProtocol {
    return {
        getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
    } as unknown as RestProtocol;
}

/** Construct the real server with the config as given — the seam under test. */
function construct(config: RestServerConfig): RestServer {
    return new RestServer(makeServer(), makeProtocol(), config);
}

/**
 * The construction refusal's message, or `''` when the server constructed.
 * An empty answer fails every `toContain` below on its own, which is what
 * makes each of them a positive control for the `not.toContain` beside it.
 */
function refusal(config: RestServerConfig): string {
    try {
        construct(config);
        return '';
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/** The part of the normalized config these pins read back. */
type NormalizedView = {
    crud: {
        operations: Record<'create' | 'read' | 'update' | 'delete' | 'list', boolean>;
        patterns: Record<string, unknown> | undefined;
        dataPrefix: string;
        objectParamStyle: string;
    };
    metadata: {
        prefix: string;
        cacheTtl: number;
        maskObjectFields: boolean;
        endpoints: Record<'types' | 'items' | 'item' | 'schema', boolean>;
    };
    batch: {
        maxBatchSize: number;
        defaultAtomic: boolean;
        operations: Record<'createMany' | 'updateMany' | 'deleteMany' | 'upsertMany', boolean>;
    };
    routes: {
        includeObjects: string[] | undefined;
        nameTransform: string;
    };
};

/** Read the normalized config back off a constructed server. */
function normalized(config: RestServerConfig): NormalizedView {
    return (construct(config) as unknown as { config: NormalizedView }).config;
}

// ---------------------------------------------------------------------------
// §A — the server refuses what each sibling schema declares invalid
// ---------------------------------------------------------------------------

describe('[#11984] §A RestServer construction runs the four sibling schemas', () => {
    it('refuses `batch.maxBatchSize: 0` — the value that became the live batch cap', () => {
        const message = refusal({ batch: { maxBatchSize: 0 } });
        expect(message, 'the refusal must name the sub-object AND the key').toContain('batch.maxBatchSize');
        expect(message, 'and the schema that declares the bound').toContain('BatchEndpointsConfigSchema');
        expect(message, "zod's own issue text carries the declared bound").toContain('>=1');
    });

    it('refuses `batch.maxBatchSize: 2000` — above the declared maximum', () => {
        const message = refusal({ batch: { maxBatchSize: 2000 } });
        expect(message).toContain('batch.maxBatchSize');
        expect(message).toContain('<=1000');
    });

    it('refuses `batch.maxBatchSize: 2.5` — declared `.int()`', () => {
        expect(refusal({ batch: { maxBatchSize: 2.5 } })).toContain('batch.maxBatchSize');
    });

    it('refuses `routes.nameTransform: "snake_case"` — an option outside the declared enum', () => {
        const message = refusal({ routes: { nameTransform: 'snake_case' as never } });
        expect(message).toContain('routes.nameTransform');
        expect(message).toContain('RouteGenerationConfigSchema');
        expect(message, 'the declared vocabulary is part of the prescription').toContain('kebab-case');
    });

    it('refuses `crud.objectParamStyle: "header"` — an option outside the declared enum', () => {
        const message = refusal({ crud: { objectParamStyle: 'header' as never } });
        expect(message).toContain('crud.objectParamStyle');
        expect(message).toContain('CrudEndpointsConfigSchema');
    });

    it('refuses `metadata.cacheTtl: 2.5` — declared `.int()`', () => {
        const message = refusal({ metadata: { cacheTtl: 2.5 } });
        expect(message).toContain('metadata.cacheTtl');
        expect(message).toContain('MetadataEndpointsConfigSchema');
    });

    it('refuses a declared key written with the wrong type', () => {
        expect(refusal({ crud: { dataPrefix: 42 as never } })).toContain('crud.dataPrefix');
        expect(refusal({ metadata: { enableCache: 'yes' as never } })).toContain('metadata.enableCache');
        expect(refusal({ routes: { includeObjects: 'account' as never } })).toContain('routes.includeObjects');
    });

    it('refuses `crud.patterns` keyed by an operation the CRUD vocabulary does not contain', () => {
        // `patterns` is `z.record(CrudOperation, ...)`: an enum-keyed record,
        // which zod validates key by key — so a pattern for an operation that
        // does not exist is refused, not carried along and never matched.
        const message = refusal({ crud: { patterns: { bogus: { method: 'GET', path: '/x' } } as never } });
        expect(message).toContain('crud.patterns');
        expect(message).toContain('bogus');
    });

    it('refuses a partial `routes.overrides.<object>.operations` — the declared record is exhaustive over the five operations', () => {
        // Same enum-keyed record, with a NON-optional value: zod requires
        // every declared operation, so the missing ones are named one by one.
        // The input TYPE already demanded all five at typed authoring sites;
        // this is the day the runtime agrees with `tsc`.
        const message = refusal({ routes: { overrides: { account: { operations: { list: false } as never } } } });
        expect(message).toContain('routes.overrides.account.operations.create');
        expect(message).toContain('routes.overrides.account.operations.read');
    });

    it('lists every failing key of the sub-object in one refusal', () => {
        const message = refusal({ batch: { maxBatchSize: 0, defaultAtomic: 'yes' as never } });
        expect(message).toContain('batch.maxBatchSize');
        expect(message).toContain('batch.defaultAtomic');
    });

    it('a sibling refusal never diagnoses `api.version` — a key this config did not write', () => {
        // #11637 appends an "empty version mounts the API at /api//" rationale
        // when `api.version` is what failed. A sibling refusal must not
        // inherit it: that paragraph sends the operator to a line they never
        // wrote.
        const message = refusal({ batch: { maxBatchSize: 0 } });
        expect(message, 'positive control: the refusal is present').toContain('batch.maxBatchSize');
        expect(message).not.toContain('/api//');
        expect(message).not.toContain('api.version');
    });
});

// ---------------------------------------------------------------------------
// §B — the real plugin composition, i.e. BOTH cast hops
// ---------------------------------------------------------------------------

type StartContext = Parameters<NonNullable<ReturnType<typeof createRestApiPlugin>['start']>>[0];

function bootCtx(): StartContext {
    const services: Record<string, unknown> = { 'http.server': makeServer(), protocol: makeProtocol() };
    return {
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name in services) return services[name];
            throw new Error(`Service '${name}' not found`);
        }),
        getServices: vi.fn(() => new Map(Object.entries(services))),
        hook: vi.fn(),
        trigger: vi.fn().mockResolvedValue(undefined),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        getKernel: vi.fn(),
    } as unknown as StartContext;
}

describe('[#11984] §B the refusal survives the plugin path', () => {
    it('CONTROL: this ctx really does boot a REST server', async () => {
        // `createRestApiPlugin.start()` returns quietly when `http.server` or
        // `protocol` is missing, so a rejection below could otherwise be
        // attributed to a thin ctx rather than to the config.
        const ctx = bootCtx();
        await expect(createRestApiPlugin({ api: { batch: { maxBatchSize: 200 } } }).start!(ctx)).resolves.toBeUndefined();
    });

    it('rejects `createRestApiPlugin({ api: { batch: { maxBatchSize: 0 } } }).start()`', async () => {
        await expect(
            createRestApiPlugin({ api: { batch: { maxBatchSize: 0 } } }).start!(bootCtx()),
        ).rejects.toThrow(/batch\.maxBatchSize/);
    });

    it('rejects `createRestApiPlugin({ api: { routes: { nameTransform: "snake_case" } } }).start()`', async () => {
        await expect(
            createRestApiPlugin({ api: { routes: { nameTransform: 'snake_case' as never } } }).start!(bootCtx()),
        ).rejects.toThrow(/routes\.nameTransform/);
    });
});

// ---------------------------------------------------------------------------
// §C — REGRESSION GUARDS (green BEFORE this change and after)
// ---------------------------------------------------------------------------

describe('[#11984] §C regression guards — the narrowing is exactly the declared one', () => {
    it('an empty config still constructs, with the declared defaults', () => {
        const cfg = normalized({});
        expect(cfg.batch.maxBatchSize).toBe(200);
        expect(cfg.metadata.cacheTtl).toBe(3600);
        expect(cfg.metadata.prefix).toBe('/meta');
        expect(cfg.crud.dataPrefix).toBe('/data');
        expect(cfg.crud.objectParamStyle).toBe('path');
        expect(cfg.routes.nameTransform).toBe('none');
    });

    it('accepts the declared `maxBatchSize` bounds inclusively', () => {
        expect(normalized({ batch: { maxBatchSize: 1 } }).batch.maxBatchSize).toBe(1);
        expect(normalized({ batch: { maxBatchSize: 1000 } }).batch.maxBatchSize).toBe(1000);
    });

    it('accepts every option the declared enums contain, and reads each back', () => {
        for (const nameTransform of ['none', 'plural', 'kebab-case', 'camelCase'] as const) {
            expect(normalized({ routes: { nameTransform } }).routes.nameTransform, nameTransform).toBe(nameTransform);
        }
        for (const objectParamStyle of ['path', 'query'] as const) {
            expect(normalized({ crud: { objectParamStyle } }).crud.objectParamStyle, objectParamStyle).toBe(objectParamStyle);
        }
    });

    it('KEEPS a negative `metadata.cacheTtl` — declared `.int()` only, with no lower bound', () => {
        // The bound on the narrowing: the card that filed this defect listed
        // "a negative TTL" among the values the parse would refuse, and the
        // schema declares no such rule. This seam enforces the contract as
        // written; a lower bound is `packages/spec`'s to declare.
        expect(normalized({ metadata: { cacheTtl: -1 } }).metadata.cacheTtl).toBe(-1);
        expect(normalized({ metadata: { cacheTtl: 0 } }).metadata.cacheTtl).toBe(0);
    });

    it('STRIPS an unknown key inside a sub-object rather than refusing it — the schemas are non-strict', () => {
        expect(() => construct({ batch: { bogus: 1 } as never })).not.toThrow();
        expect(() => construct({ routes: { overrides: { account: { enabled: false, bogus: 1 } as never } } })).not.toThrow();
    });

    it('KEEPS the retired top-level `openApi31` key at its ignore posture — the whole-config tombstone is not run here', () => {
        // `RestServerConfigSchema.openApi31` is a `retiredKey()` tombstone
        // (#4579) whose parse REFUSES the key. This seam parses the five
        // sub-objects, never the whole config, so the tombstone keeps the
        // posture #3963 chose for `api.requireAuth`: flipping either into a
        // boot failure is that decision's to make, not this seam's.
        expect(() => construct({ openApi31: {} } as never)).not.toThrow();
    });

    it('the `api` sub-object still runs its own declared contract (#11637)', () => {
        expect(refusal({ api: { version: '' } })).toContain('api.version');
    });
});

// ---------------------------------------------------------------------------
// §D — the parsed output is CONSUMED: defaults come from the schema, and what
// an author wrote survives it
// ---------------------------------------------------------------------------

describe('[#11984] §D the four siblings consume the parsed output', () => {
    it('a declared in-range value is preserved, not replaced by the default', () => {
        expect(normalized({ batch: { maxBatchSize: 500 } }).batch.maxBatchSize).toBe(500);
        expect(normalized({ metadata: { cacheTtl: 60 } }).metadata.cacheTtl).toBe(60);
        expect(normalized({ crud: { dataPrefix: '/records' } }).crud.dataPrefix).toBe('/records');
        expect(normalized({ routes: { includeObjects: ['account'] } }).routes.includeObjects).toEqual(['account']);
    });

    it('KEEPS `metadata.maskObjectFields: false` — the ADR-0106 D8 opt-out survives the parse', () => {
        // The reason this card waited on #11983: before the key had a
        // declared seat, a consumed parse would have STRIPPED it and turned
        // masking back on for a deployment that turned it off.
        expect(normalized({ metadata: { maskObjectFields: false } }).metadata.maskObjectFields).toBe(false);
        expect(normalized({}).metadata.maskObjectFields).toBe(true);
    });

    it('KEEPS a partial `crud.operations` — per-key defaults, the AUTHOR state (ADR-0122)', () => {
        expect(normalized({ crud: { operations: { list: false } } }).crud.operations).toEqual({
            create: true, read: true, update: true, delete: true, list: false,
        });
        expect(normalized({}).crud.operations).toEqual({
            create: true, read: true, update: true, delete: true, list: true,
        });
    });

    it('KEEPS a partial `batch.operations` and `metadata.endpoints` the same way', () => {
        expect(normalized({ batch: { operations: { deleteMany: false } } }).batch.operations).toEqual({
            createMany: true, updateMany: true, deleteMany: false, upsertMany: true,
        });
        expect(normalized({ metadata: { endpoints: { schema: false } } }).metadata.endpoints).toEqual({
            types: true, items: true, item: true, schema: false,
        });
    });

    it('KEEPS a partial `crud.patterns` — the written pattern survives, and no pattern is invented', () => {
        // `patterns` is `z.record(CrudOperation, CrudEndpointPatternSchema.optional())`,
        // which zod 4 reads as an EXHAUSTIVE record: the parse walks all five
        // operations and writes each one's value into the output, so the four
        // an author did not write come back as explicit `undefined` entries —
        // exactly the declared shape (`Record<CrudOperation, Pattern | undefined>`,
        // which is also why this fixture needs `as never`: the input TYPE
        // demands all five keys while the runtime accepts a partial). That
        // key-enumeration quirk is the spec's to settle (`z.partialRecord`),
        // filed separately, so this pin asserts only what the contract
        // promises whichever way that lands: the one written pattern is
        // preserved, and no operation gains a pattern it was not given.
        const cfg = normalized({ crud: { patterns: { list: { method: 'GET', path: '/x' } } as never } });
        expect(cfg.crud.patterns?.list).toEqual({ method: 'GET', path: '/x' });
        expect(Object.values(cfg.crud.patterns ?? {}).filter((pattern) => pattern !== undefined)).toHaveLength(1);
    });
});
