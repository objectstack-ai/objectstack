// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28238, ADR-0048 §3.3] A same-named item in a DEPENDENT package does not
 * replace the base package's item for a read that names no package.
 *
 * Measured on a booted `examples/app-showcase`: a writable package that
 * depends on the showcase saved and published `showcase_task.default` with
 * two columns. The read naming the showcase answered its own columns, the
 * read naming the dependent package its two, and the read naming NO package
 * answered the two as well, under the showcase's `_packageId`. The
 * package-less content address was the stored rows' one binding
 * ({@link packagelessAddress}), and the code package that ships the name was
 * no candidate of it, so the dependent package's row won by being the only
 * stored row.
 *
 * Pinned here, through the real protocol over the real `ObjectQL` engine and
 * an in-memory driver (the harness of `environment-overlay-five-types.test.ts`),
 * the dependent package installed through the package door with its
 * dependency declared and its row written through the draft save and the
 * per-item publish, as the card's steps wrote it:
 *
 *  - the card's three reads answer base / dependent / base, and the layered
 *    read's `effective` and the list scoped to the base agree with them;
 *  - the write address does not move: a save naming no package still
 *    addresses the dependent package's row, as {@link packagelessAddress}
 *    resolves it — and since #28410 that write is refused (ADR-0146 D2);
 *  - CONTROL: a writable package's OWN item, a name no code package ships,
 *    is still served to the read naming no package (#23291);
 *  - CONTROL: a package-unbound row (the ADR-0005 overlay Setup writes) still
 *    wins over the code package; beside the dependent package's row it is now
 *    what that read serves (the dependent package's row was, before).
 *
 * Not pinned here: the declared override, the env-wide list (which no
 * longer keeps a dependent package's slot beside the base's under a name the
 * base ships) and the layered read's orphan report — the one effective read
 * of #28409, pinned in `protocol-custom-override-effective-read.test.ts`.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const DEPENDENT = 'com.default.acme-custom';
const VIEW = 'showcase_task.default';
const BASE_COLUMNS = ['title', 'project', 'assignee', 'status', 'priority', 'due_date'];
const DEPENDENT_COLUMNS = ['title', 'status'];

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

/** Installs the dependent package through the package door, its dependency on the base declared. */
async function installDependent(protocol: ObjectStackProtocolImplementation): Promise<void> {
    await (protocol as any).installPackage({
        manifest: { id: DEPENDENT, name: 'acme-custom', version: '0.1.0', type: 'app', dependencies: { [BASE]: '*' } },
    });
}

/** The card's step 2: a draft save naming the dependent package, then the per-item publish naming it. */
async function saveIntoDependent(protocol: ObjectStackProtocolImplementation, name: string, columns: readonly string[]): Promise<void> {
    const body = { ...listBody(columns), name };
    await protocol.saveMetaItem({ type: 'view', name, item: body, mode: 'draft', packageId: DEPENDENT } as any);
    await protocol.publishMetaItem({ type: 'view', name, packageId: DEPENDENT } as any);
}

/**
 * [#28410, ADR-0146 D2, ruling A on #28390] The card's step 2 under a name the
 * base ships is refused at the save door now (a dependent package's
 * same-named item has one fix, rename), so the dependent's row the read pins
 * below meet is one stored BEFORE that gate: the door's refusal is asserted
 * first, then the same draft save and per-item publish run with the gate's
 * verdict held at `not_concerned` for that one write.
 */
async function saveIntoDependentBeforeTheGate(protocol: ObjectStackProtocolImplementation, columns: readonly string[]): Promise<void> {
    await expect(protocol.saveMetaItem({ type: 'view', name: VIEW, item: { ...listBody(columns), name: VIEW }, mode: 'draft', packageId: DEPENDENT } as any))
        .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    const gated = protocol as any;
    gated.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
    try {
        await saveIntoDependent(protocol, VIEW, columns);
    } finally {
        delete gated.overrideWriteVerdict;
    }
}

const read = async (protocol: ObjectStackProtocolImplementation, packageId?: string, name = VIEW) =>
    (await protocol.getMetaItem({ type: 'view', name, ...(packageId ? { packageId } : {}) })) as any;

describe('[#28238] a dependent package\'s row under a name the base ships is not served to the read naming no package', () => {
    it('the card\'s three steps answer base / dependent / base, and the layered read and the base\'s list agree', async () => {
        const { protocol, rowsOf } = await boot();
        await installDependent(protocol);
        await saveIntoDependentBeforeTheGate(protocol, DEPENDENT_COLUMNS);
        expect(rowsOf(VIEW).map((r) => [r.package_id, r.state])).toEqual([[DEPENDENT, 'active']]);

        expect(columnsOf((await read(protocol, BASE)).item)).toEqual(BASE_COLUMNS);
        expect(columnsOf((await read(protocol, DEPENDENT)).item)).toEqual(DEPENDENT_COLUMNS);
        const packageless = await read(protocol);
        expect(columnsOf(packageless.item)).toEqual(BASE_COLUMNS);
        expect(packageless.item._packageId).toBe(BASE);

        const layered: any = await (protocol as any).getMetaItemLayered({ type: 'view', name: VIEW });
        expect(columnsOf(layered.effective)).toEqual(BASE_COLUMNS);
        // [#28409] The dependent's row under the base's name is an orphan of
        // that name (ADR-0146 D8, N-10 Wanted 5): the layered read REPORTS it
        // as a shadowed `overlay` layer instead of dropping it silently, while
        // `effective` stays the base document the by-name read serves.
        expect(columnsOf(layered.overlay)).toEqual(DEPENDENT_COLUMNS);

        const listed: any = await protocol.getMetaItems({ type: 'view', packageId: BASE });
        expect(listed.items.filter((i: any) => i.name === VIEW).map((i: any) => columnsOf(i))).toEqual([BASE_COLUMNS]);
    });

    it('the write address does not move: a save naming no package still addresses the dependent package\'s row, which the override gate refuses', async () => {
        const { protocol, rowsOf } = await boot();
        await installDependent(protocol);
        await saveIntoDependentBeforeTheGate(protocol, DEPENDENT_COLUMNS);
        expect((await (protocol as any).packagelessAddress('view', VIEW)).packageId).toBe(DEPENDENT);

        // [#28410, ADR-0146 D2, ruling A on #28390] The save naming no package
        // resolves to the dependent package's row — the address does not move
        // — and that write is a dependent's same-named item, which the
        // override write gate refuses (rename): the refusal names the
        // dependent package, and the stored row is untouched.
        await expect(protocol.saveMetaItem({ type: 'view', name: VIEW, item: listBody(['title']) } as any))
            .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, message: expect.stringContaining(`'${DEPENDENT}'`) });

        const rows = rowsOf(VIEW).filter((r) => r.state === 'active');
        expect(rows.map((r) => r.package_id)).toEqual([DEPENDENT]);
        expect(columnsOf(JSON.parse(String(rows[0].metadata)))).toEqual(DEPENDENT_COLUMNS);
        expect(columnsOf((await read(protocol, DEPENDENT)).item)).toEqual(DEPENDENT_COLUMNS);
        expect(columnsOf((await read(protocol)).item)).toEqual(BASE_COLUMNS);
    });

    it('CONTROL: a writable package\'s own item, a name no code package ships, is still served to the read naming no package', async () => {
        const { protocol } = await boot();
        await installDependent(protocol);
        const own = 'showcase_task.acme_board';
        await saveIntoDependent(protocol, own, DEPENDENT_COLUMNS);

        const packageless = await read(protocol, undefined, own);
        expect(columnsOf(packageless.item)).toEqual(DEPENDENT_COLUMNS);
        expect(packageless.item._packageId).toBe(DEPENDENT);
    });

    /** A package-unbound active row, laid down through the engine as the repository's write lays one down. */
    const storeUnboundRow = (engine: ObjectQL, columns: readonly string[]) => engine.insert('sys_metadata', {
        type: 'view', name: VIEW, organization_id: null, package_id: null,
        metadata: JSON.stringify(listBody(columns)), state: 'active', version: 1,
    }, { context: { isSystem: true } });

    it('CONTROL: a package-unbound row still wins over the code package on the read naming no package', async () => {
        const { engine, protocol } = await boot();
        await storeUnboundRow(engine, ['title', 'priority']);

        expect(columnsOf((await read(protocol)).item)).toEqual(['title', 'priority']);
        expect(columnsOf((await read(protocol, BASE)).item)).toEqual(['title', 'priority']);
    });

    it('beside the dependent package\'s row, the package-unbound row is what the read naming no package serves', async () => {
        const { engine, protocol } = await boot();
        await installDependent(protocol);
        await saveIntoDependentBeforeTheGate(protocol, DEPENDENT_COLUMNS);
        await storeUnboundRow(engine, ['title', 'priority']);

        expect(columnsOf((await read(protocol)).item)).toEqual(['title', 'priority']);
        const layered: any = await (protocol as any).getMetaItemLayered({ type: 'view', name: VIEW });
        expect(columnsOf(layered.effective)).toEqual(['title', 'priority']);
        expect(columnsOf((await read(protocol, DEPENDENT)).item)).toEqual(DEPENDENT_COLUMNS);
    });
});
