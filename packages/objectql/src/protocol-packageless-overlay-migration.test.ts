// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28413, ADR-0146 D11, N-16a] A package-less overlay row of a name a code
 * package X ships moves into X's paired `<X>.custom` as a declared override —
 * `listPackagelessOverlays` / `migratePackagelessOverlays`, the protocol half
 * of `os migrate packageless-overlays` — and, until #28576 closes the
 * package-less write, a package-less save landing on the moved row keeps its
 * declaration.
 *
 * Pinned through the real protocol over the real `ObjectQL` engine and an
 * in-memory driver (the harness of `protocol-custom-override-effective-read.test.ts`):
 *
 *  - THE MOVE: the row lands in the pair, created through the ensure door,
 *    declaring `{ package: X, basedOn: X's version }`, in its own state; the
 *    unbound row is gone; the five reads serve the same content as before; a
 *    re-run moves 0;
 *  - LEFT ALONE: a name no package ships, a name two packages ship, and a row
 *    the pair already overrides (`shadowed`), each untouched;
 *  - a stored pair declaration with no `basedOn` gains it (#28644's reading);
 *  - THE SAVE (Wanted 4): after the move, a package-less draft save and publish
 *    land on the pair's row with or without `overrides` in the body, and the
 *    item stays the declared override; a package-less DELETE removes the pair's
 *    row and X's document is served again;
 *  - ADOPT-ORPHANS (Wanted 5): adopting into a writable package skips the
 *    shipped-name row and rebinds an environment one.
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
const OTHER = 'com.example.other';
const WORKSPACE = 'com.default.workspace';
const VIEW = 'showcase_task.default';
const SHARED_VIEW = 'shared_task.default';
const ENV_VIEW = 'env_only.default';
const BASE_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date'];
const UNBOUND_COLUMNS = ['title', 'priority'];
const EDITED_COLUMNS = ['title', 'status'];
const ACTOR = 'os migrate packageless-overlays';

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
const PAGE = 'showcase_home';
const pageBody = (name: string, label: string) => ({ name, label, type: 'app', regions: [] });
const listBody = (name: string, object: string, columns: readonly string[]) => ({
    name,
    object,
    viewKind: 'list',
    label: 'All',
    config: {
        type: 'grid',
        data: { provider: 'object', object },
        columns: columns.map((field) => ({ field })),
    },
});

const objectOf = (name: string, fields: readonly string[]) => ({
    name,
    label: name,
    sharingModel: 'private',
    fields: Object.fromEntries(fields.map((f) => [f, { name: f, label: f, type: 'text' }])),
});
const listView = (object: string, columns: readonly string[]) => ({
    object,
    list: { label: 'All', type: 'grid', data: { provider: 'object', object }, columns: columns.map((field) => ({ field })) },
});

async function boot() {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    // X ships `showcase_task.default` and `shared_task.default`; another code
    // package ships `shared_task.default` too (a name two packages ship).
    engine.registerApp({
        id: BASE, name: 'showcase', version: '1.2.0', namespace: 'showcase',
        objects: [objectOf('showcase_task', BASE_COLUMNS), objectOf('shared_task', BASE_COLUMNS)],
        views: [listView('showcase_task', BASE_COLUMNS), listView('shared_task', BASE_COLUMNS)],
    });
    engine.registerApp({
        id: OTHER, name: 'other', version: '2.0.0', namespace: 'other',
        views: [listView('shared_task', BASE_COLUMNS)],
    });
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const rows = (name: string) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'view' && r.name === name)
        .map((r) => [r.package_id ?? null, r.state] as const);
    const rowOf = (name: string, packageId: string | null, state = 'active') =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .find((r) => r.type === 'view' && r.name === name && (r.package_id ?? null) === packageId && r.state === state);
    return { engine, protocol, rows, rowOf, stores };
}

/** A row laid down through the engine as an older release stored it. */
const storeRow = (
    engine: ObjectQL,
    name: string,
    object: string,
    columns: readonly string[],
    packageId: string | null = null,
    state = 'active',
    extra: Record<string, unknown> = {},
) => engine.insert('sys_metadata', {
    type: 'view', name, organization_id: null, package_id: packageId,
    metadata: JSON.stringify({ ...listBody(name, object, columns), ...extra }), state, version: 1,
}, { context: { isSystem: true } });

const columnsOf = (item: any): string[] => (item?.config?.columns ?? item?.columns ?? []).map((c: any) => c?.field ?? c);
const read = async (protocol: ObjectStackProtocolImplementation, packageId?: string) =>
    ((await protocol.getMetaItem({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) })) as any).item;
const layered = async (protocol: ObjectStackProtocolImplementation, packageId?: string): Promise<any> =>
    (protocol as any).getMetaItemLayered({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) });
const listed = async (protocol: ObjectStackProtocolImplementation, packageId?: string) => {
    const res: any = await protocol.getMetaItems({ type: 'view', ...(packageId ? { packageId } : {}) });
    return (res.items as any[]).filter((i) => i?.name === VIEW).map((i) => columnsOf(i));
};
/** The five reads of `VIEW` (N-10): no package, naming X, layered effective, X's list, env-wide list. */
const fiveReads = async (protocol: ObjectStackProtocolImplementation) => [
    columnsOf(await read(protocol)),
    columnsOf(await read(protocol, BASE)),
    columnsOf((await layered(protocol)).effective),
    ...(await listed(protocol, BASE)),
    ...(await listed(protocol)),
];

const census = (protocol: ObjectStackProtocolImplementation): Promise<any> => (protocol as any).listPackagelessOverlays();
const migrate = (protocol: ObjectStackProtocolImplementation): Promise<any> =>
    (protocol as any).migratePackagelessOverlays({ actor: ACTOR });
const dispositions = (c: any) => (c.rows as any[]).map((r) => `${r.name}@${r.state} ${r.disposition}`);

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

describe('[#28413] the census and the move', () => {
    it('THE MOVE: the row lands in the pair as the declared override, the unbound row goes, the five reads serve the same content, a re-run moves 0', async () => {
        const { engine, protocol, rows, rowOf } = await boot();
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS);
        await storeRow(engine, VIEW, 'showcase_task', EDITED_COLUMNS, null, 'draft');
        const before = await fiveReads(protocol);
        expect(before).toEqual([UNBOUND_COLUMNS, UNBOUND_COLUMNS, UNBOUND_COLUMNS, UNBOUND_COLUMNS, UNBOUND_COLUMNS]);
        expect(dispositions(await census(protocol))).toEqual([`${VIEW}@active movable`, `${VIEW}@draft movable`]);
        expect((engine.registry as any).getPackage(PAIR)).toBeUndefined();

        const result = await migrate(protocol);
        expect(result.outcomes.map((o: any) => o.outcome)).toEqual(['moved', 'moved']);
        expect(result.bases).toEqual([{ base: BASE, pair: PAIR, pairCreated: true, moved: 2, declarationsCompleted: 0, failed: 0, shadowed: 0 }]);
        // The pair came through the ensure door: installed, with the pair namespace.
        expect((engine.registry as any).getPackage(PAIR)?.manifest?.namespace).toBe('showcase_custom');
        expect(rows(VIEW).slice().sort()).toEqual([[PAIR, 'active'], [PAIR, 'draft']]);
        for (const state of ['active', 'draft']) {
            const moved = rowOf(VIEW, PAIR, state)!;
            expect(isServedOverrideRowOf(moved as any, BASE), state).toBe(true);
            expect(JSON.parse(String(moved.metadata)).overrides).toEqual({ package: BASE, basedOn: '1.2.0' });
        }
        expect(columnsOf(JSON.parse(String(rowOf(VIEW, PAIR, 'draft')!.metadata)))).toEqual(EDITED_COLUMNS);

        expect(await fiveReads(protocol)).toEqual(before);

        const again = await migrate(protocol);
        expect(again.outcomes).toEqual([]);
        expect(again.rows).toEqual([]);
        expect(rows(VIEW).slice().sort()).toEqual([[PAIR, 'active'], [PAIR, 'draft']]);
    });

    it('LEFT ALONE: a name no package ships, a name two packages ship, and a row the pair already overrides', async () => {
        const { engine, protocol, rows } = await boot();
        await (protocol as any).ensureCustomizationPackage({ basePackageId: BASE });
        // A Studio customization made first (N-17): the pair's declared row.
        await storeRow(engine, VIEW, 'showcase_task', EDITED_COLUMNS, PAIR, 'active', { overrides: { package: BASE, basedOn: '1.0.0' } });
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS);
        // …and a Setup DRAFT of the same name: the pair's override is per
        // name, so a draft beside its ACTIVE override is shadowed too — moved
        // in as the pair's draft, its publish would replace the Studio
        // customization (the merge Wanted 2 forbids).
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS, null, 'draft');
        await storeRow(engine, SHARED_VIEW, 'shared_task', UNBOUND_COLUMNS);
        await storeRow(engine, ENV_VIEW, 'showcase_task', UNBOUND_COLUMNS);

        const listedCensus = await census(protocol);
        expect(dispositions(listedCensus)).toEqual([
            `${SHARED_VIEW}@active multi_shipped`, `${VIEW}@active shadowed`, `${VIEW}@draft shadowed`,
        ]);
        expect(listedCensus.rows.find((r: any) => r.disposition === 'multi_shipped').shippers).toEqual([OTHER, BASE]);
        expect(listedCensus.rows.filter((r: any) => r.disposition === 'shadowed').map((r: any) => r.shadowDeclares)).toEqual([true, true]);
        expect(listedCensus.environmentRows).toBe(1);

        const result = await migrate(protocol);
        expect(result.outcomes).toEqual([]);
        expect(result.bases).toEqual([{ base: BASE, pair: PAIR, pairCreated: false, moved: 0, declarationsCompleted: 0, failed: 0, shadowed: 2 }]);
        expect(rows(VIEW).slice().sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([[PAIR, 'active'], [null, 'active'], [null, 'draft']]);
        expect(rows(SHARED_VIEW)).toEqual([[null, 'active']]);
        expect(rows(ENV_VIEW)).toEqual([[null, 'active']]);
        // The pair's declared row is still the one served.
        expect(columnsOf(await read(protocol))).toEqual(EDITED_COLUMNS);
    });

    it('READ BACK FIRST: a save that leaves no declared row in the pair keeps the unbound row, and the row is reported failed', async () => {
        const { engine, protocol, rows } = await boot();
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS);
        // A save door that answers and writes nothing.
        (protocol as any).saveMetaItem = async () => ({ success: true });
        const result = await migrate(protocol);
        expect(result.outcomes.map((o: any) => o.outcome)).toEqual(['failed']);
        expect(result.outcomes[0].error).toContain('does not read back as the declared override');
        expect(rows(VIEW)).toEqual([[null, 'active']]);
        expect(result.bases[0]).toMatchObject({ moved: 0, failed: 1 });
    });

    it('a stored pair declaration with no basedOn gains the base\'s version', async () => {
        const { engine, protocol, rowOf } = await boot();
        await (protocol as any).ensureCustomizationPackage({ basePackageId: BASE });
        await storeRow(engine, VIEW, 'showcase_task', EDITED_COLUMNS, PAIR, 'active', { overrides: { package: BASE } });
        const listedCensus = await census(protocol);
        expect(listedCensus.incompleteDeclarations.map((d: any) => [d.name, d.pair, d.base])).toEqual([[VIEW, PAIR, BASE]]);

        const result = await migrate(protocol);
        expect(result.outcomes.map((o: any) => [o.outcome, o.basedOn])).toEqual([['declaration_completed', '1.2.0']]);
        expect(JSON.parse(String(rowOf(VIEW, PAIR)!.metadata)).overrides).toEqual({ package: BASE, basedOn: '1.2.0' });
        expect(columnsOf(await read(protocol))).toEqual(EDITED_COLUMNS);
        expect((await census(protocol)).incompleteDeclarations).toEqual([]);
    });

    it('…on every overridable type, not only the five overlay types (a page)', async () => {
        const { engine, protocol, stores } = await boot();
        engine.registerApp({ id: BASE, name: 'showcase', version: '1.2.0', namespace: 'showcase', pages: [pageBody(PAGE, 'Home')] } as any);
        await (protocol as any).ensureCustomizationPackage({ basePackageId: BASE });
        await engine.insert('sys_metadata', {
            type: 'page', name: PAGE, organization_id: null, package_id: PAIR,
            metadata: JSON.stringify({ ...pageBody(PAGE, 'Edited home'), overrides: { package: BASE } }), state: 'active', version: 1,
        }, { context: { isSystem: true } });
        const pageRow = () => Array.from(stores.get('sys_metadata')?.values() ?? [])
            .find((r) => r.type === 'page' && r.name === PAGE && r.package_id === PAIR && r.state === 'active');

        expect((await census(protocol)).incompleteDeclarations.map((d: any) => [d.type, d.name, d.pair])).toEqual([['page', PAGE, PAIR]]);
        const result = await migrate(protocol);
        expect(result.outcomes.map((o: any) => [o.outcome, o.basedOn, o.error])).toEqual([['declaration_completed', '1.2.0', undefined]]);
        const body = JSON.parse(String(pageRow()!.metadata));
        expect(body.overrides).toEqual({ package: BASE, basedOn: '1.2.0' });
        expect(body.label).toBe('Edited home');
    });
});

/**
 * The state the move leaves, laid down without the ceremony (so these cases
 * read the save door alone): the pair ensured through its door, and the
 * item's row bound to it, declaring the override.
 */
async function movedState(engine: ObjectQL, protocol: ObjectStackProtocolImplementation): Promise<void> {
    await (protocol as any).ensureCustomizationPackage({ basePackageId: BASE });
    await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS, PAIR, 'active', { overrides: { package: BASE, basedOn: '1.2.0' } });
}

describe('[#28413] until #28576: a package-less save of a moved item keeps its declaration', () => {
    for (const withOverrides of [false, true]) {
        it(`a package-less draft save and publish ${withOverrides ? 'carrying' : 'without'} \`overrides\` land on the pair's row, still the declared override`, async () => {
            const { engine, protocol, rows, rowOf } = await boot();
            await movedState(engine, protocol);
            // Setup's form save: the item as the editor read it, naming no package.
            const served = await read(protocol);
            const body: Record<string, unknown> = { ...listBody(VIEW, 'showcase_task', EDITED_COLUMNS) };
            if (withOverrides) body.overrides = served.overrides;
            await protocol.saveMetaItem({ type: 'view', name: VIEW, item: body, mode: 'draft' } as any);
            await protocol.publishMetaItem({ type: 'view', name: VIEW } as any);

            expect(rows(VIEW)).toEqual([[PAIR, 'active']]);
            expect(isServedOverrideRowOf(rowOf(VIEW, PAIR) as any, BASE)).toBe(true);
            expect(JSON.parse(String(rowOf(VIEW, PAIR)!.metadata)).overrides).toEqual({ package: BASE, basedOn: '1.2.0' });
            expect(await fiveReads(protocol)).toEqual([EDITED_COLUMNS, EDITED_COLUMNS, EDITED_COLUMNS, EDITED_COLUMNS, EDITED_COLUMNS]);

            // …and a publish-mode save naming no package, the other spelling of the same write.
            await protocol.saveMetaItem({ type: 'view', name: VIEW, item: { ...listBody(VIEW, 'showcase_task', UNBOUND_COLUMNS) } } as any);
            expect(rows(VIEW)).toEqual([[PAIR, 'active']]);
            expect(isServedOverrideRowOf(rowOf(VIEW, PAIR) as any, BASE)).toBe(true);
            expect(columnsOf(await read(protocol))).toEqual(UNBOUND_COLUMNS);
        });
    }

    it('a package-less DELETE removes the pair\'s row and X\'s document is served again', async () => {
        const { engine, protocol, rows } = await boot();
        await movedState(engine, protocol);
        await protocol.deleteMetaItem({ type: 'view', name: VIEW } as any);
        expect(rows(VIEW)).toEqual([]);
        expect(await fiveReads(protocol)).toEqual([BASE_COLUMNS, BASE_COLUMNS, BASE_COLUMNS, BASE_COLUMNS, BASE_COLUMNS]);
    });

    it('CONTROL: a package-less save carrying `overrides` over an unmoved package-less row is still refused (the pair is not its address)', async () => {
        const { engine, protocol } = await boot();
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS);
        await expect(protocol.saveMetaItem({
            type: 'view', name: VIEW, mode: 'draft',
            item: { ...listBody(VIEW, 'showcase_task', EDITED_COLUMNS), overrides: { package: BASE, basedOn: '1.2.0' } },
        } as any)).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    });
});

describe('[#28413] adopt-orphans leaves a shipped name to the ceremony', () => {
    it('adopting into a writable package skips the shipped-name row and rebinds an environment one', async () => {
        const { engine, protocol, rows } = await boot();
        await (protocol as any).installPackage({ manifest: { id: WORKSPACE, name: 'workspace', version: '0.1.0', type: 'app' } });
        await storeRow(engine, VIEW, 'showcase_task', UNBOUND_COLUMNS);
        await storeRow(engine, ENV_VIEW, 'showcase_task', UNBOUND_COLUMNS);
        const result = await (protocol as any).reassignOrphanedMetadata({ targetPackageId: WORKSPACE });
        expect(result.reassigned).toEqual([{ type: 'view', name: ENV_VIEW }]);
        expect(rows(VIEW)).toEqual([[null, 'active']]);
        expect(rows(ENV_VIEW)).toEqual([[WORKSPACE, 'active']]);
    });
});
