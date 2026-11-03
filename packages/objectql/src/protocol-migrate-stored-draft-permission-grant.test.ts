// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stored-metadata healing pass (`migrateStoredMetadata`, `os migrate meta
 * --stored`) re-saves a draft-only permission set whose stored body needs a
 * conversion, even when the set grants on an object that exists nowhere now.
 *
 * ## The defect
 *
 * The save door refuses a permission set granting on an object that does not
 * exist, and does not judge a grant the set already holds. "Already holds"
 * was read from the set's ACTIVE row. A set that is only a draft has none, so
 * the pass re-saving its own draft (a legacy `managedBy` key to strip) was
 * refused `422 INVALID_METADATA` once the object draft it granted on was gone:
 * `apply` reported the row `failed` and the legacy key stayed at rest.
 *
 * Now a `migrate-stored` re-save is not judged, as it is not for a seed's
 * keyed field: it rewrites a row the store already holds, and the draft is
 * judged when it is published. Every author-facing door is judged as before.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * the pass reads its rows out of the driver and every pin reads the stored row
 * back out of it.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-objects-key-collision.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
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
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = (data.id as string) ?? `r_${randomUUID()}`;
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
    return driver;
}

const object = {
    name: 'qa_widget', label: 'Widget', sharingModel: 'private',
    fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
};
const set = { name: 'qa_probe', label: 'Grant probe', objects: { qa_widget: { allowRead: true } } };

describe('migrate-stored re-saves a draft-only permission set whose object draft is gone', () => {
    let kernel: ObjectKernel;
    let stores: Stores;
    let protocol: any;

    beforeEach(async () => {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        stores = new Map();
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        protocol = kernel.getService('protocol');
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    const rowsOf = (type: string, name: string) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === type && r.name === name);
    const bodyOf = (row: Record<string, unknown>): any =>
        (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata);

    /**
     * An object draft, and a set draft granting on it (accepted: the object is
     * a draft), whose stored body is then given the retired `managedBy` key, the
     * at-rest shape of a set drafted before that key was retired.
     */
    async function seed(): Promise<void> {
        expect((await protocol.saveMetaItem({ type: 'object', name: object.name, item: object, mode: 'draft' })).success).toBe(true);
        expect((await protocol.saveMetaItem({ type: 'permission', name: set.name, item: set, mode: 'draft' })).success).toBe(true);
        const [row] = rowsOf('permission', set.name);
        expect(row?.state).toBe('draft');
        const legacy = { ...bodyOf(row!), managedBy: 'user' };
        row!.metadata = typeof row!.metadata === 'string' ? JSON.stringify(legacy) : legacy;
        // Its stamp was the hash of the body before the key went in; a row
        // stored with that key carries its own, so the stamp is not the
        // converted body's (a matching stamp reads as "nothing to write").
        row!.checksum = null;
        expect(rowsOf('permission', set.name).map((r) => r.state)).toEqual(['draft']);
    }

    /** Remove the object draft, as a discard would: the set now grants on an object that exists nowhere. */
    function dropObjectDraft(): void {
        const objectRows = rowsOf('object', object.name);
        expect(objectRows.map((r) => r.state)).toEqual(['draft']);
        for (const r of objectRows) stores.get('sys_metadata')!.delete(r.id as string);
    }

    const permissionRow = (report: any) =>
        report.rows.find((r: any) => r.type === 'permission' && r.name === set.name);

    it('the pass rewrites it: the legacy key is stripped and the grant kept, and the set stays a draft', async () => {
        await seed();
        dropObjectDraft();

        const preview = await protocol.migrateStoredMetadata({ types: ['permission'] });
        expect(permissionRow(preview)?.outcome, JSON.stringify(permissionRow(preview))).toBe('pending');

        const report = await protocol.migrateStoredMetadata({ apply: true, types: ['permission'] });

        expect(permissionRow(report), JSON.stringify(permissionRow(report))).toMatchObject({ state: 'draft', outcome: 'rewritten' });
        const rows = rowsOf('permission', set.name);
        expect(rows.map((r) => r.state)).toEqual(['draft']);
        expect(bodyOf(rows[0]!)).not.toHaveProperty('managedBy');
        expect(Object.keys(bodyOf(rows[0]!).objects)).toEqual(['qa_widget']);
    });

    it('…and its publish is still refused, naming the object (the draft is judged where it goes live)', async () => {
        await seed();
        dropObjectDraft();
        await protocol.migrateStoredMetadata({ apply: true, types: ['permission'] });

        const err = await protocol.publishMetaItem({ type: 'permission', name: set.name }).then(() => null, (e: any) => e);

        expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.path)).toEqual(['objects.qa_widget']);
        expect(rowsOf('permission', set.name).map((r) => r.state)).toEqual(['draft']);
    });

    it('control: with the object draft still present the pass rewrites it', async () => {
        await seed();

        const report = await protocol.migrateStoredMetadata({ apply: true, types: ['permission'] });

        expect(permissionRow(report), JSON.stringify(permissionRow(report))).toMatchObject({ state: 'draft', outcome: 'rewritten' });
        expect(bodyOf(rowsOf('permission', set.name)[0]!)).not.toHaveProperty('managedBy');
    });

    it('control: an author re-saving the same draft is still refused, naming the object', async () => {
        await seed();
        dropObjectDraft();

        const err = await protocol.saveMetaItem({ type: 'permission', name: set.name, item: set, mode: 'draft' })
            .then(() => null, (e: any) => e);

        expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.path)).toEqual(['objects.qa_widget']);
        expect(bodyOf(rowsOf('permission', set.name)[0]!)).toHaveProperty('managedBy', 'user');
    });
});
