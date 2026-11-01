// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28412, ADR-0146 D9 item 1] A flow a code package X ships, overridden by X's
 * paired `<X>.custom` declaring `overrides: { package: X }`, IS the packaged
 * flow: the save door admits the declared save (N-09's write gate, opened for
 * `flow`), the per-item publish promotes it, and every read of X's flow name
 * serves it under X's provenance — the read naming no package, the read naming
 * X, the layered read (`code` = X's flow, `effective` = the override), the
 * served list and the execution view the automation engine arms from.
 *
 * Every other stored row of the name stays declined (#20946): a dependent
 * package's declaration is refused at the save door and, laid down before the
 * gate, is never served; the pair's UNDECLARED row is refused with a remedy
 * that names the declaration, not a clone. Deleting the override serves X's
 * flow again.
 *
 * The harness is `protocol-custom-override-effective-read.test.ts`'s (#28409):
 * the real protocol over the real `ObjectQL` engine and an in-memory driver,
 * every package installed through the package door. The protocol is
 * `@objectstack/metadata-protocol`'s `dist/`, so a change there is read here
 * after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import {
    ObjectStackProtocolImplementation,
    isServedOverrideRowOf,
    resetEnvWritableMetadataTypes,
    storedRowBindingOf,
} from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.default.acme-custom';
const FLOW = 'showcase_task_escalate';
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

const flowBody = (label: string, extra: Record<string, unknown> = {}) => ({
    name: FLOW,
    label,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
});

function baseManifest(): Record<string, unknown> {
    return {
        id: BASE,
        name: 'showcase',
        version: '1.0.0',
        namespace: 'showcase',
        objects: [{
            name: 'showcase_task',
            label: 'Task',
            sharingModel: 'private',
            fields: { title: { name: 'title', label: 'title', type: 'text' } },
        }],
        flows: [flowBody('SHIPPED')],
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
    const rows = () => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'flow' && r.name === FLOW);
    return { engine, protocol, rows };
}

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

async function install(protocol: ObjectStackProtocolImplementation, id: string): Promise<void> {
    await (protocol as any).installPackage({
        manifest: {
            id, name: id.split('.').join('-'), version: '0.1.0', type: 'app',
            ...(id === PAIR
                ? { namespace: 'showcase_custom', dependencies: { [BASE]: '^1' } }
                : { dependencies: { [BASE]: '*' } }),
        },
    });
}

/** A draft save naming the package, then the per-item publish naming it. */
async function saveInto(protocol: ObjectStackProtocolImplementation, packageId: string, label: string, extra: Record<string, unknown> = {}) {
    await protocol.saveMetaItem({ type: 'flow', name: FLOW, item: flowBody(label, extra), mode: 'draft', packageId } as any);
    await protocol.publishMetaItem({ type: 'flow', name: FLOW, packageId } as any);
}

const read = async (protocol: ObjectStackProtocolImplementation, packageId?: string) =>
    ((await protocol.getMetaItem({ type: 'flow', name: FLOW, ...(packageId ? { packageId } : {}) })) as any).item;
const layered = async (protocol: ObjectStackProtocolImplementation, packageId?: string): Promise<any> =>
    (protocol as any).getMetaItemLayered({ type: 'flow', name: FLOW, ...(packageId ? { packageId } : {}) });
const listed = async (protocol: ObjectStackProtocolImplementation, face: 'served' | 'execution') => {
    const res: any = face === 'served'
        ? await protocol.getMetaItems({ type: 'flow' })
        : await (protocol as any).getMetaItemsForExecution({ type: 'flow' });
    return (res.items as any[]).filter((i) => i?.name === FLOW).map((i) => [i._packageId, i.label]);
};

describe('[#28412] a declared .custom flow override is the packaged flow, at every door', () => {
    it('the save door admits the declared save, the publish promotes it, and every read serves it under X', async () => {
        const { protocol, engine, rows } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, 'OVERRIDE', { overrides: { ...DECLARATION } });
        expect(rows().map((r) => [r.package_id, r.state])).toEqual([[PAIR, 'active']]);
        expect(isServedOverrideRowOf(rows()[0] as any, BASE)).toBe(true);

        for (const scope of [undefined, BASE]) {
            const item = await read(protocol, scope);
            expect(item.label, `by-name ${scope ?? '(no package)'}`).toBe('OVERRIDE');
            expect(item._packageId).toBe(BASE);
            expect(item.overrides).toEqual(DECLARATION);
            const layers = await layered(protocol, scope);
            expect(layers.code.label, `layered ${scope ?? '(no package)'} code`).toBe('SHIPPED');
            expect(layers.effective.label, `layered ${scope ?? '(no package)'} effective`).toBe('OVERRIDE');
        }
        expect(await listed(protocol, 'served')).toEqual([[BASE, 'OVERRIDE']]);
        expect(await listed(protocol, 'execution')).toEqual([[BASE, 'OVERRIDE']]);

        // What the automation boot pull reads: the registry's hydrated copy
        // carries the row's own `package_id`, the binding precedence judges.
        const hydrated = (engine.registry.listItems('flow') as any[]).filter((i) => i?.name === FLOW);
        expect(hydrated.map((i) => storedRowBindingOf(i))).toContain(PAIR);
    });

    it('a dependent package\'s declaration is refused at the save door, and laid down before the gate is never served', async () => {
        const { protocol, engine, rows } = await boot();
        await install(protocol, DEPENDENT);
        await expect(protocol.saveMetaItem({
            type: 'flow', name: FLOW, item: flowBody('DEPENDENT', { overrides: { ...DECLARATION } }), mode: 'draft', packageId: DEPENDENT,
        } as any)).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        // Laid down as one stored before the gate, by the store's own write.
        await engine.insert('sys_metadata', {
            type: 'flow', name: FLOW, organization_id: null, package_id: DEPENDENT,
            metadata: JSON.stringify(flowBody('DEPENDENT', { overrides: { ...DECLARATION } })), state: 'active', version: 1,
        }, { context: { isSystem: true } });
        expect(rows().map((r) => r.package_id)).toEqual([DEPENDENT]);
        expect((await read(protocol)).label).toBe('SHIPPED');
        expect((await read(protocol, BASE)).label).toBe('SHIPPED');
        expect(await listed(protocol, 'execution')).toEqual([[BASE, 'SHIPPED']]);
    });

    it('the pair\'s undeclared save is refused, and the remedy names the declaration, never a clone', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        const refusal = await protocol.saveMetaItem({
            type: 'flow', name: FLOW, item: flowBody('UNDECLARED'), mode: 'draft', packageId: PAIR,
        } as any).then(() => undefined, (e: Error) => e);
        expect(refusal).toMatchObject({ status: 403 });
        expect(refusal!.message).toMatch(/[Dd]eclare/);
        expect(refusal!.message).not.toMatch(/clone/i);
        expect(refusal!.message).not.toMatch(/not yet available/);
    });

    it('deleting the override serves X\'s flow again', async () => {
        const { protocol, rows } = await boot();
        await install(protocol, PAIR);
        await saveInto(protocol, PAIR, 'OVERRIDE', { overrides: { ...DECLARATION } });
        expect(await listed(protocol, 'execution')).toEqual([[BASE, 'OVERRIDE']]);
        await protocol.deleteMetaItem({ type: 'flow', name: FLOW, packageId: PAIR } as any);
        expect(rows().filter((r) => r.state === 'active')).toEqual([]);
        expect((await read(protocol)).label).toBe('SHIPPED');
        expect(await listed(protocol, 'execution')).toEqual([[BASE, 'SHIPPED']]);
    });
});
