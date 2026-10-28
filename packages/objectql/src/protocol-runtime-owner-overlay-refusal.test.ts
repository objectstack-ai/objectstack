// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23416, ADR-0029 D9.9 — a save into package Q of an object package P's
 * RUNTIME-authored row owns is refused before any write, with the refusal the
 * code-owner path gives (`OBJECT_OVERLAY_PACKAGE_MISMATCH` / 422).
 *
 * ## The defect
 *
 * `classifyObjectContribution` asked the registry one question,
 * `getPackagedObjectOwner`, which answers for a CODE artifact only. An object
 * a package's `sys_metadata` row created at runtime has no packaged owner, so
 * a save naming a second package classified as `own` and was written. The
 * write-through then called `registerObject(…, Q, …, 'own')`, the registry's
 * single-owner rule refused it (`already owned by package P`), and
 * `applyObjectRegistryMutation`'s best-effort `console.warn` swallowed the
 * refusal: the save answered `200` while `sys_metadata` held a Q-bound row the
 * registry could not hold. Measured on a booted showcase per the card
 * (`PUT /api/v1/meta/object/NAME?package=Q`).
 *
 * ## Why a real kernel
 *
 * The disagreement is between two stores the kernel assembles: the
 * `sys_metadata` rows the engine's driver holds and the `SchemaRegistry` the
 * data plane dispatches on. `ObjectQLPlugin` binds the real protocol to the
 * real engine and registry, so every pin below reads the stored rows out of
 * the driver and the owner out of the registry, never a payload.
 *
 * ## The pins
 *
 *  - Q's save of P's runtime object is refused (`code` + `status`), nothing is
 *    stored for Q (no row, no history), and the registry and `sys_metadata`
 *    still agree on P;
 *  - CONTROL: P's own re-save answers success and moves the registry;
 *  - CONTROL: a save naming no package addresses P's row and answers success;
 *  - CONTROL: the code-owner case answers exactly what it answered before
 *    (`NOT_OVERRIDABLE`: the package door answers ahead of D9.9 there).
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-metadata-row-actor.test.ts`; equality-only WHERE. */
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

const P = 'com.qa.p';
const Q = 'com.qa.q';
const NAME = 'qa_probe_gadget';

/** A runtime object body; `label` tells the two packages' writes apart. */
const gadgetBody = (label: string) => ({
    name: NAME,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
    },
});

describe('#23416 — a save into a second package of an object a runtime-authored row owns', () => {
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
        // [#26708] The workspaces the saves below name are installed, as
        // authored bases: a save naming a package no installed package has
        // is refused before it is written.
        for (const id of [P, Q]) engine.registry.installPackage({ id, name: id, version: '1.0.0' } as any, 'authored');
        protocol = kernel.getService('protocol');
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    /** The bindings of the object's stored `sys_metadata` rows, as the driver holds them. */
    const storedBindings = (table: 'sys_metadata' | 'sys_metadata_history' = 'sys_metadata') =>
        Array.from(stores.get(table)?.values() ?? [])
            .filter((r) => r.type === 'object' && r.name === NAME)
            .map((r) => r.package_id ?? null);

    const registryOwner = () => engine.registry.getObjectOwner(NAME)?.packageId;
    const registryLabel = () => (engine.registry.getObject(NAME) as { label?: string } | undefined)?.label;

    const saveInto = (packageId: string | undefined, label: string) =>
        protocol.saveMetaItem({
            type: 'object', name: NAME, ...(packageId ? { packageId } : {}), item: gadgetBody(label),
        });

    /** P authors the object at runtime: the row exists and the registry holds it as P's. */
    async function seedRuntimeOwner(): Promise<void> {
        const res = await saveInto(P, 'Gadget P');
        expect(res.success).toBe(true);
        expect(storedBindings()).toEqual([P]);
        expect(registryOwner()).toBe(P);
        expect(engine.registry.getPackagedObjectOwner(NAME)).toBeUndefined();
    }

    it('Q\'s save is refused with the D9.9 envelope, before any write', async () => {
        await seedRuntimeOwner();
        const historyBefore = storedBindings('sys_metadata_history');

        const err = await saveInto(Q, 'Gadget Q').then(() => null, (e: any) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
        expect(err.status).toBe(422);
        expect(err.packageId).toBe(Q);
        expect(err.ownerPackageId).toBe(P);
        // Nothing stored for Q: no row, and no history entry either.
        expect(storedBindings()).toEqual([P]);
        expect(storedBindings('sys_metadata_history')).toEqual(historyBefore);
        // The two stores agree, on P.
        expect(registryOwner()).toBe(P);
        expect(registryLabel()).toBe('Gadget P');
    });

    it('CONTROL: P\'s own re-save answers success and the registry follows it', async () => {
        await seedRuntimeOwner();

        const res = await saveInto(P, 'Gadget P v2');

        expect(res.success).toBe(true);
        expect(storedBindings()).toEqual([P]);
        expect(registryOwner()).toBe(P);
        expect(registryLabel()).toBe('Gadget P v2');
    });

    it('CONTROL: a save naming no package addresses P\'s row and answers success', async () => {
        await seedRuntimeOwner();

        const res = await saveInto(undefined, 'Gadget unbound');

        expect(res.success).toBe(true);
        expect(storedBindings()).toEqual([P]);
        expect(registryOwner()).toBe(P);
        expect(registryLabel()).toBe('Gadget unbound');
    });

    it('CONTROL: a code-packaged owner answers what it answered before', async () => {
        // The package's object as `registerApp` registers it: contributors only,
        // with the package provenance a loader stamps.
        engine.registry.registerObject(
            { ...gadgetBody('Gadget code'), _packageId: P, _provenance: 'package' } as any,
            P,
        );
        expect(engine.registry.getPackagedObjectOwner(NAME)?.packageId).toBe(P);

        const err = await saveInto(Q, 'Gadget Q').then(() => null, (e: any) => e);

        // [ADR-0131 D6] Managed content is sealed, so the package door answers
        // ahead of the D9.9 check for a code owner (measured before this
        // change, unchanged by it).
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
        expect(storedBindings()).toEqual([]);
        expect(registryOwner()).toBe(P);
        expect(registryLabel()).toBe('Gadget code');
    });
});
