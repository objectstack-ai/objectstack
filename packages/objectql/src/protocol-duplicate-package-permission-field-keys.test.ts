// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0070 D4 — `duplicatePackage` re-points a copied permission set's
 * field-level rules at the copied objects: in `PermissionSetSchema.fields`,
 * keyed `<entity_name>.<field_name>`, a key's OBJECT part follows the renamed
 * object, and nothing else about the key moves.
 *
 * ## The defect
 *
 * The copy's `objects` map followed the renamed objects, but its `fields` map
 * kept the source's keys (`dupsrc_customer.full_name`). The security plugin
 * reads a set's field rules for an object by the key prefix `<object>.`
 * (`PermissionEvaluator.getFieldPermissions`), so the copy's rules applied to
 * the SOURCE's object and the duplicate's object got none: a field the source
 * set hid was readable on the duplicate for whoever held the copied set.
 *
 * ## The split rule
 *
 * Object names and field names are both `^[a-z_][a-z0-9_]*$`, so a key's
 * object part is everything before its FIRST `.`. That part is rewritten only
 * when it equals a renamed object name exactly; the field part is never read.
 * A renamed key that meets a key the set already holds is refused in
 * `failed[]`, because keeping either rule would silently drop the other.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * every pin reads the stored `sys_metadata` rows out of the driver, never a
 * payload.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-unprefixed-object.test.ts`; equality-only WHERE. */
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

/** Source package; `installPackage` derives its namespace `dupsrc`. */
const P = 'com.qa.dupsrc';
/** Target package; namespace `dupdst`, derived the same way. */
const Q = 'com.qa.dupdst';
/** A third package, whose object the source's set also governs. */
const R = 'com.qa.dupext';

const HIDDEN = { readable: false, editable: false };
const LOCKED = { readable: true, editable: false };
const OPEN = { readable: true, editable: true };

/** A prefixed object with a field that spells the object's own name. */
const customerBody = {
    name: 'dupsrc_customer', label: 'Customer', sharingModel: 'private',
    fields: {
        full_name: { name: 'full_name', type: 'text', label: 'Full name' },
        dupsrc_customer: { name: 'dupsrc_customer', type: 'text', label: 'Customer code' },
    },
};
/** An object whose name lacks the `dupsrc_` prefix, likewise. */
const ticketBody = {
    name: 'ticket', label: 'Ticket', sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        ticket: { name: 'ticket', type: 'text', label: 'Ticket number' },
    },
};
/** An object of another package: not copied, so not renamed. */
const accountBody = {
    name: 'dupext_account', label: 'Account', sharingModel: 'private',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
};
const flsBody = {
    name: 'dupsrc_fls', label: 'Field rules',
    objects: {
        dupsrc_customer: { allowRead: true, allowEdit: true },
        ticket: { allowRead: true, allowEdit: true },
        dupext_account: { allowRead: true },
    },
    fields: {
        'dupsrc_customer.full_name': HIDDEN,
        'dupsrc_customer.dupsrc_customer': LOCKED,
        'ticket.title': HIDDEN,
        'ticket.ticket': OPEN,
        'dupext_account.name': LOCKED,
    },
};

describe('ADR-0070 D4 — duplicatePackage re-points a copied permission set\'s `fields` keys', () => {
    let kernel: ObjectKernel;
    let stores: Stores;
    let engine: ObjectQL;
    let protocol: any;

    beforeEach(async () => {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        stores = new Map();
        engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        protocol = kernel.getService('protocol');
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    /** The stored `sys_metadata` rows, as the driver holds them. */
    const storedRows = () => Array.from(stores.get('sys_metadata')?.values() ?? []);
    const storedBody = (type: string, name: string, packageId: string): any => {
        const row = storedRows().find((r) => r.type === type && r.name === name && r.package_id === packageId);
        if (!row) return undefined;
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    };

    async function save(packageId: string, type: string, item: { name: string }): Promise<void> {
        const res = await protocol.saveMetaItem({ type, name: item.name, packageId, item });
        expect(res.success).toBe(true);
    }

    /** Seeds the source and the third package, duplicates, and returns the copy's `fields`. */
    async function duplicate(): Promise<Record<string, unknown>> {
        await protocol.installPackage({ manifest: { id: R, name: 'Other', type: 'application' } });
        await save(R, 'object', accountBody);
        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'application' } });
        expect(engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
        await save(P, 'object', customerBody);
        await save(P, 'object', ticketBody);
        await save(P, 'permission', flsBody);

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toEqual([]);
        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'object', name: 'dupdst_customer' },
            { type: 'object', name: 'dupdst_ticket' },
            { type: 'permission', name: 'dupdst_fls' },
        ]));
        const copy = storedBody('permission', 'dupdst_fls', Q);
        expect(copy).toBeDefined();
        return copy.fields;
    }

    it('a prefixed object\'s key follows its renamed object, with its rule', async () => {
        const fields = await duplicate();

        expect(fields['dupdst_customer.full_name']).toEqual(HIDDEN);
        // NEGATIVE CONTROL: no key of the copy names the source's object.
        expect(Object.keys(fields).filter((key) => key.startsWith('dupsrc_customer.'))).toEqual([]);
    });

    it('a bare object\'s key follows the target-namespace name the copy took', async () => {
        const fields = await duplicate();

        expect(fields['dupdst_ticket.title']).toEqual(HIDDEN);
        // NEGATIVE CONTROL: no key of the copy names the source's `ticket`.
        expect(Object.keys(fields).filter((key) => key.startsWith('ticket.'))).toEqual([]);
    });

    it('only the object part moves: a field part that spells the object\'s name stays', async () => {
        const fields = await duplicate();

        expect(fields['dupdst_customer.dupsrc_customer']).toEqual(LOCKED);
        expect(fields['dupdst_ticket.ticket']).toEqual(OPEN);
        // NEGATIVE CONTROL: the field part was not renamed with the object.
        expect(fields).not.toHaveProperty(['dupdst_customer.dupdst_customer']);
        expect(fields).not.toHaveProperty(['dupdst_ticket.dupdst_ticket']);
    });

    it('a key naming an object outside the package keeps its name, and the source set is untouched', async () => {
        const fields = await duplicate();

        // NEGATIVE CONTROL: an object the package does not hold is not renamed.
        expect(fields['dupext_account.name']).toEqual(LOCKED);
        expect(Object.keys(fields).sort()).toEqual([
            'dupdst_customer.dupsrc_customer',
            'dupdst_customer.full_name',
            'dupdst_ticket.ticket',
            'dupdst_ticket.title',
            'dupext_account.name',
        ]);
        // The source set keeps every key it had, with its rule.
        expect(storedBody('permission', 'dupsrc_fls', P).fields).toEqual(flsBody.fields);
    });

    it('a renamed key that meets a key the set already holds is refused, never merged', async () => {
        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'application' } });
        await save(P, 'object', customerBody);
        // `dupdst_customer.full_name` names no object of the package, so it
        // keeps its name, and `dupsrc_customer.full_name` follows onto it.
        await save(P, 'permission', {
            name: 'dupsrc_clash', label: 'Clash',
            objects: { dupsrc_customer: { allowRead: true } },
            fields: { 'dupsrc_customer.full_name': HIDDEN, 'dupdst_customer.full_name': OPEN },
        } as { name: string });

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toHaveLength(1);
        const [refusal] = res.failed;
        expect(refusal).toMatchObject({ type: 'permission', name: 'dupsrc_clash' });
        // Located: the set, the key that moved, the key it met, and the remedy.
        expect(refusal.error).toContain("Permission set 'dupsrc_clash' is not copied");
        expect(refusal.error).toContain("'dupsrc_customer.full_name'");
        expect(refusal.error).toContain("'dupdst_customer.full_name'");
        expect(refusal.error).toContain('on the source, then duplicate again');
        // NEGATIVE CONTROL: nothing of the set was written to the target, and
        // the object still copied.
        expect(storedBody('permission', 'dupdst_clash', Q)).toBeUndefined();
        expect(res.copied).toEqual([{ type: 'object', name: 'dupdst_customer' }]);
    });
});
