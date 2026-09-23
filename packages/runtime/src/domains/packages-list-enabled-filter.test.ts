// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19394] `GET /api/v1/packages` honours the declared `enabled` filter —
 * ruling item 2 of #17667.
 *
 * ## The defect this file pins shut
 *
 * `ListInstalledPackagesRequestSchema` (`packages/spec/src/api/package-api.zod.ts`)
 * declares `enabled: z.boolean().optional()`, and the serving door — the
 * `parts.length === 0 && m === 'GET'` branch of `handlePackagesRequest` — never
 * read it. A caller filtering an installed-package list by `enabled` was handed
 * the UNFILTERED list, with no refusal and no warning: «declared ≠ enforced» in
 * the silent direction, which is the class Prime Directive #10 refuses and the
 * one no status, header or field on the answer distinguishes from a request
 * served as asked.
 *
 * ## ⭐ §0 is the load-bearing section, and it is first for a reason
 *
 * Every case below is a claim that the DOOR agrees with the DECLARATION, never
 * that the door matches a reading this file has an opinion about. So the
 * declaration is asserted BY REFERENCE first — its type, its optionality, the
 * absence of a default, and the record-side default that decides what a row
 * carrying no `enabled` counts as. If the spec seat ever moves any of those,
 * §0 goes red first and names what happened, instead of a behaviour case
 * failing for a reason the next reader would have to reconstruct.
 *
 * That ordering is this card's whole risk. A runtime door implementing a
 * PLAUSIBLE reading of `enabled` rather than the DECLARED one would recreate
 * the split the ruling exists to close — quietly, because it compiles and it
 * tests green against its own assumption.
 *
 * ## ⛔ Two neighbours this file deliberately says nothing about
 *
 * - **The four residual install-door classes filed as #19328** (a manifest with
 *   no `type`, unknown keys on either body form, a string-typed
 *   `enableOnInstall` / `overwrite`, install options on the bare form). They
 *   live in the `POST` branch of the same file. ⛔ No case here asserts
 *   anything about them in either direction: pinning them as `201` would freeze
 *   known residuals as intended behaviour, and pinning them as refused would be
 *   this file quietly widening a graded scope.
 * - **`hasMore` / `nextCursor`.** #19364 retired the request half
 *   (`limit` / `cursor`) and left `hasMore` a constant `false` that is now true
 *   by construction. §5 asserts it is UNMOVED by this card — that is a
 *   preservation pin, not a re-adjudication.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ListInstalledPackagesRequestSchema } from '@objectstack/spec/api';
import { InstalledPackageSchema } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Authenticated caller holding the ADR-0106 D4 read capability. */
const reader = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] },
});

/** The declared key, reached the way the door reaches it — never re-spelled. */
const DECLARED_ENABLED = ListInstalledPackagesRequestSchema.shape.enabled;

/**
 * Five rows chosen so that `enabled` and `status` DISAGREE on two of them.
 *
 * `SchemaRegistry.disablePackage` moves both at once (`enabled = false` and
 * `status = 'disabled'`), so a registry built only through the lifecycle verbs
 * cannot tell a door that filters on `enabled` apart from one that filters on
 * `status` — every case would pass either way. Two rows are therefore written
 * directly, which is a state the declared record admits (`status` and `enabled`
 * are independent keys on `InstalledPackageSchema`) and one a durable-store
 * hydration can produce.
 *
 * The fifth row carries NO `enabled` key at all — the shape
 * `InstalledPackageSchema`'s `.default(true)` is about, asserted in §0 and
 * partitioned in §3.
 */
const ENABLED_APP = 'com.acme.enabled-app';
const DISABLED_APP = 'com.acme.disabled-app';
const ENABLED_BUT_ERRORED = 'com.acme.enabled-but-errored';
const DISABLED_BUT_INSTALLED = 'com.acme.disabled-but-installed';
const NO_ENABLED_KEY = 'com.acme.no-enabled-key';

/** Every id the fixture registry holds, for the "no filter" and partition reads. */
const ALL_IDS = [
    ENABLED_APP, DISABLED_APP, ENABLED_BUT_ERRORED, DISABLED_BUT_INSTALLED, NO_ENABLED_KEY,
].sort();

function fixtureRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';

    const install = (id: string, type: string) => registry.installPackage({
        id, name: id, namespace: id.split('.').pop(), version: '1.0.0', type,
    } as any);

    install(ENABLED_APP, 'app');
    install(DISABLED_APP, 'app');
    install(ENABLED_BUT_ERRORED, 'plugin');
    install(DISABLED_BUT_INSTALLED, 'plugin');
    install(NO_ENABLED_KEY, 'app');

    registry.disablePackage(DISABLED_APP);

    // `status` moved, `enabled` left alone — a row the `enabled` filter must
    // keep in the ENABLED half while `?status=installed` excludes it.
    (registry.getPackage(ENABLED_BUT_ERRORED) as any).status = 'error';
    // `enabled` moved, `status` left alone — the mirror image.
    (registry.getPackage(DISABLED_BUT_INSTALLED) as any).enabled = false;
    // No `enabled` key at all.
    delete (registry.getPackage(NO_ENABLED_KEY) as any).enabled;

    return registry;
}

interface Door {
    dispatcher: HttpDispatcher;
    /** The one registry read the list branch makes — a refusal must not reach it. */
    getAllPackages: ReturnType<typeof vi.spyOn>;
}

function makeDoor(): Door {
    const registry = fixtureRegistry();
    const getAllPackages = vi.spyOn(registry, 'getAllPackages');
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' ? { registry } : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), getAllPackages };
}

/** `GET /api/v1/packages` exactly as the route reads it. */
const list = (door: Door, query: Record<string, unknown>) =>
    door.dispatcher.handlePackages('', 'GET', undefined, query, reader());

/** The ids a successful list answered with, sorted. */
function idsOf(response: any): string[] {
    return (response?.body?.data?.packages ?? []).map((p: any) => p.manifest.id).sort();
}

// ═══════════════════════════════════════════════════════════════════════
// §0 — the DECLARATION this door is being held to
// ═══════════════════════════════════════════════════════════════════════

describe('§0 what `ListInstalledPackagesRequestSchema` declares about `enabled`', () => {
    it('declares a BOOLEAN — exactly two spellings on the wire, and no third', () => {
        expect(DECLARED_ENABLED.safeParse(true).success).toBe(true);
        expect(DECLARED_ENABLED.safeParse(false).success).toBe(true);
        // ⭐ This is what licenses `parseBooleanParam` rather than a local
        // `=== 'true'`: the declared type admits `true`/`false` and nothing
        // else, so a third spelling is refused rather than guessed. If the
        // spec seat ever widens this key to a string or an enum, THIS goes red
        // and the door's coercion has to be re-read against the new grammar.
        expect(DECLARED_ENABLED.safeParse('true').success).toBe(false);
        expect(DECLARED_ENABLED.safeParse(1).success).toBe(false);
    });

    it('declares it OPTIONAL with NO default — absent stays absent', () => {
        const parsed = ListInstalledPackagesRequestSchema.parse({});
        // The distinction the whole card turns on: `.optional()` with no
        // `.default()` means an absent key parses to an absent key. It does
        // NOT become `false`, so "no filter" and "filter to the disabled half"
        // are two different requests and the door must answer them differently.
        expect('enabled' in parsed).toBe(false);
        expect(parsed.enabled).toBeUndefined();
    });

    it('declares the RECORD default that decides what a row with no `enabled` counts as', () => {
        // `InstalledPackageSchema.enabled` is `z.boolean().default(true)`, so a
        // row carrying no `enabled` IS enabled by declaration. That is the one
        // fact `packageCountsAsEnabled` reads; §3 partitions on it.
        expect(InstalledPackageSchema.shape.enabled.parse(undefined)).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §1 — ABSENT means NO FILTER (the case the card names explicitly)
// ═══════════════════════════════════════════════════════════════════════

describe('§1 an absent `enabled` filters nothing', () => {
    it.each([
        ['no query object at all', {}],
        ['an explicitly undefined value', { enabled: undefined }],
        ['an empty array — no occurrence, per the multiplicity rule', { enabled: [] }],
    ])('%s → every row, enabled and disabled alike', async (_label, query) => {
        const door = makeDoor();
        const r = await list(door, query);

        expect(r.response?.status).toBe(200);
        expect(idsOf(r.response)).toEqual(ALL_IDS);
        expect(r.response?.body?.data?.total).toBe(ALL_IDS.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §2 — the two declared values select their halves
// ═══════════════════════════════════════════════════════════════════════

describe('§2 `enabled` selects by the row\'s enabled state', () => {
    it('?enabled=true → the enabled rows only', async () => {
        const door = makeDoor();
        const r = await list(door, { enabled: 'true' });

        expect(r.response?.status).toBe(200);
        expect(idsOf(r.response)).toEqual([ENABLED_APP, ENABLED_BUT_ERRORED, NO_ENABLED_KEY].sort());
        // ⭐ THE REGRESSION GUARD. A door that silently ignored the parameter
        // again would answer the full list here and pass every assertion that
        // only asked for a 200 — which is exactly what the defect looked like.
        expect(idsOf(r.response)).not.toEqual(ALL_IDS);
        expect(r.response?.body?.data?.total).toBe(3);
    });

    it('?enabled=false → the disabled rows only, NOT the whole list', async () => {
        const door = makeDoor();
        const r = await list(door, { enabled: 'false' });

        expect(r.response?.status).toBe(200);
        expect(idsOf(r.response)).toEqual([DISABLED_APP, DISABLED_BUT_INSTALLED].sort());
        expect(idsOf(r.response)).not.toEqual(ALL_IDS);
        expect(r.response?.body?.data?.total).toBe(2);
    });

    it('reads `enabled`, NOT `status` — the two disagree on two rows and the filter follows `enabled`', async () => {
        const door = makeDoor();
        // `com.acme.enabled-but-errored` is `status: 'error'` and still enabled;
        // `com.acme.disabled-but-installed` is `status: 'installed'` and not.
        // A door that filtered on `status` would place each in the other half.
        expect(idsOf((await list(door, { enabled: 'true' })).response)).toContain(ENABLED_BUT_ERRORED);
        expect(idsOf((await list(makeDoor(), { enabled: 'true' })).response)).not.toContain(DISABLED_BUT_INSTALLED);
        expect(idsOf((await list(makeDoor(), { enabled: 'false' })).response)).toContain(DISABLED_BUT_INSTALLED);
        expect(idsOf((await list(makeDoor(), { enabled: 'false' })).response)).not.toContain(ENABLED_BUT_ERRORED);
    });

    it('accepts a REAL boolean — what an in-process `dispatch()` delegation hands over', async () => {
        expect(idsOf((await list(makeDoor(), { enabled: true })).response))
            .toEqual([ENABLED_APP, ENABLED_BUT_ERRORED, NO_ENABLED_KEY].sort());
        expect(idsOf((await list(makeDoor(), { enabled: false })).response))
            .toEqual([DISABLED_APP, DISABLED_BUT_INSTALLED].sort());
    });

    it('accepts a ONE-element array — one occurrence encoded differently by an adapter', async () => {
        expect(idsOf((await list(makeDoor(), { enabled: ['false'] })).response))
            .toEqual([DISABLED_APP, DISABLED_BUT_INSTALLED].sort());
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §3 — the two halves PARTITION the registry
// ═══════════════════════════════════════════════════════════════════════

describe('§3 `?enabled=true` and `?enabled=false` sum to the unfiltered list', () => {
    it('every row lands in exactly one half — including the row with no `enabled` key', async () => {
        const enabled = idsOf((await list(makeDoor(), { enabled: 'true' })).response);
        const disabled = idsOf((await list(makeDoor(), { enabled: 'false' })).response);

        // The property `packageCountsAsEnabled` is spelled for: a strict
        // `p.enabled === want` would drop `com.acme.no-enabled-key` out of BOTH
        // halves, silently, on a 200 — a row the caller can reach with no
        // filter and with neither filter.
        expect([...enabled, ...disabled].sort()).toEqual(ALL_IDS);
        expect(enabled.filter((id) => disabled.includes(id))).toEqual([]);
        expect(enabled).toContain(NO_ENABLED_KEY);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §4 — the refusals: the envelope, and the read that never happened
// ═══════════════════════════════════════════════════════════════════════

describe('§4 a spelling the declared type does not admit is refused, not guessed', () => {
    it.each([
        ['1', '1'],
        ['0', '0'],
        ['uppercase TRUE', 'TRUE'],
        ['yes', 'yes'],
        ['empty', ''],
        ['a structured value', { $ne: false }],
    ])('?enabled=%s → 400 VALIDATION_FAILED naming the parameter', async (_label, raw) => {
        const door = makeDoor();
        const r = await list(door, { enabled: raw });

        expect(r.handled).toBe(true);
        // ADR-0112: the envelope, not merely a throw — `code` AND `status`.
        // A bare `toThrow()` would be a weaker pin than it looks: the shape
        // that was wrong here was never the absence of a throw, it was a `200`
        // carrying the wrong rows.
        expect(r.response?.status).toBe(400);
        expect((r.response as any)?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect((r.response as any)?.body?.success).toBe(false);
        // ADR-0114: the field-addressed half names the parameter and the
        // constraint it violated, so a caller can point at its own input.
        expect((r.response as any)?.body?.error?.details?.fields).toEqual([
            { field: 'enabled', code: 'invalid_boolean', message: expect.stringContaining('`enabled`') },
        ]);
    });

    it('refuses BEFORE the registry is read — a request-shape error owes no server state', async () => {
        const door = makeDoor();
        await list(door, { enabled: 'yes' });

        // The other half of a refusal pin. A door that answered 400 after
        // listing would satisfy the envelope assertions above while still
        // making the answer depend on what happens to be installed.
        expect(door.getAllPackages).not.toHaveBeenCalled();
    });

    it('names the offending value, capped so the body cannot be stuffed', async () => {
        const r = await list(makeDoor(), { enabled: 'x'.repeat(500) });

        const message = (r.response as any)?.body?.error?.message as string;
        expect(message).toContain('`true` or `false`');
        expect(message.length).toBeLessThan(200);
    });

    it('a REPEATED `?enabled=` answers this door\'s existing multiplicity sentence, not a second one', async () => {
        const door = makeDoor();
        const r = await list(door, { enabled: ['true', 'false'] });

        expect(r.response?.status).toBe(400);
        // The same words `?version=` is refused with on this door (#17672) —
        // one rule, one sentence. ⛔ Not a new dialect for one parameter.
        expect((r.response as any)?.body?.error?.message)
            .toBe('The "enabled" query parameter was supplied 2 times. Supply it at most once — '
                + 'this endpoint will not choose between conflicting values.');
        expect(door.getAllPackages).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §5 — PRESERVATION: everything this card did not touch answers as before
// ═══════════════════════════════════════════════════════════════════════

describe('§5 the rest of the list door is unmoved', () => {
    it('`status` still filters on status alone', async () => {
        expect(idsOf((await list(makeDoor(), { status: 'disabled' })).response)).toEqual([DISABLED_APP]);
        expect(idsOf((await list(makeDoor(), { status: 'error' })).response)).toEqual([ENABLED_BUT_ERRORED]);
    });

    it('`type` still filters on the manifest type alone', async () => {
        expect(idsOf((await list(makeDoor(), { type: 'plugin' })).response))
            .toEqual([DISABLED_BUT_INSTALLED, ENABLED_BUT_ERRORED].sort());
    });

    it('the three filters compose — each narrows the set the others left', async () => {
        expect(idsOf((await list(makeDoor(), { type: 'plugin', enabled: 'true' })).response))
            .toEqual([ENABLED_BUT_ERRORED]);
        expect(idsOf((await list(makeDoor(), { status: 'installed', enabled: 'false' })).response))
            .toEqual([DISABLED_BUT_INSTALLED]);
    });

    it('an unmatched filter selects nothing and is not an error', async () => {
        const r = await list(makeDoor(), { type: 'no-such-type', enabled: 'true' });

        expect(r.response?.status).toBe(200);
        expect(idsOf(r.response)).toEqual([]);
        expect(r.response?.body?.data?.total).toBe(0);
    });

    it('`hasMore` is still the constant `false` and `nextCursor` still absent', async () => {
        for (const query of [{}, { enabled: 'true' }, { enabled: 'false' }]) {
            const r = await list(makeDoor(), query);
            expect(r.response?.body?.data?.hasMore).toBe(false);
            expect(r.response?.body?.data?.nextCursor).toBeUndefined();
        }
    });

    it('each served row still carries the projected record fields and the writable verdict', async () => {
        const r = await list(makeDoor(), { enabled: 'false' });
        const row = (r.response as any)?.body?.data?.packages?.[0];

        expect(row.manifest).toBeDefined();
        expect(row.status).toBeDefined();
        expect(row.enabled).toBe(false);
        expect('writable' in row).toBe(true);
    });
});
