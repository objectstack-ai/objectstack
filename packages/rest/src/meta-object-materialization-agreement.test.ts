// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8268] The two producers of "what does this object look like" must agree
// about EVERY stamp the registry's object-materialization seam applies — not
// about one named stamp at a time.
//
// ## Why this file is about a CLASS and not about `nameField`
//
// Three stamps of ONE seam have now been found diverging on ONE read path, and
// each was found, filed and fixed separately:
//
//   #6562  injected system columns (`created_at`, `owner_id`, …)  ruled 2026-08-08
//   #8038  the `__search` companion column                        landed a6cd2c152f
//   #8268  `nameField` (the ADR-0079 title designation)           THIS FILE
//
// The cause is the same one every time and it is structural, not incidental.
// `GET /meta/object/:name` resolves `sys_metadata` overlay → MetadataService →
// SchemaRegistry, and ONLY the last of those three has been through
// `SchemaRegistry.registerObject`'s materialization block. The other two hold
// the author's DECLARATION, captured before materialization. So the answer a
// caller got depended on which link produced it, with nothing in the response
// saying which one had — and each convergence installed at the read exit
// reached for ONE named stamp, which is precisely why the next stamp arrived as
// the next card.
//
// So this file does not assert "the by-name read returns `nameField`". That
// passes again the day someone re-adds the key at the route, which is the same
// defect one layer over, and it says nothing about stamp four. It asserts
// AGREEMENT ON THE WHOLE DOCUMENT — every key of the by-name answer against the
// registry's own resolved schema — measured from the real producers in one
// test, over a real `RestServer` on a real `ObjectStackProtocolImplementation`
// on a real `SchemaRegistry`. A stamp added to `materializeBaseLayer` and not
// converged at the read exits fails this file without anyone editing it.
//
// ## The measurement this file was built from, on `origin/main`
//
//   artifact host   byName vs listed   diverge on keys: nameField
//                   byName vs registry diverge on keys: nameField
//                   byName.nameField = undefined   registry.nameField = 'name'
//   bridged host    diverge on keys: (none)        byName.nameField = 'name'
//   absent host     diverge on keys: (none)        byName.nameField = 'name'
//
// The controls are the whole tell: the probe can see agreement when agreement
// exists, and the divergence tracks the un-materialized service copy
// specifically. Which route is right is settled — #6562's maintainer ruling
// (2026-08-08, Option B): the read serves the EFFECTIVE runtime schema and the
// stored-layer minority converges on the registry-backed majority.
//
// ## Two divergences this file MEASURES but does not fix
//
// Both were found by diffing whole keys rather than the fields map, both are
// out of this card's region, and both are filed. They are pinned here as
// EXPECTED so that the day either is fixed, this file fails and is updated
// deliberately rather than silently drifting:
//
//  1. `indexes` — on a MULTI-TENANT deployment `applySystemFields` also stamps
//     `indexes: [{ fields: ['organization_id'] }]`, and the read exit's
//     `applyInjectedSystemColumns` converges the FIELDS MAP only. A fourth
//     stamp of the same seam, in `metadata-core`.
//  2. `__search` on an extended title-less base — `registerObject` materializes
//     the BASE and `resolveObject` folds `extend` contributors on afterwards
//     WITHOUT re-materializing, while the read exits transform the ALREADY
//     FOLDED document. So a base with no title-eligible field that an extension
//     gives a text field to gets a companion from both `/meta` reads and none
//     from the registry. A POSITION defect of the seam, not a stamp defect,
//     live since #8038 and unchanged here.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

/** The ADR-0079 primary-title pointer — the stamp this card converged. */
const NAME_FIELD = 'nameField';
const SEARCH_COMPANION = '__search';

/**
 * An object with a title-eligible field, so the materialization seam designates
 * a title for it. Stands for the ordinary business object.
 */
const TITLED_DECLARATION = {
    name: 'showcase_account',
    label: 'Account',
    fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        industry: { name: 'industry', label: 'Industry', type: 'text' },
    },
};

/**
 * A junction object with NO title-eligible field (`lookup` and `number` are
 * both outside `TITLE_ELIGIBLE_TYPES`), so `provisionPrimary(_, { synthesize:
 * false })` designates NOTHING and no companion is provisioned either — on any
 * route, on any host. This file's anti-vacuity case.
 */
const UNTITLED_DECLARATION = {
    name: 'showcase_project_membership',
    label: 'Project Membership',
    fields: {
        project: { name: 'project', label: 'Project', type: 'lookup', reference_to: 'showcase_project' },
        seats: { name: 'seats', label: 'Seats', type: 'number' },
    },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Keys that are READ DECORATIONS rather than part of what the document means —
 * derived diagnostics and provenance the write path strips again (#4326). They
 * are excluded from the whole-key comparison because the registry's own
 * resolved schema does not carry them and never should.
 */
const DECORATIONS = new Set(['_diagnostics', '_packageId', '_lock', '_draft', '_provenance']);

/**
 * Every key on which `a` and `b` differ, decorations excluded.
 *
 * ⛔ Compares field DEFINITIONS key-insensitively to declaration ORDER. The two
 * producers build the fields map by different routes, so `JSON.stringify` alone
 * reports a difference of ordering as a difference of content — measured: it
 * flagged an extended object whose two field maps were identical in every
 * definition. Ordering is not part of what the read exits converge, and pinning
 * it here would make this file fail for a reason it is not about.
 */
function divergingKeys(a: unknown, b: unknown): string[] {
    const stable = (v: unknown): string => {
        if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
        if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
    };
    const keys = (o: unknown) =>
        Object.keys((o ?? {}) as Record<string, unknown>).filter((k) => !DECORATIONS.has(k));
    const all = [...new Set([...keys(a), ...keys(b)])].sort();
    return all.filter((k) => stable((a as never)?.[k]) !== stable((b as never)?.[k]));
}

/**
 * How this host's `metadata` service was populated — the ONE axis that makes the
 * routes disagree, and the reason the hosts below are not variations on a theme.
 */
type ServiceMode =
    /** Artifact ingest: the service holds the author's declaration, pre-materialization. */
    | 'artifact'
    /** In-process boot: the service is seeded from the MATERIALIZED registry. */
    | 'bridged'
    /** No `metadata` service at all — the read falls through to the registry. */
    | 'absent';

interface Host {
    listed: Record<string, unknown> | undefined;
    byName: Record<string, unknown> | undefined;
    layerEffective: Record<string, unknown> | undefined;
    serviceBody: Record<string, unknown> | undefined;
    registryResolved: Record<string, unknown> | undefined;
}

/**
 * Boot a REST server over the REAL protocol over a REAL registry and read every
 * route off it. The registry is always the real one, so the materialization
 * under test is the shipped materialization and not a re-description of it.
 */
async function measure(opts: {
    serviceMode: ServiceMode;
    /** The deployment gate (`OS_SEARCH_PINYIN_ENABLED`, resolved once per registry). */
    searchCompanion?: boolean;
    /** Multi-tenant injection (`organization_id` + its index). */
    multiTenant?: boolean;
    /** Register the junction object with no title-eligible field instead. */
    untitled?: boolean;
    /** Add an `extend` contributor carrying a title-eligible field. */
    extendWithText?: boolean;
}): Promise<Host> {
    const declaration = opts.untitled ? UNTITLED_DECLARATION : TITLED_DECLARATION;
    const objectName = declaration.name;

    const registry = new SchemaRegistry({
        multiTenant: opts.multiTenant ?? false,
        searchCompanion: opts.searchCompanion !== false,
    } as never);
    registry.registerObject(clone(declaration) as never, 'showcase', undefined, 'own');
    if (opts.extendWithText) {
        registry.registerObject(
            {
                name: objectName,
                fields: { nickname: { name: 'nickname', label: 'Nickname', type: 'text' } },
            } as never,
            'ext_pkg', undefined, 'extend',
        );
    }

    const engine = {
        registry,
        find: async () => [],
        findOne: async () => undefined,
    };

    const services = new Map<string, unknown>();
    if (opts.serviceMode !== 'absent') {
        // 'artifact' registers the AUTHOR'S DECLARATION (what a compiled
        // artifact's `objects` collection holds — nothing has materialized it);
        // 'bridged' registers what the registry resolved. This single
        // difference is the whole reproduction.
        const body = opts.serviceMode === 'artifact'
            ? clone(declaration)
            : registry.getObject(objectName);
        services.set('metadata', {
            get: async (type: string, name: string) =>
                (type === 'object' || type === 'objects') && name === objectName
                    ? clone(body)
                    : undefined,
        });
    }

    const protocol = new ObjectStackProtocolImplementation(
        engine as never,
        () => services as Map<string, never>,
    );

    const rest = new RestServer(
        createMockServer() as never,
        protocol as never,
        { api: { requireAuth: false } } as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const routes = rest.getRouteManager();

    const run = async (path: string, params: Record<string, string>, query: Record<string, string>) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: ${path}`);
        let body: unknown;
        const res = {
            status: () => res,
            header: () => res,
            json: (b: unknown) => { body = b; },
            send: (b: unknown) => { body = b; },
        } as unknown as Parameters<typeof entry.handler>[1];
        await entry.handler(
            { params, query, headers: {}, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0],
            res,
        );
        return body as Record<string, unknown> | undefined;
    };

    const listBody = await run('/api/v1/meta/:type', { type: 'object' }, {});
    const listItems = (Array.isArray(listBody)
        ? listBody
        : ((listBody?.items ?? listBody?.data ?? []) as unknown[])) as Array<{ name?: string }>;

    const singleBody = await run('/api/v1/meta/:type/:name', { type: 'object', name: objectName }, {});
    const layeredBody = await run(
        '/api/v1/meta/:type/:name', { type: 'object', name: objectName }, { layers: 'true' },
    );

    const metadataService = services.get('metadata') as
        { get(t: string, n: string): Promise<unknown> } | undefined;

    return {
        listed: listItems.find((o) => o?.name === objectName) as Record<string, unknown> | undefined,
        byName: singleBody?.item as Record<string, unknown> | undefined,
        layerEffective: layeredBody?.effective as Record<string, unknown> | undefined,
        serviceBody: metadataService
            ? (await metadataService.get('object', objectName)) as Record<string, unknown>
            : undefined,
        registryResolved: registry.getObject(objectName) as unknown as Record<string, unknown>,
    };
}

/** The read is non-empty — a "defect" assertion over an empty read proves nothing. */
function expectNonEmptyRead(host: Host) {
    expect(host.byName).toBeTruthy();
    expect(host.byName?.name).toBe(host.registryResolved?.name);
    expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>).length)
        .toBeGreaterThan(0);
}

describe('[#8268] every /meta object read exit materializes the base the way the registry does', () => {
    it('agrees on an ARTIFACT-ingested host — where the by-name read used to drop `nameField`', async () => {
        const host = await measure({ serviceMode: 'artifact' });
        expectNonEmptyRead(host);

        // The host is genuinely un-materialized, measured rather than asserted:
        // the service's copy really does lack the designation, so agreement
        // here cannot be reached by this host having had nothing to converge.
        expect(host.serviceBody?.[NAME_FIELD]).toBeUndefined();
        // …and the list read really does carry it, so agreement cannot be
        // reached by the list read quietly losing it too.
        expect(host.listed?.[NAME_FIELD]).toBe('name');

        // The pin, at the level of the CLASS: the by-name answer and the
        // registry's own resolved schema differ on NO key at all.
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
        expect(divergingKeys(host.byName, host.listed)).toEqual([]);
        // `?layers=true`'s `effective` is documented as "what `getMetaItem`
        // would return" (#4513/#8027), so it converges too or that sentence
        // stops being true.
        expect(divergingKeys(host.layerEffective, host.registryResolved)).toEqual([]);

        // Named explicitly as well as structurally, so a reader of a failure
        // sees WHICH stamp moved and not only that something did.
        expect(host.byName?.[NAME_FIELD]).toBe('name');
    });

    it('agrees on a REGISTRY-ONLY host — the platform objects, which already agreed', async () => {
        const host = await measure({ serviceMode: 'absent' });
        expectNonEmptyRead(host);

        expect(host.byName?.[NAME_FIELD]).toBe('name');
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
    });

    it('agrees on a BRIDGED in-process host — the boot that always happened to work', async () => {
        const host = await measure({ serviceMode: 'bridged' });
        expectNonEmptyRead(host);

        expect(host.serviceBody?.[NAME_FIELD]).toBe('name');
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
    });

    it('converges the companion stamp on the same host, in the same call', async () => {
        // #8038's stamp travels through the SAME shared seam now. Pinned here
        // so a regression that reached for `nameField` alone — the mistake this
        // card exists to stop being repeated — fails immediately.
        const host = await measure({ serviceMode: 'artifact' });

        expect(Object.keys((host.serviceBody?.fields ?? {}) as Record<string, unknown>))
            .not.toContain(SEARCH_COMPANION);
        expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>))
            .toContain(SEARCH_COMPANION);
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
    });

    // ── Anti-vacuity ────────────────────────────────────────────────────────
    // Agreement is worth something only if the stamps are genuinely
    // DISCRIMINATED. A fix that simply stamped `nameField: 'name'` onto every
    // served object, or copied the registry's answer over the served body,
    // fails every case below.

    it('designates NOTHING on either route for an object with no title-eligible field', async () => {
        const host = await measure({ serviceMode: 'artifact', untitled: true });
        expectNonEmptyRead(host);

        expect(host.registryResolved?.[NAME_FIELD]).toBeUndefined();
        expect(host.listed?.[NAME_FIELD]).toBeUndefined();
        expect(host.byName?.[NAME_FIELD]).toBeUndefined();
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
    });

    it('serves no companion on either route when the DEPLOYMENT has companions off', async () => {
        // The `nameField` half still converges here — the two stamps of the
        // seam are gated independently, and a shared call must not collapse
        // them into one decision.
        const host = await measure({ serviceMode: 'artifact', searchCompanion: false });
        expectNonEmptyRead(host);

        expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>))
            .not.toContain(SEARCH_COMPANION);
        expect(host.byName?.[NAME_FIELD]).toBe('name');
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual([]);
    });

    it('never INVENTS a designation the registry itself declined', async () => {
        // The one case where a transform run at the read exit would over-reach.
        // `registerObject` designates over the BASE layer; `resolveObject` folds
        // `extend` contributors on afterwards WITHOUT re-designating. So a
        // title-less base that an extension gives a text field to resolves with
        // NO `nameField`, while a transform over the FOLDED document the read
        // exit holds would happily designate the extension's field.
        //
        // The seam withholds instead. Convergence may only move the served copy
        // ONTO the registry's answer, never manufacture one the registry
        // refused — otherwise this card's fix becomes the next card's defect.
        const host = await measure({ serviceMode: 'artifact', untitled: true, extendWithText: true });

        // The fold really did happen — otherwise this case is vacuous.
        expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>))
            .toContain('nickname');
        // …and the extension's field really is title-eligible, so withholding
        // is a decision and not an inability.
        expect((host.byName?.fields as Record<string, { type?: string }>)?.nickname?.type)
            .toBe('text');

        expect(host.registryResolved?.[NAME_FIELD]).toBeUndefined();
        expect(host.byName?.[NAME_FIELD]).toBeUndefined();
        expect(host.layerEffective?.[NAME_FIELD]).toBeUndefined();
    });

    it('keeps designating when the base itself carries the title, extension or not', async () => {
        // The mirror of the case above: withholding must be narrow. A base that
        // CAN be designated still is, with an extender present.
        const host = await measure({ serviceMode: 'artifact', extendWithText: true });

        expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>))
            .toContain('nickname');
        expect(host.registryResolved?.[NAME_FIELD]).toBe('name');
        expect(host.byName?.[NAME_FIELD]).toBe('name');
    });

    // ── The two divergences this card measured and did NOT fix ──────────────
    // Pinned as EXPECTED so the day either is fixed this file fails and is
    // updated deliberately. See the header for what each one is.

    it('MEASURES the un-converged multi-tenant `indexes` stamp (not fixed here)', async () => {
        const host = await measure({ serviceMode: 'artifact', multiTenant: true });
        expectNonEmptyRead(host);

        // The stamp the registry applies and the read exit does not.
        expect(host.registryResolved?.indexes).toEqual([{ fields: ['organization_id'] }]);
        expect(host.byName?.indexes).toBeUndefined();

        // `indexes` is the ONLY key still diverging on this host — `nameField`
        // is converged, which is what this card changed.
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual(['indexes']);
    });

    it('MEASURES the companion over-provisioned on an extended title-less base (not fixed here)', async () => {
        // Reproduces on the REGISTRY-ONLY host too, so it is not the artifact
        // seam: it is the seam's POSITION relative to the extender fold.
        const host = await measure({ serviceMode: 'absent', untitled: true, extendWithText: true });

        expect(Object.keys((host.registryResolved?.fields ?? {}) as Record<string, unknown>))
            .not.toContain(SEARCH_COMPANION);
        expect(Object.keys((host.byName?.fields ?? {}) as Record<string, unknown>))
            .toContain(SEARCH_COMPANION);
        expect(divergingKeys(host.byName, host.registryResolved)).toEqual(['fields']);
    });
});
