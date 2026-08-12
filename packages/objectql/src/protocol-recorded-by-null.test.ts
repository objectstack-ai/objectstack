// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4556 — an actor-less metadata write stores NULL in
 * `sys_metadata_history.recorded_by`, against a REAL {@link ObjectQL} engine.
 *
 * The repository unit suite can only prove the repository forwards what it
 * is given. The sentinel was born one layer up: the protocol filled
 * `actor: request.actor ?? 'system'` on five write paths, so every metadata
 * write with no caller actor — boot sync, migration, an unauthenticated
 * internal call — put the STRING `'system'` into a column declared
 * `Field.lookup('sys_user')`. This suite drives the protocol methods a real
 * caller drives and reads the row that actually landed.
 *
 * `recorded_by` is declared here as the real thing — a `readonly` lookup to
 * `sys_user` — rather than the `text` stub the older repo-path suite uses,
 * because that is what makes the second half of the file meaningful: #4441
 * had to exempt `readonly` fields from the write-path referential-integrity
 * check precisely because this column held a value no `sys_user` row
 * matched. With the sentinel gone the ordinary authoring paths must still
 * pass — that is the regression #4441 was bitten by.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const sysUserObject = {
    name: 'sys_user',
    label: 'User',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const },
    },
};

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
        // The real declaration, not a `text` stand-in — see the file header.
        recorded_by: {
            name: 'recorded_by', label: 'Recorded By',
            type: 'lookup' as const, referenceTo: 'sys_user', readonly: true,
        },
        recorded_at: { name: 'recorded_at', label: 'At', type: 'datetime' as const, required: true },
    },
};

/** Minimal stub driver; equality-only WHERE. */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;

    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them. The short-circuiting shape this stub used to carry
    // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
    // the same object, so a query like
    // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
    // was silently answered on the `$or` alone — a different query than the one
    // written, with the suite still green. See #7620.
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
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
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
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

const viewBody = (label: string) => ({ name: 'cases', type: 'grid', label, columns: ['id'], object: 'case', viewKind: 'list' }); // [#7741] the inline arm requires the object binding pair

describe('#4556 — protocol write paths store NULL, not the sentinel string', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    const historyRows = async () =>
        (await engine.find('sys_metadata_history', { where: { organization_id: 'org_x' } })) as any[];

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysUserObject);
        engine.registry.registerObject(sysMetadataObject);
        engine.registry.registerObject(sysMetadataHistoryObject);
        await engine.insert('sys_user', { id: 'usr_alice', name: 'Alice' }, { context: { isSystem: true } } as any);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('saveMetaItem with NO actor lands recorded_by = NULL', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'),
        });

        const rows = await historyRows();
        expect(rows).toHaveLength(1);
        // The whole issue in one assertion: the column is a lookup('sys_user'),
        // so 'system' was a foreign key pointing at nothing.
        expect(rows[0].recorded_by ?? null).toBeNull();
        expect(rows[0].recorded_by).not.toBe('system');
    });

    it('saveMetaItem WITH an actor still stores that user id', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'), actor: 'usr_alice',
        });
        const rows = await historyRows();
        expect(rows[0].recorded_by).toBe('usr_alice');
    });

    it('deleteMetaItem with NO actor writes a tombstone with recorded_by = NULL', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'), actor: 'usr_alice',
        });
        await protocol.deleteMetaItem({ type: 'view', name: 'cases', organizationId: 'org_x' });

        const tombstone = (await historyRows()).find((h) => h.operation_type === 'delete');
        expect(tombstone).toBeDefined();
        expect(tombstone.recorded_by ?? null).toBeNull();
        expect(tombstone.recorded_by).not.toBe('system');
    });

    it('publishMetaItem with NO actor records the publish event with recorded_by = NULL', async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('draft'), mode: 'draft',
        });
        await protocol.publishMetaItem({ type: 'view', name: 'cases', organizationId: 'org_x' });

        const publishRow = (await historyRows()).find((h) => h.operation_type === 'publish');
        expect(publishRow).toBeDefined();
        expect(publishRow.recorded_by ?? null).toBeNull();
        expect(publishRow.recorded_by).not.toBe('system');
    });

    it('no history row on ANY path carries a value that is not a sys_user id', async () => {
        // The three authoring paths #4441 was bitten by: create, publish, delete.
        await protocol.saveMetaItem({
            type: 'view', name: 'a', organizationId: 'org_x', item: viewBody('a'), mode: 'draft',
        });
        await protocol.publishMetaItem({ type: 'view', name: 'a', organizationId: 'org_x' });
        await protocol.saveMetaItem({
            type: 'view', name: 'b', organizationId: 'org_x', item: viewBody('b'), actor: 'usr_alice',
        });
        await protocol.deleteMetaItem({ type: 'view', name: 'b', organizationId: 'org_x' });

        const rows = await historyRows();
        expect(rows.length).toBeGreaterThan(0);
        const users = new Set(['usr_alice']);
        for (const row of rows) {
            const v = row.recorded_by ?? null;
            // Either NULL, or an id that a sys_user row actually has. Nothing else.
            expect(v === null || users.has(v)).toBe(true);
        }
    });
});
