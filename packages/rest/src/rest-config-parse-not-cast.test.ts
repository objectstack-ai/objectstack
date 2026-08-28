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
 *
 * ⚠️ §C is also where the first round's census miss is pinned. That census was
 * scoped to this package; the risk surface is EVERY package that constructs a
 * REST server, and `packages/cli`'s `os serve` shipped
 * `projectResolution: 'none'` — a value the declared enum does not contain and
 * `@objectstack/runtime` declared as a literal type. Five `packages/cli` e2e
 * boots went red in CI. The lesson, written where the next author will hit it:
 * the search radius belongs where the CONSUMERS live, not where the change does.
 *
 * [#12450] That miss is what bought `projectResolution` an `.omit()` from the
 * declared parse — and this file then carried a GREEN §C case defending the
 * exemption: "KEEPS `projectResolution: \"none\"` — the value this platform
 * actually ships". #11999 migrated the producer off that value (PR #12444) and
 * the case did not notice: it called `construct()` with a hand-written literal,
 * so its premise could die while it stayed green. ⛔ THE LESSON, and the reason
 * the retired value is now a REFUSAL in §A rather than a reworded guard here:
 * **a test that cannot fail when its premise dies is not protected by the
 * suite — it is hidden by it. The passing status is what stops anyone looking.**
 *
 * ⚠️ The other half of that premise is NOT measurable from this package, and
 * saying so here is part of the fix. "No boot path emits the retired value any
 * more" is a claim about the PRODUCER, and the producer (`@objectstack/runtime`)
 * depends on this package — so the coupling cannot be imported in this
 * direction without a cycle, and it lives at the producer instead:
 * `packages/runtime/src/standalone-stack.test.ts` drives the REAL emitted `api`
 * block through a REAL `RestServer` construction. THAT is the case that goes red
 * if the platform ever emits the retired value again; the two below only pin
 * what this seam does with a value once it arrives.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';
import { createRestApiPlugin } from './rest-api-plugin.js';

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

    it('refuses a declared key written with the wrong type', () => {
        expect(() => construct({ enableCrud: 'yes' as never })).toThrow(/api\.enableCrud/);
    });

    it('[#12450] refuses the retired `projectResolution: "none"` — the parse finally reaches this key', () => {
        // `.omit()`ed from the declared parse until #12450, so this seam
        // ACCEPTED a value `RestApiConfigSchema` has never declared. Measured on
        // the pre-change tree: `construct({ projectResolution: 'none' })`
        // returned a server and `getApiBasePath()` answered `/api/v1`.
        // Declared-but-never-executed is the defect this whole file is named
        // after (#11637); #11999 removed the reason for the exemption by
        // migrating `@objectstack/runtime` onto the declared `'auto'`.
        let message = '';
        try {
            construct({ projectResolution: 'none' as never });
        } catch (err: any) {
            message = String(err?.message ?? err);
        }
        // POSITIVE CONTROL for the negative assertion below, and not a substring
        // of it: an empty `message` (nothing thrown) would satisfy any
        // `not.toContain` vacuously, so the refusal has to be proven present
        // before its shape can be measured.
        expect(message, 'the retired value must be refused, and the refusal must name the key').toContain('api.projectResolution');
        expect(
            message,
            'a projectResolution refusal must not diagnose `version`, a key this config never wrote',
        ).not.toContain('/api//');
    });

    it('appends the version rationale ONLY when `version` is what failed', () => {
        // Caught by this change's own ablation: a `projectResolution` refusal
        // printed the whole "an empty version mounts the entire API at /api//"
        // paragraph, sending the operator to a line they never wrote.
        let message = '';
        try {
            construct({ enableCrud: 'yes' as never });
        } catch (err: any) {
            message = String(err?.message ?? err);
        }
        expect(message).toContain('api.enableCrud');
        expect(
            message,
            'a non-version refusal must not diagnose a key the operator did not write',
        ).not.toContain('/api//');
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

    it('KEEPS `enableSearch` — declared since #11983, and the opt-out survives normalization', () => {
        // Historically the reason the seam validates but does NOT consume the
        // parsed output: this key had no declared seat, so the non-strict
        // `z.object()` STRIPPED it (measured), and consuming the parse would
        // silently have turned search back ON for a deployment that turned it
        // off. #11983 declared it (`RestApiConfigSchema.enableSearch`, default
        // `true`), so the parse now preserves it too — this pin remains as the
        // end-to-end guarantee that the deployment-wide opt-out reaches the
        // normalized config, whichever way the seam reads it.
        const rest = construct({ version: 'v1', enableSearch: false });
        expect((rest as any).config.api.enableSearch).toBe(false);
    });

    it('[#12450] accepts every `projectResolution` the declared enum contains — the narrowing is the retired value ONLY', () => {
        // The BOUND on the change, and the half that makes "exactly one value
        // starts being rejected" a measurement rather than a claim. Census over
        // the tree at the time of #12450: four spellings appear anywhere as a
        // value for this key — `'required'`, `'optional'`, `'auto'` and the
        // retired `'none'` — so these three ARE the population that must keep
        // constructing. Read back off the normalized config rather than off a
        // mount path: a strategy that parsed and was then dropped in
        // normalization would still answer `/api/v1`.
        for (const projectResolution of ['required', 'optional', 'auto'] as const) {
            const rest = construct({ enableProjectScoping: true, projectResolution });
            expect((rest as any).config.api.projectResolution, projectResolution).toBe(projectResolution);
        }
    });

    it('KEEPS the retired `api.requireAuth` warn-and-ignore posture (#3963)', () => {
        // The tombstone is `.omit()`ed from the validation on purpose: #3963
        // chose warn-and-ignore for this key, and converting that into a boot
        // failure is that decision's to make. 96 in-repo fixtures still pass it.
        expect(() => construct({ requireAuth: false, version: 'v1' })).not.toThrow();
    });
});
