// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11637] The REST server runs the config contract it declares.
 *
 * `RestApiConfigSchema` (`packages/spec/src/api/rest-server.zod.ts`) constrains
 * `api.version` with `z.string().regex(/^[a-zA-Z0-9_\-\.]+$/)`, which refuses
 * `''`. Nothing ever ran it. Both hops into this package were casts —
 * `config.api as any` in `rest-api-plugin.ts`, then `as Partial<RestApiConfig>`
 * in `RestServer.normalizeConfig` — the plugin declares no `configSchema`, and
 * the kernel's `PluginConfigValidator` could not have covered it anyway
 * (`PluginLoader.loadPlugin` calls its own `validatePluginConfig(metadata)`
 * with NO config argument and returns early, and `createRestApiPlugin` closes
 * over its config so the kernel never receives it). `??` was the only guard
 * left, and `??` substitutes `null`/`undefined` only.
 *
 * Measured on the pre-fix code: `api.version: ''` constructed happily and
 * `getApiBasePath()` returned `/api/`, so the whole surface — `/data`, `/meta`,
 * `/discovery`, `openapi.json` — mounted under a doubled slash, and
 * `'v1/beta'` spliced an extra path segment into every route.
 *
 * ⛔ ANTI-VACUITY. A pin asserting that *the schema* refuses `''` would be
 * green before this change too — the schema always refused it. Every pin below
 * drives the REAL server construction (and, in §B, the real plugin
 * composition), so what it measures is whether the SERVER refuses.
 *
 * §C is explicitly a set of REGRESSION GUARDS: green before this change and
 * green after. They are here to bound the narrowing — to show it refuses
 * exactly what the schema declares and nothing this seam invented.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { createRestApiPlugin } from './rest-api-plugin';

function makeServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn(), close: vi.fn(),
    } as any;
}

function makeProtocol() {
    return {
        getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
    } as any;
}

/** Construct the real server with `api` as given — the seam under test. */
function construct(api: Record<string, unknown>) {
    return new RestServer(makeServer(), makeProtocol(), { api } as any);
}

// ---------------------------------------------------------------------------
// §A — the server refuses what the schema declares invalid
// ---------------------------------------------------------------------------

describe('[#11637] §A RestServer construction runs RestApiConfigSchema', () => {
    it('refuses `api.version: ""` — the value that mounted the whole API at /api//', () => {
        expect(() => construct({ version: '' })).toThrow(/api\.version/);
    });

    it('names the declared contract and the pattern it failed, not a bare "invalid"', () => {
        let message = '';
        try {
            construct({ version: '' });
        } catch (err: any) {
            message = String(err?.message ?? err);
        }
        // The prescription is the payload: an operator reading this must be
        // able to find the rule without reading our source.
        expect(message, 'the refusal must name the schema that declares the rule').toContain('RestApiConfigSchema');
        expect(message, "zod's own issue message carries the declared pattern").toContain('must match pattern');
        expect(message, 'and it must say why an empty version is not survivable').toContain('/api//');
    });

    it('refuses `api.version: "v1/beta"` — a version that splices a path segment into every route', () => {
        expect(() => construct({ version: 'v1/beta' })).toThrow(/api\.version/);
    });

    it('refuses a version carrying whitespace', () => {
        expect(() => construct({ version: 'v1 beta' })).toThrow(/api\.version/);
    });

    it('refuses a declared-enum violation on the same object (`projectResolution`)', () => {
        // Same seam, same mechanism: the cast admitted any string here too.
        expect(() => construct({ projectResolution: 'whenever' })).toThrow(/api\.projectResolution/);
    });

    it('no constructed server can carry a doubled slash in its mount', () => {
        // The defect stated as the operator sees it. Pre-fix this server
        // existed and `getApiBasePath()` answered `/api/`; now the
        // construction itself is refused, so the broken mount is unreachable.
        expect(() => construct({ version: '' })).toThrow();
        const ok = construct({ version: 'v1' });
        expect(ok.getApiBasePath()).toBe('/api/v1');
        expect(ok.getApiBasePath()).not.toContain('//');
    });
});

// ---------------------------------------------------------------------------
// §B — the real plugin composition, i.e. BOTH cast hops
// ---------------------------------------------------------------------------

function createCtx(services: Record<string, unknown>) {
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
    } as any;
}

function bootCtx() {
    return createCtx({ 'http.server': makeServer(), protocol: makeProtocol() });
}

describe('[#11637] §B the refusal survives the plugin path', () => {
    it('CONTROL: this ctx really does boot a REST server', async () => {
        // Not decoration. `createRestApiPlugin.start()` returns quietly when
        // `http.server` or `protocol` is missing, so a rejection below could
        // otherwise be attributed to a thin ctx rather than to the config.
        // This case is what makes the next one attributable.
        const ctx = bootCtx();
        await expect(createRestApiPlugin({ api: { api: { version: 'v1' } } as any }).start!(ctx)).resolves.toBeUndefined();
        expect(ctx.logger.error).not.toHaveBeenCalled();
    });

    it('rejects `createRestApiPlugin({ api: { api: { version: "" } } }).start()`', async () => {
        const ctx = bootCtx();
        await expect(
            createRestApiPlugin({ api: { api: { version: '' } } as any }).start!(ctx),
        ).rejects.toThrow(/api\.version/);
    });
});

// ---------------------------------------------------------------------------
// §C — REGRESSION GUARDS (green BEFORE this change and after)
// ---------------------------------------------------------------------------

describe('[#11637] §C regression guards — the narrowing is exactly the declared one', () => {
    it('a conventional config still boots and still mounts at /api/v1', () => {
        expect(construct({}).getApiBasePath()).toBe('/api/v1');
        expect(construct({ version: 'v1' }).getApiBasePath()).toBe('/api/v1');
    });

    it('accepts every spelling the declared pattern allows', () => {
        expect(construct({ version: 'v2' }).getApiBasePath()).toBe('/api/v2');
        expect(construct({ version: '2024-01' }).getApiBasePath()).toBe('/api/2024-01');
        expect(construct({ version: 'v1.2' }).getApiBasePath()).toBe('/api/v1.2');
        expect(construct({ version: 'v1_beta' }).getApiBasePath()).toBe('/api/v1_beta');
    });

    it('still accepts `basePath: ""` — the schema declares NO constraint there', () => {
        // The narrowing follows the contract, it does not extend it. `basePath`
        // is a bare `z.string()`, so an empty one stays this seam's business
        // to accept (`direct-mount-base-follows-apipath.test.ts` boots one).
        expect(construct({ basePath: '', version: 'v1' }).getApiBasePath()).toBe('/v1');
    });

    it('`apiPath` still overrides the composed base', () => {
        expect(construct({ apiPath: '/backend/api/v9' }).getApiBasePath()).toBe('/backend/api/v9');
    });

    it('KEEPS `enableSearch`, which no schema in packages/spec declares', () => {
        // The reason the seam validates but does NOT consume the parsed output.
        // `RestApiConfigSchema` is not `.strict()`, so a non-strict `z.object()`
        // STRIPS this key (measured). Consuming the parse would silently turn
        // search back ON for a deployment that turned it off.
        const rest = construct({ version: 'v1', enableSearch: false });
        expect((rest as any).config.api.enableSearch).toBe(false);
    });

    it('KEEPS the retired `api.requireAuth` warn-and-ignore posture (#3963)', () => {
        // The tombstone is `.omit()`ed from the validation on purpose: #3963
        // chose warn-and-ignore for this key, and converting that into a boot
        // failure is that decision's to make. 96 in-repo fixtures still pass it.
        expect(() => construct({ requireAuth: false, version: 'v1' })).not.toThrow();
    });
});
