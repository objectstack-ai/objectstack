// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8037] EVERY property the object-extension fold touches, classified by merge
// kind and measured on every read that serves an object schema.
//
// This is the third card in one family, and the first two were let through by
// the same blind spot rather than by two unrelated oversights:
//
//   #7556 (PR #8015) taught the by-name read to fold `objectExtensions` onto the
//   MetadataService body, reconciling the two reads on `fields`. Its pin compares
//   FIELD NAMES.
//   #8027 (PR #8045) then found `validations` and `indexes` DUPLICATED, because
//   `mergeObjectDefinitions` concatenates them and the fold was not idempotent —
//   invisible to a field-name pin, because the field spread is idempotent.
//   #8037 arrived next, about `label`.
//
// `mergeObjectDefinitions` handles its properties in THREE ways, so a fold has
// three distinct failure modes and a field-name pin sees exactly one of them:
//
//   | property     | merge kind                  | idempotent? |
//   |--------------|-----------------------------|-------------|
//   | fields       | key-keyed spread            | yes         |
//   | validations  | CONCATENATED                | no (#8027)  |
//   | indexes      | CONCATENATED                | no (#8027)  |
//   | label        | scalar, last-writer-wins    | yes         |
//   | pluralLabel  | scalar, last-writer-wins    | yes         |
//   | description  | scalar, last-writer-wins    | yes         |
//
// That is the WHOLE set — `mergeObjectDefinitions` names these six keys and
// copies nothing else, which `ObjectExtensionSchema`'s own guidance states from
// the other side ("the merge carries `fields`, `label`, `pluralLabel`,
// `description`, `validations` and `indexes` only"). So this file pins all six
// rather than the one the card was filed about: the two prior defects were each
// a property class nobody was measuring, and the cheapest way to stop paying for
// a fourth is to measure the classes instead of the instances.
//
// ⭐ WHAT THIS FILE ESTABLISHED ABOUT #8037. The fold is UNIFORM: on every host
// shape below, every read agrees with the registry's resolved schema (ADR-0029
// D9.2) on all six properties, scalars included. The divergence the card
// reports — list/by-name serving `Account` while `?layers=true` serves
// `Account (Success Overlay)` — is NOT produced here and cannot be: it is
// produced one layer up, by i18n. `translateObject` resolves each of the three
// scalars as `catalog ?? document`, the two translated reads therefore serve the
// owner package's catalog entry in place of whatever the fold resolved, and
// `?layers=true` is deliberately not translated ("this is a diagnostic"). See
// `packages/qa/dogfood/test/showcase-object-extension-scalar-divergence.dogfood.test.ts`,
// which reproduces that on a real catalog and holds the escalation.
//
// Keeping the two apart is the point. If the scalar divergence were pinned here,
// on a harness with no i18n service, it would be pinned against a cause this
// layer does not contain — and the next card in the family would be filed
// against the fold again.
//
// Existing pins this file sits beside, both of which must stay green:
// `meta-object-extension-agreement.test.ts` (#8015, fields) and
// `meta-object-overlay-extension-fold.test.ts` (#8045, idempotency).

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

/**
 * The owner's declaration. Every scalar is populated, because a scalar the base
 * leaves `undefined` cannot show whether the extender OVERWROTE it or merely
 * filled it in.
 */
const OWNER_DECLARATION = {
    name: 'showcase_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    description: 'A company the org delivers projects for.',
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
 * The extension. It contributes in ALL THREE merge kinds at once — that is the
 * fixture's whole job.
 *
 * #8045's fixture deliberately declared NO `label`, and said so: an extender's
 * scalars are last-writer-wins, so a relabelling extension overrides the
 * tenant's overlay label, and its author kept that out of scope rather than
 * assert it either way. #8037 is exactly the seam that left, so here the
 * extension overrides all three scalars — with the real showcase's own
 * `label: 'Account (Success Overlay)'`, which ships on `main` today.
 */
const EXTENSION_DECLARATION = {
    name: 'showcase_account',
    label: 'Account (Success Overlay)',
    pluralLabel: 'Accounts (Success Overlay)',
    description: 'Customer-success overlay for accounts.',
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
    pluralLabel: 'Tasks',
    description: 'A unit of work inside a project.',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    validations: [
        { name: 'task_rule', type: 'script', message: 'Title is required', condition: 'record.title == null' },
    ],
    indexes: [{ name: 'task_idx', fields: ['title'] }],
};

/** The three scalar props, as one list, so no case can quietly check only `label`. */
const SCALAR_PROPS = ['label', 'pluralLabel', 'description'] as const;

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
 * (`governServedItem` / #6562). Filtered off BOTH sides of every comparison, so
 * each pin is about the AUTHORED field set — what an `extend` contributor
 * contributes to.
 */
const PLATFORM_COLUMNS: readonly string[] = [
    'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
    'organization_id', 'owner_id', 'owning_business_unit_id',
];

function declaredFieldsOf(item: unknown): string[] {
    return fieldNamesOf(item).filter((n) => !PLATFORM_COLUMNS.includes(n));
}

/**
 * `validations` / `indexes` entry names IN ORDER, duplicates preserved. Order
 * and multiplicity are the whole point: a second fold shows up here and nowhere
 * else, which is how #8027 escaped #7556's pin.
 */
function entryNames(item: unknown, key: 'validations' | 'indexes'): string[] {
    const list = (item as Record<string, unknown> | null | undefined)?.[key];
    return Array.isArray(list) ? list.map((v) => String((v as { name?: unknown })?.name)) : [];
}

function scalarsOf(item: unknown): Record<string, unknown> {
    const o = (item ?? {}) as Record<string, unknown>;
    return Object.fromEntries(SCALAR_PROPS.map((k) => [k, o[k]]));
}

/** Every property class of one served body, as a single comparable value. */
function propertiesOf(item: unknown) {
    return {
        fields: declaredFieldsOf(item),
        validations: entryNames(item, 'validations'),
        indexes: entryNames(item, 'indexes'),
        ...scalarsOf(item),
    };
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
    /** A row that customises the label — the tenant edit #8027 is about. */
    | 'customised'
    /** A row byte-identical to the owner's declaration. */
    | 'verbatim'
    /** ⭐ A row already through the fold — what a Studio GET → edit → PUT persists. */
    | 'prefolded';

interface Host {
    listed: unknown;
    byName: unknown;
    layerCode: unknown;
    layerOverlay: unknown;
    layerEffective: unknown;
    /** The registry's resolution OF THIS HOST'S BASE — what D9.2 defines as correct. */
    registryResolved: unknown;
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
        registryResolved: registry.foldObjectExtendersOnto(
            objectName, clone(storedBody ?? declaration),
        ),
        storedRow: storedBody,
    };
}

/** Every host shape, so no case is measured on one boot and generalised from it. */
const SERVICE_MODES: readonly ServiceMode[] = ['artifact', 'bridged', 'absent'];
const OVERLAY_MODES: readonly OverlayMode[] = ['none', 'customised', 'verbatim', 'prefolded'];

describe('[#8037] the extension fold, by property class', () => {
    // ── §0: the fixture genuinely exercises what the cases below claim ──

    it('ANTI-VACUITY: the extension differs from the base in all three merge kinds', () => {
        // Without this, a fold that silently did nothing would satisfy every
        // agreement assertion in this file. #7556's pin passed throughout #8027
        // for the neighbouring reason — its fixture contributed only the one
        // property class whose merge is idempotent.
        for (const key of SCALAR_PROPS) {
            expect(EXTENSION_DECLARATION[key]).toBeDefined();
            expect(EXTENSION_DECLARATION[key]).not.toBe(OWNER_DECLARATION[key]);
        }
        // The concatenating pair contributes entries the base does not have…
        expect(EXTENSION_DECLARATION.validations.map((v) => v.name))
            .not.toEqual(OWNER_DECLARATION.validations.map((v) => v.name));
        expect(EXTENSION_DECLARATION.indexes.map((i) => i.name))
            .not.toEqual(OWNER_DECLARATION.indexes.map((i) => i.name));
        // …and the spread contributes names the base does not declare.
        for (const f of Object.keys(EXTENSION_DECLARATION.fields)) {
            expect(Object.keys(OWNER_DECLARATION.fields)).not.toContain(f);
        }
    });

    it('ANTI-VACUITY: the fold actually moves every property class off the base', async () => {
        const host = await measure();
        const resolved = host.registryResolved as Record<string, unknown>;

        // Scalars moved to the extender's values…
        for (const key of SCALAR_PROPS) {
            expect(resolved[key]).toBe(EXTENSION_DECLARATION[key]);
            expect(resolved[key]).not.toBe(OWNER_DECLARATION[key]);
        }
        // …the concatenating pair carries BOTH contributors' entries…
        expect(entryNames(resolved, 'validations')).toEqual(['owner_rule', 'ext_rule']);
        expect(entryNames(resolved, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
        // …and the spread carries both field sets.
        expect(declaredFieldsOf(resolved)).toEqual(
            [...Object.keys(OWNER_DECLARATION.fields), ...Object.keys(EXTENSION_DECLARATION.fields)].sort(),
        );
    });

    // ── §1: the load-bearing sweep — every class, every read, every host ──

    for (const serviceMode of SERVICE_MODES) {
        for (const overlay of OVERLAY_MODES) {
            it(`every read agrees with the registry's resolved schema on all six properties [service=${serviceMode} overlay=${overlay}]`, async () => {
                const host = await measure({ serviceMode, overlay });
                const expected = propertiesOf(host.registryResolved);

                // ⭐ Asserted against D9.2 — what the object SHOULD resolve to —
                // and never against whatever another route happens to say. Both
                // prior defects had the two routes agreeing with each other on a
                // body that was already wrong, which is precisely why a
                // `byName === listed` pin stayed green through them.
                expect(propertiesOf(host.byName)).toEqual(expected);
                expect(propertiesOf(host.listed)).toEqual(expected);
                expect(propertiesOf(host.layerEffective)).toEqual(expected);
            });
        }
    }

    // ── §2: #8045's idempotency, which this card must not regress ──

    for (const host of ['prefolded', 'bridged'] as const) {
        it(`does not duplicate the concatenated classes on an already-folded base [${host}]`, async () => {
            const measured = host === 'prefolded'
                ? await measure({ overlay: 'prefolded' })
                : await measure({ serviceMode: 'bridged' });

            // The base genuinely carries the extender's entries already —
            // without this the case proves nothing.
            const base = host === 'prefolded' ? measured.storedRow : measured.registryResolved;
            expect(entryNames(base, 'validations')).toContain('ext_rule');
            expect(entryNames(base, 'indexes')).toContain('ext_idx');

            for (const read of [measured.byName, measured.listed, measured.layerEffective]) {
                expect(entryNames(read, 'validations')).toEqual(['owner_rule', 'ext_rule']);
                expect(entryNames(read, 'indexes')).toEqual(['owner_idx', 'ext_idx']);
            }
        });
    }

    it('returns an unfolded base BY REFERENCE when nothing extends the name', () => {
        // #8045's other half: the ordinary payload pays a comparison and no copy.
        const registry = new SchemaRegistry();
        registry.registerObject(clone(UNEXTENDED_DECLARATION) as never, 'showcase', undefined, 'own');
        const base = clone(UNEXTENDED_DECLARATION);
        expect(registry.foldObjectExtendersOnto('showcase_task', base)).toBe(base);
    });

    // ── §3: the fold is not applied to every payload ──

    it('an object with no extension contributor serialises byte-identically', async () => {
        for (const serviceMode of SERVICE_MODES) {
            const host = await measure({ serviceMode, extended: false });

            // Byte-identity against the DECLARATION, not against another read:
            // the fold must be a no-op here, so the served scalars and both
            // concatenated lists are the owner's own, unchanged.
            for (const read of [host.byName, host.listed, host.layerEffective]) {
                expect(scalarsOf(read)).toEqual(scalarsOf(UNEXTENDED_DECLARATION));
                expect(entryNames(read, 'validations')).toEqual(['task_rule']);
                expect(entryNames(read, 'indexes')).toEqual(['task_idx']);
                for (const f of Object.keys(EXTENSION_DECLARATION.fields)) {
                    expect(declaredFieldsOf(read)).not.toContain(f);
                }
            }
        }
    });

    // ── §4: the overlay layer reports only what the TENANT customised ──

    it('leaves `layers.overlay` the tenant\'s own row — an extension is not a customisation', async () => {
        const host = await measure({ overlay: 'customised' });

        // ⛔ The boundary #7556 drew and #8045 re-affirmed. Studio's diff tab
        // reads this layer, so an extension appearing in it would report a
        // customisation the tenant never made — in EVERY property class, not
        // just the fields #8045 checked.
        expect(host.layerOverlay).toEqual(host.storedRow);
        for (const key of SCALAR_PROPS) {
            expect((host.layerOverlay as Record<string, unknown>)[key])
                .not.toBe(EXTENSION_DECLARATION[key]);
        }
        expect(entryNames(host.layerOverlay, 'validations')).not.toContain('ext_rule');
        expect(entryNames(host.layerOverlay, 'indexes')).not.toContain('ext_idx');
        for (const f of Object.keys(EXTENSION_DECLARATION.fields)) {
            expect(fieldNamesOf(host.layerOverlay)).not.toContain(f);
        }
    });
});
