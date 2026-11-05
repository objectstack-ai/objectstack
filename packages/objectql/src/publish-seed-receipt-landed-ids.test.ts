// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30348] The publish receipt names the rows a seed landed on —
 * `seedApplied.landed`, per object, split into `inserted` (rows THIS publish
 * created) and `matched` (pre-existing rows a seed key matched).
 *
 * objectstack-ai/cloud#3598 ruling A: cloud clears an AI build's sample data
 * by the ids the publish wrote, and the receipt used to carry only counts. The
 * split is the half that keeps that safe: under `ignore` (the create-only
 * default since #30081) a seed record whose natural key matches an existing
 * row — possibly a customer's own — lands on it without writing, and such a
 * row must never be listed as one the seed created.
 *
 * Every id is checked against the ENGINE (`engine.find` on the seeded object,
 * or the id the test wrote itself), never against a value derived from the
 * code under test. Driven through the real doors — `publishPackageDrafts` and
 * `publishMetaItem` — with the real protocol, a real ObjectQL engine and the
 * real `SeedLoaderService` over an in-memory driver (harness copied from
 * `publish-package-drafts-seed-receipt-counts.test.ts` — copied, not shared,
 * so each file can fail on its own).
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { PublishMetaItemResponseSchema, PublishPackageDraftsResponseSchema, SEED_APPLIED_LANDED_IDS_CAP } from '@objectstack/spec/api';
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

const PKG = 'com.objectstack.qa.seedlanded';
const ITEM = 'seedlanded_item';
const MISSING = 'seedlanded_nope';

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

/** The seeded object's rows, read at the engine, in stored (insertion) order. */
async function rowsOf(engine: ObjectQL): Promise<Array<{ id: string; name: string }>> {
    return (await engine.find(ITEM, { context: { isSystem: true } })) as Array<{ id: string; name: string }>;
}

const seed = (names: string[], mode = 'ignore') => ({ object: ITEM, mode, records: names.map((name) => ({ name })) });
const list = (ids: string[], total = ids.length) => ({ ids, total, truncated: total > ids.length });
const NONE = list([]);

describe('seedApplied.landed — the rows a published seed landed on (#30348)', () => {
    it('a fresh seed: every row it created is under `inserted`, per object, exactly as the engine holds them', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'l_fresh', item: seed(['R1', 'R2', 'R3']) }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await rowsOf(engine);
        expect(rows.map((r) => r.name)).toEqual(['R1', 'R2', 'R3']);
        expect(res.seedApplied.success).toBe(true);
        expect(res.seedApplied.landed).toEqual([{ object: ITEM, inserted: list(rows.map((r) => r.id)), matched: NONE }]);
        // The wire contract carries it: the declared schema parses the real
        // response and keeps the key (a schema without it would strip it).
        expect(PublishPackageDraftsResponseSchema.parse(res).seedApplied?.landed).toEqual(res.seedApplied.landed);
    });

    it('under `ignore`, a pre-existing row the seed key matched is `matched`, never `inserted`', async () => {
        const { p, engine } = await makeProtocol();
        // A customer's own row, written before the seed, sharing its natural key.
        const customer: any = await engine.insert(ITEM, { name: 'R1' }, { context: { isSystem: true } } as any);
        await stage(p, [{ type: 'seed', name: 'l_ignore', item: seed(['R1', 'R2']) }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await rowsOf(engine);
        const created = rows.find((r) => r.name === 'R2')!.id;
        // Positive control: `ignore` wrote no second R1 — the customer's row is the only one.
        expect(rows.filter((r) => r.name === 'R1').map((r) => r.id)).toEqual([customer.id]);
        expect(res.seedApplied.inserted).toBe(1);
        expect(res.seedApplied.landed).toEqual([{ object: ITEM, inserted: list([created]), matched: list([customer.id]) }]);
    });

    it('a re-publish matches the rows the FIRST publish created: `matched`, and nothing `inserted`', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'l_again', item: seed(['R1', 'R2']) }]);
        const first: any = await p.publishPackageDrafts({ packageId: PKG });
        const ids = (await rowsOf(engine)).map((r) => r.id);
        expect(first.seedApplied.landed).toEqual([{ object: ITEM, inserted: list(ids), matched: NONE }]);

        await stage(p, [{ type: 'seed', name: 'l_again', item: seed(['R1', 'R2']) }]);
        const again: any = await p.publishPackageDrafts({ packageId: PKG });

        expect((await rowsOf(engine)).map((r) => r.id)).toEqual(ids);
        expect(again.seedApplied.inserted).toBe(0);
        expect(again.seedApplied.landed).toEqual([{ object: ITEM, inserted: NONE, matched: list(ids) }]);
    });

    it('over the cap: the first SEED_APPLIED_LANDED_IDS_CAP ids, `truncated: true`, and the uncut `total`', async () => {
        expect(SEED_APPLIED_LANDED_IDS_CAP).toBe(200);
        const { p, engine } = await makeProtocol();
        const names = Array.from({ length: SEED_APPLIED_LANDED_IDS_CAP + 5 }, (_, i) => `R${String(i).padStart(3, '0')}`);
        await stage(p, [{ type: 'seed', name: 'l_big', item: seed(names) }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await rowsOf(engine);
        expect(rows).toHaveLength(names.length);
        const byName = new Map(rows.map((r) => [r.name, r.id]));
        const inRecordOrder = names.map((n) => byName.get(n)!);
        expect(res.seedApplied.inserted).toBe(names.length);
        expect(res.seedApplied.landed).toEqual([{
            object: ITEM,
            inserted: { ids: inRecordOrder.slice(0, SEED_APPLIED_LANDED_IDS_CAP), total: names.length, truncated: true },
            matched: NONE,
        }]);
        // The schema holds the same cap: one id more is refused, not carried.
        const over = { ...res, seedApplied: { ...res.seedApplied, landed: [{
            object: ITEM, inserted: { ids: inRecordOrder, total: names.length, truncated: false }, matched: NONE,
        }] } };
        expect(PublishPackageDraftsResponseSchema.safeParse(over).success).toBe(false);
        expect(PublishPackageDraftsResponseSchema.safeParse(res).success).toBe(true);
    });

    it('two seeds of one object fold into ONE entry; an id the batch inserted is never also `matched`', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [
            { type: 'seed', name: 'l_a', item: seed(['R1', 'R2']) },
            // Its R1 matches the row the first seed just created.
            { type: 'seed', name: 'l_b', item: seed(['R1', 'R3']) },
        ]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await rowsOf(engine);
        expect(rows.map((r) => r.name).sort()).toEqual(['R1', 'R2', 'R3']);
        expect(res.seedApplied.landed).toHaveLength(1);
        expect(res.seedApplied.landed[0].object).toBe(ITEM);
        expect([...res.seedApplied.landed[0].inserted.ids].sort()).toEqual(rows.map((r) => r.id).sort());
        expect(res.seedApplied.landed[0].matched).toEqual(NONE);
    });

    it('a seed with no records: the loader ran and reported, so one entry with two empty lists', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'l_empty', item: seed([]) }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(await rowsOf(engine)).toEqual([]);
        expect(res.seedApplied.success).toBe(true);
        expect(res.seedApplied.inserted).toBe(0);
        // Reported-and-empty, which is a different answer from an absent key.
        expect(res.seedApplied.landed).toEqual([{ object: ITEM, inserted: NONE, matched: NONE }]);
        expect(PublishPackageDraftsResponseSchema.parse(res).seedApplied?.landed).toEqual(res.seedApplied.landed);
    });

    it('a publish with no seed carries no `seedApplied` at all, so no `landed`', async () => {
        const { p } = await makeProtocol();
        await stage(p, [{ type: 'object', name: ITEM, item: {
            name: ITEM, label: 'R2', sharingModel: 'public_read_write',
            fields: { name: { name: 'name', label: 'Name', type: 'text' } },
        } }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(res.outcome).toBe('published');
        expect('seedApplied' in res).toBe(false);
    });

    // [#30429] A load that THREW part-way reports `landed` for the datasets
    // that FINISHED before the throw — the same projection, the same two
    // lists — and leaves the dataset that threw out: its ids are only partly
    // known when it throws (`SeedLoadPartialWrites.finished`), while its rows
    // stay in the counts and its object in `error`.
    it('a load that threw: `landed` lists the seeds that finished, created vs matched, and not the one that threw', async () => {
        const { p, engine } = await makeProtocol();
        // A customer's own row sharing a seed key, so both lists are exercised.
        const customer: any = await engine.insert(ITEM, { name: 'R1' }, { context: { isSystem: true } } as any);
        await stage(p, [
            { type: 'seed', name: 'a_good', item: seed(['R1', 'R2', 'R3']) },
            { type: 'seed', name: 'z_missing', item: { object: MISSING, mode: 'ignore', records: [{ name: 'Z' }] } },
        ]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        const rows = await rowsOf(engine);
        // Positive control: the good seed's rows DID land before the throw.
        expect(rows.map((r) => r.name)).toEqual(['R1', 'R2', 'R3']);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
        expect(res.seedApplied.inserted).toBe(2);
        const created = rows.filter((r) => r.name !== 'R1').map((r) => r.id);
        // One entry, for the seed that finished; none for the object that threw.
        expect(res.seedApplied.landed).toEqual([{ object: ITEM, inserted: list(created), matched: list([customer.id]) }]);
        // The wire contract keeps it on a failed apply too.
        expect(PublishPackageDraftsResponseSchema.parse(res).seedApplied?.landed).toEqual(res.seedApplied.landed);
    });

    it('a load that threw before any seed finished: `landed` is reported and empty, not absent', async () => {
        const { p, engine } = await makeProtocol();
        await stage(p, [{ type: 'seed', name: 'z_missing', item: { object: MISSING, mode: 'ignore', records: [{ name: 'Z' }] } }]);

        const res: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(await rowsOf(engine)).toEqual([]);
        expect(res.seedApplied.success).toBe(false);
        expect(res.seedApplied.inserted).toBe(0);
        expect(res.seedApplied.error).toContain(`'${MISSING}'`);
        expect(res.seedApplied.landed).toEqual([]);
    });

    it('the single-item door (`publishMetaItem`) carries the same `landed`, and its schema keeps it', async () => {
        const { p, engine } = await makeProtocol();
        const customer: any = await engine.insert(ITEM, { name: 'R1' }, { context: { isSystem: true } } as any);
        await stage(p, [{ type: 'seed', name: 'l_single', item: seed(['R1', 'R2']) }]);

        const res: any = await (p as any).publishMetaItem({ type: 'seed', name: 'l_single', packageId: PKG });

        const created = (await rowsOf(engine)).find((r) => r.name === 'R2')!.id;
        expect(res.seedApplied.landed).toEqual([{ object: ITEM, inserted: list([created]), matched: list([customer.id]) }]);
        expect(PublishMetaItemResponseSchema.parse(res).seedApplied?.landed).toEqual(res.seedApplied.landed);
    });
});
