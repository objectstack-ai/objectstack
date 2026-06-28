// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integration test for `protocol.cloneData` driving a REAL {@link ObjectQL}
 * engine + a minimal in-memory driver. The unit suite in
 * `protocol-data.test.ts` stubs the engine; this exercises the production
 * path — registry.getObject (enable.clone + field defs), engine.findOne for
 * the source, and engine.insert for the copy — so the strongest real-engine
 * signal (autonumber regeneration on the cloned row) is actually verified.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

// A clonable object: business fields + an engine-generated autonumber that
// must be re-issued (not copied) on the clone.
const accountObject = {
    name: 'clone_account',
    label: 'Account',
    // enable block omitted on purpose → clone is default-on.
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        amount: { name: 'amount', label: 'Amount', type: 'number' as const },
        ref: { name: 'ref', label: 'Ref', type: 'autonumber' as const, autonumberFormat: 'ACC-{0000}' },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const, system: true },
    },
};

// A non-clonable object: enable.clone explicitly false.
const lockedObject = {
    name: 'clone_locked',
    label: 'Locked',
    enable: { clone: false },
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
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
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any, // no native autonumber → engine uses its counter
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
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
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

describe('cloneData — real ObjectQL engine', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(accountObject as any);
        engine.registry.registerObject(lockedObject as any);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('produces a new row with a regenerated autonumber and copied business fields', async () => {
        const created = await protocol.createData({
            object: 'clone_account',
            data: { name: 'Acme', amount: 100, organization_id: 'org_1' },
        });
        const sourceId = created.id;
        const sourceRef = created.record.ref;
        expect(sourceRef).toBe('ACC-0001');

        const cloned = await protocol.cloneData({ object: 'clone_account', id: sourceId });

        // Distinct identity.
        expect(cloned.id).not.toBe(sourceId);
        expect(cloned.sourceId).toBe(sourceId);
        // Business fields carried over.
        expect(cloned.record.name).toBe('Acme');
        expect(cloned.record.amount).toBe(100);
        // Autonumber re-issued by the engine, not copied.
        expect(cloned.record.ref).toBe('ACC-0002');

        // Both rows persist independently.
        const all = await engine.find('clone_account', {});
        expect(all.length).toBe(2);
    });

    it('applies caller overrides over the copied values', async () => {
        const created = await protocol.createData({
            object: 'clone_account',
            data: { name: 'Acme', amount: 100 },
        });
        const cloned = await protocol.cloneData({
            object: 'clone_account',
            id: created.id,
            overrides: { name: 'Acme (Copy)' },
        });
        expect(cloned.record.name).toBe('Acme (Copy)');
        expect(cloned.record.amount).toBe(100);
    });

    it('rejects with 403 CLONE_DISABLED when enable.clone === false', async () => {
        const created = await protocol.createData({
            object: 'clone_locked',
            data: { name: 'Immutable' },
        });
        await expect(
            protocol.cloneData({ object: 'clone_locked', id: created.id }),
        ).rejects.toMatchObject({ code: 'CLONE_DISABLED', status: 403 });
        // No second row written.
        expect((await engine.find('clone_locked', {})).length).toBe(1);
    });

    it('rejects with 404 when the source record does not exist', async () => {
        await expect(
            protocol.cloneData({ object: 'clone_account', id: 'does-not-exist' }),
        ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
    });
});
