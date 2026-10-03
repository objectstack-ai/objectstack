// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7736 — a `defineView` container authored through the RUNTIME door is served,
 * not merely stored.
 *
 * "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
 * dual-read: the container is registered under the bare `<object>` key, and
 * every named view is ALSO registered as an independent ViewItem under
 * `<object>.<viewKey>`. Only the expanded items carry the `viewKind` + `object`
 * pair that the object-bound read paths filter on, so the expanded layer — not
 * the container — is what `GET /meta/view?object=`, `getViewsByObject()` and
 * the view switcher actually read.
 *
 * Both SOURCE registrars do this (the ObjectQL boot loop and the metadata
 * artifact/HMR loader). The RUNTIME door did not. Measured before the fix, on
 * the card's own repro: the write is accepted, the body is stored verbatim
 * carrying neither `object` nor `viewKind`, `getMetaItem` by name serves it
 * badged `_diagnostics.valid: true` — and the enumerating read answers ZERO,
 * because `getMetaItems` drops containers from enumeration on the stated
 * assumption that "the registrar expands it into independent ViewItems", which
 * for a runtime-written row never happened.
 *
 * The pin is at the protocol, not at either read exit, because there are two
 * independent object-bound readers (the REST route reads through
 * `getMetaItems`; `getViewsByObject()` reads `MetadataManager.list`) and a fix
 * at one leaves the other empty. `hydrateOverlayIntoRegistry` is the single
 * choke point all three runtime hydration callers share.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { expandViewContainer, isAggregatedViewContainer, ViewSchema } from '@objectstack/spec/ui';
import { MetadataPlugin } from '@objectstack/metadata';
import { savedItemNameRefusal } from '@objectstack/metadata/view-container-name';
import { ObjectStackProtocolImplementation } from './index.js';

interface Row {
    id: string; type: string; name: string; organization_id: string | null;
    package_id: string | null; state: string; metadata: string; checksum?: string; version?: number;
}

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/**
 * A registry stub that actually STORES what `registerItem` hands it and returns
 * it from `listItems` — the two halves this card turns on. A no-op registry
 * would pass every assertion below vacuously.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const registered = new Map<string, Map<string, any>>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
                                                                              assertEngineFindOnePredicate(_t, opts); return findRow(opts.where)?.row ?? null; },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key); rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) { assertEngineDeleteDispatch(opts); return { deleted: 0 }; },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> { return cb(undefined, { owned: true }); },
        async syncObjectSchema() { },
        registry: {
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            isPackageDisabled: () => false,
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            registerObject: () => { },
            getPackage: () => undefined,
        },
    };
    return { engine, rows, registered };
}

/** The card's repro body: a `defineView` container, as `defineView` emits it. */
const leadContainer = {
    list: {
        label: 'All Leads',
        type: 'grid',
        data: { provider: 'object', object: 'crm_lead' },
        columns: [{ field: 'name' }, { field: 'company' }],
    },
    listViews: {
        pipeline: {
            label: 'Lead Pipeline',
            type: 'grid',
            data: { provider: 'object', object: 'crm_lead' },
            columns: [{ field: 'name' }],
        },
    },
};

/** The object-bound predicate BOTH read exits filter on, verbatim. */
const switcherMatches = (items: any[], object: string) =>
    items.filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === object);

describe('#7736 a runtime-authored view container is served', () => {
    it('serves the expanded ViewItems the object-bound read paths filter on', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

        const list: any = await protocol.getMetaItems({ type: 'view' });
        const served = switcherMatches(list.items, 'crm_lead');

        expect(
            served.map((v: any) => v.name).sort(),
            'A runtime-authored container must expand into the independent ViewItems '
            + 'the switcher reads, exactly as the two source registrars do.',
        ).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
        for (const v of served) expect(v.viewKind).toBe('list');
    });

    it('…and what it serves is the STORED container, not a default', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });
        const list: any = await protocol.getMetaItems({ type: 'view' });
        const byName = Object.fromEntries(list.items.map((v: any) => [v.name, v]));

        // The authored payload survives expansion — label and columns are the
        // ones this test wrote, so the served view cannot be a stand-in.
        expect(byName['crm_lead.pipeline'].label).toBe('Lead Pipeline');
        expect(byName['crm_lead.pipeline'].config.columns).toEqual([{ field: 'name' }]);
        expect(byName['crm_lead.default'].label).toBe('All Leads');
        expect(byName['crm_lead.default'].config.columns).toEqual([{ field: 'name' }, { field: 'company' }]);
    });

    it('still never surfaces the aggregated container itself (ADR-0017 canonical shape)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });
        const list: any = await protocol.getMetaItems({ type: 'view' });

        // The bare `<object>` key is a back-compat single-item read, never an
        // enumeration entry — loosening that filter was the tempting fix and is
        // not the one taken.
        expect(list.items.some((v: any) => v?.name === 'crm_lead')).toBe(false);
        const byName: any = await protocol.getMetaItem({ type: 'view', name: 'crm_lead' });
        expect(byName.item).toBeTruthy();
        expect(byName.item.listViews).toBeDefined();
    });

    /**
     * ANTI-VACUITY. The suite above would pass just as well against a change
     * that served "whatever exists" for every object. These two cases prove the
     * fixtures actually distinguish an authored container from no container.
     */
    describe('anti-vacuity — absence still reads as absence', () => {
        it('an object with NO view container serves nothing for that object', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            // A container authored for crm_lead must not make crm_account —
            // an object nobody authored a view for — start answering non-empty.
            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

            const list: any = await protocol.getMetaItems({ type: 'view' });
            expect(switcherMatches(list.items, 'crm_account')).toEqual([]);
            expect(switcherMatches(list.items, 'crm_lead')).toHaveLength(2);
        });

        it('with no view written at all, the view read is empty', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const list: any = await protocol.getMetaItems({ type: 'view' });
            expect(list.items).toEqual([]);
            expect(switcherMatches(list.items, 'crm_lead')).toEqual([]);
        });
    });

    /**
     * The path must not have become "expand anything". A view that is already an
     * independent ViewItem, and a non-view type, go through the same hydration
     * choke point and must come back byte-identical to their pre-fix behaviour.
     */
    describe('the untouched arms', () => {
        it('an already-independent ViewItem is served exactly once, unchanged', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const record = {
                name: 'crm_lead.mine', object: 'crm_lead', viewKind: 'list', label: 'My Leads',
                config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: [{ field: 'name' }] },
            };
            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead.mine', item: record });

            const list: any = await protocol.getMetaItems({ type: 'view' });
            const served = switcherMatches(list.items, 'crm_lead');
            expect(served).toHaveLength(1);
            expect(served[0].name).toBe('crm_lead.mine');
            expect(served[0].config).toEqual(record.config);
        });

        it('a non-view type stores and serves a byte-identical body', async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            // [#8308] `sharingModel` authored: the publish gate refuses an
            // OWD-less custom object once #8310 declares `object` in
            // `runtimeTypes`; this case pins byte-identical storage, not that.
            const authored = { name: 'crm_invoice', label: 'Invoice', sharingModel: 'private', fields: { amount: { type: 'currency', label: 'Amount' } } };
            await protocol.saveMetaItem({ type: 'object', name: 'crm_invoice', item: authored });

            const stored = Array.from(rows.values()).find((r) => r.name === 'crm_invoice')!;
            expect(JSON.parse(stored.metadata)).toEqual(authored);
        });

        it('a view container stores a byte-identical body — expansion is derived, never persisted', async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

            // Exactly ONE row: the container as authored (plus the `name` the
            // write door has always stamped). No expanded rows are persisted, so
            // there is nothing to go stale when the container is next edited.
            const viewRows = Array.from(rows.values()).filter((r) => r.type === 'view');
            expect(viewRows).toHaveLength(1);
            expect(JSON.parse(viewRows[0].metadata)).toEqual({ ...leadContainer, name: 'crm_lead' });
        });
    });
});

/**
 * #13407 — the third occurrence of #7736's own defect, and why: #7736's
 * `hydrateExpandedViewItems` registry-hydration is reached ONLY for an
 * unscoped (`environmentId === undefined`) kernel writing an env-wide
 * (`organizationId` unset) row — exactly the one combination the suite above
 * exercises. Two gates, both correct and untouched here, exclude everything
 * else: `applyRegistryWriteThrough` never write-through hydrates when
 * `this.environmentId !== undefined` (a real per-environment/cloud kernel —
 * `assembleMetadataProtocol`'s own comment: "per-project (cloud) kernels
 * source metadata from the control plane"), and `hydrateOverlayIntoRegistry`
 * refuses ANY org-scoped row before ever expanding it ("[#6602] a per-org
 * overlay is served on demand, never grafted into the registry every org in
 * this process shares" — ADR-0005). The card's own repro is "a signed-in user
 * with an ACTIVE ORG" — exactly the excluded case, on any kernel.
 *
 * The fix is two independent, additive changes, neither touching either gate:
 *
 *  1. Object-name derivation now checks the container's own top-level
 *     `object` field FIRST (`ViewSchema.object`) — never consulted before.
 *  2. `getMetaItems` expands a container it reads INLINE, into that request's
 *     own response only, never into the shared SchemaRegistry — safe for
 *     isolation because it operates only on rows already scoped to THIS
 *     request's own org/environment (the pre-existing `queryByOrg` merge).
 */
describe('#13407 org-scoped and environment-scoped runtime containers are served', () => {
    it('derives the object binding from the containers own top-level `object` field, not just `list.data.object`', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Saved under a name that is NOT the object, and `list` carries no
        // `data.object` either — only the container's own top-level `object`
        // field says what this binds to. Pre-fix this expanded under the
        // WRONG key (derived from the save name) instead.
        const bound = {
            object: 'crm_lead',
            list: { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] },
        };
        await protocol.saveMetaItem({ type: 'view', name: 'lead_views', item: bound });

        const list: any = await protocol.getMetaItems({ type: 'view' });
        expect(switcherMatches(list.items, 'crm_lead').map((v: any) => v.name)).toEqual(['crm_lead.default']);
    });

    it('the cards own repro: a runtime container authored by a signed-in user with an ACTIVE ORG is now served', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'crm_lead', item: leadContainer, organizationId: 'org_acme',
        });

        const list: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);
        const served = switcherMatches(list.items, 'crm_lead').map((v: any) => v.name).sort();
        expect(served).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
    });

    it('POSITIVE CONTROL: a pre-existing independent ViewItem for the same object is still served alongside the newly-expanded container', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'crm_lead', item: leadContainer, organizationId: 'org_acme',
        });
        await protocol.saveMetaItem({
            type: 'view',
            name: 'crm_lead.mine',
            item: {
                name: 'crm_lead.mine', object: 'crm_lead', viewKind: 'list', label: 'My Leads',
                config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: [{ field: 'name' }] },
            },
            organizationId: 'org_acme',
        });

        const list: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);
        const served = switcherMatches(list.items, 'crm_lead').map((v: any) => v.name).sort();
        // A fix that merely "returned everything" could not distinguish these:
        // the pre-existing independent item and the two newly-expanded
        // container items must all be present, distinctly.
        expect(served).toEqual(['crm_lead.default', 'crm_lead.mine', 'crm_lead.pipeline']);
    });

    it('ORG ISOLATION HELD: a container authored in org_acme is invisible reading as org_globex, and visible reading as org_acme', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'crm_lead', item: leadContainer, organizationId: 'org_acme',
        });

        const globex: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_globex' } as any);
        expect(switcherMatches(globex.items, 'crm_lead')).toEqual([]);

        const acme: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);
        expect(switcherMatches(acme.items, 'crm_lead')).toHaveLength(2);
    });

    it('the isolation-safe path never registers an org-scoped expansion into the shared SchemaRegistry', async () => {
        const { engine, registered } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'crm_lead', item: leadContainer, organizationId: 'org_acme',
        });
        await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);

        // The RESPONSE carries the expansion (re-confirmed above); the SHARED
        // registry — read by every org/environment this kernel serves — must
        // carry none of it. This is what makes the fix isolation-safe without
        // touching either scope gate.
        expect(registered.get('view')?.size ?? 0).toBe(0);
    });

    it('an ENVIRONMENT-SCOPED kernel (a real per-project/cloud kernel, `assembleMetadataProtocol`s own construction shape) also serves a runtime-authored container', async () => {
        const { engine } = makeStubEngine();
        // #7736's own pin only ever constructed an UNSCOPED protocol
        // (`environmentId` omitted) — the control-plane instance. This
        // constructs the OTHER real shape.
        const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_prod_1');

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });
        const list: any = await protocol.getMetaItems({ type: 'view' });
        const served = switcherMatches(list.items, 'crm_lead').map((v: any) => v.name).sort();
        expect(served).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
    });

    describe('anti-vacuity — the closure does not become "expand anything"', () => {
        it('a DIFFERENT object in the SAME org still serves nothing for it', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            await protocol.saveMetaItem({
                type: 'view', name: 'crm_lead', item: leadContainer, organizationId: 'org_acme',
            });
            const list: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);
            expect(switcherMatches(list.items, 'crm_account')).toEqual([]);
        });

        it('an org with no container written at all reads empty, not an error', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            const list: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_acme' } as any);
            expect(list.items).toEqual([]);
        });
    });
});

/**
 * #21334 — a container on ANOTHER package's object must not take any of that
 * package's names, nor its default.
 *
 * The spec names every expanded view `<object>.<key>` (a bare `list` takes
 * `<object>.default`). A container saved under any other name — in another
 * package, or in none — for an object a code package ships used to expand
 * there and REPLACE the packaged views on the object door
 * (`GET /meta/view?object=`), wearing the shadowed artifact's `_packageId`,
 * while the by-name read kept the packaged item on an environment-scoped kernel
 * (and served the shadow too on an unscoped one, through the registry's bare
 * key). ADR-0005 keys an overlay by its own name and ADR-0126 rules out a silent
 * override. Triage's ruling takes the arm "expand under the container's own
 * name"; the seat's answer extends it to every member of the container, and
 * rules that such a container never declares the object's default.
 *
 * The registry double here is the real `SchemaRegistry`'s shape where this card
 * turns on it: loader entries under `<package>:<name>`, a hydrated row under
 * the bare name, `getItem`'s bare-slot-first precedence, `getArtifactItem`'s
 * package-scoped code-artifact lookup, and `getPackagedObjectOwner`. The
 * packaged views are produced by the spec's own `expandViewContainer`, as the
 * source registrars produce them. The cold-boot proof over the real showcase
 * composition, through the REST doors, is
 * `view-container-cross-package-default.dogfood.test.ts`.
 */
describe('#21334 a container on another package\'s object never takes that package\'s names or its default', () => {
    const SHOWCASE = 'com.example.showcase';
    const REPAIR = 'com.example.repairassets';
    const TASK = 'showcase_task';
    const DEFAULT = `${TASK}.default`;
    const ORG = 'org_acme';
    const data = { provider: 'object', object: TASK };
    const PACKAGED_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date', 'progress']
        .map((field) => ({ field }));
    /**
     * What the showcase ships for `showcase_task`: a `defineView` container with
     * one member of every kind the expander knows, so every probe below aims at
     * a name the package really ships.
     */
    const packagedTaskViews = {
        list: { label: 'All Tasks', type: 'grid', data, columns: PACKAGED_COLUMNS },
        listViews: {
            in_progress: { label: 'In Progress', type: 'grid', data, columns: PACKAGED_COLUMNS.slice(0, 4) },
        },
        form: { type: 'simple', sections: [{ label: 'Main', fields: ['title'] }] },
        formViews: {
            edit: { type: 'tabbed', sections: [{ label: 'Edit', fields: ['title', 'status'] }] },
        },
    };
    const PACKAGED = expandViewContainer(TASK, packagedTaskViews).map((vi) => ({ ...(vi as any) }));
    /** The card's own probe body, verbatim. */
    const probe = (name: string) => ({ name, object: TASK, list: { type: 'grid', columns: ['title', 'status'] } });

    function faithfulRegistry() {
        const byType = new Map<string, Map<string, Record<string, unknown>>>();
        const objects = new Map<string, { packageId: string; ownership: 'own'; definition: Record<string, unknown> }>();
        const collection = (type: string) => {
            if (!byType.has(type)) byType.set(type, new Map());
            return byType.get(type)!;
        };
        return {
            registerItem(type: string, item: Record<string, unknown>, keyField = 'name', packageId?: string) {
                const name = String(item[keyField]);
                if (packageId) {
                    if (item._packageId === undefined) item._packageId = packageId;
                    if (item._provenance === undefined) item._provenance = 'package';
                    collection(type).set(`${packageId}:${name}`, item);
                } else {
                    collection(type).set(name, item);
                }
            },
            listItems(type: string, packageId?: string) {
                const all = [...(byType.get(type)?.values() ?? [])];
                return packageId ? all.filter((it) => it._packageId === packageId) : all;
            },
            getItem(type: string, name: string, packageId?: string) {
                const entries = byType.get(type);
                if (!entries) return undefined;
                const direct = entries.get(name);
                if (direct) return direct;
                if (packageId) {
                    const local = entries.get(`${packageId}:${name}`);
                    if (local) return local;
                }
                for (const [key, item] of entries) if (key.endsWith(`:${name}`)) return item;
                return undefined;
            },
            getArtifactItem(type: string, name: string, packageId?: string) {
                const entries = [...(byType.get(type)?.entries() ?? [])];
                const scoped = entries.filter(([key, it]) => key.endsWith(`:${name}`) && isCodeArtifactBody(it));
                const local = packageId ? scoped.find(([, it]) => it._packageId === packageId) : undefined;
                if (local) return local[1];
                if (scoped[0]) return scoped[0][1];
                const bare = byType.get(type)?.get(name);
                return bare && isCodeArtifactBody(bare) ? bare : undefined;
            },
            shipObject(name: string, packageId: string) {
                objects.set(name, { packageId, ownership: 'own', definition: { name, _packageId: packageId } });
            },
            getPackagedObjectOwner: (name: string) => objects.get(name),
            getObject: (name: string) => objects.get(name)?.definition,
            registerObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            isObjectPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        };
    }

    /** The stub engine above, with the showcase's packaged task views in a faithful registry. */
    function showcaseHarness(environmentId?: string) {
        const stub = makeStubEngine();
        const registry = faithfulRegistry();
        registry.shipObject(TASK, SHOWCASE);
        registry.registerItem('view', { ...packagedTaskViews, name: TASK }, 'name', SHOWCASE);
        for (const vi of expandViewContainer(TASK, packagedTaskViews)) {
            registry.registerItem('view', { ...(vi as any) }, 'name', SHOWCASE);
        }
        stub.engine.registry = registry;
        const protocol = new ObjectStackProtocolImplementation(stub.engine, undefined, environmentId);
        return { ...stub, registry, protocol };
    }

    type Protocol = ObjectStackProtocolImplementation;
    const scoped = (organizationId?: string) => (organizationId ? { organizationId } : {});
    const objectDoor = async (protocol: Protocol, organizationId?: string) =>
        switcherMatches(((await protocol.getMetaItems({ type: 'view', ...scoped(organizationId) } as any)) as any).items, TASK);
    const byNameDoor = async (protocol: Protocol, name: string, organizationId?: string) =>
        ((await protocol.getMetaItem({ type: 'view', name, ...scoped(organizationId) } as any)) as any).item;
    const named = (items: any[], name: string) => items.filter((v) => v.name === name);
    /** The packaged default, as the source registrar registered it. */
    const expectPackagedDefault = (v: any) => {
        expect(v?.label).toBe('All Tasks');
        expect(v?.config?.columns).toEqual(PACKAGED_COLUMNS);
        expect(v?._packageId).toBe(SHOWCASE);
        expect(v?.isDefault).toBe(true);
    };
    /** (a) Every name the showcase ships answers the packaged view, once, on BOTH doors — the same row. */
    const expectEveryPackagedNameIntact = async (protocol: Protocol, organizationId?: string) => {
        const served = await objectDoor(protocol, organizationId);
        for (const shipped of PACKAGED) {
            const listed = named(served, shipped.name);
            expect(listed, `exactly one item answers ${shipped.name} on the object door`).toHaveLength(1);
            expect({ label: listed[0].label, config: listed[0].config, _packageId: listed[0]._packageId })
                .toEqual({ label: shipped.label, config: shipped.config, _packageId: SHOWCASE });
            const read = await byNameDoor(protocol, shipped.name, organizationId);
            expect({ label: read?.label, config: read?.config, _packageId: read?._packageId })
                .toEqual({ label: shipped.label, config: shipped.config, _packageId: SHOWCASE });
        }
    };
    /** (c) The object's only defaults are the ones its owning package declares. */
    const expectOnlyPackagedDefaults = (served: any[]) => {
        for (const viewKind of ['list', 'form']) {
            expect(
                served.filter((v) => v.viewKind === viewKind && v.isDefault).map((v) => v.name),
                `the ${viewKind} default stays the owning package's`,
            ).toEqual(PACKAGED.filter((v) => v.viewKind === viewKind && v.isDefault).map((v) => v.name));
        }
    };

    /**
     * Every member kind the spec's expander places, derived FROM the expander:
     * each top-level key of the container schema is offered a single view and a
     * record of views, and a key that yields an expanded item is a member kind.
     * A single-view member is enumerated twice — bare, and naming its own key —
     * when its own schema declares `name` (a `list` does; a `form` does not, so
     * a named `form` is not authorable). A kind the spec adds later shows up
     * here, and the enumeration below fails until it is placed.
     */
    function memberKindsOfTheExpander(): string[] {
        const shape = (ViewSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
        const slots = Object.keys(shape);
        expect(slots.length, 'the container schema\'s own keys are readable').toBeGreaterThan(0);
        const declaresName = (schema: unknown): boolean => {
            let s: any = schema;
            for (let i = 0; i < 6 && s; i++) {
                if (s.shape) return 'name' in s.shape;
                s = s._zod?.def?.innerType ?? s._def?.innerType ?? (typeof s.unwrap === 'function' ? s.unwrap() : undefined);
            }
            return false;
        };
        const view = { type: 'grid', label: 'probe' };
        const kinds: string[] = [];
        for (const slot of slots) {
            if (expandViewContainer('o', { [slot]: { ...view } }).length > 0) {
                kinds.push(slot);
                if (declaresName(shape[slot])) kinds.push(`${slot}#named`);
            } else if (expandViewContainer('o', { [slot]: { k: { ...view } } }).some((vi) => vi.name === 'o.k')) {
                kinds.push(`${slot}.*`);
            }
        }
        return kinds.sort();
    }

    const OWN = 'os_qa_probe';
    const listView = { type: 'grid', columns: ['title', 'status'] };
    const formView = { type: 'simple', sections: [{ label: 'Probe', fields: ['title'] }] };
    /**
     * One case per member kind: a container on `showcase_task` with ONLY that
     * member, whose key aims at a name the showcase ships, and the one name the
     * member must be served under instead.
     */
    const MEMBER_CASES: Record<string, { member: Record<string, unknown>; authored: unknown; shadows: string; servedAs: string }> = {
        list: { member: { list: listView }, authored: listView, shadows: DEFAULT, servedAs: `${TASK}.${OWN}` },
        'list#named': {
            member: { list: { ...listView, name: 'in_progress' } }, authored: { ...listView, name: 'in_progress' },
            shadows: `${TASK}.in_progress`, servedAs: `${TASK}.${OWN}.in_progress`,
        },
        'listViews.*': {
            member: { listViews: { in_progress: listView } }, authored: listView,
            shadows: `${TASK}.in_progress`, servedAs: `${TASK}.${OWN}.in_progress`,
        },
        form: { member: { form: formView }, authored: formView, shadows: `${TASK}.form`, servedAs: `${TASK}.${OWN}.form` },
        'formViews.*': {
            member: { formViews: { edit: formView } }, authored: formView,
            shadows: `${TASK}.edit`, servedAs: `${TASK}.${OWN}.edit`,
        },
    };

    it('the enumeration covers every member kind the spec\'s expander places, and nothing else', () => {
        expect(Object.keys(MEMBER_CASES).sort()).toEqual(memberKindsOfTheExpander());
        // Each probe really aims at a shipped name: without the fix it IS that name.
        for (const [kind, c] of Object.entries(MEMBER_CASES)) {
            const names = expandViewContainer(TASK, c.member).map((vi) => vi.name);
            expect(names, kind).toEqual([c.shadows]);
            expect(PACKAGED.map((v) => v.name), kind).toContain(c.shadows);
        }
    });

    const KERNELS = [
        ['an environment-scoped kernel (the standalone stack stamps env_local)', 'env_local'],
        ['an unscoped kernel (write-through hydrates the registry)', undefined],
    ] as const;
    const CONTAINERS = [
        { arm: 'package-scoped (saved into another writable package)', packageId: REPAIR, organizationId: undefined, ownPackage: REPAIR },
        { arm: 'package-less, environment-wide', packageId: undefined, organizationId: undefined, ownPackage: undefined },
        { arm: 'package-less, organization-scoped', packageId: undefined, organizationId: ORG, ownPackage: undefined },
    ] as const;
    const save = (protocol: Protocol, name: string, item: unknown, c: (typeof CONTAINERS)[number]) =>
        protocol.saveMetaItem({
            type: 'view', name, item,
            ...(c.packageId ? { packageId: c.packageId } : {}),
            ...scoped(c.organizationId),
        } as any);

    for (const [kernel, environmentId] of KERNELS) {
        describe(`on ${kernel}`, () => {
            for (const c of CONTAINERS) {
                for (const [kind, m] of Object.entries(MEMBER_CASES)) {
                    it(`${c.arm}, member ${kind}: no packaged name is replaced on either door, its own name is served with its own package, and it claims no default`, async () => {
                        const { protocol } = showcaseHarness(environmentId);
                        await save(protocol, OWN, { name: OWN, object: TASK, ...m.member }, c);

                        // (a)
                        await expectEveryPackagedNameIntact(protocol, c.organizationId);
                        // (b)
                        const served = await objectDoor(protocol, c.organizationId);
                        const own = served.filter((v) => String(v.name).startsWith(`${TASK}.${OWN}`));
                        expect(own.map((v) => v.name)).toEqual([m.servedAs]);
                        expect(own[0].object).toBe(TASK);
                        expect(own[0]._packageId).toBe(c.ownPackage);
                        expect(own[0]._provenance, 'never the packaged artifact\'s provenance').not.toBe('package');
                        expect(own[0]._diagnostics?.valid, 'a qualified ViewItem name the spec accepts').toBe(true);
                        expect(own[0].config, 'the member as authored, nothing lent left on it').toEqual(m.authored);
                        // (c)
                        expect(own[0].isDefault).toBeUndefined();
                        expectOnlyPackagedDefaults(served);
                        // The by-name door answers the container's own name with its row.
                        const row = await byNameDoor(protocol, OWN, c.organizationId);
                        expect(row?.object).toBe(TASK);
                    });
                }

                it(`${c.arm}: the card's probe — the packaged default unchanged on BOTH doors, and the object keeps ONE list default`, async () => {
                    const { protocol } = showcaseHarness(environmentId);
                    await save(protocol, 'os_qa_shadow_probe', probe('os_qa_shadow_probe'), c);

                    const listed = named(await objectDoor(protocol, c.organizationId), DEFAULT);
                    expect(listed, 'exactly one item answers <object>.default on the object door').toHaveLength(1);
                    expectPackagedDefault(listed[0]);
                    const read = await byNameDoor(protocol, DEFAULT, c.organizationId);
                    expectPackagedDefault(read);
                    expect({ label: read.label, config: read.config, _packageId: read._packageId })
                        .toEqual({ label: listed[0].label, config: listed[0].config, _packageId: listed[0]._packageId });
                    const served = await objectDoor(protocol, c.organizationId);
                    expect(served.filter((v) => v.viewKind === 'list' && v.isDefault).map((v) => v.name)).toEqual([DEFAULT]);
                    expect(named(served, `${TASK}.os_qa_shadow_probe`)[0]?.config).toEqual(probe('os_qa_shadow_probe').list);
                });
            }

            it('CONTROL — a container of the object\'s OWN package still expands to <object>.default, as its default', async () => {
                const { protocol, rows } = showcaseHarness(environmentId);
                // A row bound to the package that owns the object (an installed
                // package's own stored view), written straight to the store.
                rows.set('own-pkg-row', {
                    id: 'r_own', type: 'view', name: 'os_qa_same_pkg', organization_id: null,
                    package_id: SHOWCASE, state: 'active', metadata: JSON.stringify(probe('os_qa_same_pkg')),
                });

                const listed = named(await objectDoor(protocol), DEFAULT);
                expect(listed).toHaveLength(1);
                expect(listed[0].config).toEqual(probe('os_qa_same_pkg').list);
                expect(listed[0]._packageId).toBe(SHOWCASE);
                expect(listed[0].isDefault).toBe(true);
                expect(named(await objectDoor(protocol), `${TASK}.os_qa_same_pkg`)).toEqual([]);
            });

            it('CONTROL — a package-less overlay OF the package\'s own container keeps expanding to <object>.default', async () => {
                const { protocol } = showcaseHarness(environmentId);
                // Name-keyed (ADR-0005): the row IS the overlay of the showcase's
                // `showcase_task` container, so it stands in that package's slot.
                const overlay = { name: TASK, list: { label: 'Customized', type: 'grid', data, columns: [{ field: 'title' }] } };
                await protocol.saveMetaItem({ type: 'view', name: TASK, item: overlay } as any);

                const listed = named(await objectDoor(protocol), DEFAULT);
                expect(listed).toHaveLength(1);
                expect(listed[0].label).toBe('Customized');
                expect(listed[0]._packageId).toBe(SHOWCASE);
                expect(listed[0].isDefault).toBe(true);
                expect((await objectDoor(protocol)).filter((v) => String(v.name).startsWith(`${TASK}.${TASK}`))).toEqual([]);
            });

            it('CONTROL — the sanctioned override (a write to <object>.default by name) is served on both doors', async () => {
                const { protocol } = showcaseHarness(environmentId);
                const override = {
                    name: DEFAULT, object: TASK, viewKind: 'list', label: 'Overridden',
                    config: { type: 'grid', data, columns: [{ field: 'title' }] },
                };
                await protocol.saveMetaItem({ type: 'view', name: DEFAULT, item: override } as any);

                const listed = named(await objectDoor(protocol), DEFAULT);
                expect(listed).toHaveLength(1);
                expect(listed[0].label).toBe('Overridden');
                expect((await byNameDoor(protocol, DEFAULT)).label).toBe('Overridden');
            });
        });
    }

    it('the bare list keeps the spec\'s in-container de-duplication when a keyed view already takes the container\'s name', async () => {
        const { protocol } = showcaseHarness('env_local');
        const container = {
            name: 'probe_x', object: TASK,
            list: { type: 'grid', columns: ['title', 'status'] },
            listViews: { probe_x: { label: 'Keyed', type: 'grid', columns: ['title'] } },
        };
        await protocol.saveMetaItem({ type: 'view', name: 'probe_x', item: container, packageId: REPAIR } as any);

        const served = await objectDoor(protocol);
        expect(named(served, `${TASK}.probe_x.probe_x`)[0]?.label).toBe('Keyed');
        expect(named(served, `${TASK}.probe_x`)[0]?.config).toEqual(container.list);
        await expectEveryPackagedNameIntact(protocol);
    });

    it('a container named after a key the owning package ships keeps its bare list off that name', async () => {
        const { protocol } = showcaseHarness('env_local');
        await protocol.saveMetaItem({ type: 'view', name: 'in_progress', item: probe('in_progress'), packageId: REPAIR } as any);

        const served = await objectDoor(protocol);
        expect(named(served, `${TASK}.in_progress.in_progress`)[0]?.config).toEqual(probe('in_progress').list);
        expect(named(served, `${TASK}.in_progress.in_progress`)[0]?._packageId).toBe(REPAIR);
        await expectEveryPackagedNameIntact(protocol);
    });

    it('a stored container with no name of its own expands nothing on another package\'s object', async () => {
        const { protocol, rows } = showcaseHarness('env_local');
        const nameless = { object: TASK, list: { type: 'grid', columns: ['title'] }, listViews: { in_progress: { label: 'Mine', type: 'grid', columns: ['title'] } } };
        rows.set('nameless-row', {
            id: 'r_nameless', type: 'view', name: 'os_qa_nameless', organization_id: null,
            package_id: REPAIR, state: 'active', metadata: JSON.stringify(nameless),
        });

        const served = await objectDoor(protocol);
        expect(served.filter((v) => v._packageId === REPAIR)).toEqual([]);
        await expectEveryPackagedNameIntact(protocol);
    });

    /**
     * #21442 — every name the object door lists answers the same row by name,
     * on both kernels, for every member kind and every container scope.
     *
     * The list read expands each stored container it reads into its own answer;
     * nothing else stores or registers those views on every kernel. Measured on
     * `origin/main` before this change, with this harness: the by-name read
     * answered an expanded name only on an unscoped kernel and only for an
     * environment-wide container (registry hydration), and answered nothing on
     * `env_local` or for an organization-scoped container. Triage's ruling A:
     * the by-name read expands the in-scope containers through the function the
     * list read uses, ⛔ no second expansion rule and ⛔ no kernel-specific
     * branch. The container's own name stays its stored row — the control.
     */
    describe('#21442 a name a stored container expands answers by name what the object door lists', () => {
        const withoutDiagnostics = (item: any) => {
            if (!item || typeof item !== 'object') return item;
            const { _diagnostics: _drop, ...rest } = item;
            return rest;
        };
        const ownNames = (served: any[]) => served.filter((v) => String(v.name).startsWith(`${TASK}.${OWN}`));
        const layers = async (protocol: Protocol, name: string, organizationId?: string) =>
            (await protocol.getMetaItemLayered({ type: 'view', name, ...scoped(organizationId) })) as any;
        const history = async (protocol: Protocol, name: string, organizationId?: string) =>
            (await protocol.historyMetaItem({ type: 'view', name, ...scoped(organizationId) })).events;
        const diff = async (protocol: Protocol, name: string, organizationId?: string) =>
            (protocol as any).diffMetaItem({ type: 'view', name, ...scoped(organizationId) });
        /** What the registry holds for `view`, by key — reads must leave it as they found it. */
        const registrySnapshot = (registry: ReturnType<typeof faithfulRegistry>) =>
            JSON.stringify(registry.listItems('view').map((it) => [it.name, it._packageId ?? null]).sort());

        for (const [kernel, environmentId] of KERNELS) {
            describe(`on ${kernel}`, () => {
                for (const c of CONTAINERS) {
                    for (const [kind, m] of Object.entries(MEMBER_CASES)) {
                        it(`${c.arm}, member ${kind}: every name the object door lists answers that same item by name`, async () => {
                            const { protocol } = showcaseHarness(environmentId);
                            await save(protocol, OWN, { name: OWN, object: TASK, ...m.member }, c);

                            const served = await objectDoor(protocol, c.organizationId);
                            expect(ownNames(served).map((v) => v.name), 'the expanded name is listed').toEqual([m.servedAs]);
                            for (const listed of served) {
                                const read = await byNameDoor(protocol, listed.name, c.organizationId);
                                expect(withoutDiagnostics(read), `${listed.name} by name`).toEqual(withoutDiagnostics(listed));
                            }
                            // CONTROL — the container's own name is still its stored row.
                            const row = await byNameDoor(protocol, OWN, c.organizationId);
                            expect(row?.name).toBe(OWN);
                            expect(row?.object).toBe(TASK);
                            for (const key of Object.keys(m.member)) expect(row?.[key], `the stored container carries ${key}`).toEqual(m.member[key]);
                        });
                    }

                    it(`${c.arm}: the layers name the container and its scope; history and diff resolve to the container's own row`, async () => {
                        const { protocol } = showcaseHarness(environmentId);
                        const member = MEMBER_CASES['listViews.*'];
                        await save(protocol, OWN, { name: OWN, object: TASK, ...member.member }, c);
                        const expanded = member.servedAs;

                        const layered = await layers(protocol, expanded, c.organizationId);
                        // `overlay` is the container's own stored row, as the
                        // layers read reports a stored row; `overlayScope` the
                        // scope it was read from.
                        expect(layered.overlay?.name).toBe(OWN);
                        expect(layered.overlay?.listViews).toEqual(member.member.listViews);
                        expect(layered.overlay?._packageId).toBe(c.ownPackage);
                        expect(layered.overlayScope).toBe(c.organizationId ? 'org' : 'env');
                        // `effective` is what the by-name read answers.
                        expect(withoutDiagnostics(layered.effective))
                            .toEqual(withoutDiagnostics(await byNameDoor(protocol, expanded, c.organizationId)));
                        // CONTROL — the container's own name reports its own row, unchanged.
                        const ownLayers = await layers(protocol, OWN, c.organizationId);
                        expect(ownLayers.overlay?.name).toBe(OWN);
                        expect(ownLayers.effective?.listViews).toEqual(member.member.listViews);

                        const ownHistory = await history(protocol, OWN, c.organizationId);
                        expect(ownHistory.length, 'the container has a change log of its own').toBeGreaterThan(0);
                        const expandedHistory = await history(protocol, expanded, c.organizationId);
                        expect(expandedHistory, 'the container\'s own log, nothing synthesized').toEqual(ownHistory);
                        expect(expandedHistory.every((e: any) => e.ref.name === OWN), 'every event names the container').toBe(true);

                        const ownDiff = await diff(protocol, OWN, c.organizationId);
                        const expandedDiff = await diff(protocol, expanded, c.organizationId);
                        expect(expandedDiff).toEqual(ownDiff);
                        expect(expandedDiff.name, 'the answer names the item actually diffed').toBe(OWN);
                    });

                    it(`${c.arm}: the reads persist and register nothing, and a name nothing expands still answers nothing`, async () => {
                        const { protocol, rows, registry } = showcaseHarness(environmentId);
                        await save(protocol, OWN, { name: OWN, object: TASK, ...MEMBER_CASES['listViews.*'].member }, c);
                        const rowsBefore = JSON.stringify([...rows.keys()].sort());
                        const registryBefore = registrySnapshot(registry);

                        const expanded = MEMBER_CASES['listViews.*'].servedAs;
                        await byNameDoor(protocol, expanded, c.organizationId);
                        await layers(protocol, expanded, c.organizationId);
                        await history(protocol, expanded, c.organizationId);
                        await diff(protocol, expanded, c.organizationId);
                        expect(JSON.stringify([...rows.keys()].sort()), 'no derived row is stored').toBe(rowsBefore);
                        expect(registrySnapshot(registry), 'no derived item is registered by a read').toBe(registryBefore);

                        const nothing = `${TASK}.${OWN}.not_a_member`;
                        expect(await byNameDoor(protocol, nothing, c.organizationId)).toBeUndefined();
                        expect(await history(protocol, nothing, c.organizationId), 'no history for a name never stored').toEqual([]);
                        const layeredNothing = await layers(protocol, nothing, c.organizationId);
                        expect([layeredNothing.overlay, layeredNothing.overlayScope, layeredNothing.effective]).toEqual([null, null, null]);
                    });
                }

                it('ISOLATION — an organization-scoped container\'s names answer nothing by name for another organization', async () => {
                    const { protocol } = showcaseHarness(environmentId);
                    const org = CONTAINERS.find((c) => c.organizationId !== undefined)!;
                    await save(protocol, OWN, { name: OWN, object: TASK, ...MEMBER_CASES['listViews.*'].member }, org);
                    const expanded = MEMBER_CASES['listViews.*'].servedAs;

                    expect(await byNameDoor(protocol, expanded, ORG)).toBeTruthy();
                    expect(ownNames(await objectDoor(protocol, 'org_globex'))).toEqual([]);
                    expect(await byNameDoor(protocol, expanded, 'org_globex')).toBeUndefined();
                    expect(await byNameDoor(protocol, expanded)).toBeUndefined();
                });

                for (const organizationId of [undefined, ORG]) {
                    it(`a tenant overlay of the package's own container (${organizationId ? 'organization-scoped' : 'environment-wide'}): each name it expands answers the overlay's view by name, not the packaged one`, async () => {
                        const { protocol } = showcaseHarness(environmentId);
                        const overlay = {
                            name: TASK,
                            list: { label: 'Customized', type: 'grid', data, columns: [{ field: 'title' }] },
                            listViews: { in_progress: { label: 'Customized In Progress', type: 'grid', data, columns: [{ field: 'title' }] } },
                        };
                        await protocol.saveMetaItem({ type: 'view', name: TASK, item: overlay, ...scoped(organizationId) } as any);

                        const served = await objectDoor(protocol, organizationId);
                        for (const name of [DEFAULT, `${TASK}.in_progress`]) {
                            const listed = named(served, name);
                            expect(listed, `${name} is listed once`).toHaveLength(1);
                            expect(String(listed[0].label)).toMatch(/^Customized/);
                            const read = await byNameDoor(protocol, name, organizationId);
                            expect(withoutDiagnostics(read), `${name} by name`).toEqual(withoutDiagnostics(listed[0]));
                        }
                        // The layers: the packaged item, the overlay that customizes it, and the result.
                        const layered = await layers(protocol, DEFAULT, organizationId);
                        expect(layered.code?.label).toBe('All Tasks');
                        expect(layered.overlay?.name).toBe(TASK);
                        expect(layered.overlayScope).toBe(organizationId ? 'org' : 'env');
                        expect(layered.effective?.label).toBe('Customized');
                    });
                }
            });
        }

        it('both kernels answer every listed name with the same item', async () => {
            for (const c of CONTAINERS) {
                for (const [kind, m] of Object.entries(MEMBER_CASES)) {
                    const answers = [];
                    for (const [, environmentId] of KERNELS) {
                        const { protocol } = showcaseHarness(environmentId);
                        await save(protocol, OWN, { name: OWN, object: TASK, ...m.member }, c);
                        answers.push(withoutDiagnostics(await byNameDoor(protocol, m.servedAs, c.organizationId)));
                    }
                    expect(answers[0], `${c.arm}, member ${kind}`).toBeTruthy();
                    expect(answers[1], `${c.arm}, member ${kind}`).toEqual(answers[0]);
                }
            }
        });
    });
});

/**
 * #21412 — the runtime save door refuses a view container whose own `name`
 * disagrees with the name it is saved under, through the one judge the source
 * registrars call (`@objectstack/metadata/view-container-name`).
 *
 * Before: the card's probe was ACCEPTED — stored as row `crm_lead` with body
 * `name` `lead_views`, and registered as `lead_views` (the container, keyed by
 * `body.name` in `hydrateOverlayIntoRegistry`) plus `crm_lead.default`: one
 * document answering under a name its row does not have. The two source
 * registrars refuse the same document.
 *
 * The key judged here is the SAVE name, not the binding: this door keeps a
 * container saved under a name other than its object (the #13407 case above,
 * #21334's arm), so the body it stamps for such a container must pass when it
 * is sent back. Shapes as the card's measurement named them (row = save name):
 * P1 row crm_lead / `name` lead_views; P2 row lead_views / `name` lead_views,
 * bound to crm_lead; P2b P2 with no `name`; P3 row lead_views / `name`
 * crm_lead; P4 row crm_lead / `name` lead_views, no other binding.
 */
describe('#21412 the save door refuses a container whose own name disagrees with the name it is saved under', () => {
    const named = (name: string | undefined, body: Record<string, unknown>) =>
        (name === undefined ? { ...body } : { name, ...body });
    /** Bound to crm_lead through its own `object`, no `data` on any arm. */
    const objectBound = { object: 'crm_lead', list: { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] } };
    /** No binding but whatever `name` it carries. */
    const unbound = { list: { label: 'All', type: 'grid', columns: [{ field: 'name' }] } };

    async function save(name: string, item: unknown) {
        const harness = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(harness.engine);
        let error: any = null;
        try {
            await protocol.saveMetaItem({ type: 'view', name, item });
        } catch (e) {
            error = e;
        }
        const viewRows = Array.from(harness.rows.values()).filter((r) => r.type === 'view');
        // The keys the registry holds a CONTAINER under — its expansions carry
        // `viewKind` and are the container's derived items, not a second key
        // for the document (seat answer Q4).
        const containerKeys = Array.from(harness.registered.get('view')?.entries() ?? [])
            .filter(([, v]) => isAggregatedViewContainer(v))
            .map(([k]) => k);
        return { ...harness, protocol, error, viewRows, containerKeys };
    }

    function expectRefused(outcome: Awaited<ReturnType<typeof save>>) {
        // The minimum a rejection pin asserts: the ADR-0112 envelope.
        expect(outcome.error).toBeInstanceOf(Error);
        expect(outcome.error.code).toBe('VALIDATION_ERROR');
        expect(outcome.error.status).toBe(400);
        // ...and the refused document reached nothing.
        expect(outcome.viewRows).toEqual([]);
        expect(outcome.registered.get('view')?.size ?? 0).toBe(0);
    }

    it('P1, the card\'s probe: refused VALIDATION_ERROR / 400, nothing stored, nothing registered', async () => {
        expectRefused(await save('crm_lead', named('lead_views', leadContainer)));
    });

    it('P1 is refused THROUGH the judge: the door throws exactly what it returns for that document', async () => {
        const body = named('lead_views', leadContainer);
        const { error } = await save('crm_lead', body);
        expect(error.message).toBe(savedItemNameRefusal('view', body, 'crm_lead', 'save')!.message);
    });

    it('P1 answers the envelope a source registrar answers for the same document', async () => {
        const body = named('lead_views', objectBound);
        const { error: saveDoor } = await save('crm_lead', body);
        const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } }) as any;
        const ctx = {
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            registerService: () => {}, getService: () => undefined, trigger: async () => {},
        } as any;
        const registrar = await plugin._parseAndRegisterArtifact(ctx, JSON.parse(JSON.stringify({
            manifest: { id: 'com.acme.crm', name: 'CRM', version: '1.0.0', type: 'app' },
            views: [body],
        })), 'fixture-21412').then(() => null, (e: any) => e);
        expect(registrar).toBeInstanceOf(Error);
        expect([saveDoor.code, saveDoor.status]).toEqual([registrar.code, registrar.status]);
        expect([saveDoor.code, saveDoor.status]).toEqual(['VALIDATION_ERROR', 400]);
    });

    it('P3: a `name` equal to the binding but not to the row is refused', async () => {
        expectRefused(await save('lead_views', named('crm_lead', leadContainer)));
    });

    it('P4: a `name` that is the only binding, but not the row, is refused', async () => {
        expectRefused(await save('crm_lead', named('lead_views', unbound)));
    });

    it('P2: a `name` equal to the row passes though the container binds elsewhere — one key, the row\'s', async () => {
        const outcome = await save('lead_views', named('lead_views', objectBound));
        expect(outcome.error).toBeNull();
        expect(outcome.viewRows.map((r) => [r.name, JSON.parse(r.metadata).name])).toEqual([['lead_views', 'lead_views']]);
        expect(outcome.containerKeys).toEqual(['lead_views']);
        const list: any = await outcome.protocol.getMetaItems({ type: 'view' });
        expect(switcherMatches(list.items, 'crm_lead').map((v: any) => v.name)).toEqual(['crm_lead.default']);
    });

    it('P2b: an absent `name` passes and is stamped with the row name — and the stamped body passes when sent back', async () => {
        const outcome = await save('lead_views', named(undefined, objectBound));
        expect(outcome.error).toBeNull();
        expect(outcome.viewRows.map((r) => JSON.parse(r.metadata).name)).toEqual(['lead_views']);
        expect(outcome.containerKeys).toEqual(['lead_views']);

        const read: any = await outcome.protocol.getMetaItem({ type: 'view', name: 'lead_views' });
        expect(read.item.name).toBe('lead_views');
        const { _diagnostics: _drop, ...sentBack } = read.item;
        await expect(outcome.protocol.saveMetaItem({ type: 'view', name: 'lead_views', item: sentBack })).resolves.toBeTruthy();
    });

    it('CONTROL: a `name` equal to the row and the binding passes, under one key', async () => {
        const outcome = await save('crm_lead', named('crm_lead', leadContainer));
        expect(outcome.error).toBeNull();
        expect(outcome.containerKeys).toEqual(['crm_lead']);
    });
});
