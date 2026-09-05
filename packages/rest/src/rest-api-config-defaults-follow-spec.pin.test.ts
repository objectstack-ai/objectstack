// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14366] `RestApiConfigSchema` is the SINGLE SOURCE of the `api` sub-object's
 * defaults — `RestServer.normalizeConfig` follows a change to a
 * `z.default(...)` in `packages/spec` rather than restating it.
 *
 * ⛔ ANTI-VACUITY, and this file exists because the ordinary spelling of this
 * pin is vacuous. A test that asserts today's VALUES — `version === 'v1'`,
 * `enableProjectScoping === false` — passes just as well with the deleted `??`
 * chain still in place, because the chain's literals and the schema's defaults
 * agreed key for key on the day the chain was written. That agreement is the
 * whole defect: two sources that happen to match, with nothing measuring that
 * they keep matching. Asserting the matched value measures neither source.
 *
 * So this file MOVES the schema and asks where the server lands. The mock
 * below re-declares five `z.default(...)`s to values that differ from both the
 * real schema's and the deleted chain's literals, then drives a REAL
 * `RestServer` construction and reads the normalized config back:
 *
 *     key                    real default   deleted `??` literal   mutated to
 *     version                'v1'           'v1'                   'v9-mutated'
 *     basePath               '/api'         '/api'                 '/mutated'
 *     enableUi               true           true                   false
 *     enableProjectScoping   false          false                  true
 *     projectResolution      'auto'         'auto'                 'required'
 *
 * Pre-change tree: all five answer the `??` literal, because the chain read the
 * RAW input (`api.version ?? 'v1'`) and an absent key is nullish whatever the
 * schema says — the parsed output was discarded. Post-change: all five answer
 * the mutated default. That gap is what makes each case below a measurement of
 * the propagation rather than of a coincidence. Measured, both directions, in
 * this change's own reverse verification.
 *
 * ⚠️ This file mocks `@objectstack/spec/api` module-wide, so the schema it
 * drives is NOT the shipped one. The complementary pins that need the REAL
 * schema — that the shipped defaults are the schema's, that `requireAuth`
 * keeps its warn-and-ignore posture, and that the parse's inner defaults now
 * reach `documentation` / `responseFormat` — live in
 * `rest-config-parse-not-cast.test.ts` §D, which is deliberately unmocked.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/spec/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@objectstack/spec/api')>();
    const { z } = await import('zod');
    return {
        ...actual,
        // `.extend()` on the real schema, not a hand-built stand-in: every
        // other key — and the `requireAuth` tombstone the seam `.omit()`s —
        // must survive, or this would measure a shape change rather than a
        // default change. Only the five defaults move.
        RestApiConfigSchema: (actual.RestApiConfigSchema as any).extend({
            version: z.string().regex(/^[a-zA-Z0-9_\-\.]+$/).default('v9-mutated'),
            basePath: z.string().default('/mutated'),
            enableUi: z.boolean().default(false),
            enableProjectScoping: z.boolean().default(true),
            projectResolution: z.enum(['required', 'optional', 'auto']).default('required'),
        }),
    };
});

const { RestServer } = await import('./rest-server.js');
// The MOCKED schema, imported through the same specifier the seam uses, so the
// control case below reads the very object the server was handed.
const { RestApiConfigSchema } = await import('@objectstack/spec/api');

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
function construct(api: Record<string, unknown> = {}) {
    return new RestServer(makeServer(), makeProtocol(), { api } as any);
}

/** The normalized `api` block, read off the constructed server. */
function normalizedApi(rest: unknown): Record<string, unknown> {
    return (rest as { config: { api: Record<string, unknown> } }).config.api;
}

describe('[#14366] normalizeConfig follows the SCHEMA default, not a local literal', () => {
    it('CONTROL: the mock really did move the schema', () => {
        // Not decoration. Every assertion below is "the server answers X"; if
        // the mock silently failed to apply, the real default would be `'v1'`
        // and a `not.toBe('v1')` style pin could pass for the wrong reason.
        // This proves the premise the rest of the file rests on.
        const parsed = (RestApiConfigSchema as any).omit({ requireAuth: true }).parse({});
        expect(parsed.version, 'the mocked schema must carry the mutated default').toBe('v9-mutated');
        expect(parsed.basePath).toBe('/mutated');
        expect(parsed.enableUi).toBe(false);
        expect(parsed.enableProjectScoping).toBe(true);
        expect(parsed.projectResolution).toBe('required');
    });

    it('a moved `version` default reaches the normalized config', () => {
        // Pre-change: `'v1'` — `api.version ?? 'v1'` never consulted the schema.
        expect(normalizedApi(construct()).version).toBe('v9-mutated');
    });

    it('a moved `basePath` default reaches the normalized config', () => {
        expect(normalizedApi(construct()).basePath).toBe('/mutated');
    });

    it('a moved BOOLEAN default reaches it too — the `??` chain could not express this', () => {
        // The sharpest of the five. `api.enableUi ?? true` yields `true` for an
        // absent key no matter what the schema declares, so a spec change from
        // `default(true)` to `default(false)` was UNREPRESENTABLE downstream:
        // silently dropped, with every test still green. This is the drift the
        // card was filed about, stated as an executable case.
        expect(normalizedApi(construct()).enableUi).toBe(false);
        expect(normalizedApi(construct()).enableProjectScoping).toBe(true);
    });

    it('a moved ENUM default reaches it', () => {
        expect(normalizedApi(construct()).projectResolution).toBe('required');
    });

    it('the moved defaults reach the MOUNT, not just the config object', () => {
        // Read through the behaviour, not only the structure: a default that
        // landed in the normalized config but was not threaded would still be
        // a half-fix. `getApiBasePath()` composes `${basePath}/${version}`.
        expect(construct().getApiBasePath()).toBe('/mutated/v9-mutated');
    });

    it('an AUTHORED value still wins over the schema default — the change is defaults only', () => {
        // The bound. Consuming the parse must not start overriding what the
        // caller wrote; zod `.default()` applies to `undefined` alone.
        const rest = construct({ version: 'v3', basePath: '/authored', enableUi: true });
        expect(normalizedApi(rest).version).toBe('v3');
        expect(normalizedApi(rest).basePath).toBe('/authored');
        expect(normalizedApi(rest).enableUi).toBe(true);
        expect(rest.getApiBasePath()).toBe('/authored/v3');
    });

    it('an authored FALSE still survives — `??` and the parse agree here, and must keep agreeing', () => {
        // `false` is not nullish, so the deleted chain honoured it too. Kept as
        // a regression guard: the failure this pin guards against is a future
        // author "simplifying" the parse into a truthiness check.
        const rest = construct({ enableProjectScoping: false });
        expect(normalizedApi(rest).enableProjectScoping).toBe(false);
    });
});
