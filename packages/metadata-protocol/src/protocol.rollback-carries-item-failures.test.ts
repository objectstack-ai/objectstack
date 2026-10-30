// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `rollbackToPackageCommit` carries every item a `revertCommit` step refused
// into its own `failed[]`, and answers `success: false` for it.
//
// A package rollback is a loop of `revertCommit` calls, newest commit first.
// `revertCommit` reports an item it refuses — here the restore of a row stored
// under a non-canonical type, `STORED_TYPE_NOT_CANONICAL` — in its RETURNED
// per-item `failed[]`; it does not throw. The rollback read only a thrown
// error, so it dropped the returned refusals and answered `success: true` for
// a package left half rolled back, naming nothing it had left in place.
//
// The declared answer (`RollbackToPackageCommitResponseSchema`) says
// `success` is "True exactly when nothing failed", and each `failed[]` entry
// is `{ commitId, error }`. A refused item therefore lands as one entry: the
// commit it belongs to, and an `error` that names the item (`type/name`) and
// quotes `revertCommit`'s client-facing refusal text.
//
// Driven over the real `SysMetadataRepository`, with the commit ledger served
// by the engine double so `listCommits` plans the rollback itself.

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, from
// `@objectstack/metadata-core` — objectql depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
}

const PKG = 'app.demo';

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/** One `apply` commit row in the driver's snake_case wire shape. */
const applyCommit = (id: string, createdAt: string, items: unknown[]) => ({
    id,
    package_id: PKG,
    organization_id: null,
    operation: 'apply',
    message: `commit ${id}`,
    item_count: items.length,
    created_at: createdAt,
    items: JSON.stringify(items),
});

function makeProtocol(opts: { unreadableCommits?: readonly string[] } = {}) {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const commits: Array<Record<string, unknown>> = [];
    const unreadable = new Set(opts.unreadableCommits ?? []);
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesWhere(r as any, w)) return { key: k, row: r };
        return null;
    };
    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean =>
        (['organization_id', 'type', 'name', 'version', 'operation_type'] as const)
            .every((k) => w[k] === undefined || h[k] === w[k]);

    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_commit') {
                // A commit the ledger LISTS but whose own read answers nothing —
                // the inner `revertCommit` then throws `COMMIT_NOT_FOUND`.
                if (unreadable.has(String(o.where.id))) return null;
                return commits.find((c) => c.id === o.where.id) ?? null;
            }
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, o.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_commit') {
                return commits.filter((c) => c.package_id === o?.where?.package_id);
            }
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, o?.where ?? {}));
            }
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r as any, o?.where ?? {}));
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata_commit') {
                commits.push({ ...data });
                return { id: String(data.id ?? `cm_${nextId}`) };
            }
            if (table === 'sys_metadata_history') {
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(o);
            const found = findRow(o.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: () => undefined,
            registerObject: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => undefined,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
    return { protocol, rows, commits };
}

/** Write a row through the repository, which stores `type` exactly as given. */
async function seed(protocol: any, type: string, name: string, label: string): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(null);
    const ref = { type, name, org: 'env' };
    const existing = await repo.get(ref, { state: 'active' });
    await repo.put(ref, { name, label }, {
        parentVersion: existing?.hash ?? null,
        actor: null,
        source: 'test.rollback-item-failures',
        intent: 'runtime-only',
        state: 'active',
    });
}

const stored = (rows: Map<string, Row>, type: string, name: string): any => {
    for (const r of rows.values()) if (r.type === type && r.name === name) return JSON.parse(r.metadata);
    return undefined;
};

/**
 * The package's history: target `c0`; `c1` created `view/created_in_c1`;
 * `c2` created `view/created_in_c2`, edited `view/grid` (V1 → V2) and edited
 * `fields/a.b` (V1 → V2). The `fields` row is stored under the non-canonical
 * type, so `revertCommit` refuses to restore it (`STORED_TYPE_NOT_CANONICAL`).
 */
async function seedPackage(protocol: any, commits: Array<Record<string, unknown>>, opts: { refusedItem: boolean }) {
    await seed(protocol, 'view', 'grid', 'V1');
    await seed(protocol, 'view', 'grid', 'V2');
    await seed(protocol, 'view', 'created_in_c1', 'C1');
    await seed(protocol, 'view', 'created_in_c2', 'C2');
    if (opts.refusedItem) {
        await seed(protocol, 'fields', 'a.b', 'V1');
        await seed(protocol, 'fields', 'a.b', 'V2');
    }
    commits.push(
        applyCommit('c0', '2026-01-01T00:00:00Z', []),
        applyCommit('c1', '2026-01-02T00:00:00Z', [
            { type: 'view', name: 'created_in_c1', existedBefore: false, prevVersion: null },
        ]),
        applyCommit('c2', '2026-01-03T00:00:00Z', [
            { type: 'view', name: 'grid', existedBefore: true, prevVersion: 1 },
            ...(opts.refusedItem ? [{ type: 'fields', name: 'a.b', existedBefore: true, prevVersion: 1 }] : []),
            { type: 'view', name: 'created_in_c2', existedBefore: false, prevVersion: null },
        ]),
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('rollbackToPackageCommit carries the items a revert step refused', () => {
    it('answers `success: false` and names the commit, the item and the refusal text', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { protocol, rows, commits } = makeProtocol();
        await seedPackage(protocol, commits, { refusedItem: true });

        // What the inner step itself reports for the refused item — the text
        // the rollback must carry.
        const refusal = 'is stored under the non-canonical metadata type \'fields\'';

        const res = await protocol.rollbackToPackageCommit({ commitId: 'c0' });

        expect(res.success).toBe(false);
        expect(res.failed).toHaveLength(1);
        expect(Object.keys(res.failed[0]).sort()).toEqual(['commitId', 'error']);
        expect(res.failed[0].commitId).toBe('c2');
        expect(res.failed[0].error).toContain('fields/a.b');
        expect(res.failed[0].error).toContain(refusal);
        expect(res.failed[0].error).toContain('PUT /meta/field/a.b');

        // Everything else is rolled back as before: both commits are reverted
        // (each step records its own revert commit) and the neighbours of the
        // refused item are undone.
        expect([...res.revertedCommits].sort()).toEqual(['c1', 'c2']);
        expect(stored(rows, 'view', 'created_in_c1')).toBeUndefined();
        expect(stored(rows, 'view', 'created_in_c2')).toBeUndefined();
        expect(stored(rows, 'view', 'grid')?.label).toBe('V1');
        // The refused item stayed as it was.
        expect(stored(rows, 'fields', 'a.b')?.label).toBe('V2');
    });

    it('control: an all-clean rollback answers `success: true` with an empty `failed[]`', async () => {
        const { protocol, rows, commits } = makeProtocol();
        await seedPackage(protocol, commits, { refusedItem: false });

        const res = await protocol.rollbackToPackageCommit({ commitId: 'c0' });

        expect(res).toEqual({ success: true, revertedCommits: expect.any(Array), failed: [] });
        expect([...res.revertedCommits].sort()).toEqual(['c1', 'c2']);
        expect(stored(rows, 'view', 'grid')?.label).toBe('V1');
    });

    it('control: a commit whose revert throws still lands in `failed[]`, and the next commit is still reverted', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { protocol, rows, commits } = makeProtocol({ unreadableCommits: ['c2'] });
        await seedPackage(protocol, commits, { refusedItem: false });

        const res = await protocol.rollbackToPackageCommit({ commitId: 'c0' });

        expect(res.success).toBe(false);
        expect(res.failed).toEqual([{ commitId: 'c2', error: "No commit 'c2'." }]);
        expect(res.revertedCommits).toEqual(['c1']);
        expect(stored(rows, 'view', 'created_in_c1')).toBeUndefined();
        expect(stored(rows, 'view', 'grid')?.label).toBe('V2');
    });
});
