// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The move door's facet against a stub host: what it asks the doors, and what
 * it does to the running process when a move stops. The route's answers on a
 * booted stack are pinned in `qa/dogfood/test/package-move-in.dogfood.test.ts`;
 * this file reaches what no booted stack can stage on request — a fault in the
 * middle of a move, an undo that fails, a refusal with no code of its own.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProtocolPackageMoveInFacet } from './protocol-package-move-in.js';

const TARGET = 'com.probe.zeta';

const flowRow = (name: string, checksum: string | null = null) => ({
    id: `row-${name}`, type: 'flow', name, state: 'active', package_id: null, member: null, checksum,
    metadata: JSON.stringify({ name, label: name, type: 'autolaunched', nodes: [], edges: [] }),
});

/** A refusal as a door throws one: a 4xx status, and a code when it has one. */
const refusal = (message: string, status: number, code?: string) =>
    Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

function stubHost(rows: ReadonlyArray<Record<string, unknown>>, opts: { rollback?: boolean } = {}) {
    const put = vi.fn(async () => undefined);
    const engine: Record<string, unknown> = {
        registry: { getPackage: () => ({ manifest: { namespace: 'zeta' } }), getPackageScopedItem: () => undefined },
    };
    if (opts.rollback !== false) engine.transaction = async (fn: () => Promise<unknown>) => fn();
    const host = {
        engine,
        refuseOrganizationScopedWrite: vi.fn(),
        ensureOverlayIndex: vi.fn(async () => undefined),
        findEnvironmentRows: vi.fn(async () => rows),
        isArtifactBacked: vi.fn(() => false),
        uninstalledNamedBaseRefusal: vi.fn(() => undefined),
        isWritablePackage: vi.fn(() => true),
        objectNamespacePrefixViolation: vi.fn(() => null),
        objectNamespaceObjectNameClash: vi.fn(() => null),
        classifyObjectContribution: vi.fn(() => ({ kind: 'new' })),
        overlayPackageMismatchError: vi.fn(),
        receiptVersion: vi.fn(async (stored: string) => `token:${stored}`),
        facade: { deleteMetaItem: vi.fn(async () => ({ success: true })) },
        saveMetaItem: vi.fn(async () => ({ success: true })),
        recordPackageCommit: vi.fn(async () => ({ commitId: 'c1' })),
        applyRegistryWriteThrough: vi.fn(async () => undefined),
        runMutationProjector: vi.fn(async () => undefined),
        emitMetadataMutation: vi.fn(),
        storedOverlayEntries: vi.fn((_q: unknown, stored: Array<Record<string, unknown>>) =>
            stored.map((r) => ({ name: r.name, data: JSON.parse(String(r.metadata)) }))),
        getOverlayRepo: vi.fn(() => ({ put })),
    };
    return { host, put };
}

const move = (host: unknown, items: Array<{ type: string; name: string }>, dryRun?: boolean) =>
    ProtocolPackageMoveInFacet.moveIntoPackage(host as never, { targetPackageId: TARGET, items, ...(dryRun ? { dryRun } : {}) });

describe('the move door facet (#38150)', () => {
    it('a dry run answers phase 0\'s judgement and calls no door, no projector and no signal', async () => {
        const { host } = stubHost([flowRow('f1')]);
        const answer = await move(host, [{ type: 'flow', name: 'f1' }], true);
        expect(answer.outcome).toBe('would_move');
        expect(answer.moved.map((m) => m.name)).toEqual(['f1']);
        expect(host.facade.deleteMetaItem).not.toHaveBeenCalled();
        expect(host.saveMetaItem).not.toHaveBeenCalled();
        expect(host.recordPackageCommit).not.toHaveBeenCalled();
        expect(host.applyRegistryWriteThrough).not.toHaveBeenCalled();
        expect(host.runMutationProjector).not.toHaveBeenCalled();
        expect(host.emitMetadataMutation).not.toHaveBeenCalled();
    });

    it('each delete names the version phase 0 read, so a write in between answers the delete door\'s conflict', async () => {
        const { host } = stubHost([flowRow('f1', 'h1'), flowRow('f2')]);
        const answer = await move(host, [{ type: 'flow', name: 'f1' }, { type: 'flow', name: 'f2' }]);
        expect(answer.outcome).toBe('moved');
        expect(host.receiptVersion).toHaveBeenCalledWith('h1');
        const deletes = host.facade.deleteMetaItem.mock.calls.map((c: any[]) => c[0]);
        expect(deletes[0]).toMatchObject({ name: 'f1', packageId: null, dropStorage: false, parentVersion: 'token:h1' });
        // A row stored with no version is deleted unpinned.
        expect(deletes[1]).not.toHaveProperty('parentVersion');

        // The conflict the delete door throws is the item's refusal, with its code.
        const raced = stubHost([flowRow('f1', 'h1')]);
        raced.host.facade.deleteMetaItem.mockRejectedValueOnce(
            refusal('Conflict on flow/f1: the version token sent is not the current version', 409, 'METADATA_CONFLICT'));
        const refused = await move(raced.host, [{ type: 'flow', name: 'f1' }]);
        expect(refused.outcome).toBe('refused');
        expect(refused.refused.map((r) => `${r.name}:${r.code}`)).toEqual(['f1:METADATA_CONFLICT']);
        expect(raced.host.saveMetaItem).not.toHaveBeenCalled();
    });

    it('after a rollback, every item the transaction touched is put back in the process: registry, projector and signal', async () => {
        const { host } = stubHost([flowRow('f1'), flowRow('f2')]);
        host.saveMetaItem
            .mockResolvedValueOnce({ success: true })
            .mockRejectedValueOnce(refusal("Flow 'f2' is invalid.", 422, 'VALIDATION_ERROR'));
        const answer = await move(host, [{ type: 'flow', name: 'f1' }, { type: 'flow', name: 'f2' }]);
        expect(answer.outcome).toBe('refused');
        expect(answer.refused).toEqual([{ type: 'flow', name: 'f2', code: 'VALIDATION_ERROR', error: "Flow 'f2' is invalid." }]);

        // The registry is written back at the package-less address, for both.
        const rewrites = host.applyRegistryWriteThrough.mock.calls.map((c: any[]) => c[0]);
        expect(rewrites.map((w: any) => `${w.name}@${w.packageId}<-${w.reboundFrom?.packageId}`).sort())
            .toEqual([`f1@null<-${TARGET}`, `f2@null<-${TARGET}`]);
        // The projector and the signal run again: deleted at the target, restored loose.
        const projected = host.runMutationProjector.mock.calls.map((c: any[]) => `${c[0].name}:${c[0].state}`);
        expect(projected).toEqual(['f2:deleted', 'f2:active', 'f1:deleted', 'f1:active']);
        const signalled = host.emitMetadataMutation.mock.calls.map((c: any[]) => c[0]);
        expect(signalled.map((s: any) => `${s.name}:${s.state}`)).toEqual(['f2:deleted', 'f2:active', 'f1:deleted', 'f1:active']);
        const restoredF1 = host.runMutationProjector.mock.calls.map((c: any[]) => c[0]).find((p: any) => p.name === 'f1' && p.state === 'active');
        expect(restoredF1.body).toMatchObject({ name: 'f1' });
    });

    it('a refusal with no code of its own is MOVE_FAILED, its declared sentence quoted', async () => {
        const { host } = stubHost([flowRow('f1')]);
        host.saveMetaItem.mockRejectedValueOnce(refusal('The flow cannot be saved here.', 400));
        const answer = await move(host, [{ type: 'flow', name: 'f1' }]);
        expect(answer.outcome).toBe('refused');
        expect(answer.refused).toEqual([{ type: 'flow', name: 'f1', code: 'MOVE_FAILED', error: 'The flow cannot be saved here.' }]);
    });

    it('a fault that is not a refusal is answered as a 500 fault, its code and text filtered, never as an item\'s refusal', async () => {
        const { host } = stubHost([flowRow('f1')]);
        host.saveMetaItem.mockRejectedValueOnce(Object.assign(new Error('SQLITE_BUSY: database is locked at /var/db'), { code: 'SQLITE_BUSY' }));
        const err: any = await move(host, [{ type: 'flow', name: 'f1' }]).then(() => undefined, (e) => e);
        expect(err?.status).toBe(500);
        expect(err.code).toBe('INTERNAL_ERROR');
        expect(err.message).toContain("Nothing was moved into package 'com.probe.zeta': the move of flow 'f1' failed");
        expect(err.message).not.toContain('SQLITE_BUSY');
        expect(err.message).not.toContain('/var/db');
        // The process is put back all the same.
        expect(host.runMutationProjector.mock.calls.map((c: any[]) => `${c[0].name}:${c[0].state}`)).toEqual(['f1:deleted', 'f1:active']);
    });

    it('a failed package commit is a fault of the commit, not of the last item', async () => {
        const { host } = stubHost([flowRow('f1')]);
        host.recordPackageCommit.mockRejectedValueOnce(refusal('commit refused', 422, 'VALIDATION_ERROR'));
        const err: any = await move(host, [{ type: 'flow', name: 'f1' }]).then(() => undefined, (e) => e);
        expect(err?.status).toBe(500);
        expect(err.message).toContain('recording the package commit failed');
    });

    it('an undo that fails answers a 500 naming what did not go back, never `refused`', async () => {
        // A runtime that cannot roll back: every landed step is undone by hand.
        const { host, put } = stubHost([flowRow('f1'), flowRow('f2')], { rollback: false });
        host.saveMetaItem
            .mockResolvedValueOnce({ success: true })
            .mockRejectedValueOnce(refusal("Flow 'f2' is invalid.", 422, 'VALIDATION_ERROR'));
        put.mockRejectedValueOnce(new Error('disk full'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const err: any = await move(host, [{ type: 'flow', name: 'f1' }, { type: 'flow', name: 'f2' }]).then(() => undefined, (e) => e);
            expect(err?.status).toBe(500);
            expect(err.code).toBeUndefined();
            expect(err.message).toContain('undoing what had already moved failed for flow/f2');
            expect(err.message).not.toContain('flow/f1,');
        } finally {
            error.mockRestore();
        }
        // f1 went back: removed from the target, put back loose, the process replayed loose.
        const undoDeletes = host.facade.deleteMetaItem.mock.calls.map((c: any[]) => c[0]).filter((d: any) => d.packageId === TARGET);
        expect(undoDeletes.map((d: any) => d.name)).toEqual(['f2', 'f1']);
        expect(host.runMutationProjector.mock.calls.map((c: any[]) => `${c[0].name}:${c[0].state}`)).toEqual(['f1:active']);
    });
});
