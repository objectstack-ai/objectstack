// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `revertCommit` answers only what it achieved.
 *
 * The governing text is the method's own docblock on `protocol.ts` — "a revert
 * that answers `success: true` is one the running process has already acted
 * on" — and ADR-0067 D3.
 *
 * §1 [#33563] A step AFTER an item's row write (the registry write-through,
 * the storage sync, the mutation projector, or a throw from any of them)
 * that does not land puts the item in `failed[]`, with the row state named,
 * and the answer's `success` is false. The revert's own commit still records
 * the row change, because the row did change.
 *
 * Measured before the fix, on this harness: each case below answered
 * `{ success: true, reverted: [{ …, action: 'restored' | 'removed' }],
 * failed: [] }`, and the only trace was a `warn` line on stderr.
 *
 * The harness is an in-memory stub engine under the real
 * `SysMetadataRepository` (the pattern of
 * `protocol.recovery-doors-mutation-projector.test.ts`), with a commit store
 * that keeps every commit row the protocol records, so a revert commit can be
 * read back and reverted in its turn. The import is the same-package relative
 * `./protocol.js`, so vitest compiles the source itself: no rebuild between
 * an ablation and its run.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG = 'app.demo';
const INSTALLED_PACKAGES: ReadonlySet<string> = new Set([PKG]);
const installedPackage = (id: string) => (INSTALLED_PACKAGES.has(id) ? { manifest: { id } } : undefined);

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
}

interface CommitRow {
    id: string;
    package_id: string;
    operation: 'apply' | 'revert';
    parent_commit_id?: string;
    items: string;
    created_at?: string;
    [k: string]: unknown;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const commits: CommitRow[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_commit') return commits.find((c) => c.id === opts.where.id) ?? null;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_commit') {
                return bound(commits.filter((c) => opts?.where?.package_id === undefined || c.package_id === opts.where.package_id));
            }
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_commit') {
                commits.push({ ...(data as unknown as CommitRow) });
                return { id: data.id };
            }
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: installedPackage,
            getArtifactItem: () => undefined,
        },
    };
    return { engine, rows, commits };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), 'env_prod') as any;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    /** Set to make the next projector call fail, the way a projector that throws does. */
    const projector = { fail: false, calls: 0 };
    protocol.registerMutationProjector('object', async () => {
        projector.calls += 1;
        if (projector.fail) throw new Error('SQLITE_ERROR: no such table: sys_permission_set');
    });
    return { protocol, projector, ...h };
}

/** An `apply` commit of `PKG`, recorded directly in the commit store. */
function recordApply(commits: CommitRow[], id: string, items: unknown[]) {
    commits.push({
        id,
        commit_id: id,
        package_id: PKG,
        organization_id: null,
        operation: 'apply',
        message: `the commit ${id}`,
        created_at: '2026-01-01T00:00:00Z',
        items: JSON.stringify(items),
    });
}

const objectBody = (label: string) => ({
    name: 'ticket',
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** The stored active row's label: what the row holds, whatever the answer says. */
const storedLabel = (rows: Map<string, Row>): string | undefined => {
    for (const r of rows.values()) {
        if (r.type === 'object' && r.name === 'ticket' && r.state === 'active') return JSON.parse(r.metadata).label;
    }
    return undefined;
};

/** Saved twice: version 1 is 'Ticket', version 2 (served) is 'Renamed'. */
async function editedTwice() {
    const rig = makeProtocol();
    await rig.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: objectBody('Ticket'), packageId: PKG });
    await rig.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: objectBody('Renamed'), packageId: PKG });
    recordApply(rig.commits, 'c1', [{ type: 'object', name: 'ticket', existedBefore: true, prevVersion: 1 }]);
    return rig;
}

/** Saved once, by the commit under revert: the revert soft-removes it. */
async function createdByTheCommit() {
    const rig = makeProtocol();
    await rig.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: objectBody('Ticket'), packageId: PKG });
    recordApply(rig.commits, 'c1', [{ type: 'object', name: 'ticket', existedBefore: false, prevVersion: null }]);
    return rig;
}

const revertsOf = (commits: CommitRow[], parent: string) =>
    commits.filter((c) => c.operation === 'revert' && c.parent_commit_id === parent);

afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// §1 [#33563] A fault after the row write is a failed item, with the row named
// ═══════════════════════════════════════════════════════════════════════════

describe('[#33563] revertCommit reports a fault after an item\'s row write in failed[]', () => {
    it('control: a clean restore reverts the item and answers success', async () => {
        const { protocol, rows, commits } = await editedTwice();

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(res).toMatchObject({ success: true, revertedCount: 1, failedCount: 0, failed: [] });
        expect(res.reverted).toEqual([{ type: 'object', name: 'ticket', action: 'restored' }]);
        expect(storedLabel(rows)).toBe('Ticket');
        expect(revertsOf(commits, 'c1')).toHaveLength(1);
    });

    it('the registry refusing the restored object: failed[], row state and code named, success false', async () => {
        const { protocol, rows, commits, engine } = await editedTwice();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        engine.registry.registerObject = () => {
            throw Object.assign(new Error('Object "ticket" is already owned by package "app.other".'), {
                code: 'NAMESPACE_CONFLICT', status: 422,
            });
        };

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.reverted).toEqual([]);
        expect(res.failedCount).toBe(1);
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket', code: 'NAMESPACE_CONFLICT' });
        expect(res.failed[0].error).toContain('its row was restored to the body of version 1');
        expect(res.failed[0].error).toContain('already owned by package "app.other"');
        // The row change happened, and the revert's own commit records it.
        expect(storedLabel(rows)).toBe('Ticket');
        const [revert] = revertsOf(commits, 'c1');
        expect(JSON.parse(revert.items).map((i: any) => [i.type, i.name])).toEqual([['object', 'ticket']]);
    });

    it('the storage sync refused: failed[] naming the advisory, which stays on advisories', async () => {
        const { protocol, rows, engine } = await editedTwice();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        engine.syncObjectSchema = async () => { throw new Error('the datasource is read-only'); };

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.reverted).toEqual([]);
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket' });
        expect(res.failed[0].error).toContain('its row was restored to the body of version 1');
        expect(res.failed[0].error).toContain("'object-storage-sync-refused' advisory");
        expect((res.advisories ?? []).map((a: any) => a.rule)).toContain('object-storage-sync-refused');
        expect(storedLabel(rows)).toBe('Ticket');
    });

    it('the projector failing on the restore limb: failed[], and the projector\'s driver text is not quoted', async () => {
        const { protocol, projector } = await editedTwice();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        projector.fail = true;
        projector.calls = 0;

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(projector.calls).toBe(1);
        expect(res.success).toBe(false);
        expect(res.reverted).toEqual([]);
        expect(res.failed[0].error).toContain('its row was restored to the body of version 1');
        expect(res.failed[0].error).toContain('mutation projector failed');
        expect(res.failed[0].error).not.toContain('SQLITE_ERROR');
    });

    it('the projector failing on the soft-remove limb: failed[] names the removed row', async () => {
        const { protocol, projector, rows, commits } = await createdByTheCommit();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        projector.fail = true;

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.reverted).toEqual([]);
        expect(res.failed[0].error).toContain('its row was removed from sys_metadata');
        expect(res.failed[0].error).toContain('mutation projector failed');
        expect(storedLabel(rows)).toBeUndefined();
        expect(JSON.parse(revertsOf(commits, 'c1')[0].items)).toHaveLength(1);
    });

    it('a throw after the row write: the failed entry names the row state beside the refusal', async () => {
        const { protocol, rows, engine } = await editedTwice();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        engine.registry.registerItem = () => {
            throw Object.assign(new Error('The registry is sealed for this object.'), { code: 'NOT_OVERRIDABLE', status: 403 });
        };

        const res = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket', code: 'NOT_OVERRIDABLE' });
        expect(res.failed[0].error).toContain('its row was restored to the body of version 1');
        expect(res.failed[0].error).toContain('The registry is sealed for this object.');
        expect(storedLabel(rows)).toBe('Ticket');
    });

    it('rollbackToPackageCommit carries the step\'s post-row-write fault and answers success false', async () => {
        const { protocol, commits, engine } = await editedTwice();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        recordApply(commits, 'c0', []);
        commits[commits.length - 1].created_at = '2025-12-31T00:00:00Z';
        engine.registry.registerObject = () => {
            throw Object.assign(new Error('Object "ticket" is already owned by package "app.other".'), {
                code: 'NAMESPACE_CONFLICT', status: 422,
            });
        };

        const res = await protocol.rollbackToPackageCommit({ commitId: 'c0', packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.revertedCommits).toEqual(['c1']);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0].error).toContain("Item 'object/ticket' was not reverted");
        expect(res.failed[0].error).toContain('its row was restored to the body of version 1');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 [#33564, ADR-0067 D3] A revert is itself revertible
// ═══════════════════════════════════════════════════════════════════════════
//
// Measured before the fix, on this harness: the revert commit recorded every
// item as `prevVersion: null` (`existedBefore` true only for a restored item),
// so reverting it took neither limb for a restored item (in neither
// `reverted[]` nor `failed[]`, `success: false` with nothing said) and sent a
// removed item down the soft-remove limb again, recreating nothing.

describe('[#33564] reverting a revert commit restores what the revert replaced', () => {
    it('restore limb: the revert records the version it replaced, and reverting it brings that body back', async () => {
        const { protocol, rows, commits } = await editedTwice();

        const first = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });
        expect(first.success).toBe(true);
        expect(storedLabel(rows)).toBe('Ticket');
        const [revert] = revertsOf(commits, 'c1');
        expect(JSON.parse(revert.items)).toEqual([
            { type: 'object', name: 'ticket', existedBefore: true, prevVersion: 2 },
        ]);

        const second = await protocol.revertCommit({ commitId: revert.id, packageId: PKG });

        expect(second).toMatchObject({ success: true, revertedCount: 1, failed: [] });
        expect(second.reverted).toEqual([{ type: 'object', name: 'ticket', action: 'restored' }]);
        expect(storedLabel(rows)).toBe('Renamed');
    });

    it('soft-remove limb: the revert records the removed row\'s version, and reverting it writes the row again', async () => {
        const { protocol, rows, commits } = await createdByTheCommit();

        const first = await protocol.revertCommit({ commitId: 'c1', packageId: PKG });
        expect(first.reverted).toEqual([{ type: 'object', name: 'ticket', action: 'removed' }]);
        expect(storedLabel(rows)).toBeUndefined();
        const [revert] = revertsOf(commits, 'c1');
        expect(JSON.parse(revert.items)).toEqual([
            { type: 'object', name: 'ticket', existedBefore: true, prevVersion: 1 },
        ]);

        const second = await protocol.revertCommit({ commitId: revert.id, packageId: PKG });

        expect(second).toMatchObject({ success: true, revertedCount: 1, failed: [] });
        expect(second.reverted).toEqual([{ type: 'object', name: 'ticket', action: 'restored' }]);
        expect(storedLabel(rows)).toBe('Ticket');
    });

    it('an item recorded as existing with no version is named in failed[], never skipped, and nothing is written', async () => {
        // The shape every revert commit an earlier release recorded carries.
        const { protocol, rows, commits } = await editedTwice();
        recordApply(commits, 'legacy_revert', [{ type: 'object', name: 'ticket', existedBefore: true, prevVersion: null }]);

        const res = await protocol.revertCommit({ commitId: 'legacy_revert', packageId: PKG });

        expect(res).toMatchObject({ success: false, revertedCount: 0, failedCount: 1, reverted: [] });
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket' });
        expect(res.failed[0].error).toContain('records no version to restore it to, so nothing was written');
        expect(res.failed[0].error).toContain('/api/v1/meta/object/ticket/rollback');
        expect(storedLabel(rows)).toBe('Renamed');
    });
});
