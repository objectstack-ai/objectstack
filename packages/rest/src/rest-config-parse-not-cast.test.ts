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
import { RestApiConfigSchema } from '@objectstack/spec/api';
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

// ---------------------------------------------------------------------------
// §D — [#14366] the parsed output is CONSUMED
// ---------------------------------------------------------------------------

/**
 * #11637 ran the parse and threw its result away; the block was rebuilt from a
 * `??` chain over the raw cast. #14366 folded the chain onto the parse after
 * re-measuring both of #11637's reasons expired and the key diff empty in both
 * directions (14 read, 14 declared after the `.omit()`).
 *
 * ⛔ These cases assert against `RestApiConfigSchema`'s OWN output, computed at
 * run time — never against a literal. A literal here would restate in the test
 * exactly the duplication the change deleted from the source, and would go
 * green on both trees. The pin that DISCRIMINATES the two trees has to move the
 * schema, which needs a module mock, so it lives in its own file:
 * `rest-api-config-defaults-follow-spec.pin.test.ts`. §D is the unmocked half —
 * the SHIPPED schema, the SHIPPED posture, and the one bounded behaviour delta.
 */
describe('[#14366] §D the `api` sub-object consumes the parsed output', () => {
    const declaredApi = () => RestApiConfigSchema.omit({ requireAuth: true });

    /** The normalized `api` block, read off the constructed server. */
    const normalizedApi = (rest: unknown) =>
        (rest as { config: { api: Record<string, unknown> } }).config.api;

    it('every default in the normalized block is the SCHEMA\'s, key for key', () => {
        const fromSchema = declaredApi().parse({}) as Record<string, unknown>;
        const fromServer = normalizedApi(construct({}));
        // Positive control: an empty `fromSchema` would make the loop vacuous.
        expect(Object.keys(fromSchema).length, 'the schema must actually supply defaults').toBeGreaterThan(0);
        for (const [key, value] of Object.entries(fromSchema)) {
            expect(fromServer[key], `api.${key} must come from RestApiConfigSchema`).toEqual(value);
        }
    });

    it('the normalized key set is exactly the declared key set — nothing added, nothing dropped', () => {
        // The measurement the consumption decision rests on: a key the method
        // read but the schema did not declare would be silently STRIPPED by a
        // consumed parse, which is the failure #11637 avoided by discarding.
        const declared = Object.keys(declaredApi().shape).sort();
        const normalized = Object.keys(normalizedApi(construct({}))).sort();
        expect(normalized).toEqual(declared);
        expect(declared, 'the retired tombstone stays out of the parsed shape').not.toContain('requireAuth');
    });

    it('an authored value still wins over the schema default', () => {
        const rest = construct({ version: 'v7', basePath: '/svc', enableSearch: false });
        expect(normalizedApi(rest).version).toBe('v7');
        expect(normalizedApi(rest).basePath).toBe('/svc');
        expect(normalizedApi(rest).enableSearch).toBe(false);
    });

    it('THE BOUNDED DELTA: an authored `documentation` now carries its own declared inner defaults', () => {
        // The single measured behaviour change of #14366, pinned rather than
        // left to be rediscovered. The deleted `??` chain copied this object
        // through untouched (`documentation: api.documentation`), so a partial
        // one stayed partial; the parse fills the inner `.default()`s.
        // `documentation` has ZERO read sites outside this block (the #14369
        // census), so nothing observes it today — which is exactly why it needs
        // a pin: an unobserved change is the kind that gets reverted by
        // accident.
        const doc = normalizedApi(construct({ documentation: { description: 'd' } }))
            .documentation as Record<string, unknown>;
        expect(doc).toEqual(
            (declaredApi().parse({ documentation: { description: 'd' } }) as { documentation: unknown }).documentation,
        );
        expect(doc.description, 'the authored key survives').toBe('d');
        expect(doc.enabled, 'and the declared inner default arrives with it').toBe(true);
    });

    it('THE BOUNDED DELTA: an authored `responseFormat` does the same', () => {
        const rf = normalizedApi(construct({ responseFormat: { envelope: false } }))
            .responseFormat as Record<string, unknown>;
        expect(rf.envelope, 'the authored key survives').toBe(false);
        expect(rf.includeMetadata).toBe(true);
        expect(rf.includePagination).toBe(true);
    });

    it('an ABSENT optional object stays absent — the parse does not materialize it', () => {
        // The bound on the delta above: `.optional()` without `.default()`
        // means "missing stays missing". A parse that invented an empty
        // `documentation` block would change what nothing-authored means.
        const api = normalizedApi(construct({}));
        expect(api.documentation).toBeUndefined();
        expect(api.responseFormat).toBeUndefined();
        expect(api.apiPath).toBeUndefined();
    });

    it('an undeclared key under `api` is not carried into the normalized config', () => {
        // Unchanged by #14366 and pinned as the bound: the `??` chain copied a
        // fixed list of 14 keys, and the non-strict parse strips anything not
        // declared. Both drop it — so consuming cannot have widened the surface.
        const api = normalizedApi(construct({ totallyUndeclared: 'x' } as never));
        expect(api).not.toHaveProperty('totallyUndeclared');
    });

    it('KEEPS the #3963 warn-and-ignore posture: `requireAuth: false` constructs AND still warns', async () => {
        // The pin the card names. The warning is emitted by `rest-api-plugin.ts`
        // off the RAW config, so consuming the parse inside `RestServer` cannot
        // reach it — measured here end to end rather than argued.
        expect(() => construct({ requireAuth: false, version: 'v1' })).not.toThrow();

        const ctx = bootCtx();
        await expect(
            createRestApiPlugin({ api: { api: { requireAuth: false, version: 'v1' } } as any }).start!(ctx),
        ).resolves.toBeUndefined();
        const warned = (ctx.logger.warn as { mock: { calls: unknown[][] } }).mock.calls
            .map((args) => String(args[0]))
            .join('\n');
        expect(warned, 'the retired key must still be reported to the operator').toContain('`api.requireAuth` was removed');
        expect(warned).toContain('IGNORED');
    });
});
