// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Used by" for an OBJECT lists a permission set that names it only through a
 * field-level rule: a `PermissionSetSchema.fields` key, `<entity_name>.<field_name>`.
 *
 * ## The defect
 *
 * `findReferencesToMeta` (`GET /api/v1/meta/object/:name/references`) feeds the
 * admin "Used by" panel, whose empty state reads "Nothing in the metadata graph
 * points at this item. Safe to delete." The derived reference-site index reads
 * `permission.fields` only as a site naming `field` items, never an object, so a
 * set whose only rule for an object is a field rule was missing from that
 * object's answer: the panel could clear an object for deletion while a
 * permission set still masked its fields.
 *
 * ## The split rule
 *
 * Object names and field names are both `^[a-z_][a-z0-9_]*$`, so a key's object
 * part is everything before its FIRST `.` — the same split the security plugin
 * makes (`PermissionEvaluator.getFieldPermissions`, `key.startsWith(object + '.')`).
 * The field part never names an object: a key whose FIELD part spells another
 * object's name is not a reference to that object.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * every set here passed the real save door and is read back out of the driver.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-permission-field-keys.test.ts`; equality-only WHERE. */
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

/** The package every item below is saved into; `installPackage` derives its namespace `refsrc`. */
const P = 'com.qa.refsrc';

const HIDDEN = { readable: false, editable: false };

/** The object whose "Used by" answer is asked for. */
const customerBody = {
    name: 'refsrc_customer', label: 'Customer', sharingModel: 'private',
    fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
};
/** Another object, with a field whose NAME spells the customer object's name. */
const invoiceBody = {
    name: 'refsrc_invoice', label: 'Invoice', sharingModel: 'private',
    fields: {
        total: { name: 'total', type: 'number', label: 'Total' },
        refsrc_customer: { name: 'refsrc_customer', type: 'text', label: 'Customer reference' },
    },
};
/** Names the customer object ONLY through a field-rule key. */
const customerFlsBody = {
    name: 'refsrc_customer_fls', label: 'Customer field rules',
    objects: {},
    fields: { 'refsrc_customer.full_name': HIDDEN },
};
/** Names only the invoice object — once with a field part that spells `refsrc_customer`. */
const invoiceFlsBody = {
    name: 'refsrc_invoice_fls', label: 'Invoice field rules',
    objects: {},
    fields: { 'refsrc_invoice.total': HIDDEN, 'refsrc_invoice.refsrc_customer': HIDDEN },
};
/** Names the customer object through its `objects` record — the site that already answered. */
const customerGrantBody = {
    name: 'refsrc_customer_grant', label: 'Customer grant',
    objects: { refsrc_customer: { allowRead: true } },
};

describe('findReferencesToMeta lists a permission set that names an object only in its `fields` keys', () => {
    let kernel: ObjectKernel;
    let protocol: any;

    beforeEach(async () => {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(new Map()), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        protocol = kernel.getService('protocol');

        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'app' } });
        for (const [type, item] of [
            ['object', customerBody],
            ['object', invoiceBody],
            ['permission', customerFlsBody],
            ['permission', invoiceFlsBody],
            ['permission', customerGrantBody],
        ] as const) {
            const res = await protocol.saveMetaItem({ type, name: item.name, packageId: P, item });
            expect(res.success).toBe(true);
        }
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    /** The permission-set rows of an object's answer, as `name@path`. */
    async function permissionRowsFor(objectName: string): Promise<string[]> {
        const { references } = await protocol.findReferencesToMeta({ type: 'object', name: objectName });
        return references
            .filter((r: { type: string }) => r.type === 'permission')
            .map((r: { name: string; path: string }) => `${r.name}@${r.path}`)
            .sort();
    }

    it('a set whose `fields` key names the object is listed, at a path naming the `fields` key', async () => {
        expect(await permissionRowsFor('refsrc_customer')).toContain('refsrc_customer_fls@fields{key}');
    });

    it('a set whose `fields` keys name only another object is not listed, even where a FIELD part spells the object', async () => {
        // NEGATIVE CONTROL: `refsrc_invoice.refsrc_customer` governs a column of
        // `refsrc_invoice`; its field part names no object.
        expect(await permissionRowsFor('refsrc_customer')).not.toEqual(
            expect.arrayContaining([expect.stringMatching(/^refsrc_invoice_fls@/)]),
        );
        // ...and that set IS listed for the object it does name, once.
        expect((await permissionRowsFor('refsrc_invoice')).filter((row) => row.startsWith('refsrc_invoice_fls@')))
            .toEqual(['refsrc_invoice_fls@fields{key}']);
    });

    it('the `objects` record answer is unchanged', async () => {
        expect(await permissionRowsFor('refsrc_customer')).toContain('refsrc_customer_grant@objects{key}');
    });

    it('the `field` target still refuses: an object-qualified field key is not an answerable target', async () => {
        // #9538's ground. `field` items are addressed `<object>.<field>`; this
        // card adds an OBJECT answer and must not move the FIELD one.
        let caught: any;
        try {
            await protocol.findReferencesToMeta({ type: 'field', name: 'refsrc_customer.full_name' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeDefined();
        expect(caught.code).toBe('NOT_IMPLEMENTED');
        expect(caught.status).toBe(501);
    });
});
