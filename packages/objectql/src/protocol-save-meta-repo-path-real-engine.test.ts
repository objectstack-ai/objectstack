// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PR-10d.4 — Integration test for the repository write path using a REAL
 * {@link ObjectQL} engine driving a minimal in-memory driver. The PR-10d.3
 * unit suite uses a hand-rolled stub at the *engine* level; the rubber-duck
 * review flagged that as a drift risk because production semantics
 * (especially the strict `where: { id }` requirement for `engine.update`)
 * may diverge from the stub. This test wires the protocol up to the real
 * engine + a minimal driver so the production code path is exercised.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * Minimal in-memory driver covering only what `SysMetadataRepository`
 * exercises. Equality-only WHERE evaluation; one record store per object.
 */
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
        if (Array.isArray(where.$and)) return where.$and.every((w: any) => matchesWhere(row, w));
        if (Array.isArray(where.$or)) return where.$or.some((w: any) => matchesWhere(row, w));
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any))
                ? (v as any).$eq
                : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };

    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        findStream() { throw new Error('not implemented'); },
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
        async delete(object: string, id: string) {
            return storeFor(object).delete(id);
        },
        async count(object: string, ast: any) {
            return (await this.find(object, ast)).length;
        },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

function viewBody(label: string) {
    return { name: 'cases', type: 'grid', label, columns: ['id'] };
}

describe('saveMetaItem — repository write path against real ObjectQL (PR-10d.4)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject as any);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('insert → update writes the second body and bumps version (id-based update on real engine)', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x',
            item: viewBody('A'),
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x',
            item: viewBody('B'),
        });

        const rows = await engine.find('sys_metadata', {
            where: { type: 'view', organization_id: 'org_x' },
        });
        expect(rows.length).toBe(1);
        const row = rows[0] as any;
        const body = JSON.parse(row.metadata);
        expect(body.label).toBe('B');
        expect(row.version).toBe(2);
    });

    it('stale parentVersion → 409 metadata_conflict; stored body unchanged', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x',
            item: viewBody('Original'),
        });

        await expect(
            protocol.saveMetaItem({
                type: 'view', name: 'cases', organizationId: 'org_x',
                item: viewBody('Should not land'),
                parentVersion: 'sha256:stale',
            }),
        ).rejects.toMatchObject({ code: 'metadata_conflict', status: 409 });

        const rows = await engine.find('sys_metadata', {
            where: { type: 'view', organization_id: 'org_x' },
        });
        const body = JSON.parse((rows[0] as any).metadata);
        expect(body.label).toBe('Original');
    });

    it('checksum column holds the full sha256:<hex> hash (71 chars)', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x',
            item: viewBody('A'),
        });
        const rows = await engine.find('sys_metadata', {
            where: { type: 'view', organization_id: 'org_x' },
        });
        const checksum = (rows[0] as any).checksum as string;
        expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(checksum.length).toBe(71);
    });

    it('plural type "views" is normalized to singular and stored as "view"', async () => {
        await protocol.saveMetaItem({
            type: 'views', name: 'cases', organizationId: 'org_x',
            item: viewBody('Plural'),
        });
        const rows = await engine.find('sys_metadata', {
            where: { type: 'view', organization_id: 'org_x' },
        });
        expect(rows.length).toBe(1);
    });
});

describe('deleteMetaItem — repository write path against real ObjectQL (PR-10d wiring)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    const sysMetadataHistoryObject = {
        name: 'sys_metadata_history',
        label: 'Metadata History',
        fields: {
            id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
            event_seq: { name: 'event_seq', label: 'Seq', type: 'number' as const, required: true },
            type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
            name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
            version: { name: 'version', label: 'Version', type: 'number' as const, required: true },
            operation_type: { name: 'operation_type', label: 'Op', type: 'text' as const, required: true },
            metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
            checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
            previous_checksum: { name: 'previous_checksum', label: 'Prev Checksum', type: 'text' as const, maxLength: 71 },
            change_note: { name: 'change_note', label: 'Note', type: 'longtext' as const },
            source: { name: 'source', label: 'Source', type: 'text' as const },
            organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
            recorded_by: { name: 'recorded_by', label: 'By', type: 'text' as const },
            recorded_at: { name: 'recorded_at', label: 'At', type: 'datetime' as const, required: true },
        },
    };

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject as any);
        engine.registry.registerObject(sysMetadataHistoryObject as any);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('deletes the overlay row AND appends a delete tombstone to sys_metadata_history', async () => {
        const save = await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x',
            item: viewBody('A'), actor: 'alice',
        });
        expect((save as any).seq).toBe(1);

        const result = await protocol.deleteMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', actor: 'alice',
        });
        expect(result.success).toBe(true);
        expect(result.reset).toBe(true);
        expect(result.seq).toBe(2);

        // sys_metadata row gone
        const rows = await engine.find('sys_metadata', {
            where: { type: 'view', organization_id: 'org_x' },
        });
        expect(rows.length).toBe(0);

        // sys_metadata_history has a create + a delete tombstone
        const history = await engine.find('sys_metadata_history', {
            where: { type: 'view', name: 'cases', organization_id: 'org_x' },
        });
        expect(history.length).toBe(2);
        const ops = history.map((h: any) => h.operation_type).sort();
        expect(ops).toEqual(['create', 'delete']);
        const tombstone = history.find((h: any) => h.operation_type === 'delete') as any;
        expect(tombstone.metadata).toBeNull();
        expect(tombstone.checksum).toBeNull();
        expect(tombstone.previous_checksum).toMatch(/^sha256:/);
        expect(tombstone.event_seq).toBe(2);
        expect(tombstone.version).toBe(2);
        expect(tombstone.recorded_by).toBe('alice');
        expect(tombstone.source).toBe('protocol.deleteMetaItem');
    });

    it('returns reset=false (no history write) when no overlay exists', async () => {
        const result = await protocol.deleteMetaItem({
            type: 'view', name: 'never_existed', organizationId: 'org_x',
        });
        expect(result.success).toBe(true);
        expect(result.reset).toBe(false);
        expect(result.seq).toBeUndefined();

        const history = await engine.find('sys_metadata_history', {
            where: { organization_id: 'org_x' },
        });
        expect(history.length).toBe(0);
    });

    it('plural type "views" is normalized to singular for the tombstone', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'),
        });
        await protocol.deleteMetaItem({
            type: 'views', name: 'cases', organizationId: 'org_x',
        });
        const tombstone = await engine.findOne('sys_metadata_history', {
            where: { name: 'cases', operation_type: 'delete' },
        });
        expect((tombstone as any).type).toBe('view');
    });
});
