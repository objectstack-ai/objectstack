// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata save door judges a permission set's field-level (FLS) keys the
 * way `os validate` does: it runs the same `@objectstack/lint` rules over the
 * write, and a key the runtime can never match is refused with 422.
 *
 * ## The shape this pins (#23549)
 *
 * `PermissionSetSchema.fields` is keyed `<object>.<field>`, and the security
 * plugin reads a set's rules for an object by the prefix `<object>.`
 * (`PermissionEvaluator.getFieldPermissions`). A key whose object part is
 * EMPTY (`'.full_name'`) matches no object — `ObjectSchema.name` cannot be
 * empty — so the mask it declares never enforces. The save door used to store
 * it (`success: true`): `security-fls-unqualified-key` skipped every key
 * containing a '.', and `security-fls-unknown-field` read the empty head as
 * another package's object. It is now refused by the first rule.
 *
 * ## The controls beside it
 *
 * The bare key and the deeper (multi-dot) key on an in-stack object were
 * refused before and are refused the same way now; a qualified key naming a
 * real field and a key naming another package's object both still save.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * the refusal is the save door's own 422 and the acceptances are read back as
 * stored `sys_metadata` rows out of the driver, never a payload.
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

/** The package the object and the sets are written into; namespace `flskey`. */
const P = 'com.qa.flskey';

/** The rule ids, spelled as the 422's `issues[].rule` carries them. */
const UNQUALIFIED_KEY = 'security-fls-unqualified-key';
const UNKNOWN_FIELD = 'security-fls-unknown-field';

const HIDDEN = { readable: false, editable: false };

const customerBody = {
    name: 'flskey_customer', label: 'Customer', sharingModel: 'private',
    fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
};

/** A set granting the in-stack object, with ONE field rule under `key`. */
const setWith = (name: string, key: string) => ({
    name, label: name,
    objects: { flskey_customer: { allowRead: true, allowEdit: true } },
    fields: { [key]: HIDDEN },
});

describe('the save door judges a permission set\'s FLS key forms as `os validate` does (#23549)', () => {
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

        await protocol.installPackage({ manifest: { id: P, name: 'FLS keys', type: 'application' } });
        const res = await protocol.saveMetaItem({ type: 'object', name: customerBody.name, packageId: P, item: customerBody });
        expect(res.success).toBe(true);
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    /** The stored permission row's body, as the driver holds it. */
    const storedSet = (name: string): any => {
        const row = Array.from(stores.get('sys_metadata')?.values() ?? [])
            .find((r) => r.type === 'permission' && r.name === name);
        if (!row) return undefined;
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    };

    /** Saves the set and returns the save door's refusal; fails if the save succeeds. */
    async function refusalOf(name: string, key: string): Promise<any> {
        const err = await protocol
            .saveMetaItem({ type: 'permission', name, packageId: P, item: setWith(name, key) })
            .then(() => undefined, (e: unknown) => e);
        expect(err, `the save of fields key ${JSON.stringify(key)} must be refused`).toBeDefined();
        return err;
    }

    it('an EMPTY object part (\'.full_name\') is refused 422, naming the <object>.<field> form', async () => {
        const err = await refusalOf('flskey_empty_object', '.full_name');

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        // One key, one defect, one finding — not a second from the unknown-field rule.
        expect(err.issues.map((i: any) => i.rule)).toEqual([UNQUALIFIED_KEY]);
        const [issue] = err.issues;
        expect(issue.path).toContain('fields[".full_name"]');
        // The card's acceptance: the prescription names the qualified form.
        expect(issue.hint).toContain("'<object>.<field>'");
        // Nothing was stored.
        expect(storedSet('flskey_empty_object')).toBeUndefined();
    });

    it('CONTROL: a bare key is refused as before, under the same rule', async () => {
        const err = await refusalOf('flskey_bare', 'full_name');

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues.map((i: any) => i.rule)).toEqual([UNQUALIFIED_KEY]);
        expect(storedSet('flskey_bare')).toBeUndefined();
    });

    it('CONTROL: a deeper key on an in-stack object is refused as before, under the unknown-field rule', async () => {
        const err = await refusalOf('flskey_deeper', 'flskey_customer.full_name.x');

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues.map((i: any) => i.rule)).toEqual([UNKNOWN_FIELD]);
        expect(storedSet('flskey_deeper')).toBeUndefined();
    });

    it('NEGATIVE CONTROL: a qualified key naming a real field saves, and is stored as written', async () => {
        const res = await protocol.saveMetaItem({
            type: 'permission', name: 'flskey_valid', packageId: P, item: setWith('flskey_valid', 'flskey_customer.full_name'),
        });

        expect(res.success).toBe(true);
        expect(storedSet('flskey_valid')?.fields).toEqual({ 'flskey_customer.full_name': HIDDEN });
    });

    it('NEGATIVE CONTROL: a key naming another package\'s object (\'no_such_object.x\') keeps saving', async () => {
        const res = await protocol.saveMetaItem({
            type: 'permission', name: 'flskey_other_pkg', packageId: P, item: setWith('flskey_other_pkg', 'no_such_object.x'),
        });

        expect(res.success).toBe(true);
        expect(storedSet('flskey_other_pkg')?.fields).toEqual({ 'no_such_object.x': HIDDEN });
    });
});
