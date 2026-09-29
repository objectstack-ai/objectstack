// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20295] The REST server REFUSES the retired `api.responseFormat` and
 * `api.documentation.enabled` at construction — ADR-0049 enforce-or-remove.
 *
 * Before: both were parsed by `parseDeclaredApiConfig`, defaulted, and copied
 * into `this.config.api` by `normalizeConfig`, where nothing read them back —
 * `responseFormat.envelope: false` unwrapped no response and
 * `documentation.enabled: false` turned no document off (`api.enableOpenApi`
 * decides that mount). Now both are `retiredKey()` tombstones on
 * `RestApiConfigSchema`, and this seam runs that schema, so the tombstone's
 * refusal reaches the operator at boot — the `crud.patterns` posture
 * (`rest-sub-config-parse-not-cast.test.ts` §E), NOT `requireAuth`'s
 * warn-and-ignore `.omit()`.
 *
 * [#20294] `api.documentation.version` joined them (ruling B on #20359): the
 * block's identity members are enforced now — they overlay the served OpenAPI
 * `info` — and `version` is the one member retired, because the served
 * `info.version` is the protocol version (#11646).
 *
 * ⛔ ANTI-VACUITY — the same rule as `rest-config-parse-not-cast.test.ts`: a pin
 * asking the SCHEMA whether it refuses is `packages/spec`'s job
 * (`rest-api-config-dead-keys-retirement.test.ts`). Every case below drives the
 * REAL `RestServer` construction or the real plugin composition, so what it
 * measures is whether the SERVER refuses. `refusal()` answers `''` when
 * construction succeeds, and `''` contains no key name, so every `toContain`
 * below is its own positive control.
 *
 * On the assertion set: this is a construction-time refusal, not an HTTP
 * answer — nothing is mounted yet, so there is no ADR-0112 `code` / `status`
 * envelope to assert. The strongest set this door has is: refused, the located
 * key (`api.<path>`), the declaring schema's name, and the prescription.
 *
 * This file is one of the two the retirement's tree-scoped absence pin
 * excludes by name: its JOB is to author the retired keys.
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

/** The construction refusal's message, or `''` when the server constructed. */
function refusal(api: Record<string, unknown>): string {
    try {
        construct(api);
        return '';
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/** The normalized `api` block, read off the constructed server. */
const normalizedApi = (rest: unknown) =>
    (rest as { config: { api: Record<string, unknown> } }).config.api;

/** The mounted `METHOD path` set of a constructed server. */
function mounted(api: Record<string, unknown>): string[] {
    const rest = construct(api);
    rest.registerRoutes();
    return rest.getRoutes().map((r: any) => `${r.method} ${r.path}`).sort();
}

function bootCtx() {
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
    } as any;
}

const RESPONSE_FORMAT_PRESCRIPTION =
    /`api\.responseFormat` was removed in @objectstack\/spec 17\.5\.0.*Delete the key\..*Response shapes are fixed/s;
const DOCS_ENABLED_PRESCRIPTION =
    /`api\.documentation\.enabled` was removed in @objectstack\/spec 17\.5\.0.*Delete the key; `api\.enableOpenApi: false` is the switch/s;
const DOCS_VERSION_PRESCRIPTION =
    /`api\.documentation\.version` was removed in @objectstack\/spec 17\.5\.0.*`info\.version` has one source: the protocol version.*Delete the key\. To publish your app's own release number, write it into `api\.documentation\.description`/s;

describe('[#20295] RestServer construction refuses the retired `api` keys', () => {
    it('refuses `api.responseFormat` — every former spelling, the old defaults and the empty block included', () => {
        for (const responseFormat of [
            { envelope: false },
            { envelope: true, includeMetadata: true, includePagination: true },
            { includeMetadata: false },
            {},
        ]) {
            const label = JSON.stringify(responseFormat);
            const message = refusal({ responseFormat });
            expect(message, label).toContain('  - api.responseFormat: ');
            expect(message, label).toContain('RestApiConfigSchema');
            expect(message, label).toMatch(RESPONSE_FORMAT_PRESCRIPTION);
        }
    });

    it('refuses `api.documentation.enabled` — both values — while its siblings in the block are untouched', () => {
        for (const enabled of [false, true]) {
            const message = refusal({ documentation: { title: 'My API', enabled } });
            expect(message, String(enabled)).toContain('  - api.documentation.enabled: ');
            expect(message, String(enabled)).toContain('RestApiConfigSchema');
            expect(message, String(enabled)).toMatch(DOCS_ENABLED_PRESCRIPTION);
            // Only the retired member is diagnosed — `title` is not named.
            expect(message, String(enabled)).not.toContain('api.documentation.title');
        }
    });

    it('a retired-key refusal never diagnoses `api.version` — a key this config did not write', () => {
        const message = refusal({ responseFormat: { envelope: false } });
        expect(message, 'positive control: the refusal is present').toContain('api.responseFormat');
        expect(message).not.toContain('/api//');
        expect(message).not.toContain('api.version');
    });

    it('the plugin path refuses the same keys (both cast hops)', async () => {
        await expect(
            createRestApiPlugin({ api: { api: { responseFormat: { envelope: false } } } } as never).start!(bootCtx()),
        ).rejects.toThrow(/api\.responseFormat.*was removed/s);
        await expect(
            createRestApiPlugin({ api: { api: { documentation: { enabled: false } } } } as never).start!(bootCtx()),
        ).rejects.toThrow(/api\.documentation\.enabled.*was removed/s);
    });
});

describe('[#20294] RestServer construction refuses the retired `api.documentation.version`', () => {
    // Ruling B on #20359: the identity members of `documentation` are enforced
    // (they overlay the served `info` — `rest-openapi-info-overlay.test.ts`),
    // `version` is retired because the served `info.version` is the protocol
    // version (#11646). An authored one used to be accepted and ignored.
    it('refuses it — with the enforced siblings beside it undiagnosed', () => {
        const message = refusal({ documentation: { title: 'Acme Orders API', description: 'd', version: '2.3.0' } });
        expect(message).toContain('  - api.documentation.version: ');
        expect(message).toContain('RestApiConfigSchema');
        expect(message).toMatch(DOCS_VERSION_PRESCRIPTION);
        // Only the retired member is diagnosed — no issue line locates an
        // enforced sibling (the prescription itself NAMES
        // `api.documentation.description`, as the place a release number
        // goes, so the check is on the located-issue line, not the word).
        expect(message).not.toContain('  - api.documentation.title: ');
        expect(message).not.toContain('  - api.documentation.description: ');
        // Not the route identifier either: `api.version` is a different key.
        expect(message).not.toContain('  - api.version: ');
    });

    it('the plugin path refuses it too', async () => {
        await expect(
            createRestApiPlugin({ api: { api: { documentation: { version: '2.3.0' } } } } as never).start!(bootCtx()),
        ).rejects.toThrow(/api\.documentation\.version.*was removed/s);
    });

    it('CONTROL: the same block without `version` constructs, and the enforced members pass through', () => {
        expect(refusal({ documentation: { title: 'Acme Orders API', description: 'd' } })).toBe('');
        const api = normalizedApi(construct({ documentation: { title: 'Acme Orders API', description: 'd' } }));
        expect(api.documentation).toEqual({ title: 'Acme Orders API', description: 'd' });
    });
});

describe('[#20295] CONTROL: without the retired keys, the server is what it was', () => {
    it('the plugin path still boots (the ctx is not what refuses)', async () => {
        const ctx = bootCtx();
        await expect(
            createRestApiPlugin({ api: { api: { documentation: { title: 'My API' } } } } as never).start!(ctx),
        ).resolves.toBeUndefined();
        expect(ctx.logger.error).not.toHaveBeenCalled();
    });

    it('normalizeConfig neither forwards nor re-defaults either retired key', () => {
        const api = normalizedApi(construct({ documentation: { title: 'My API' } }));
        expect(api).not.toHaveProperty('responseFormat');
        expect(api.documentation, 'the live members pass through with their declared defaults only').toEqual({ title: 'My API' });
        expect(api.documentation as object).not.toHaveProperty('enabled');
    });

    it('`api.enableOpenApi` is the OpenAPI switch the prescription names — it really unmounts the document', () => {
        const on = mounted({});
        const off = mounted({ enableOpenApi: false });
        // Positive control: the default mounts both routes the switch owns.
        expect(on).toContain('GET /api/v1/openapi.json');
        expect(on).toContain('GET /api/v1/docs');
        expect(on.filter((r) => !off.includes(r)).sort()).toEqual(['GET /api/v1/docs', 'GET /api/v1/openapi.json']);
    });

    it('a `documentation` block without `enabled` mounts exactly the default surface — the key never reached it', () => {
        expect(mounted({ documentation: { title: 'Renamed', description: 'd' } })).toEqual(mounted({}));
    });
});
