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
 *
 * [#14691] Ten of the keys these pins originally exercised were RETIRED under
 * ADR-0049 enforce-or-remove (the #14369 liveness census found them normalized
 * and never read): `crud.patterns` / `objectParamStyle`, `metadata.cacheTtl` /
 * `endpoints.schema`, `batch.operations.upsertMany` / `defaultAtomic`, and all
 * of `routes.*`. Each is now a `retiredKey()` tombstone, so the pins below that
 * used to assert "accepted, read back" for those keys are REVERSED — by design,
 * not by regression — into refusal pins: the SERVER refuses the key at
 * construction with the retirement prescription (§E). The regression guards on
 * the LIVE keys are unchanged, which is what makes this file still measure that
 * the narrowing is exactly the declared one.
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
        dataPrefix: string;
    };
    metadata: {
        prefix: string;
        enableCache: boolean;
        maskObjectFields: boolean;
        endpoints: Record<'types' | 'items' | 'item', boolean>;
    };
    batch: {
        maxBatchSize: number;
        operations: Record<'createMany' | 'updateMany' | 'deleteMany', boolean>;
    };
    routes: Record<string, never>;
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

    // `routes.nameTransform`, `crud.objectParamStyle` and `metadata.cacheTtl` used
    // to be pinned here as "refuses the OUT-OF-CONTRACT value". Since #14691 the
    // keys themselves are tombstones and EVERY value is refused — see §E.

    it('refuses a declared key written with the wrong type', () => {
        expect(refusal({ crud: { dataPrefix: 42 as never } })).toContain('crud.dataPrefix');
        expect(refusal({ metadata: { enableCache: 'yes' as never } })).toContain('metadata.enableCache');
        expect(refusal({ batch: { enableBatchEndpoint: 'yes' as never } })).toContain('batch.enableBatchEndpoint');
    });

    // `crud.patterns` (an enum-keyed record) and `routes.overrides.<object>.operations`
    // (an exhaustive one) used to be pinned here for their key-by-key refusals.
    // Both records are tombstones since #14691 — see §E.

    it('lists every failing key of the sub-object in one refusal', () => {
        const message = refusal({ batch: { maxBatchSize: 0, enableBatchEndpoint: 'yes' as never } });
        expect(message).toContain('batch.maxBatchSize');
        expect(message).toContain('batch.enableBatchEndpoint');
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

    it('rejects `createRestApiPlugin({ api: { routes: { nameTransform: "none" } } }).start()` — a #14691 tombstone, through the plugin path', async () => {
        // Before #14691 this case drove `'snake_case'`, the out-of-enum value.
        // The key is retired now, so its former DEFAULT is refused too, with the
        // prescription rather than the enum text.
        await expect(
            createRestApiPlugin({ api: { routes: { nameTransform: 'none' as never } } }).start!(bootCtx()),
        ).rejects.toThrow(/routes\.nameTransform.*was removed/s);
    });
});

// ---------------------------------------------------------------------------
// §C — REGRESSION GUARDS (green BEFORE this change and after)
// ---------------------------------------------------------------------------

describe('[#11984] §C regression guards — the narrowing is exactly the declared one', () => {
    it('an empty config still constructs, with the declared defaults', () => {
        const cfg = normalized({});
        expect(cfg.batch.maxBatchSize).toBe(200);
        expect(cfg.metadata.prefix).toBe('/meta');
        expect(cfg.crud.dataPrefix).toBe('/data');
        // [#14691] the retired keys materialize NO default any more — the
        // normalized config simply does not carry them.
        expect(cfg.metadata).not.toHaveProperty('cacheTtl');
        expect(cfg.crud).not.toHaveProperty('objectParamStyle');
        expect(cfg.crud).not.toHaveProperty('patterns');
        expect(cfg.batch).not.toHaveProperty('defaultAtomic');
        expect(cfg.routes).toEqual({});
    });

    it('accepts the declared `maxBatchSize` bounds inclusively', () => {
        expect(normalized({ batch: { maxBatchSize: 1 } }).batch.maxBatchSize).toBe(1);
        expect(normalized({ batch: { maxBatchSize: 1000 } }).batch.maxBatchSize).toBe(1000);
    });

    // The two enum read-backs (`routes.nameTransform`, `crud.objectParamStyle`)
    // and the "KEEPS a negative `metadata.cacheTtl`" bound used to live here.
    // All three keys are tombstones since #14691, so those pins are reversed
    // in §E; the negative-TTL bound the card once argued about is moot — no
    // TTL of any sign is accepted.

    it('STRIPS an unknown key inside a sub-object rather than refusing it — the schemas are non-strict', () => {
        expect(() => construct({ batch: { bogus: 1 } as never })).not.toThrow();
        expect(() => construct({ metadata: { endpoints: { types: true, bogus: 1 } as never } })).not.toThrow();
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
        expect(normalized({ metadata: { prefix: '/metadata' } }).metadata.prefix).toBe('/metadata');
        expect(normalized({ crud: { dataPrefix: '/records' } }).crud.dataPrefix).toBe('/records');
        expect(normalized({ metadata: { enableCache: false } }).metadata.enableCache).toBe(false);
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
        // [#14691] `upsertMany` and `schema` left both shapes: the three live
        // switches per block are exactly what the normalized config carries.
        expect(normalized({ batch: { operations: { deleteMany: false } } }).batch.operations).toEqual({
            createMany: true, updateMany: true, deleteMany: false,
        });
        expect(normalized({ metadata: { endpoints: { item: false } } }).metadata.endpoints).toEqual({
            types: true, items: true, item: false,
        });
    });

    // The `crud.patterns` preservation pin (and the `z.partialRecord` question it
    // deferred to #14365) is gone with the key — #14691 retired the record.
});

// ---------------------------------------------------------------------------
// §E — [#14691] the retired keys are REFUSED at construction, with the
// prescription, whatever the value. These are the #11984 pins above, reversed:
// the SERVER is still what is measured (the schema-level pins live in
// `packages/spec`'s `rest-server.test.ts`), and `refusal()`'s `''`-on-success
// keeps every `toContain` its own positive control.
// ---------------------------------------------------------------------------

describe('[#14691] §E the retired sub-config keys are refused at construction', () => {
    it('refuses `crud.patterns` and `crud.objectParamStyle` — both former enum values included', () => {
        const patterns = refusal({ crud: { patterns: { list: { method: 'GET', path: '/x' } } } } as never);
        expect(patterns).toContain('crud.patterns');
        expect(patterns).toContain('CrudEndpointsConfigSchema');
        expect(patterns).toMatch(/was removed in @objectstack\/spec 17/);
        for (const objectParamStyle of ['path', 'query']) {
            const message = refusal({ crud: { objectParamStyle } } as never);
            expect(message, objectParamStyle).toContain('crud.objectParamStyle');
            expect(message, objectParamStyle).toMatch(/was removed/);
        }
    });

    it('refuses `metadata.cacheTtl` — the old default, zero and the negative value the old contract accepted', () => {
        for (const cacheTtl of [3600, 0, -1]) {
            const message = refusal({ metadata: { cacheTtl } } as never);
            expect(message, String(cacheTtl)).toContain('metadata.cacheTtl');
            expect(message, String(cacheTtl)).toContain('MetadataEndpointsConfigSchema');
            expect(message, String(cacheTtl)).toMatch(/was removed/);
        }
    });

    it('refuses `metadata.endpoints.schema` — a nested tombstone inside a live block', () => {
        const message = refusal({ metadata: { endpoints: { schema: false } } } as never);
        expect(message).toContain('metadata.endpoints.schema');
        expect(message).toMatch(/does not exist/);
    });

    it('refuses `batch.operations.upsertMany` and `batch.defaultAtomic`', () => {
        const upsert = refusal({ batch: { operations: { upsertMany: false } } } as never);
        expect(upsert).toContain('batch.operations.upsertMany');
        expect(upsert).toMatch(/never built/);
        for (const defaultAtomic of [true, false]) {
            const message = refusal({ batch: { defaultAtomic } } as never);
            expect(message, String(defaultAtomic)).toContain('batch.defaultAtomic');
            expect(message, String(defaultAtomic)).toMatch(/options\.atomic/);
        }
    });

    it('refuses every `routes.*` key — the whole sub-object is tombstones', () => {
        for (const [key, routes] of Object.entries({
            includeObjects: { includeObjects: ['account'] },
            excludeObjects: { excludeObjects: ['system_log'] },
            nameTransform: { nameTransform: 'none' },
            overrides: { overrides: { account: { enabled: false } } },
        })) {
            const message = refusal({ routes } as never);
            expect(message, key).toContain(`routes.${key}`);
            expect(message, key).toContain('RouteGenerationConfigSchema');
            expect(message, key).toMatch(/was removed/);
        }
    });

    it('an empty `routes` sub-object still constructs — the tombstones refuse keys, not the block', () => {
        expect(() => construct({ routes: {} })).not.toThrow();
        expect(normalized({ routes: {} }).routes).toEqual({});
    });

    it('the plugin path refuses the same keys (both cast hops)', async () => {
        await expect(
            createRestApiPlugin({ api: { batch: { defaultAtomic: false } } } as never).start!(bootCtx()),
        ).rejects.toThrow(/batch\.defaultAtomic.*was removed/s);
    });
});
