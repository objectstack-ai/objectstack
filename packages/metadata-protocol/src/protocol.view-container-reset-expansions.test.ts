// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23149] Resetting a published overlay of a packaged view CONTAINER heals the
 * expanded views its publish registered, not only the container's plain key.
 *
 * ## What was measured
 *
 * On `examples/app-showcase` an admin overlaid the packaged `showcase_task`
 * container (`list.label` → `All Tasks (X)`, the `progress` column dropped),
 * published it, and reset it: `DELETE /meta/view/showcase_task` answered
 * `{ success: true, reset: true }`, while `GET /meta/view` and
 * `GET /meta/view?object=showcase_task` kept serving `showcase_task.default` as
 * the overlay's six-column `All Tasks (X)` until a restart.
 *
 * Reproduced one layer down, over the real `ObjectQL` engine and its
 * `SchemaRegistry` before this change: the boot registers the packaged
 * container's expansions under `<packageId>:<object>.<viewKey>`; the publish
 * registers the overlay's expansions under the bare `<object>.<viewKey>` names
 * ({@link ObjectStackProtocolImplementation} `hydrateExpandedViewItems`) and
 * leaves the packaged entries untouched; the reset's heal lifted the bare
 * `showcase_task` entry and nothing else, so the list read listed the packaged
 * `showcase_task.default` AND the overlay's stale one, and the by-name read
 * (with no MetadataService answering first) served the stale one. The heal now
 * walks every name the container registered through the same tiers it walks
 * for the container's own name.
 *
 * ## The harness
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 * So the registry is a double carrying the real `SchemaRegistry`'s key shapes
 * (`<packageId>:<name>` for a package's entry, the bare name for a hydrated
 * row), its `getItem` precedence, its artifact lookup, its listing, and its two
 * heal verbs (`removeRuntimeShadow`, `removeOverlayEntry`) with their refusals.
 * The engine is the in-memory `sys_metadata` double of
 * `protocol.served-content-hash.test.ts`. No MetadataService is registered, so
 * the by-name read answers from the registry, the source that was stale.
 *
 * ## Pins
 *
 *  - after the reset, the list read, the object-filtered list and the by-name
 *    read all serve the packaged expansion, once, and the bare names are empty;
 *  - a view the overlay added, which no package ships, is retired;
 *  - publish → reset → publish serves the second overlay, and its reset heals;
 *  - control: a packaged dashboard (no expansion) resets as before;
 *  - an expansion name another package ships is never touched by the heal;
 *  - an organization-scoped heal touches none of the container's expansions,
 *    and an environment-wide heal after it still heals them.
 */
import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    isTenantAuthored,
} from '@objectstack/metadata-core';
import { expandViewContainer } from '@objectstack/spec/ui';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG = 'com.example.showcase';
const OTHER_PKG = 'com.example.other';
const OBJ = 'showcase_task';
const DEFAULT_VIEW = `${OBJ}.default`;
const IN_PROGRESS_VIEW = `${OBJ}.in_progress`;
const SHIPPED_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date', 'progress'];

const data = { provider: 'object' as const, object: OBJ };

/** The `defineView` container the package ships for its object. */
const shippedContainer = () => ({
    list: { label: 'All Tasks', type: 'grid', data, columns: SHIPPED_COLUMNS.map((field) => ({ field })) },
    listViews: {
        in_progress: { label: 'In Progress', type: 'grid', data, columns: [{ field: 'title' }, { field: 'status' }] },
    },
});

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    [k: string]: unknown;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        // Any other combinator is REFUSED, never read as a field name.
        if (k.startsWith('$')) throw new Error(`stub engine: combinator '${k}' is not implemented`);
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/**
 * The real `SchemaRegistry`'s generic-metadata half, for the verbs the
 * protocol's save, read and heal paths call on a view or a dashboard.
 */
function makeRegistry() {
    const byType = new Map<string, Map<string, any>>();
    const collection = (type: string) => {
        let c = byType.get(type);
        if (!c) byType.set(type, (c = new Map()));
        return c;
    };
    const isArtifact = (it: any) => !!it && !!it._packageId && it._packageId !== 'sys_metadata' && !isTenantAuthored(it);
    return {
        registerItem(type: string, item: any, keyField = 'name', packageId?: string) {
            // `applyProtection` stamps a package's entry; a bare registration is left as handed in.
            if (packageId) {
                if (item._packageId === undefined) item._packageId = packageId;
                if (item._provenance === undefined) item._provenance = 'package';
            }
            const name = String(item[keyField]);
            collection(type).set(packageId ? `${packageId}:${name}` : name, item);
        },
        /** Bare slot first, then prefer-local, then the first composite. */
        getItem(type: string, name: string, packageId?: string) {
            const c = byType.get(type);
            if (!c) return undefined;
            const direct = c.get(name);
            if (direct) return direct;
            if (packageId) {
                const local = c.get(`${packageId}:${name}`);
                if (local) return local;
            }
            for (const [key, item] of c) if (key.endsWith(`:${name}`)) return item;
            return undefined;
        },
        getArtifactItem(type: string, name: string, packageId?: string) {
            const c = byType.get(type);
            if (!c) return undefined;
            if (packageId) {
                const local = c.get(`${packageId}:${name}`);
                if (isArtifact(local)) return local;
            }
            for (const [key, item] of c) if (key !== name && key.endsWith(`:${name}`) && isArtifact(item)) return item;
            const direct = c.get(name);
            if (isArtifact(direct) && (!packageId || direct._packageId === packageId)) return direct;
            return undefined;
        },
        listItems(type: string, packageId?: string) {
            const all = [...(byType.get(type)?.values() ?? [])];
            return packageId ? all.filter((it) => it._packageId === packageId) : all;
        },
        /** Drops the bare entry only while a package's entry of the name remains. */
        removeRuntimeShadow(type: string, name: string) {
            const c = byType.get(type);
            if (!c || !c.has(name)) return false;
            for (const [key, item] of c) {
                if (key !== name && key.endsWith(`:${name}`) && item?._packageId && item._packageId !== 'sys_metadata') {
                    c.delete(name);
                    return true;
                }
            }
            return false;
        },
        /** Drops the bare entry unless it is itself a package's artifact. */
        removeOverlayEntry(type: string, name: string) {
            const c = byType.get(type);
            if (!c || !c.has(name)) return false;
            if (isArtifact(c.get(name))) return false;
            c.delete(name);
            return true;
        },
        getPackagedObjectOwner(name: string) {
            return name === OBJ ? { packageId: PKG, ownership: 'own' } : undefined;
        },
        isPackageDisabled: () => false,
        getPackage: () => undefined,
        registerObject: () => {},
        /** Test reach: the bare slot alone, as no registry verb answers it. */
        bare(type: string, name: string) {
            return byType.get(type)?.get(name);
        },
    };
}

function makeEngine() {
    const rows = new Map<string, Row>();
    const historyRows: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const registry = makeRegistry();
    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where?: Record<string, unknown>; limit?: number } = {}) {
            const matched = table === 'sys_metadata_audit'
                ? auditRows.filter((a) => matchesWhere(a, o.where))
                : table === 'sys_metadata_history'
                    ? historyRows.filter((h) => matchesWhere(h, o.where))
                    : Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            // The caller's bound, applied after the filter, by presence.
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, row: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata_audit') {
                auditRows.push({ id: `a_${nextId}`, ...row });
                return { id: `a_${nextId}` };
            }
            if (table === 'sys_metadata_history') {
                historyRows.push({ id: `h_${nextId}`, ...row });
                return { id: `h_${nextId}` };
            }
            const stored = { id: `r_${nextId}`, ...row } as Row;
            rows.set(keyOf(row), stored);
            return { id: stored.id };
        },
        async update(_t: string, patch: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(patch, o);
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...patch } as Row;
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(o);
            const found = findRow(o.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() {},
        registry,
    };
    return { engine, registry, rows };
}

/**
 * A control-plane kernel (no environment), registered the way the boot
 * registers the package: the container under the object's name and each view it
 * expands to under its own, both in the package's slot.
 */
function boot(opts: { otherPackageShipsInProgress?: boolean } = {}) {
    const { engine, registry, rows } = makeEngine();
    const stamp = <T extends object>(item: T, pkg = PKG) =>
        ({ ...item, _packageId: pkg, _packageVersion: '1.0.0', _provenance: 'package' });
    registry.registerItem('view', stamp({ name: OBJ, ...shippedContainer() }), 'name', PKG);
    for (const vi of expandViewContainer(OBJ, shippedContainer())) {
        registry.registerItem('view', stamp(vi as object), 'name', PKG);
    }
    if (opts.otherPackageShipsInProgress) {
        const other = { ...shippedContainer().listViews.in_progress, label: 'Other In Progress' };
        const [inProgress] = expandViewContainer(OBJ, { listViews: { in_progress: other } });
        registry.registerItem('view', stamp(inProgress as object, OTHER_PKG), 'name', OTHER_PKG);
    }
    registry.registerItem('dashboard', stamp({ name: 'ops_dash', label: 'Ops', widgets: [] }), 'name', PKG);
    const protocol = new ObjectStackProtocolImplementation(engine);
    return { protocol, registry, rows };
}

const stripInternal = (body: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('_')));

/** Studio's designer loop on the container: read, edit, save a draft, publish. */
async function publishContainerOverlay(
    protocol: ObjectStackProtocolImplementation,
    edit: (container: Record<string, any>) => void,
) {
    const read: any = await protocol.getMetaItem({ type: 'view', name: OBJ });
    const container = stripInternal(read.item) as Record<string, any>;
    edit(container);
    const saved: any = await protocol.saveMetaItem({ type: 'view', name: OBJ, item: container, mode: 'draft' });
    expect(saved).toMatchObject({ success: true });
    const published: any = await protocol.publishMetaItem({ type: 'view', name: OBJ });
    expect(published).toMatchObject({ success: true });
}

const xEdit = (label: string, dropProgress: boolean) => (container: Record<string, any>) => {
    container.list = {
        ...container.list,
        label,
        columns: (container.list.columns as Array<{ field: string }>).filter((c) => !dropProgress || c.field !== 'progress'),
    };
};

const labelOf = (view: any) => view?.config?.label ?? view?.label;
const columnCountOf = (view: any) => (view?.config?.columns ?? view?.columns)?.length;

async function listItems(protocol: ObjectStackProtocolImplementation, type = 'view'): Promise<any[]> {
    const res: any = await protocol.getMetaItems({ type });
    return Array.isArray(res) ? res : res.items;
}

/** The views every read door serves under `name`: the list, the `?object=` list, the by-name read. */
async function doors(protocol: ObjectStackProtocolImplementation, name: string) {
    const all = await listItems(protocol);
    // The object-bound predicate the `?object=` list and the switcher filter on.
    const byObject = all.filter((v: any) => v && v.viewKind && v.object === OBJ);
    const one: any = await protocol.getMetaItem({ type: 'view', name }).catch(() => undefined);
    return {
        list: all.filter((v: any) => v?.name === name).map((v) => [labelOf(v), columnCountOf(v)]),
        objectList: byObject.filter((v: any) => v?.name === name).map((v) => [labelOf(v), columnCountOf(v)]),
        item: one?.item === undefined ? undefined : [labelOf(one.item), columnCountOf(one.item)],
    };
}

const PACKAGED_DEFAULT = ['All Tasks', 7];

describe('[#23149] a reset of a packaged view container heals the expansions its publish registered', () => {
    it("the card's repro: after the reset every read door serves the packaged expansion, once", async () => {
        const { protocol, registry } = boot();
        await publishContainerOverlay(protocol, xEdit('All Tasks (X)', true));
        // The overlay is what the doors served before the reset.
        expect(await doors(protocol, DEFAULT_VIEW)).toEqual({
            list: [['All Tasks (X)', 6]],
            objectList: [['All Tasks (X)', 6]],
            item: ['All Tasks (X)', 6],
        });

        const reset: any = await protocol.deleteMetaItem({ type: 'view', name: OBJ });
        expect(reset).toMatchObject({ success: true, reset: true });

        expect(await doors(protocol, DEFAULT_VIEW)).toEqual({
            list: [PACKAGED_DEFAULT],
            objectList: [PACKAGED_DEFAULT],
            item: PACKAGED_DEFAULT,
        });
        // The bare names the publish registered are empty again, the member
        // the overlay did not edit included; the packaged entries stay.
        expect(registry.bare('view', DEFAULT_VIEW)).toBeUndefined();
        expect(registry.bare('view', IN_PROGRESS_VIEW)).toBeUndefined();
        expect(registry.bare('view', OBJ)).toBeUndefined();
        expect(labelOf(registry.getItem('view', DEFAULT_VIEW))).toBe('All Tasks');
    });

    it('a view the overlay added, which no package ships, is retired by the reset', async () => {
        const { protocol, registry } = boot();
        const added = `${OBJ}.added_by_overlay`;
        await publishContainerOverlay(protocol, (container) => {
            container.listViews = {
                ...container.listViews,
                added_by_overlay: { label: 'Added', type: 'grid', data, columns: [{ field: 'title' }] },
            };
        });
        expect((await doors(protocol, added)).list).toEqual([['Added', 1]]);

        await protocol.deleteMetaItem({ type: 'view', name: OBJ });

        expect(await doors(protocol, added)).toEqual({ list: [], objectList: [], item: undefined });
        expect(registry.bare('view', added)).toBeUndefined();
    });

    it('publish → reset → publish serves the second overlay, and its reset heals again', async () => {
        const { protocol } = boot();
        await publishContainerOverlay(protocol, xEdit('First overlay', true));
        await protocol.deleteMetaItem({ type: 'view', name: OBJ });

        await publishContainerOverlay(protocol, xEdit('Second overlay', false));
        expect(await doors(protocol, DEFAULT_VIEW)).toEqual({
            list: [['Second overlay', 7]],
            objectList: [['Second overlay', 7]],
            item: ['Second overlay', 7],
        });

        await protocol.deleteMetaItem({ type: 'view', name: OBJ });
        expect(await doors(protocol, DEFAULT_VIEW)).toEqual({
            list: [PACKAGED_DEFAULT],
            objectList: [PACKAGED_DEFAULT],
            item: PACKAGED_DEFAULT,
        });
    });

    it('control: a packaged dashboard, which expands to nothing, resets as before', async () => {
        const { protocol } = boot();
        await protocol.saveMetaItem({
            type: 'dashboard', name: 'ops_dash', item: { name: 'ops_dash', label: 'Ops (X)', widgets: [] }, mode: 'draft',
        });
        await protocol.publishMetaItem({ type: 'dashboard', name: 'ops_dash' });
        const before = (await listItems(protocol, 'dashboard')).filter((d: any) => d?.name === 'ops_dash');
        expect(before.map((d: any) => d.label)).toEqual(['Ops (X)']);

        const reset: any = await protocol.deleteMetaItem({ type: 'dashboard', name: 'ops_dash' });
        expect(reset).toMatchObject({ success: true, reset: true });

        const after = (await listItems(protocol, 'dashboard')).filter((d: any) => d?.name === 'ops_dash');
        expect(after.map((d: any) => d.label)).toEqual(['Ops']);
        const one: any = await protocol.getMetaItem({ type: 'dashboard', name: 'ops_dash' });
        expect(one.item.label).toBe('Ops');
    });

    it('an expansion name another package ships is never touched by the heal', async () => {
        const { protocol, registry } = boot({ otherPackageShipsInProgress: true });
        // Whatever holds that bare name is not this container's: here, a
        // registration from another source, which the heal must leave.
        const held = { name: IN_PROGRESS_VIEW, object: OBJ, viewKind: 'list', label: 'Held elsewhere', _provenance: 'org' };
        registry.registerItem('view', held, 'name');

        await publishContainerOverlay(protocol, xEdit('All Tasks (X)', true));
        // The hydration skipped the name (#21980): the bare slot is unchanged.
        expect(registry.bare('view', IN_PROGRESS_VIEW)).toBe(held);
        expect(labelOf(registry.bare('view', DEFAULT_VIEW))).toBe('All Tasks (X)');

        await protocol.deleteMetaItem({ type: 'view', name: OBJ });

        expect(registry.bare('view', IN_PROGRESS_VIEW)).toBe(held);
        expect(labelOf(registry.getArtifactItem('view', IN_PROGRESS_VIEW, OTHER_PKG))).toBe('Other In Progress');
        // The name the container did register is healed.
        expect(registry.bare('view', DEFAULT_VIEW)).toBeUndefined();
    });

    it('an organization-scoped heal touches none of the expansions; an environment-wide one after it heals them', async () => {
        const { protocol, registry } = boot();
        await publishContainerOverlay(protocol, xEdit('All Tasks (X)', true));
        const heal = (organizationId: string | null) =>
            (protocol as any).restoreArtifactRegistryView('view', OBJ, organizationId) as Promise<void>;

        await heal('org_a');
        expect(labelOf(registry.bare('view', DEFAULT_VIEW))).toBe('All Tasks (X)');
        expect(registry.bare('view', IN_PROGRESS_VIEW)).toBeDefined();
        expect(registry.bare('view', OBJ)).toBeDefined();

        await heal(null);
        expect(registry.bare('view', DEFAULT_VIEW)).toBeUndefined();
        expect(registry.bare('view', IN_PROGRESS_VIEW)).toBeUndefined();
        expect(registry.bare('view', OBJ)).toBeUndefined();
    });
});
