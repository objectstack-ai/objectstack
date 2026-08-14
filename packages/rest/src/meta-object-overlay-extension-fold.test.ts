// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8027] A tenant customisation is a BASE LAYER. It does not decide which
// fields the object has.
//
// The defect: `sys_metadata` holds an overlay row for an object (an admin
// renamed the object's label in Studio). `getMetaItem` adopted that row as the
// resolved schema, and `getMetaItems` did the same through
// `mergePackageAwareOverlay`, which picks a per-slot winner WHOLESALE rather
// than merging fields. ADR-0029 D9.2 defines the resolution as `overlay ?? own`
// with the `extend` contributors folded ON — which is what
// `SchemaRegistry.resolveObject` does for an overlay it knows about, and what
// #7556 made the by-name read do for the MetadataService copy. The overlay path
// was the one adopter that still served its layer verbatim.
//
// Measured with one `extend` contributor and one env-wide overlay row: `byName`
// and `listed` both lost every extension field, `layers.code` kept them (#7556
// folds it) and `layers.effective` did not — so a single `?layers=true`
// response reported a `code` layer that has the fields and an `effective` layer
// that does not, with an `overlay` layer showing a customisation that explains
// none of the difference. An admin who renames a label silently removes three
// extension-contributed fields from every writable form, while the data API
// keeps accepting and persisting them.
//
// WHY THIS FILE DOES NOT PIN AGREEMENT. #7556's pin is `byName === listed`, and
// it CANNOT catch this: here both routes agree — on a body that has already
// lost the fields. Its author said so rather than let the pin imply coverage it
// did not have. So the load-bearing assertion here is against the REGISTRY'S
// RESOLVED SCHEMA — what D9.2 defines — and never against the other route. The
// agreement dimension is kept as a second, weaker check.
//
// ⭐ AND THE FOLD IS NOT IDEMPOTENT, which is the trap this fix had to clear
// rather than assume away: `mergeObjectDefinitions` CONCATENATES `validations`
// and `indexes`. Folding a body that has already been through the fold
// duplicates both, and a duplicated index does not fail a test — it fails a
// deployment. Two shipped call sites already hand it a folded base (the
// `bridged` host below, live on `main`; and a stored row saved from a folded
// read), so `foldObjectExtendersOnto` was made idempotent instead. The
// `prefolded` and `bridged` hosts here are what hold that.

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
    validations: [
        { name: 'owner_rule', type: 'script', message: 'Name is required', condition: 'record.name == null' },
    ],
    indexes: [{ name: 'owner_idx', fields: ['name'] }],
};

/**
 * What the artifact stores under `objectExtensions` — a SEPARATE collection.
 *
 * It contributes `validations` and `indexes` as well as fields, deliberately:
 * those are the two keys the fold CONCATENATES, so they are the only place a
 * second fold is observable. A fixture contributing fields alone would make
 * every idempotency case below pass vacuously (#7556's pin compares field
 * names, which is exactly why the double-fold on `bridged` survived it).
 */
const EXTENSION_DECLARATION = {
    name: 'showcase_account',
    // Deliberately declares NO `label`. `mergeObjectDefinitions` applies an
    // extender's scalar props last-writer-wins, so an extension that relabels
    // its target overrides the TENANT's overlay label — D9.2 as written, and
    // visible here only because this file (unlike #7556's) compares more than
    // field names. A contributor that adds fields is the population this issue
    // is about; keeping a label out of it lets the cases below pin that the
    // tenant's own customisation survives the fold.
    fields: {
        loyalty_tier: { name: 'loyalty_tier', label: 'Loyalty Tier', type: 'text' },
        linkedin_url: { name: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
        csat_score: { name: 'csat_score', label: 'CSAT Score', type: 'number' },
    },
    validations: [
        { name: 'ext_rule', type: 'script', message: 'CSAT is 0-5', condition: 'record.csat_score > 5' },
    ],
    indexes: [{ name: 'ext_idx', fields: ['loyalty_tier'] }],
};

/** An object NOTHING extends — the control that keeps every other payload honest. */
const UNEXTENDED_DECLARATION = {
    name: 'showcase_task',
    label: 'Task',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    validations: [
        { name: 'task_rule', type: 'script', message: 'Title is required', condition: 'record.title == null' },
    ],
    indexes: [{ name: 'task_idx', fields: ['title'] }],
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

/** Field names off a served body, tolerant of both wire shapes. */
function fieldNamesOf(item: unknown): string[] {
    const fields = (item as { fields?: unknown } | null | undefined)?.fields;
    if (!fields) return [];
    const names = Array.isArray(fields)
        ? (fields as Array<{ name?: unknown }>).map((f) => String(f?.name))
        : Object.keys(fields as Record<string, unknown>);
    return [...names].sort();
}

/**
 * The columns the platform injects into every served object body
 * (`governServedItem` / #6562), listed here for the same reason #6562's own
 * suite lists them.
 *
 * Filtered off BOTH sides of every comparison below, so each pin is about the
 * AUTHORED field set — which is what an `extend` contributor contributes to and
 * what this issue is about. They are not filtered off the `toContain` checks:
 * an extension field must be present in the payload as actually served.
 */
const PLATFORM_COLUMNS: readonly string[] = [
    'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
    'organization_id', 'owner_id', 'owning_business_unit_id',
];

/** Served field names minus {@link PLATFORM_COLUMNS}. */
function declaredFieldsOf(item: unknown): string[] {
    return fieldNamesOf(item).filter((n) => !PLATFORM_COLUMNS.includes(n));
}

/**
 * `validations` / `indexes` entry names IN ORDER, with duplicates preserved.
 * Order and multiplicity are the whole point: a second fold shows up here and
 * nowhere else.
 */
function entryNames(item: unknown, key: 'validations' | 'indexes'): string[] {
    const list = (item as Record<string, unknown> | null | undefined)?.[key];
    return Array.isArray(list) ? list.map((v) => String((v as { name?: unknown })?.name)) : [];
}

/** How this host's `metadata` service was populated. */
type ServiceMode =
    /** Artifact ingest: owner declaration only; extensions live in their own collection. */
    | 'artifact'
    /** In-process boot: `bridgeObjectsToMetadataService` seeds it from the MERGED registry. */
    | 'bridged'
    /** No `metadata` service at all — the read falls through to the registry. */
    | 'absent';

/** What, if anything, `sys_metadata` holds for the object. */
type OverlayMode =
    /** No row. The ordinary shape, and the one that must stay byte-identical. */
    | 'none'
    /** A row that customises the label — the tenant edit this issue is about. */
    | 'customised'
    /** A row byte-identical to the owner's declaration — no meaningful customisation. */
    | 'verbatim'
    /**
     * ⭐ A row whose body has ALREADY been through the fold — what the Studio
     * GET → edit → PUT round-trip persists, because the write path stores the
     * request body verbatim (ADR-0005 §Validation) and the read it came from is
     * folded. The row a naive fix duplicates every extender validation on.
     */
    | 'prefolded';

interface Host {
    listed: unknown;
    byName: unknown;
    layerCode: unknown;
    layerOverlay: unknown;
    layerEffective: unknown;
    /** The registry's resolution OF THIS HOST'S BASE — what D9.2 defines as correct. */
    registryResolved: unknown;
    /** The raw row as stored, for the `overlay` layer comparison. */
    storedRow: unknown;
}

/**
 * Boot a REST server over the REAL protocol over a REAL registry and read all
 * three surfaces off it: the list route, the by-name route, and `?layers=true`.
 */
async function measure(opts: {
    serviceMode?: ServiceMode;
    overlay?: OverlayMode;
    extended?: boolean;
} = {}): Promise<Host> {
    const serviceMode = opts.serviceMode ?? 'artifact';
    const overlayMode = opts.overlay ?? 'none';
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

    // The stored row's BODY. `customised` renames the object — the edit an admin
    // actually makes — and carries the owner's declaration otherwise, because a
    // Studio save PUTs the whole document back.
    let storedBody: Record<string, unknown> | undefined;
    if (overlayMode === 'customised') {
        storedBody = { ...clone(declaration), label: 'Customer' };
    } else if (overlayMode === 'verbatim') {
        storedBody = clone(declaration);
    } else if (overlayMode === 'prefolded') {
        storedBody = registry.foldObjectExtendersOnto(objectName, clone(declaration)) as Record<string, unknown>;
    }

    const rows = storedBody === undefined ? [] : [{
        id: 'row_1',
        type: 'object',
        name: objectName,
        state: 'active',
        organization_id: null,
        package_id: null,
        metadata: JSON.stringify(storedBody),
    }];
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return (r[k] ?? null) === (v ?? null);
        });

    const engine = {
        registry,
        find: async (table: string, q: { where: Record<string, unknown> }) =>
            table === 'sys_metadata' ? rows.filter((r) => matches(r, q.where)) : [],
        findOne: async (table: string, q: { where: Record<string, unknown> }) =>
            table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) : undefined,
    };

    const services = new Map<string, unknown>();
    if (serviceMode !== 'absent') {
        // 'artifact' registers the OWNER declaration (what the compiled
        // artifact's `objects` collection holds); 'bridged' registers what
        // `getAllObjects()` returns, which is the ALREADY-MERGED body.
        const body = serviceMode === 'artifact' ? clone(declaration) : registry.getObject(objectName);
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
            status: () => res, header: () => res,
            json: (b: unknown) => { body = b; }, send: (b: unknown) => { body = b; },
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

    return {
        listed: listItems.find((o) => o?.name === objectName),
        byName: singleBody?.item,
        layerCode: layeredBody?.code,
        layerOverlay: layeredBody?.overlay,
        layerEffective: layeredBody?.effective,
        // D9.2 applied to THIS host's base: the overlay row when one exists,
        // else the owner's declaration. This is the definition the served body
        // is checked against — never the other route.
        registryResolved: registry.foldObjectExtendersOnto(
            objectName, clone(storedBody ?? declaration),
        ),
        storedRow: storedBody,
    };
}

describe('[#8027] an object overlay row is a base layer, not the resolved schema', () => {
    it('serves the extension fields on BOTH routes when a customisation row exists', async () => {
        const host = await measure({ overlay: 'customised' });

        // The defect, on the two reads every writable form derives from.
        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(host.byName)).toContain(field);
            expect(fieldNamesOf(host.listed)).toContain(field);
        }

        // ⭐ THE LOAD-BEARING ASSERTION: what is served is the registry's
        // resolution of this host's base — D9.2 — not merely what the other
        // route happens to say. #7556's `byName === listed` pin is green
        // THROUGHOUT this defect, because both routes lost the fields together.
        expect(declaredFieldsOf(host.byName)).toEqual(declaredFieldsOf(host.registryResolved));
        expect(declaredFieldsOf(host.listed)).toEqual(declaredFieldsOf(host.registryResolved));

        // The customisation itself still wins where it actually speaks. A fold
        // that resolved the object by discarding the overlay would satisfy every
        // field assertion above and be a worse bug than the one being fixed.
        expect((host.byName as { label?: string }).label).toBe('Customer');
        expect((host.listed as { label?: string }).label).toBe('Customer');
    });

    it('resolves `layers.effective`, and leaves `layers.overlay` the tenant\'s own row', async () => {
        const host = await measure({ overlay: 'customised' });

        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(host.layerEffective)).toContain(field);
        }
        expect(declaredFieldsOf(host.layerEffective)).toEqual(declaredFieldsOf(host.registryResolved));

        // ⛔ The boundary #7556 drew deliberately: an extension is a CODE
        // declaration, not something this tenant customised, so it must not
        // appear in the layer whose entire job is "what you changed". Studio's
        // diff tab reads this.
        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(host.layerOverlay)).not.toContain(field);
        }
        expect(host.layerOverlay).toEqual(host.storedRow);
    });

    it('stops `code` and `effective` contradicting each other in one response', async () => {
        // A row that customises NOTHING — byte-identical to the owner's
        // declaration. The two layers describe the same object from the same
        // base, so any difference between them is the bug itself rather than a
        // customisation. This is the shape the issue called out: `code` had the
        // fields, `effective` did not, and the `overlay` layer explained nothing.
        const host = await measure({ overlay: 'verbatim' });

        expect(fieldNamesOf(host.layerEffective)).toEqual(fieldNamesOf(host.layerCode));
        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(host.layerCode)).toContain(field);
            expect(fieldNamesOf(host.layerEffective)).toContain(field);
        }
    });

    // ── ⭐ §2: the fold is applied to bases that have already been folded ──

    it('does not duplicate validations or indexes on an ALREADY-FOLDED overlay row', async () => {
        const host = await measure({ overlay: 'prefolded' });

        // The row itself genuinely carries the extender's entries — without
        // this the case proves nothing (see the anti-vacuity test).
        expect(entryNames(host.storedRow, 'validations')).toEqual(['owner_rule', 'ext_rule']);

        // Folding it again must not append a second copy. `fields` would look
        // perfect either way — the spread is idempotent — which is exactly how
        // this class of bug survives a field-name pin.
        expect(entryNames(host.byName, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.byName, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        expect(entryNames(host.listed, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.listed, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        expect(entryNames(host.layerEffective, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.layerEffective, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
    });

    it('does not duplicate them on a BRIDGED host either — the in-process dev boot', async () => {
        // ObjectQL's `bridgeObjectsToMetadataService` seeds the `metadata`
        // service from `registry.getAllObjects()` — bodies that are already
        // resolved — so #7556's fold ran on a folded base here and served every
        // extender validation and index TWICE. That regression is live on the
        // commit this branch starts from; it survived #7556's own pin because
        // that pin compares field names.
        const host = await measure({ serviceMode: 'bridged', overlay: 'none' });

        expect(entryNames(host.byName, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.byName, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        expect(entryNames(host.layerCode, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.layerCode, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        expect(entryNames(host.layerEffective, 'validations')).toEqual(['owner_rule', 'ext_rule']);
    });

    // ── the two populations that must not move at all ──

    it('leaves an object with NO overlay row exactly as it was', async () => {
        const host = await measure({ overlay: 'none' });

        // Identical to the registry's resolution, with no entry appearing twice.
        expect(declaredFieldsOf(host.byName)).toEqual(declaredFieldsOf(host.registryResolved));
        expect(declaredFieldsOf(host.listed)).toEqual(declaredFieldsOf(host.registryResolved));
        expect(entryNames(host.byName, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(host.byName, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        // #7556's own pin, restated: this fix must not cost that agreement.
        expect(fieldNamesOf(host.byName)).toEqual(fieldNamesOf(host.listed));
        expect(host.layerOverlay).toBeNull();
    });

    it('leaves an object with NO extension contributor exactly as it was, row or no row', async () => {
        const [withRow, withoutRow] = await Promise.all([
            measure({ extended: false, overlay: 'customised' }),
            measure({ extended: false, overlay: 'none' }),
        ]);

        // Nothing grafted on: a fold that ran unconditionally, or that failed to
        // filter its contributor list, would be invisible to every case above
        // and would change every object's payload to correct three fields.
        for (const host of [withRow, withoutRow]) {
            expect(declaredFieldsOf(host.byName)).toEqual(declaredFieldsOf(host.registryResolved));
            expect(fieldNamesOf(host.byName)).toContain('title');
            for (const field of EXTENSION_FIELDS) {
                expect(fieldNamesOf(host.byName)).not.toContain(field);
            }
            expect(entryNames(host.byName, 'validations')).toEqual(['task_rule']);
            expect(entryNames(host.byName, 'indexes')).toEqual(['task_idx']);
        }
        // The row still customises what it customises.
        expect((withRow.byName as { label?: string }).label).toBe('Customer');
        expect((withoutRow.byName as { label?: string }).label).toBe('Task');
    });

    // ── anti-vacuity ──

    it('anti-vacuity: the fixtures genuinely differ, so none of the above holds by emptiness', async () => {
        const [artifact, bridged, prefolded, unextended, none] = await Promise.all([
            measure({ overlay: 'customised' }),
            measure({ serviceMode: 'bridged', overlay: 'none' }),
            measure({ overlay: 'prefolded' }),
            measure({ extended: false, overlay: 'customised' }),
            measure({ overlay: 'none' }),
        ]);

        // 1. The overlay row is REAL and is genuinely a bare base layer: it
        //    carries none of the extension fields. If the fixture ever started
        //    seeding the row from the merged registry, every case above would
        //    still pass while proving nothing — so that is pinned here.
        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(artifact.storedRow)).not.toContain(field);
        }
        expect(fieldNamesOf(artifact.storedRow)).toEqual(['industry', 'name']);

        // 2. …and the `prefolded` row is NOT that row — it really has been
        //    through the fold. Without this the idempotency case would be a
        //    second copy of the ordinary one.
        for (const field of EXTENSION_FIELDS) {
            expect(fieldNamesOf(prefolded.storedRow)).toContain(field);
        }
        expect(entryNames(prefolded.storedRow, 'validations'))
            .not.toEqual(entryNames(artifact.storedRow, 'validations'));

        // 3. The `bridged` host's service body really is the merged one, which
        //    is what made it fold a folded base. Held against the registry so
        //    the two cannot drift into being the same host.
        expect(entryNames(bridged.layerCode, 'validations')).toContain('ext_rule');

        // 4. The extended and unextended objects are genuinely different
        //    shapes, so "equals the registry's resolution" is a statement about
        //    a non-constant set.
        expect(fieldNamesOf(none.byName)).not.toEqual(fieldNamesOf(unextended.byName));
        expect(fieldNamesOf(unextended.byName)).not.toContain('loyalty_tier');

        // 5. The customised row really does change something, so "the overlay
        //    still wins" is not vacuous either.
        expect((artifact.byName as { label?: string }).label).toBe('Customer');
        expect((none.byName as { label?: string }).label).toBe('Account');
    });
});
