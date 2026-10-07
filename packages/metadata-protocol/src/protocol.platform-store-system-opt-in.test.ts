// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21911, ADR-0096] The metadata protocol's platform-store calls carry the
 * EXPLICIT system opt-in, never a principal-less context.
 *
 * plugin-security hands an engine operation whose context carries no user, no
 * position, no permission set and no `isSystem` straight to `next()` (the
 * ADR-0096 E1 hand-off). The protocol's own reads and writes of the
 * `sys_metadata` family reached the engine exactly that way — a `{ where }`
 * with no `context`, or a repository transaction context with only its
 * handle — so they worked only because the hand-off let them through. They
 * now pass `context: { isSystem: true }` (inside a repository transaction,
 * `{ ...ctx, isSystem: true }`, so the handle rides along), the opt-in that
 * already exists; nothing about what any door authorizes moves.
 *
 * The observation channel is the engine double's own record of the context
 * each call arrived with. Every step asserts it recorded at least one call
 * (so a step that stops reaching the store reds instead of passing over
 * nothing) and that every recorded call carried `isSystem: true`.
 *
 * The double is the pinned shape of `protocol-publish-drafts-org-scope.test.ts`
 * (its write verbs and `findOne` open with the producer's own dispatch
 * predicates), plus that recorder and a transaction that hands its callback a
 * real handle object, as `ObjectQL.transaction` does.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    [k: string]: unknown;
}

interface HistoryRow {
    id: string;
    organization_id: string | null;
    type: string;
    name: string;
    version: number;
    [k: string]: unknown;
}

interface EngineCall {
    verb: string;
    table: string;
    context: Record<string, unknown> | undefined;
}

const TRX = { trx: 'handle' };

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const calls: EngineCall[] = [];
    let nextId = 0;

    const record = (verb: string, table: string, context: unknown) => {
        calls.push({ verb, table, context: context as Record<string, unknown> | undefined });
    };

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        for (const k of ['organization_id', 'type', 'name', 'version', 'checksum'] as const) {
            if (w[k] !== undefined && h[k] !== w[k]) return false;
        }
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown>; context?: unknown }) {
            assertEngineFindOnePredicate(table, opts);
            record('findOne', table, opts.context);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number; context?: unknown }) {
            record('find', table, opts?.context);
            const hits: unknown[] = table === 'sys_metadata_history'
                ? historyRows.filter((h) => matchesHistory(h, opts.where ?? {}))
                : table === 'sys_metadata'
                    ? Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where ?? {}))
                    : [];
            // The caller's bound, applied after the filter, by presence.
            return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
        },
        async insert(table: string, data: Record<string, unknown>, options?: { context?: unknown }) {
            record('insert', table, options?.context);
            nextId += 1;
            if (table === 'sys_metadata_history') {
                historyRows.push({ id: `h_${nextId}`, ...(data as any) });
                return { id: `h_${nextId}` };
            }
            if (table !== 'sys_metadata') return { id: `${table}_${nextId}` };
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown>; context?: unknown }) {
            assertEngineUpdateDispatch(data, opts);
            record('update', table, opts.context);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown>; context?: unknown }) {
            assertEngineDeleteDispatch(opts);
            record('delete', table, opts.context);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb({ transaction: TRX }, { owned: true });
        },
        registry: {
            registerItem: () => undefined,
            registerObject: () => undefined,
            unregisterItem: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    return { engine, rows, historyRows, calls };
}

const viewBody = (name: string) => ({
    name,
    label: 'Project Tasks',
    object: 'proj_task',
    viewKind: 'list',
    columns: [{ field: 'title', label: 'Title' }],
});

/**
 * Runs `step`, then asserts it reached the store and that every engine call
 * it issued carried the explicit system opt-in.
 */
async function expectSystemOptIn(
    calls: EngineCall[],
    label: string,
    step: () => Promise<unknown>,
): Promise<EngineCall[]> {
    const from = calls.length;
    await step();
    const issued = calls.slice(from);
    expect(issued.length, `${label}: reached the store`).toBeGreaterThan(0);
    const principalLess = issued.filter((c) => c.context?.isSystem !== true);
    expect(principalLess, `${label}: every engine call carries isSystem: true`).toEqual([]);
    return issued;
}

describe('platform-store calls carry the explicit system opt-in (#21911)', () => {
    it('the repository write path: draft save, publish, active save, rollback, delete', async () => {
        const { engine, calls } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // SysMetadataRepository.put (create, draft) + the two lineage counters.
        const draftCalls = await expectSystemOptIn(calls, 'draft save', () => protocol.saveMetaItem({
            type: 'view', name: 'proj_task_grid', item: viewBody('proj_task_grid'),
            packageId: 'app.pin', mode: 'draft',
        }));
        // Inside the repository transaction the handle rides along with the opt-in.
        const inTxn = draftCalls.filter((c) => c.context?.transaction !== undefined);
        expect(inTxn.length, 'the put transaction reached the store').toBeGreaterThan(0);
        for (const c of inTxn) expect(c.context).toEqual({ transaction: TRX, isSystem: true });

        // publishPackageDrafts: listDrafts, its pre-publish active-row read,
        // promoteDraft (+ put), recordMetadataAudit and persistPackageCommitRow.
        const publishCalls = await expectSystemOptIn(calls, 'publish', async () => {
            const res = await protocol.publishPackageDrafts({ packageId: 'app.pin' });
            expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        });
        expect(publishCalls.some((c) => c.table === 'sys_metadata_audit' && c.verb === 'insert')).toBe(true);
        expect(publishCalls.some((c) => c.table === 'sys_metadata_commit' && c.verb === 'insert')).toBe(true);

        // put (update) + the runtime authoring gate's stored-collection fold.
        await expectSystemOptIn(calls, 'active save', () => protocol.saveMetaItem({
            type: 'view', name: 'proj_task_grid',
            item: { ...viewBody('proj_task_grid'), label: 'Project Tasks v2' },
            packageId: 'app.pin', mode: 'publish', force: true,
        }));

        // restoreVersion (history read + active read, then put).
        await expectSystemOptIn(calls, 'rollback', async () => {
            await protocol.rollbackMetaItem({ type: 'view', name: 'proj_task_grid', toVersion: 1 } as any);
        });

        // SysMetadataRepository.delete (findOne, delete, tombstone insert).
        const deleteCalls = await expectSystemOptIn(calls, 'delete', () => protocol.deleteMetaItem({
            type: 'view', name: 'proj_task_grid', force: true,
        } as any));
        expect(deleteCalls.some((c) => c.verb === 'delete' && c.table === 'sys_metadata')).toBe(true);
    });

    it('the overlay reads: served row, lock layer, list read, draft preview', async () => {
        const { engine, calls } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine) as any;

        await protocol.saveMetaItem({
            type: 'view', name: 'proj_task_grid', item: viewBody('proj_task_grid'),
            packageId: 'app.pin', mode: 'draft',
        });

        // findServedOverlayRow + overlayLockLayerAt (the by-name read).
        await expectSystemOptIn(calls, 'by-name read', () => protocol.getMetaItem({ type: 'view', name: 'proj_task_grid' }));
        // readFlattenedMetaItems: readActiveOverlayRows' queryByOrg + the draft preview.
        await expectSystemOptIn(calls, 'list read with draft preview', () => protocol.getMetaItems({
            type: 'view', previewDrafts: true,
        }));
        // Each private reader on its own, so no caller can mask one of them.
        await expectSystemOptIn(calls, 'findServedOverlayRow', () => protocol.findServedOverlayRow({
            type: 'view', name: 'proj_task_grid', orgId: 'org_a', state: 'draft', packageId: 'app.pin',
        }));
        await expectSystemOptIn(calls, 'overlayLockLayerAt', () => protocol.overlayLockLayerAt(
            { type: 'view', name: 'proj_task_grid', organizationId: 'org_a' }, { otherSpelling: true },
        ));
        await expectSystemOptIn(calls, 'readActiveOverlayRows', () => protocol.readActiveOverlayRows({ type: 'view' }, 'org_a'));
        await expectSystemOptIn(calls, 'foldStoredCollection', () => protocol.foldStoredCollection([], 'object', 'objects', 'org_a'));
        await expectSystemOptIn(calls, 'resolveOverlayPackageBinding', () => protocol.resolveOverlayPackageBinding('view', 'proj_task_grid', 'org_a'));
        await expectSystemOptIn(calls, 'storedFlowBindingAgrees', () => protocol.storedFlowBindingAgrees('flow_a', 'app.pin'));
        await expectSystemOptIn(calls, 'recordMetadataAudit', () => protocol.recordMetadataAudit({
            type: 'view', name: 'proj_task_grid', operation: 'update', outcome: 'success', code: 'OK',
        }));
        await expectSystemOptIn(calls, 'persistPackageCommitRow', () => protocol.persistPackageCommitRow({ id: 'c_1' }));
    });

    it('the package verbs: reassign orphans, duplicate, uninstall', async () => {
        const { engine, calls } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'orphan_grid', item: viewBody('orphan_grid'), mode: 'publish',
        });

        const reassignCalls = await expectSystemOptIn(calls, 'reassignOrphanedMetadata', async () => {
            const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.pin' });
            expect(res.reassignedCount).toBe(1);
        });
        expect(reassignCalls.map((c) => c.verb)).toEqual(['find', 'update']);

        await expectSystemOptIn(calls, 'duplicatePackage', async () => {
            await protocol.duplicatePackage({
                sourcePackageId: 'app.pin', targetPackageId: 'com.example.pincopy', targetNamespace: 'pincopy',
            } as any).catch(() => undefined);
        });
        await expectSystemOptIn(calls, 'deletePackage', async () => {
            await protocol.deletePackage({ packageId: 'com.example.pincopy', allTenants: true } as any).catch(() => undefined);
        });
    });
});

describe('[#21908] row 23 — the repository reads the engine-lane slice left carry the opt-in', () => {
    it('SysMetadataRepository.getByHash, list, history and watch’s replay', async () => {
        const { engine, calls, historyRows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'proj_task_grid', item: viewBody('proj_task_grid'), mode: 'publish',
        });
        // The population the reads below must find, written by the save above.
        expect(historyRows.length).toBeGreaterThan(0);
        const hash = String(historyRows[0].checksum);
        const ref = { type: 'view', name: 'proj_task_grid' } as any;
        const repo = new SysMetadataRepository({ engine, organizationId: null });

        await expectSystemOptIn(calls, 'getByHash', async () => {
            expect(await repo.getByHash(ref, hash)).not.toBeNull();
        });
        await expectSystemOptIn(calls, 'list', async () => {
            const headers: unknown[] = [];
            for await (const h of repo.list({ type: 'view' } as any)) headers.push(h);
            expect(headers).toHaveLength(1);
        });
        await expectSystemOptIn(calls, 'history', async () => {
            const events: unknown[] = [];
            for await (const e of repo.history(ref)) events.push(e);
            expect(events.length).toBeGreaterThan(0);
        });
        await expectSystemOptIn(calls, 'replayFromHistory', async () => {
            const it = repo.watch({} as any, 0)[Symbol.asyncIterator]();
            expect((await it.next()).done).toBe(false);
            await it.return?.();
        });
    });
});
