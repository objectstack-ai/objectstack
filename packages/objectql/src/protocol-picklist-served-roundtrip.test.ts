// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The served shape of a picklist-bound field at the protocol's object read,
 * and what the authoring door does when that served body is written back.
 *
 * The read serves `picklist` AND the resolved `options`
 * (`PicklistServedFieldSchema`). The write door is an AUTHORING door, and
 * `FieldSchema` refuses the two keys together — so a PUT of the served body is
 * refused, loudly, with the prescription to drop `options`. That is the
 * behaviour the spec declares for the served shape; this file pins that the
 * runtime keeps it (no write-side strip), and that the refusal is the
 * ADR-0112 `INVALID_METADATA` envelope rather than a silent rewrite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
// [#21516] The rest of the stored-metadata family the repository writes through: the
// engine refuses a name the registry does not resolve, so the harness registers it as a boot does.
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] The real `sys_metadata` carries this — it is part of the
        // row's uniqueness key `(type, name, organization_id, package_id)` and
        // `SysMetadataRepository` writes it — but this minimal stub had omitted
        // it. Nothing noticed while an undeclared write key simply travelled to
        // the driver; the declared-field door judges the payload against this
        // map, so the omission now shows up as the fixture defect it always was.
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * Minimal stub driver covering only what `SysMetadataRepository`
 * exercises. Equality-only WHERE evaluation; one record store per object.
 */
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


describe('picklist — the protocol object read and the authoring door', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    const authored = {
        name: 'pp_obj', label: 'Probe', sharingModel: 'public_read_write',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            industry: { name: 'industry', type: 'select', label: 'Industry', picklist: 'industry' },
        },
    };

    beforeEach(async () => {
        engine = new ObjectQL();
        engine.registerDriver(makeStubDriver().driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject);
        for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any);
        engine.registerApp({
            id: 'com.test.lists', name: 'lists',
            picklists: [{ name: 'industry', label: 'Industry', options: [{ label: 'Tech', value: 'tech' }] }],
        });
        engine.registerApp({ id: 'com.test.more', name: 'more', picklistExtensions: [{ extend: 'industry', options: [{ label: 'Health', value: 'health' }] }] });
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('an authored body (`picklist`, no `options`) saves, and the read serves the resolved options beside `picklist`', async () => {
        await expect(protocol.saveMetaItem({ type: 'object', name: 'pp_obj', item: authored } as any)).resolves.toMatchObject({ success: true });
        const served: any = await protocol.getMetaItem({ type: 'object', name: 'pp_obj' } as any);
        expect(served.item.fields.industry).toMatchObject({
            picklist: 'industry',
            options: [{ label: 'Tech', value: 'tech' }, { label: 'Health', value: 'health' }],
        });
    });

    it('writing the SERVED body back is refused 422 INVALID_METADATA, naming the two keys — never stripped silently', async () => {
        await protocol.saveMetaItem({ type: 'object', name: 'pp_obj', item: authored } as any);
        const served: any = await protocol.getMetaItem({ type: 'object', name: 'pp_obj' } as any);
        const err: any = await protocol.saveMetaItem({ type: 'object', name: 'pp_obj', item: served.item } as any).then(() => undefined, (e) => e);
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.message).toContain('`picklist` and `options` cannot both be declared');
    });
});
