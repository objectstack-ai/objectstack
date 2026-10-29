// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata doors' half of the security catalog's "one name, one holder"
 * for a permission set (maintainer rulings Q4 = A, record 6050490870, and A,
 * record 6063176077) reads WHO HOLDS A NAME through this package's own
 * reading — the package half `findPackageHeldSecurityCatalogNames` exports and
 * the cold boot meets with the environment catalog — never a second derivation
 * beside it (ruling letter B, record 6074838935).
 *
 * `@objectstack/metadata-protocol` cannot import this package (this package
 * depends on it), so its predicate (`permissionSetNameCollisionRefusal`, in
 * `protocol-save-door-refusals.ts`) asks the same registry member the export
 * asks. These pins hold that seam from the side that sees both halves: the
 * real composition — `ObjectQLPlugin` binding the real protocol to a real
 * `ObjectQL` engine and its `SchemaRegistry` — so a rename of the member, or a
 * door that stops asking it, reds here, where the metadata-protocol suite's
 * registry double could not notice.
 *
 * The holder is an install CLAIM: a package whose manifest declares a
 * permission set, installed with no item registered, so no packaged lock seals
 * the name and the save door's name rule is the refusal that answers. The
 * metadata-protocol suite `protocol.permission-set-name-cross-package.test.ts`
 * pins the doors, the owner each judges and the stored half.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { findPackageHeldSecurityCatalogNames } from './registry.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory driver, copied from `protocol-adopt-orphans-object-registry.test.ts`;
 * equality-only WHERE.
 */
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
        async dropTable(object: string) { stores.delete(object); },
    };
    return driver;
}

/** The package whose install declares the set's name, and a second installed package. */
const HOLDER = 'com.qa.holder';
const OTHER = 'com.qa.other';
const SET = 'qa_claimed_editor';
const permissionSet = (name: string) => ({ name, label: 'Editor', objects: {} });

describe('the metadata doors read who holds a permission-set name through the registry\'s own reading', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    async function boot(stores: Stores): Promise<{ engine: ObjectQL; protocol: any }> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        engine.registry.logLevel = 'silent';
        // Both installed as authored bases (a save naming an uninstalled
        // package is refused first); the holder's manifest declares the set,
        // which records the claim and registers no item.
        engine.registry.installPackage(
            { id: HOLDER, name: HOLDER, version: '1.0.0', permissions: [permissionSet(SET)] } as any, 'authored',
        );
        engine.registry.installPackage({ id: OTHER, name: OTHER, version: '1.0.0' } as any, 'authored');
        return { engine, protocol: (kernel as any).getService('protocol') };
    }

    const storedSets = (stores: Stores) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'permission')
        .map((r) => ({ name: r.name, binding: r.package_id ?? null }));

    async function refusal(run: () => Promise<unknown>): Promise<any> {
        try {
            await run();
        } catch (error) {
            return error;
        }
        return undefined;
    }

    it('the reading the doors meet is the exported one: the claim names the holder', async () => {
        const { engine } = await boot(new Map());
        expect(findPackageHeldSecurityCatalogNames(engine.registry)
            .filter((entry) => entry.catalogType === 'permission' && entry.name === SET))
            .toEqual([{ catalogType: 'permission', name: SET, packageIds: [HOLDER] }]);
    });

    it.each([
        ['another installed package', OTHER],
        ['the environment (no package)', undefined],
    ] as const)('%s cannot save a set of the claimed name — NAMESPACE_CONFLICT / 422 naming the holder, nothing stored', async (_who, packageId) => {
        const stores: Stores = new Map();
        const { protocol } = await boot(stores);

        const error = await refusal(() => protocol.saveMetaItem({
            type: 'permission', name: SET, item: permissionSet(SET), ...(packageId ? { packageId } : {}),
        }));

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('NAMESPACE_CONFLICT');
        expect(error.status).toBe(422);
        expect(error.message).toContain(`package "${HOLDER}"`);
        expect(storedSets(stores)).toEqual([]);
    });

    it('CONTROL: a name no package declares saves, for another package and for the environment', async () => {
        const stores: Stores = new Map();
        const { protocol } = await boot(stores);

        const packaged = await protocol.saveMetaItem({
            type: 'permission', name: 'qa_other_editor', item: permissionSet('qa_other_editor'), packageId: OTHER,
        });
        const environment = await protocol.saveMetaItem({
            type: 'permission', name: 'qa_env_editor', item: permissionSet('qa_env_editor'),
        });

        expect(packaged.success).toBe(true);
        expect(environment.success).toBe(true);
        expect(storedSets(stores)).toEqual([
            { name: 'qa_other_editor', binding: OTHER },
            { name: 'qa_env_editor', binding: null },
        ]);
    });
});
