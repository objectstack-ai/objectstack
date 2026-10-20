// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23033 — a metadata write that names its author stores that author on the
 * `sys_metadata` row, read back from the row the REAL engine stored.
 *
 * ## The defect
 *
 * `SysMetadataRepository`'s header maps `actor → updated_by`, and its read
 * side (`rowToItem`'s `authoredBy`, `listDrafts`' `updatedBy`) reads
 * `updated_by ?? created_by`. But `put()` built the parent row with neither
 * column and wrote it under `isSystem`, whose context carries no user, so the
 * engine's own audit stamp (`sys_stamp_audit_insert` / `_update`, which stamp
 * the `*_by` pair only from `session.userId`) had nobody to write either.
 * Every metadata row read `created_by` / `updated_by` null; the actor reached
 * only the history row's `recorded_by`.
 *
 * ## Why this file is here and not beside the repository
 *
 * The repository suite (`sys-metadata-repository.recorded-by.test.ts`) can only
 * prove the repository HANDS the engine the pair — its engine is a fake that
 * stores what it is given. What this card owes on top is that the pair
 * SURVIVES the engine: `created_by` is `readonly: true` on `sys_metadata`, the
 * static-readonly strip runs inside `engine.insert` / `engine.update` after the
 * `before*` hooks, and the audit hooks rewrite the `*_by` pair whenever a
 * session user is present. So the write goes through a real kernel —
 * `ObjectQLPlugin` binds the real audit hooks and assembles the real protocol
 * and `sys_metadata` declaration — and every pin reads the stored row out of
 * the driver, never the payload. `metadata-protocol` cannot host this: it must
 * not depend on `objectql`, even as a devDependency (the same reason
 * `plugin.authoring-channel.test.ts` lives here).
 *
 * ## The pins (the triage direction's)
 *
 *  - a first write with actor A stores `created_by` A and `updated_by` A;
 *  - a second write with actor B stores `created_by` A and `updated_by` B;
 *  - CONTROL: a write with no actor stores both null — no placeholder user;
 *  - history's `recorded_by` is unchanged: each history row names its own
 *    write's actor, exactly as before;
 *  - the door's read-back: `listDrafts` answers `updatedBy` from the row.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `environment-overlay-email-locale-restart.test.ts`; equality-only WHERE. */
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

const ALICE = 'usr_alice';
const BOB = 'usr_bob';
const NAME = 'case_grid';

// [#21470] `name` is the row's: a body `name` that is not its row's is refused by the write doors.
// [#24668] Bound to `sys_metadata`, an object this harness registers: the overlay save door refuses a list view bound to an object that exists nowhere (it read `case`).
const viewBody = (label: string) => ({ name: NAME, type: 'grid', label, columns: ['id'], object: 'sys_metadata', viewKind: 'list' });

describe('#23033 — the sys_metadata row records who created it and who last changed it', () => {
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

    /** The stored `sys_metadata` rows for the view, as the driver holds them. */
    const parentRows = (state: 'active' | 'draft' = 'active') =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r) => r.type === 'view' && r.name === NAME && r.state === state);
    const parentRow = (state: 'active' | 'draft' = 'active') => {
        const rows = parentRows(state);
        expect(rows, `exactly one ${state} row for view/${NAME}`).toHaveLength(1);
        return rows[0]!;
    };
    /** `recorded_by` per history row, in write order. */
    const recordedBy = () =>
        Array.from(stores.get('sys_metadata_history')?.values() ?? [])
            .filter((h) => h.type === 'view' && h.name === NAME)
            .sort((a, b) => Number(a.version) - Number(b.version))
            .map((h) => h.recorded_by ?? null);

    it('a first write with actor A stores created_by A and updated_by A', async () => {
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('A'), actor: ALICE });

        const row = parentRow();
        expect(row.created_by).toBe(ALICE);
        expect(row.updated_by).toBe(ALICE);
        expect(recordedBy()).toEqual([ALICE]);
    });

    it('a second write with actor B keeps created_by A and moves updated_by to B', async () => {
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('A'), actor: ALICE });
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('B'), actor: BOB });

        const row = parentRow();
        expect(row.created_by, 'created_by never changes after the insert').toBe(ALICE);
        expect(row.updated_by, 'updated_by names the latest writer').toBe(BOB);
        // History is unchanged: each row still names its own write's actor.
        expect(recordedBy()).toEqual([ALICE, BOB]);
    });

    it('CONTROL: a write with no actor stores both columns null — no placeholder user', async () => {
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('A') });

        const row = parentRow();
        expect(row.created_by ?? null).toBeNull();
        expect(row.updated_by ?? null).toBeNull();
        expect(recordedBy()).toEqual([null]);
    });

    it('the door reads the row back: listDrafts answers updatedBy from the draft row', async () => {
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('A'), actor: ALICE, mode: 'draft' });
        await protocol.saveMetaItem({ type: 'view', name: NAME, item: viewBody('B'), actor: BOB, mode: 'draft' });

        const row = parentRow('draft');
        expect(row.created_by).toBe(ALICE);
        expect(row.updated_by).toBe(BOB);
        const { drafts } = await protocol.listDrafts({ type: 'view' });
        expect(drafts.map((d: any) => [d.name, d.updatedBy])).toEqual([[NAME, BOB]]);
    });
});
