// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7556] The two producers of "what fields does this object have" must answer
// the same question the same way.
//
// The defect: `GET /meta/object` composes its objects from
// `SchemaRegistry.listItems('object')`, whose object branch resolves through
// `resolveObject` — a base layer with its `extend` contributors folded on
// (ADR-0029 D9.2). `GET /meta/object/:name` consults the `metadata` SERVICE
// first, because that copy is the HMR-fresh one, and served whatever it
// returned. For every other metadata type those two agree. For `object` they do
// not: a deployment booted from a compiled artifact (`artifactSource` — every
// sealed/served runtime, and `objectstack serve`) ingests `objects` and
// `objectExtensions` as SEPARATE collections, so the service's copy is the
// owner's declaration with no extender folded in.
//
// Measured on the showcase: the account extension's three fields
// (`loyalty_tier`, `linkedin_url`, `csat_score`) were present on the list read
// and on the data API round-trip, and absent from the by-name read and from
// BOTH layers of `?layers=true` — the read the edit and new forms derive from,
// so three fields that persist through the API could never be set in the UI.
//
// WHAT THIS FILE ASSERTS, and why it is shaped this way: it does NOT assert
// "the by-name route returns the extension fields". That assertion passes again
// the day someone hardcodes or special-cases that route, which is the same
// class of defect one layer over and is exactly how this bug would survive its
// own fix. It asserts AGREEMENT — the by-name read and the list read expose the
// SAME field set — with both sides MEASURED from the real producers in the same
// test: both through real `RestServer` handlers over a real
// `ObjectStackProtocolImplementation` over a real `SchemaRegistry`. Four hosts
// that genuinely differ (below) keep the agreement from holding vacuously, and
// the anti-vacuity case pins that they ARE discriminated.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

/** The three fields the showcase's `objectExtensions` entry contributes. */
const EXTENSION_FIELDS = ['loyalty_tier', 'linkedin_url', 'csat_score'] as const;

/** The owner package's declaration — what a compiled artifact stores under `objects`. */
const OWNER_DECLARATION = {
    name: 'showcase_account',
    label: 'Account',
    fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        industry: { name: 'industry', label: 'Industry', type: 'text' },
    },
};

/** What the artifact stores under `objectExtensions` — a SEPARATE collection. */
const EXTENSION_DECLARATION = {
    name: 'showcase_account',
    label: 'Account (Success Overlay)',
    fields: {
        loyalty_tier: { name: 'loyalty_tier', label: 'Loyalty Tier', type: 'text' },
        linkedin_url: { name: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
        csat_score: { name: 'csat_score', label: 'CSAT Score', type: 'number' },
    },
};

/** An object NOTHING extends — the control that keeps every other object's payload honest. */
const UNEXTENDED_DECLARATION = {
    name: 'showcase_task',
    label: 'Task',
    fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
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
 * (`fields` as a record, or as an array of `{name}`), so the comparison is
 * about WHICH fields are served rather than about how they are spelled.
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
 * How this host's `metadata` service was populated — the ONE axis that made the
 * two routes disagree, and the reason the hosts below are not variations on a
 * theme.
 */
type ServiceMode =
    /** Artifact ingest: `MetadataPlugin` registers the owner declaration, extensions live in their own collection. */
    | 'artifact'
    /** In-process boot: ObjectQL's `bridgeObjectsToMetadataService` seeds the service from the MERGED registry. */
    | 'bridged'
    /** No `metadata` service at all — the read falls through to the registry. */
    | 'absent';

interface Host {
    /** Field names `GET /meta/object` serves for the object. */
    listed: string[];
    /** Field names `GET /meta/object/:name` serves (cached branch — the route default). */
    byName: string[];
    /** Field names the `code` layer of `?layers=true` serves. */
    layerCode: string[];
    /** Field names the `effective` layer of `?layers=true` serves. */
    layerEffective: string[];
    /** What the `metadata` service itself holds — the base the by-name read starts from. */
    serviceBody: string[];
    /** The registry's own resolved schema — what both routes are supposed to be reporting. */
    registryResolved: string[];
}

/**
 * Boot a REST server over the REAL protocol over a REAL registry, and read
 * BOTH routes off it.
 *
 * `object` selects which object this host registers; `serviceMode` selects how
 * the `metadata` service was populated. The registry is always the real one, so
 * the fold under test is the shipped fold and not a re-description of it.
 */
async function measure(opts: {
    serviceMode: ServiceMode;
    extended?: boolean;
}): Promise<Host> {
    const extended = opts.extended !== false;
    const declaration = extended ? OWNER_DECLARATION : UNEXTENDED_DECLARATION;
    const objectName = declaration.name;

    const registry = new SchemaRegistry();
    registry.registerObject(clone(declaration) as never, 'showcase', undefined, 'own');
    if (extended) {
        registry.registerObject(
            clone(EXTENSION_DECLARATION) as never, 'showcase-success', undefined, 'extend', 210,
        );
    }

    const engine = {
        registry,
        // No `sys_metadata` rows: this issue is a CODE-declared extension, and a
        // tenant overlay row is a different layer with its own precedence. Both
        // routes read this store, so it is held constant across every host.
        find: async () => [],
        findOne: async () => undefined,
    };

    const services = new Map<string, unknown>();
    if (opts.serviceMode !== 'absent') {
        // 'artifact' registers the OWNER declaration (what the compiled
        // artifact's `objects` collection holds); 'bridged' registers what
        // `getAllObjects()` returns, which is the merged body. This single
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
        layerCode: fieldNamesOf(layeredBody?.code),
        layerEffective: fieldNamesOf(layeredBody?.effective),
        serviceBody: metadataService
            ? fieldNamesOf(await metadataService.get('object', objectName))
            : [],
        registryResolved: fieldNamesOf(registry.getObject(objectName)),
    };
}

describe('[#7556] the by-name and list reads of an object answer one question', () => {
    it('agrees on an artifact-ingested host — where the by-name read used to drop every extension field', async () => {
        const host = await measure({ serviceMode: 'artifact' });

        // The symptom, measured: the list read really does compose the
        // extension's fields here, so agreement cannot be reached by the list
        // read quietly losing them too.
        for (const field of EXTENSION_FIELDS) expect(host.listed).toContain(field);

        // The pin: whatever the list read serves, the by-name read serves.
        // Before the fix this compared the folded set against the owner's
        // declaration alone.
        expect(host.byName).toEqual(host.listed);
        // …and what they agree ON is the registry's resolved schema, so the
        // agreement cannot be satisfied by both routes drifting together.
        expect(host.byName).toEqual(host.registryResolved);
    });

    it('agrees on a bridged in-process host — the boot that always happened to work', async () => {
        const host = await measure({ serviceMode: 'bridged' });

        for (const field of EXTENSION_FIELDS) expect(host.listed).toContain(field);
        expect(host.byName).toEqual(host.listed);
    });

    it('agrees on a host with no metadata service — the read falls through to the registry', async () => {
        const host = await measure({ serviceMode: 'absent' });

        for (const field of EXTENSION_FIELDS) expect(host.listed).toContain(field);
        expect(host.byName).toEqual(host.listed);
    });

    it('agrees on an object nothing extends — and serves it with no extension field grafted on', async () => {
        const host = await measure({ serviceMode: 'artifact', extended: false });

        expect(host.byName).toEqual(host.listed);
        // The other half of the fix: an object with no `extend` contributor must
        // come back exactly as the registry resolves it — nothing grafted on. A
        // fold that ran unconditionally, or that folded a contributor list it
        // had not filtered, would be invisible to the three cases above and
        // would have changed every object's payload to correct three fields.
        expect(host.byName).toEqual(host.registryResolved);
        expect(host.byName).toContain('title');
        for (const field of EXTENSION_FIELDS) expect(host.byName).not.toContain(field);
    });

    it('both layers of `?layers=true` resolve the object, not just the effective one', async () => {
        const host = await measure({ serviceMode: 'artifact' });

        // The issue's sharpest evidence: the fields were missing from BOTH
        // layers, which is what pointed at layer resolution rather than REST
        // plumbing. `code` is D9.6's "owner's declaration with its extenders
        // folded on"; `effective` is `overlay ?? code`, so with no overlay row
        // the two coincide — and both must carry the extension.
        for (const field of EXTENSION_FIELDS) {
            expect(host.layerCode).toContain(field);
            expect(host.layerEffective).toContain(field);
        }
        expect(host.layerCode).toEqual(host.listed);
        expect(host.layerEffective).toEqual(host.listed);
    });

    it('anti-vacuity: the hosts are genuinely discriminated, so the agreement cannot hold by emptiness', async () => {
        const [artifact, bridged, absent, unextended] = await Promise.all([
            measure({ serviceMode: 'artifact' }),
            measure({ serviceMode: 'bridged' }),
            measure({ serviceMode: 'absent' }),
            measure({ serviceMode: 'artifact', extended: false }),
        ]);

        // 1. The artifact host's metadata service genuinely holds the UNFOLDED
        //    body — it is missing every extension field. Without this, the
        //    'artifact' host could drift into being a second 'bridged' host
        //    (e.g. if the fixture started seeding it from the registry) and its
        //    agreement would then prove nothing about the defect.
        for (const field of EXTENSION_FIELDS) {
            expect(artifact.serviceBody).not.toContain(field);
            expect(bridged.serviceBody).toContain(field);
        }
        expect(absent.serviceBody).toEqual([]);

        // 2. The three extended hosts really do serve the extension fields, and
        //    the unextended host really does not — so "byName === listed" is a
        //    statement about a non-empty, non-constant set on both sides.
        for (const host of [artifact, bridged, absent]) {
            for (const field of EXTENSION_FIELDS) expect(host.listed).toContain(field);
        }
        for (const field of EXTENSION_FIELDS) expect(unextended.listed).not.toContain(field);

        // 3. …and the two shapes are genuinely different sets, so a fold that
        //    collapsed every object to one answer would go red here.
        expect(artifact.listed).not.toEqual(unextended.listed);
    });
});
