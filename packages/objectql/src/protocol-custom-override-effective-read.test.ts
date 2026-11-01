// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28409, ADR-0146 D8] One effective read: under the address of a name a
 * code package X ships, X's paired `<X>.custom` item that DECLARES
 * `overrides: { package: X }` is the document every read serves.
 *
 * Pinned through the real protocol over the real `ObjectQL` engine and an
 * in-memory driver (the harness of
 * `protocol-packageless-read-dependent-package.test.ts`), every package
 * installed through the package door with its dependency declared, every row
 * written through the draft save and the per-item publish:
 *
 *  - AGREEMENT (Wanted 1): one item, the five reads — the read naming no
 *    package, the read naming X, the layered read (`code` = X's document,
 *    `overlay` = the override, `effective` = the one served), the list scoped
 *    to X and the env-wide list — serve the override's columns, under X's
 *    `_packageId`;
 *  - a declaration from a package that is NOT X's pair is ignored (ruling A,
 *    #28390): every read of X's name serves X's document;
 *  - THE LIST (Wanted 2): a same-named row bound to another dependent package
 *    no longer replaces X's item in the env-wide list, while the per-package
 *    layer still holds that package's own item; a package-unbound row keeps
 *    winning over X's code item there until N-16 migrates it;
 *  - EXPORT (Wanted 4): the per-package layer the package export reads carries
 *    the overriding item with its `overrides` block for the pair, and X's own
 *    document, unchanged, for X;
 *  - ORPHANS (Wanted 5): an undeclared `.custom` row, or a dependent's row,
 *    under X's name is reported in the layered read's `overlay` with
 *    `effective` = X's document, never dropped silently;
 *  - OUTSIDE THE CLOSURE (Wanted 6): a same-named item of a package that does
 *    not depend on X is served under its own address only.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import {
    ObjectStackProtocolImplementation,
    isServedOverrideRowOf,
    resetEnvWritableMetadataTypes,
} from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.default.acme-custom';
const OUTSIDE = 'com.default.unrelated';
const VIEW = 'showcase_task.default';
const BASE_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date'];
const OVERRIDE_COLUMNS = ['title', 'due_date'];
const DEPENDENT_COLUMNS = ['title', 'status'];
const UNBOUND_COLUMNS = ['title', 'priority'];
const DECLARATION = { package: BASE, basedOn: '1.0.0' } as const;

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        bundle_member: { name: 'bundle_member', label: 'Bundle Member', type: 'text' as const, maxLength: 100 },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
                if (!(v as any).$in.includes(rowVal === undefined ? null : rowVal)) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

const listBody = (columns: readonly string[]) => ({
    name: VIEW,
    object: 'showcase_task',
    viewKind: 'list',
    label: 'All Tasks',
    config: {
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: columns.map((field) => ({ field })),
    },
});

function baseManifest(): Record<string, unknown> {
    return {
        id: BASE,
        name: 'showcase',
        version: '1.0.0',
        objects: [{
            name: 'showcase_task',
            label: 'Task',
            sharingModel: 'private',
            fields: Object.fromEntries(BASE_COLUMNS.map((f) => [f, { name: f, label: f, type: 'text' }])),
        }],
        views: [{
            object: 'showcase_task',
            list: {
                label: 'All Tasks',
                type: 'grid',
                data: { provider: 'object', object: 'showcase_task' },
                columns: BASE_COLUMNS.map((field) => ({ field })),
            },
        }],
    };
}

async function boot() {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(baseManifest());
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const rowsOf = (name: string) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'view' && r.name === name);
    return { engine, protocol, rowsOf };
}

const columnsOf = (item: any): string[] => (item?.config?.columns ?? item?.columns ?? []).map((c: any) => c?.field ?? c);

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

/** Installs a writable package through the package door, its dependencies declared. */
async function install(protocol: ObjectStackProtocolImplementation, id: string, dependsOnBase = true): Promise<void> {
    await (protocol as any).installPackage({
        manifest: {
            id, name: id.split('.').join('-'), version: '0.1.0', type: 'app',
            ...(dependsOnBase ? { dependencies: { [BASE]: '*' } } : {}),
        },
    });
}

/** A draft save naming the package, then the per-item publish naming it. */
async function saveInto(
    protocol: ObjectStackProtocolImplementation,
    packageId: string,
    columns: readonly string[],
    extra: Record<string, unknown> = {},
): Promise<void> {
    const body = { ...listBody(columns), name: VIEW, ...extra };
    await protocol.saveMetaItem({ type: 'view', name: VIEW, item: body, mode: 'draft', packageId } as any);
    await protocol.publishMetaItem({ type: 'view', name: VIEW, packageId } as any);
}

/** An active row laid down through the engine as the repository's write lays one down: package-unbound, or bound as given. */
const storeRow = (engine: ObjectQL, columns: readonly string[], packageId: string | null = null, extra: Record<string, unknown> = {}) =>
    engine.insert('sys_metadata', {
        type: 'view', name: VIEW, organization_id: null, package_id: packageId,
        metadata: JSON.stringify({ ...listBody(columns), ...extra }), state: 'active', version: 1,
    }, { context: { isSystem: true } });
const storeUnboundRow = (engine: ObjectQL, columns: readonly string[]) => storeRow(engine, columns);

const read = async (protocol: ObjectStackProtocolImplementation, packageId?: string) =>
    ((await protocol.getMetaItem({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) })) as any).item;
const layered = async (protocol: ObjectStackProtocolImplementation, packageId?: string): Promise<any> =>
    (protocol as any).getMetaItemLayered({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) });
/** The items of `VIEW` a list answers, as `[_packageId, columns]`. */
const listed = async (protocol: ObjectStackProtocolImplementation, packageId?: string) => {
    const res: any = await protocol.getMetaItems({ type: 'view', ...(packageId ? { packageId } : {}) });
    return (res.items as any[]).filter((i) => i?.name === VIEW).map((i) => [i._packageId, columnsOf(i)]);
};
/** The per-package layer the package export and the form doors' withdrawal judgement read. */
const perPackage = async (protocol: ObjectStackProtocolImplementation, packageId?: string) => {
    const res: any = await (protocol as any).getMetaItemsPerPackage({ type: 'view', ...(packageId ? { packageId } : {}) });
    return (res.items as any[]).filter((i) => i?.name === VIEW);
};

describe('[#28409] the five reads of a name X ships serve X\'s declared `.custom` override', () => {
    it('AGREEMENT: the read naming no package, the read naming X, the layered read and both lists serve the override', async () => {
        const { protocol, rowsOf } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, OVERRIDE_COLUMNS, { overrides: { ...DECLARATION } });
        expect(rowsOf(VIEW).map((r) => [r.package_id, r.state])).toEqual([[PAIR, 'active']]);
        expect(isServedOverrideRowOf(rowsOf(VIEW)[0] as any, BASE)).toBe(true);

        const packageless = await read(protocol);
        expect(columnsOf(packageless)).toEqual(OVERRIDE_COLUMNS);
        expect(packageless._packageId).toBe(BASE);
        expect(packageless.overrides).toEqual(DECLARATION);

        const named = await read(protocol, BASE);
        expect(columnsOf(named)).toEqual(OVERRIDE_COLUMNS);
        expect(named._packageId).toBe(BASE);

        for (const scope of [undefined, BASE]) {
            const layers = await layered(protocol, scope);
            expect(columnsOf(layers.code), `layered ${scope ?? '(no package)'} code`).toEqual(BASE_COLUMNS);
            expect(columnsOf(layers.overlay), `layered ${scope ?? '(no package)'} overlay`).toEqual(OVERRIDE_COLUMNS);
            expect(columnsOf(layers.effective), `layered ${scope ?? '(no package)'} effective`).toEqual(OVERRIDE_COLUMNS);
        }

        expect(await listed(protocol, BASE)).toEqual([[BASE, OVERRIDE_COLUMNS]]);
        expect(await listed(protocol)).toEqual([[BASE, OVERRIDE_COLUMNS]]);

        // The pair's own address still serves its own item.
        expect(columnsOf(await read(protocol, PAIR))).toEqual(OVERRIDE_COLUMNS);
    });

    it('a declaration from a package that is not X\'s pair is ignored: every read of X\'s name serves X\'s document', async () => {
        const { protocol } = await boot();
        await install(protocol, DEPENDENT);
        await saveInto(protocol, DEPENDENT, DEPENDENT_COLUMNS, { overrides: { ...DECLARATION } });

        expect(columnsOf(await read(protocol))).toEqual(BASE_COLUMNS);
        expect(columnsOf(await read(protocol, BASE))).toEqual(BASE_COLUMNS);
        expect(columnsOf((await layered(protocol)).effective)).toEqual(BASE_COLUMNS);
        expect(await listed(protocol, BASE)).toEqual([[BASE, BASE_COLUMNS]]);
        expect(await listed(protocol)).toEqual([[BASE, BASE_COLUMNS]]);
        // …and it stays that package's own item under its own address.
        expect(columnsOf(await read(protocol, DEPENDENT))).toEqual(DEPENDENT_COLUMNS);
    });

    it('an undeclared row of the pair is the pair\'s own item, not the override', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, OVERRIDE_COLUMNS);

        expect(columnsOf(await read(protocol))).toEqual(BASE_COLUMNS);
        expect(columnsOf(await read(protocol, BASE))).toEqual(BASE_COLUMNS);
        expect(await listed(protocol)).toEqual([[BASE, BASE_COLUMNS]]);
        expect(columnsOf(await read(protocol, PAIR))).toEqual(OVERRIDE_COLUMNS);
    });
});

describe('[#28409] the env-wide list joins the one read', () => {
    it('a dependent package\'s same-named row no longer replaces X\'s item; the per-package layer still holds it', async () => {
        const { protocol } = await boot();
        await install(protocol, DEPENDENT);
        await saveInto(protocol, DEPENDENT, DEPENDENT_COLUMNS);

        expect(await listed(protocol)).toEqual([[BASE, BASE_COLUMNS]]);
        expect(await listed(protocol, BASE)).toEqual([[BASE, BASE_COLUMNS]]);
        expect((await listed(protocol, DEPENDENT)).map(([, columns]) => columns)).toEqual([DEPENDENT_COLUMNS]);
        // The per-package layer keeps one item per package of the name (#21934).
        const layer = (await perPackage(protocol)).map((i) => columnsOf(i).join(',')).sort();
        expect(layer).toEqual([BASE_COLUMNS.join(','), DEPENDENT_COLUMNS.join(',')].sort());
    });

    it('a package-unbound row keeps winning over X\'s code item in the list, beside a dependent package\'s row', async () => {
        const { engine, protocol } = await boot();
        await install(protocol, DEPENDENT);
        await saveInto(protocol, DEPENDENT, DEPENDENT_COLUMNS);
        await storeUnboundRow(engine, UNBOUND_COLUMNS);

        expect((await listed(protocol)).map(([, columns]) => columns)).toEqual([UNBOUND_COLUMNS]);
        expect((await listed(protocol, BASE)).map(([, columns]) => columns)).toEqual([UNBOUND_COLUMNS]);
        expect(columnsOf(await read(protocol))).toEqual(UNBOUND_COLUMNS);
    });

    it('beside a package-unbound row, the declared override is served, where a save naming no package now writes', async () => {
        const { engine, protocol } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, OVERRIDE_COLUMNS, { overrides: { ...DECLARATION } });
        await storeUnboundRow(engine, UNBOUND_COLUMNS);

        // The save naming no package addresses the pair's row (the one
        // binding), so the read naming no package serves that row: serving the
        // unbound row over it would answer a save with a read it never changes.
        expect((await (protocol as any).packagelessAddress('view', VIEW)).packageId).toBe(PAIR);
        expect(columnsOf(await read(protocol))).toEqual(OVERRIDE_COLUMNS);
        expect(columnsOf(await read(protocol, BASE))).toEqual(OVERRIDE_COLUMNS);
        expect(columnsOf((await layered(protocol)).effective)).toEqual(OVERRIDE_COLUMNS);
        expect((await listed(protocol)).map(([, columns]) => columns)).toEqual([OVERRIDE_COLUMNS]);
    });
});

describe('[#28409] the export reads each package\'s own items', () => {
    it('the pair\'s layer carries the overriding item with its `overrides` block; X\'s carries X unchanged', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, OVERRIDE_COLUMNS, { overrides: { ...DECLARATION } });

        const pair = await perPackage(protocol, PAIR);
        expect(pair.map((i) => columnsOf(i))).toEqual([OVERRIDE_COLUMNS]);
        expect(pair[0].overrides).toEqual(DECLARATION);

        const base = await perPackage(protocol, BASE);
        expect(base.map((i) => columnsOf(i))).toEqual([BASE_COLUMNS]);
        expect(base[0].overrides).toBeUndefined();
    });
});

describe('[#28409] orphans of X\'s name are reported, never dropped silently', () => {
    for (const [label, owner] of [['an undeclared `.custom` row', PAIR], ['a dependent package\'s row', DEPENDENT]] as const) {
        it(`${label}: the layered read reports it in \`overlay\`, \`effective\` = X's document`, async () => {
            const { protocol } = await boot();
            await install(protocol, owner);
            await saveInto(protocol, owner, DEPENDENT_COLUMNS);

            for (const scope of [undefined, BASE]) {
                const layers = await layered(protocol, scope);
                expect(columnsOf(layers.code)).toEqual(BASE_COLUMNS);
                expect(columnsOf(layers.overlay), `layered ${scope ?? '(no package)'} overlay`).toEqual(DEPENDENT_COLUMNS);
                expect(columnsOf(layers.effective)).toEqual(BASE_COLUMNS);
            }
            expect(columnsOf(await read(protocol))).toEqual(BASE_COLUMNS);
        });
    }

    it('CONTROL: with no stored row of the name, the layered read reports no overlay', async () => {
        const { protocol } = await boot();
        const layers = await layered(protocol);
        expect(columnsOf(layers.code)).toEqual(BASE_COLUMNS);
        expect(layers.overlay).toBeNull();
    });
});

describe('[#28409] a same-named item outside X\'s closure is served under its own address only', () => {
    it('a package that does not depend on X: its row is neither served for X\'s name nor reported as X\'s orphan', async () => {
        const { engine, protocol } = await boot();
        await install(protocol, OUTSIDE, false);
        // Laid down through the engine: the publish gate refuses a view of an
        // object outside the package's closure, and a row stored before that
        // gate (or imported) is the shape the read still meets.
        await storeRow(engine, DEPENDENT_COLUMNS, OUTSIDE, { overrides: { ...DECLARATION } });

        expect(columnsOf(await read(protocol))).toEqual(BASE_COLUMNS);
        expect(columnsOf(await read(protocol, BASE))).toEqual(BASE_COLUMNS);
        expect(await listed(protocol)).toEqual([[BASE, BASE_COLUMNS]]);
        expect((await layered(protocol)).overlay).toBeNull();
        expect(columnsOf(await read(protocol, OUTSIDE))).toEqual(DEPENDENT_COLUMNS);
    });
});
