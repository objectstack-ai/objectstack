// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3770 — the data path did NOT 404 for unknown objects.
 *
 * `enforceApiAccess` (rest-server) passes an object it cannot find in metadata
 * straight through, and the comment there justified that with "let the data
 * path 404". That premise was false:
 *
 *   ① `findData` had no existence check — the only `OBJECT_NOT_FOUND` in the
 *      repo was thrown by `cloneData`.
 *   ② the engine does not reject unregistered names: `resolveObjectName` falls
 *      back to `StorageNameMapping.resolveTableName({ name })`, i.e. the object
 *      name IS used as the table name.
 *   ③ the 404 was therefore only ever a side effect of the DRIVER erroring on a
 *      missing table, recognised by string-matching that error in the REST layer.
 *
 * So the gap was case B below: when a physical table with that name exists but
 * the object is not registered — out-of-band DDL, a registration that failed
 * after `syncObjectSchema` ran, a registration race — the exposure gate was
 * silently skipped AND nothing turned it into a 404. The rows were served.
 *
 * These tests drive a REAL {@link ObjectQL} engine + a minimal stub driver
 * (the same shape `protocol-clone-real-engine.test.ts` uses), because the point
 * is precisely what happens when metadata and physical storage disagree — which
 * an engine double cannot show.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const registeredObject = {
    name: 'gate_account',
    label: 'Account',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    },
};

/** The object nobody registered. A table by this name exists anyway (case B). */
const UNREGISTERED = 'gate_ghost';

function makeStubDriver() {
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
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
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
        async aggregate(object: string, ast: any) {
            return [{ count: (await this.find(object, ast)).length }];
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

const OBJECT_NOT_FOUND = { code: 'OBJECT_NOT_FOUND', status: 404 };

describe('#3770 — data-plane object-existence gate (real ObjectQL engine)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let stores: Map<string, Map<string, Record<string, unknown>>>;

    beforeEach(async () => {
        engine = new ObjectQL();
        const made = makeStubDriver();
        stores = made.stores;
        engine.registerDriver(made.driver, true);
        await engine.init();
        engine.registry.registerObject(registeredObject);
        protocol = new ObjectStackProtocolImplementation(engine);

        // Case B setup: a physical table exists under the unregistered name,
        // holding a row no API caller should ever see.
        const ghost = new Map<string, Record<string, unknown>>();
        ghost.set('r1', { id: 'r1', secret: 'classified' });
        stores.set(UNREGISTERED, ghost);
    });

    // ─────────────────────────────────────────────────────────────
    // The gap the issue reported
    // ─────────────────────────────────────────────────────────────

    it('case B — an unregistered object whose physical table EXISTS is 404, not served', async () => {
        // Pre-#3770 this resolved and returned `{ id: 'r1', secret: 'classified' }`.
        await expect(
            protocol.findData({ object: UNREGISTERED }),
        ).rejects.toMatchObject(OBJECT_NOT_FOUND);

        // And the row really is reachable through the engine — i.e. the test
        // fails for the right reason (the gate), not because storage was empty.
        expect(await engine.find(UNREGISTERED, {})).toHaveLength(1);
    });

    it('case A — an unregistered object with no physical table is 404 from the gate, not the driver', async () => {
        stores.delete(UNREGISTERED);
        await expect(
            protocol.findData({ object: 'gate_nothing_at_all' }),
        ).rejects.toMatchObject(OBJECT_NOT_FOUND);
    });

    it('404s before the query is parsed — an unknown object cannot be probed for query-shape validity', async () => {
        // A bad `$` param on a KNOWN object is a 400 (#2926 ⑩); on an unknown
        // one the answer must stay 404 so the two are indistinguishable.
        await expect(
            protocol.findData({ object: 'gate_account', query: { $nope: '1' } }),
        ).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_QUERY_PARAM' });
        await expect(
            protocol.findData({ object: UNREGISTERED, query: { $nope: '1' } }),
        ).rejects.toMatchObject(OBJECT_NOT_FOUND);
    });

    // ─────────────────────────────────────────────────────────────
    // Every data entry point, not just the read one
    // ─────────────────────────────────────────────────────────────

    it('rejects every data entry point for an unregistered object', async () => {
        const calls: Array<[string, () => Promise<unknown>]> = [
            ['findData', () => protocol.findData({ object: UNREGISTERED })],
            ['getData', () => protocol.getData({ object: UNREGISTERED, id: 'r1' })],
            ['createData', () => protocol.createData({ object: UNREGISTERED, data: { secret: 'x' } })],
            ['cloneData', () => protocol.cloneData({ object: UNREGISTERED, id: 'r1' })],
            ['updateData', () => protocol.updateData({ object: UNREGISTERED, id: 'r1', data: { secret: 'x' } })],
            ['deleteData', () => protocol.deleteData({ object: UNREGISTERED, id: 'r1' })],
            ['createManyData', () => protocol.createManyData({ object: UNREGISTERED, records: [{ secret: 'x' }] })],
            ['insertManyData', () => protocol.insertManyData({ object: UNREGISTERED, records: [{ secret: 'x' }] })],
            ['updateManyData', () => protocol.updateManyData({ object: UNREGISTERED, records: [{ id: 'r1', data: {} }] } as any)],
            ['deleteManyData', () => protocol.deleteManyData({ object: UNREGISTERED, ids: ['r1'] } as any)],
            ['batchData', () => protocol.batchData({ object: UNREGISTERED, request: { operation: 'create', records: [{ data: {} }] } as any })],
            // `analyticsQuery` is gone from this list because the method itself
            // was retired with the degraded analytics shim (#3891) — the
            // analytics-side twin of this gate lives in service-analytics'
            // `ensureCube` (#3867/#3875).
        ];
        for (const [name, call] of calls) {
            await expect(call(), `${name} must reject`).rejects.toMatchObject(OBJECT_NOT_FOUND);
        }
        // Nothing was written to, or removed from, the ghost table.
        expect(Array.from(stores.get(UNREGISTERED)!.values())).toEqual([{ id: 'r1', secret: 'classified' }]);
    });

    // ─────────────────────────────────────────────────────────────
    // No regression for registered objects
    // ─────────────────────────────────────────────────────────────

    it('leaves registered objects working end to end', async () => {
        const created = await protocol.createData({ object: 'gate_account', data: { name: 'Acme' } });
        expect(created.record.name).toBe('Acme');

        const listed = await protocol.findData({ object: 'gate_account' });
        expect(listed.records).toHaveLength(1);

        const got = await protocol.getData({ object: 'gate_account', id: created.id });
        expect(got.record.name).toBe('Acme');

        await protocol.updateData({ object: 'gate_account', id: created.id, data: { name: 'Acme 2' } });
        expect((await protocol.getData({ object: 'gate_account', id: created.id })).record.name).toBe('Acme 2');

        await protocol.deleteData({ object: 'gate_account', id: created.id });
        expect((await protocol.findData({ object: 'gate_account' })).records).toHaveLength(0);
    });

    it('still reports RECORD_NOT_FOUND (not OBJECT_NOT_FOUND) for a missing row on a registered object', async () => {
        await expect(
            protocol.getData({ object: 'gate_account', id: 'nope' }),
        ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
    });
});
