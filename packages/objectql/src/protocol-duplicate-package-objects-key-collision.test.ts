// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0070 D4 — `duplicatePackage` never merges a renamed reference into a
 * name the copied item already holds there.
 *
 * ## The defect
 *
 * At an object-reference property, `duplicatePackage` renames a name whole —
 * a string, an array element, a record KEY. When the source names the object
 * the copy is about to be called (`dupdst_customer`, not yet an object) beside
 * the package's own (`dupsrc_customer`), the rename lands on a name the item
 * already holds:
 *
 *  - a permission set's `objects` kept whichever entry came last, so one grant
 *    was dropped with `failed: []`, and the copied object could gain edit and
 *    delete the source set never granted on its own object;
 *  - a translation's `objects` dropped one object's labels the same way;
 *  - a hook's `object` list named the copied object twice, so its handler ran
 *    twice per event there.
 *
 * Now the item is refused in `failed[]`, naming the path, both names and the
 * source edit that clears it, and nothing of it is written.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * every pin reads the stored rows out of the driver, never a payload.
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

/** Source package; `installPackage` derives its namespace `dupsrc`. */
const P = 'com.qa.dupsrc';
/** Target package; namespace `dupdst`, derived the same way. */
const Q = 'com.qa.dupdst';

const NARROW = { allowRead: true };
const WIDE = { allowRead: true, allowEdit: true, allowDelete: true };

const customerBody = {
    name: 'dupsrc_customer', label: 'Customer', sharingModel: 'private',
    fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
};

describe('ADR-0070 D4 — duplicatePackage refuses a renamed reference that meets a name the item holds', () => {
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

    const storedBody = (type: string, name: string, packageId: string): any => {
        const row = Array.from(stores.get('sys_metadata')?.values() ?? [])
            .find((r) => r.type === type && r.name === name && r.package_id === packageId);
        if (!row) return undefined;
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    };
    /** Every table the copy writes (the item, its history, commit and audit rows) that mentions `name`. */
    const tablesMentioning = (name: string): string[] =>
        Array.from(stores.entries())
            .filter(([, rows]) => Array.from(rows.values()).some((row) => JSON.stringify(row).includes(`"${name}"`)))
            .map(([table]) => table)
            .sort();

    async function save(type: string, item: { name: string }): Promise<void> {
        const res = await protocol.saveMetaItem({ type, name: item.name, packageId: P, item });
        expect(res.success).toBe(true);
    }
    async function seed(type: string, item: { name: string }): Promise<void> {
        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'application' } });
        expect(engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
        await save('object', customerBody);
        await save(type, item);
    }

    for (const [order, objects] of [
        ['the renamed key first', { dupsrc_customer: NARROW, dupdst_customer: WIDE }],
        ['the key it meets first', { dupdst_customer: WIDE, dupsrc_customer: NARROW }],
    ] as const) {
        it(`a permission set whose renamed \`objects\` key meets one it holds is refused, never merged (${order})`, async () => {
            await seed('permission', { name: 'dupsrc_objs', label: 'Objects', objects } as { name: string });

            const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

            expect(res.failed).toHaveLength(1);
            const [refusal] = res.failed;
            expect(refusal).toMatchObject({ type: 'permission', name: 'dupsrc_objs' });
            // Located: the set, the property, the key that moved, the key it met, and the remedy.
            expect(refusal.error).toContain("Permission set 'dupsrc_objs' is not copied");
            expect(refusal.error).toContain("`objects` key 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
            expect(refusal.error).toContain("Remove 'dupsrc_customer' or 'dupdst_customer' on the source, then duplicate again.");
            // Nothing of the set was written: no item row, no history, commit or audit row.
            expect(storedBody('permission', 'dupdst_objs', Q)).toBeUndefined();
            expect(tablesMentioning('dupdst_objs')).toEqual([]);
            // NEGATIVE CONTROL: the object still copied, and the scan finds what a copy writes.
            expect(res.copied).toEqual([{ type: 'object', name: 'dupdst_customer' }]);
            expect(tablesMentioning('dupdst_customer')).toEqual(expect.arrayContaining(['sys_metadata', 'sys_metadata_history']));
            // The source set is untouched.
            expect(storedBody('permission', 'dupsrc_objs', P).objects).toEqual(objects);
        });
    }

    it('NEGATIVE CONTROL: the same set without the second key copies, and its one grant follows the renamed object', async () => {
        await seed('permission', { name: 'dupsrc_objs', label: 'Objects', objects: { dupsrc_customer: NARROW } } as { name: string });

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toEqual([]);
        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'object', name: 'dupdst_customer' },
            { type: 'permission', name: 'dupdst_objs' },
        ]));
        expect(storedBody('permission', 'dupdst_objs', Q).objects).toEqual({ dupdst_customer: NARROW });
        expect(storedBody('permission', 'dupsrc_objs', P).objects).toEqual({ dupsrc_customer: NARROW });
    });

    it('a translation whose renamed `objects` key meets one it holds is refused, never merged', async () => {
        const objects = { dupsrc_customer: { label: 'Customer A' }, dupdst_customer: { label: 'Customer B' } };
        await seed('translation', { name: 'dupsrc_zh', locale: 'zh-CN', objects } as { name: string });

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'translation', name: 'dupsrc_zh' });
        expect(res.failed[0].error).toContain("Translation 'dupsrc_zh' is not copied");
        expect(res.failed[0].error).toContain("`objects` key 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
        expect(tablesMentioning('dupdst_zh')).toEqual([]);
        // NEGATIVE CONTROL: the object still copied; the source is untouched.
        expect(res.copied).toEqual([{ type: 'object', name: 'dupdst_customer' }]);
        expect(storedBody('translation', 'dupsrc_zh', P).objects).toEqual(objects);
    });

    it('a hook whose renamed `object` entry meets one it holds is refused; without the second entry it copies', async () => {
        const hook = (object: string[]) => ({
            name: 'dupsrc_stamp', object, events: ['beforeInsert'],
            body: { language: 'js', source: "ctx.input.full_name = 'stamped';" },
        });
        await seed('hook', hook(['dupsrc_customer', 'dupdst_customer']));

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'hook', name: 'dupsrc_stamp' });
        expect(res.failed[0].error).toContain("Hook 'dupsrc_stamp' is not copied");
        expect(res.failed[0].error).toContain("`object` entry 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
        expect(tablesMentioning('dupdst_stamp')).toEqual([]);

        // NEGATIVE CONTROL: the same hook without the second entry copies, and its entry follows the renamed object.
        await save('hook', hook(['dupsrc_customer']));
        const again = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: 'com.qa.dupdst2' });
        expect(again.failed).toEqual([]);
        expect(storedBody('hook', 'dupdst2_stamp', 'com.qa.dupdst2').object).toEqual(['dupdst2_customer']);
    });
});
