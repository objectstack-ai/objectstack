// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `seedApplied` receipt of a package publish counts what was WRITTEN — on
 * a failure too.
 *
 * `publishPackageDrafts` applies every seed body of the batch in one loader
 * call. When one seed fails (here: it names an object that does not exist),
 * the datasets ahead of it have already written their rows, and nothing undoes
 * them. The receipt used to answer `inserted: 0, updated: 0` all the same — a
 * receipt saying nothing was written while the table holds the rows.
 *
 * The semantics this file pins: **truthful aggregate counts**. `inserted` /
 * `updated` are the rows the loader wrote before it stopped, `success` is
 * `false`, and `error` names the seed (by the object its dataset populates)
 * that stopped it. Which seeds are published and the fact that the loader
 * stops at the failing dataset are unchanged; nothing is rolled back.
 *
 * Every count is checked against the ENGINE (`engine.find` on the seeded
 * object), never against a value derived from the code under test.
 *
 * Driven through the real door: the real protocol, a real ObjectQL engine and
 * the real `SeedLoaderService`, over an in-memory driver (harness copied from
 * `publish-package-drafts-response-conformance.test.ts` — copied, not shared,
 * so each file can fail on its own; this package carries no sqlite driver).
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeMemoryDriver() {
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
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver };
}

const PKG = 'com.objectstack.qa.seedrepro';
const ITEM = 'seedrepro_item';
const MISSING = 'seedrepro_nope';

/**
 * The real protocol over a real engine, with the package installed and ITS
 * object published through the same door — so the seeded table is one the
 * batch itself put there, exactly as the reproduction staged it.
 */
async function makeProtocol() {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any, 'test-package');
    engine.registry.installPackage({ id: PKG, name: 'R', version: '1.0.0' } as never, 'code');
    const p = new ObjectStackProtocolImplementation(engine);
    await stage(p, [{ type: 'object', name: ITEM, item: {
        name: ITEM, label: 'R', sharingModel: 'public_read_write',
        fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    } }]);
    const objectPublish: any = await p.publishPackageDrafts({ packageId: PKG });
    expect(objectPublish.outcome).toBe('published');
    return { p, engine };
}

/** `PUT /meta/:type/:name?mode=draft&package=PKG` for each draft. */
async function stage(
    p: ObjectStackProtocolImplementation,
    drafts: Array<{ type: string; name: string; item: unknown }>,
): Promise<void> {
    for (const d of drafts) {
        await (p as any).saveMetaItem({ type: d.type, name: d.name, item: d.item, mode: 'draft', packageId: PKG });
    }
}

/** The seeded object's rows, read at the engine. */
async function rowsAtEngine(engine: ObjectQL): Promise<string[]> {
    const rows = await engine.find(ITEM, { context: { isSystem: true } } as any);
    return (rows as Array<{ name?: string }>).map((r) => String(r.name)).sort();
}

const goodSeed = (names: string[]) => ({ object: ITEM, mode: 'upsert', records: names.map((name) => ({ name })) });
const missingObjectSeed = { object: MISSING, mode: 'upsert', records: [{ name: 'Z' }] };

describe('publish-drafts seedApplied counts what was written', () => {
    it('seed 1 writes 2 rows, seed 2 names a missing object: inserted 2, success false, error names seed 2', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [
            { type: 'seed', name: 'r_good', item: goodSeed(['R1', 'R2']) },
            { type: 'seed', name: 'r_missing_object', item: missingObjectSeed },
        ]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const written = await rowsAtEngine(engine);
        expect(written).toEqual(['R1', 'R2']);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.inserted).toBe(written.length);
        expect(res.seedApplied.updated).toBe(0);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
        // Unchanged by this fix: both seeds are published.
        expect(res.outcome).toBe('published');
        expect(res.publishedCount).toBe(2);
    });

    it('seed 1 UPDATES 2 existing rows, seed 2 fails: updated 2, inserted 0', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'r_good', item: goodSeed(['R1', 'R2']) }]);
        const first: any = await p.publishPackageDrafts({ packageId: PKG });
        expect(first.seedApplied).toEqual({ success: true, inserted: 2, updated: 0 });

        // The same natural keys with a changed column: an upsert UPDATE each.
        await stage(p, [
            { type: 'seed', name: 'r_good', item: { ...goodSeed([]), records: [
                { name: 'R1', label: 'one' }, { name: 'R2', label: 'two' },
            ] } },
            { type: 'seed', name: 'r_missing_object', item: missingObjectSeed },
        ]);
        await (p as any).saveMetaItem({ type: 'object', name: ITEM, mode: 'draft', packageId: PKG, item: {
            name: ITEM, label: 'R', sharingModel: 'public_read_write',
            fields: { name: { name: 'name', label: 'Name', type: 'text' }, label: { name: 'label', label: 'Label', type: 'text' } },
        } });

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await engine.find(ITEM, { context: { isSystem: true } } as any) as Array<{ name: string; label?: string }>;
        expect(rows.map((r) => `${r.name}:${r.label}`).sort()).toEqual(['R1:one', 'R2:two']);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.updated).toBe(2);
        expect(res.seedApplied.inserted).toBe(0);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
    });

    it('[control] every seed succeeds: the counts are what they always were', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [
            { type: 'seed', name: 'r_good', item: goodSeed(['R1', 'R2']) },
            { type: 'seed', name: 'r_more', item: goodSeed(['R3']) },
        ]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(await rowsAtEngine(engine)).toEqual(['R1', 'R2', 'R3']);
        expect(res.seedApplied).toEqual({ success: true, inserted: 3, updated: 0 });
    });

    it('the FIRST seed fails, a good one follows: nothing was written, and the receipt says 0', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [
            { type: 'seed', name: 'a_missing_object', item: missingObjectSeed },
            { type: 'seed', name: 'z_good', item: goodSeed(['R1', 'R2']) },
        ]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        // The loader stops at the failing dataset: the good seed after it never ran.
        expect(await rowsAtEngine(engine)).toEqual([]);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.inserted).toBe(0);
        expect(res.seedApplied.updated).toBe(0);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
    });

    it('the only seed fails before anything is written: inserted 0, updated 0 — truthfully', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'r_missing_object', item: missingObjectSeed }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(await rowsAtEngine(engine)).toEqual([]);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.inserted).toBe(0);
        expect(res.seedApplied.updated).toBe(0);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
    });
});
