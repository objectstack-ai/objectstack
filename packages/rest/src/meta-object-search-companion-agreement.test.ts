// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8038] The two producers of "what fields does this object have" must agree
// about the hidden `__search` companion column too.
//
// ## The defect, measured on `origin/main`
//
// The `__search` companion (#2486) is provisioned at the SchemaRegistry's
// object-materialization seam — `registerObject` runs `provisionSearchCompanion`
// on every base layer when the deployment has companions on. `GET /meta/object`
// composes its objects from `SchemaRegistry.listItems('object')`, so it serves
// the materialized body. `GET /meta/object/:name` consults the `metadata`
// SERVICE first, and on a deployment booted from a compiled artifact
// (`artifactSource` — every sealed/served runtime, and `objectstack serve`) that
// service holds the author's DECLARATION, captured before materialization. So
// the by-name read served a body with no companion column.
//
// Measured end-to-end on the showcase, booted from a build-shaped artifact with
// `OS_SEARCH_PINYIN_ENABLED=true` (69 objects served):
//
//   - 23 package objects. 22 carry a companion on the list read; ALL 22 were
//     served WITHOUT it by the by-name read. (The 23rd,
//     `showcase_project_membership`, has no title-eligible field, so nothing
//     provisions a companion for it on either route.)
//   - 46 platform objects. 45 carry a companion, and every one of them agreed on
//     both routes — they are registered straight into the registry, so the
//     by-name read falls through to it and never meets the artifact copy.
//
// That clean partition is the whole tell: it is not a per-object accident, it is
// PROVENANCE. Whether an object's by-name read is answered by the artifact copy
// or by the registry is invisible to the caller.
//
// ## Which route is right
//
// The by-name one is wrong, on the settled reading of this exact seam. #6562
// asked the same question about the platform's injected system columns —
// `created_at`, `owner_id`, `organization_id` — which the stored layers also
// reported as ABSENT, and the maintainer ruled (2026-08-08, Option B) that the
// read serves the EFFECTIVE runtime schema and the overlay-backed minority
// converges on the registry-backed majority. `__search` is the same kind of
// thing arriving through the same gap: a column the platform provisions, that
// the driver's `syncSchema` materializes (ADR-0045), and that the majority path
// already serves on 45 platform objects and on every list read.
//
// It is NOT the #7642 question. That issue strips `__search` from RECORD bodies
// on the data path, and says so in its own scope note — "deliberately this one
// column, not hidden system columns as a class" — about row VALUES. This is the
// schema description, where the companion's presence is the documented shape:
// #7561 exists precisely because `/meta` re-parses the served object body and
// the companion's stamp had to be spec-valid there.
//
// ## WHAT THIS FILE ASSERTS, and why it is shaped this way
//
// NOT "the by-name route returns `__search`". That passes again the day someone
// re-adds the column at the route, which is the same defect one layer over. It
// asserts AGREEMENT — the by-name read and the list read expose the same field
// set — with both sides MEASURED from the real producers in one test, over a
// real `RestServer` on a real `ObjectStackProtocolImplementation` on a real
// `SchemaRegistry`.
//
// Agreement ALONE is not enough, and #8045 is why: when both routes agree on a
// WRONG body an agreement pin is green throughout the defect. So every host also
// pins what they agree ON — the registry's own resolved schema, which is the
// contract both routes are reporting — and the anti-vacuity hosts below pin that
// the companion is genuinely DISCRIMINATED rather than always-present.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

/** The hidden companion column, spelled out rather than imported — see below. */
const SEARCH_COMPANION = '__search';

/**
 * An object with a title-eligible field, so the materialization seam provisions
 * a companion for it. Stands for the 22.
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
 * A junction object with NO title-eligible field (`lookup` and `number` are both
 * outside `TITLE_ELIGIBLE_TYPES`), so `resolveSearchCompanionSources` finds no
 * source and NOTHING provisions a companion — on either route, on any host.
 * Stands for `showcase_project_membership` and `sys_session` in the measurement
 * above, and it is one of this file's two anti-vacuity cases.
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
 * Field names off a served object body, tolerant of both shapes the wire uses
 * (`fields` as a record, or as an array of `{name}`), so the comparison is about
 * WHICH fields are served rather than about how they are spelled.
 */
function fieldNamesOf(item: unknown): string[] {
    const fields = (item as { fields?: unknown } | null | undefined)?.fields;
    if (!fields) return [];
    const names = Array.isArray(fields)
        ? (fields as Array<{ name?: unknown }>).map((f) => String(f?.name))
        : Object.keys(fields as Record<string, unknown>);
    return [...names].sort();
}

/**
 * How this host's `metadata` service was populated — the ONE axis that makes the
 * two routes disagree, and the reason the hosts below are not variations on a
 * theme. Same axis #7556 turned, because it is the same seam.
 */
type ServiceMode =
    /** Artifact ingest: the service holds the author's declaration, pre-materialization. THE 22. */
    | 'artifact'
    /** In-process boot: `bridgeObjectsToMetadataService` seeds the service from the MATERIALIZED registry. */
    | 'bridged'
    /** No `metadata` service at all — the read falls through to the registry. THE PLATFORM SIDE. */
    | 'absent';

interface Host {
    /** Field names `GET /meta/object` serves for the object. */
    listed: string[];
    /** Field names `GET /meta/object/:name` serves. */
    byName: string[];
    /** Field names the `effective` layer of `?layers=true` serves. */
    layerEffective: string[];
    /** What the `metadata` service itself holds — the base the by-name read starts from. */
    serviceBody: string[];
    /** The registry's own materialized schema — what both routes are supposed to be reporting. */
    registryResolved: string[];
}

/**
 * Boot a REST server over the REAL protocol over a REAL registry, and read BOTH
 * routes off it. The registry is always the real one, so the provisioning under
 * test is the shipped provisioning and not a re-description of it.
 */
async function measure(opts: {
    serviceMode: ServiceMode;
    /** The deployment gate (`OS_SEARCH_PINYIN_ENABLED`, resolved once per registry). */
    searchCompanion?: boolean;
    /** Register the junction object with no title-eligible field instead. */
    untitled?: boolean;
    /**
     * Seed a `sys_metadata` customisation row carrying the author's body — the
     * THIRD link of the chain, and the one #6562 was raised on. ADR-0005
     * §Validation persists a written body verbatim, so this layer has been
     * through no materialization either, and BOTH routes read it: the by-name
     * read takes it in step 1, and the list read merges it over the registry
     * entry. It is the only host on which the list exit does any work.
     */
    overlayRow?: boolean;
}): Promise<Host> {
    const declaration = opts.untitled ? UNTITLED_DECLARATION : TITLED_DECLARATION;
    const objectName = declaration.name;

    const registry = new SchemaRegistry({
        multiTenant: false,
        searchCompanion: opts.searchCompanion !== false,
    } as never);
    registry.registerObject(clone(declaration) as never, 'showcase', undefined, 'own');

    // An overlay row stores the author's declaration — pre-materialization,
    // exactly like the artifact copy, and for the same reason.
    const overlayRows = opts.overlayRow
        ? [{
            id: 'row_1',
            type: 'object',
            name: objectName,
            organization_id: null,
            package_id: null,
            state: 'active',
            metadata: JSON.stringify(clone(declaration)),
        }]
        : [];
    const matchesRow = (where: Record<string, unknown> | undefined) =>
        overlayRows.filter((r) => {
            for (const [k, v] of Object.entries(where ?? {})) {
                if (v === undefined) continue;
                if ((r as Record<string, unknown>)[k] !== v) return false;
            }
            return true;
        });

    const engine = {
        registry,
        find: async (_t: string, o?: { where?: Record<string, unknown> }) => matchesRow(o?.where),
        findOne: async (_t: string, o?: { where?: Record<string, unknown> }) =>
            matchesRow(o?.where)[0],
    };

    const services = new Map<string, unknown>();
    if (opts.serviceMode !== 'absent') {
        // 'artifact' registers the AUTHOR'S DECLARATION (what a compiled
        // artifact's `objects` collection holds — no companion, because nothing
        // has materialized it yet); 'bridged' registers what the registry
        // resolved. This single difference is the whole reproduction.
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
    const listed = listItems.find((o) => o?.name === objectName);

    const singleBody = await run('/api/v1/meta/:type/:name', { type: 'object', name: objectName }, {});
    const layeredBody = await run(
        '/api/v1/meta/:type/:name', { type: 'object', name: objectName }, { layers: 'true' },
    );

    const metadataService = services.get('metadata') as
        { get(t: string, n: string): Promise<unknown> } | undefined;

    return {
        listed: fieldNamesOf(listed),
        byName: fieldNamesOf(singleBody?.item),
        layerEffective: fieldNamesOf(layeredBody?.effective),
        serviceBody: metadataService
            ? fieldNamesOf(await metadataService.get('object', objectName))
            : [],
        registryResolved: fieldNamesOf(registry.getObject(objectName)),
    };
}

describe('[#8038] the by-name and list reads agree about the `__search` companion', () => {
    it('agrees on an ARTIFACT-ingested host — the 22 package objects, where the by-name read used to drop the column', async () => {
        const host = await measure({ serviceMode: 'artifact' });

        // The hosts are genuinely different, measured rather than asserted: the
        // service's copy really does lack the column, so agreement here cannot
        // be reached by this host having had nothing to converge.
        expect(host.serviceBody).not.toContain(SEARCH_COMPANION);
        // …and the list read really does serve it, so agreement cannot be
        // reached by the list read quietly losing it too.
        expect(host.listed).toContain(SEARCH_COMPANION);

        // The pin: whatever the list read serves, the by-name read serves.
        expect(host.byName).toEqual(host.listed);
        // …and what they agree ON is the registry's materialized schema, so the
        // agreement cannot be satisfied by both routes drifting together (#8045).
        expect(host.byName).toEqual(host.registryResolved);
        // `?layers=true`'s `effective` is documented as "what `getMetaItem`
        // would return" (#4513/#8027), so it converges with them or that
        // sentence stops being true.
        expect(host.layerEffective).toEqual(host.listed);
    });

    it('agrees on a REGISTRY-ONLY host — the platform objects, which already agreed', async () => {
        const host = await measure({ serviceMode: 'absent' });

        expect(host.listed).toContain(SEARCH_COMPANION);
        expect(host.byName).toEqual(host.listed);
        expect(host.byName).toEqual(host.registryResolved);
    });

    it('agrees on a BRIDGED in-process host — the boot that always happened to work', async () => {
        const host = await measure({ serviceMode: 'bridged' });

        expect(host.serviceBody).toContain(SEARCH_COMPANION);
        expect(host.byName).toEqual(host.listed);
        expect(host.byName).toEqual(host.registryResolved);
    });

    it('agrees on an OVERLAY-backed host — the third link, and the only one the LIST exit converges', async () => {
        // The customisation row is the base layer for BOTH routes here, so this
        // is the one host where the list read is not simply reporting the
        // registry: revert the list exit's convergence and this case alone goes
        // red, in the `listed` half rather than the `byName` half.
        const host = await measure({ serviceMode: 'absent', overlayRow: true });

        expect(host.listed).toContain(SEARCH_COMPANION);
        expect(host.byName).toEqual(host.listed);
        expect(host.byName).toEqual(host.registryResolved);
    });

    // ── Anti-vacuity ────────────────────────────────────────────────────────
    // Both routes agreeing is only worth something if the column is genuinely
    // discriminated. These two hosts prove it is: the convergence adds the
    // companion where the registry provisions one and NOWHERE else, so a fix
    // that simply stamped `__search` onto every served object fails here.

    it('serves no companion on either route when the DEPLOYMENT has companions off', async () => {
        const host = await measure({ serviceMode: 'artifact', searchCompanion: false });

        expect(host.registryResolved).not.toContain(SEARCH_COMPANION);
        expect(host.listed).not.toContain(SEARCH_COMPANION);
        expect(host.byName).not.toContain(SEARCH_COMPANION);
        expect(host.byName).toEqual(host.listed);
        expect(host.byName).toEqual(host.registryResolved);
    });

    it('serves no companion on either route for an object with NO title-eligible field', async () => {
        const host = await measure({ serviceMode: 'artifact', untitled: true });

        // Companions are ON for this deployment — the gate is not what makes
        // this case empty; the object having no source field is.
        expect(host.registryResolved).not.toContain(SEARCH_COMPANION);
        expect(host.listed).not.toContain(SEARCH_COMPANION);
        expect(host.byName).not.toContain(SEARCH_COMPANION);
        expect(host.byName).toEqual(host.listed);
        expect(host.byName).toEqual(host.registryResolved);
    });
});
