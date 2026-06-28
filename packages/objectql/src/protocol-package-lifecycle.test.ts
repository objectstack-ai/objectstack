// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 — package-level lifecycle beyond publish:
 *  - `discardPackageDrafts` — abandon all pending edits, revert to the published
 *    baseline (NON-destructive: drafts only, no table teardown).
 *  - `deletePackage` — remove the whole package (active + draft) and, by
 *    default, tear down each object's physical table (DESTRUCTIVE).
 *
 * These tests cover the orchestration (which per-item `deleteMetaItem` calls are
 * made, with which flags) — the teardown itself is covered in
 * protocol-publish-rollback.test.ts.
 */

describe('protocol.discardPackageDrafts', () => {
    function makeProtocol(drafts: Array<{ type: string; name: string }>) {
        const protocol = new ObjectStackProtocolImplementation({} as never);
        (protocol as any).ensureOverlayIndex = async () => {};
        (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => drafts });
        const deleteMetaItem = vi.spyOn(protocol, 'deleteMetaItem' as never);
        deleteMetaItem.mockResolvedValue({ success: true } as never);
        return { protocol, deleteMetaItem };
    }

    it('discards every draft (state:draft, NO teardown) and reports success', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([
            { type: 'object', name: 'course' },
            { type: 'view', name: 'course_list' },
        ]);
        const res = await protocol.discardPackageDrafts({ packageId: 'app.edu' });
        expect(deleteMetaItem).toHaveBeenCalledTimes(2);
        const first = deleteMetaItem.mock.calls[0][0] as any;
        expect(first).toMatchObject({ type: 'object', name: 'course', state: 'draft' });
        expect(first).not.toHaveProperty('dropStorage'); // never tears down published data
        expect(res).toMatchObject({ success: true, discardedCount: 2, failedCount: 0 });
    });

    it('collects per-item failures without aborting', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([
            { type: 'object', name: 'course' },
            { type: 'view', name: 'course_list' },
        ]);
        (deleteMetaItem as any).mockImplementation(async (req: any) => {
            if (req.name === 'course_list') throw Object.assign(new Error('locked'), { code: 'locked' });
            return { success: true };
        });
        const res = await protocol.discardPackageDrafts({ packageId: 'app.edu' });
        expect(res.discardedCount).toBe(1);
        expect(res.failedCount).toBe(1);
        expect(res.failed[0]).toMatchObject({ name: 'course_list', code: 'locked' });
        expect(res.success).toBe(false);
    });

    it('empty package → discardedCount 0, success false', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([]);
        const res = await protocol.discardPackageDrafts({ packageId: 'app.empty' });
        expect(deleteMetaItem).not.toHaveBeenCalled();
        expect(res).toMatchObject({ success: false, discardedCount: 0 });
    });
});

describe('protocol.deletePackage', () => {
    function makeProtocol(rows: Array<{ type: string; name: string; state: string; organization_id?: string | null }>) {
        const engine = { find: vi.fn(async () => rows) };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const deleteMetaItem = vi.spyOn(protocol, 'deleteMetaItem' as never);
        deleteMetaItem.mockResolvedValue({ success: true } as never);
        return { protocol, deleteMetaItem };
    }

    it('deletes all rows, tears down active objects (dropStorage), drafts before active', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([
            { type: 'object', name: 'course', state: 'active', organization_id: null },
            { type: 'object', name: 'course', state: 'draft', organization_id: null },
            { type: 'view', name: 'course_list', state: 'active', organization_id: null },
        ]);
        const res = await protocol.deletePackage({ packageId: 'app.edu' });
        expect(res).toMatchObject({ success: true, deletedCount: 3, failedCount: 0 });

        const calls = deleteMetaItem.mock.calls.map((c) => c[0] as any);
        const courseActive = calls.find((c) => c.name === 'course' && c.state === 'active');
        expect(courseActive).toMatchObject({ dropStorage: true });

        const order = calls.map((c) => `${c.name}:${c.state}`);
        expect(order.indexOf('course:draft')).toBeLessThan(order.indexOf('course:active'));
    });

    it('keepData:true removes metadata but does NOT request teardown', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([
            { type: 'object', name: 'course', state: 'active', organization_id: null },
        ]);
        await protocol.deletePackage({ packageId: 'app.edu', keepData: true });
        expect((deleteMetaItem.mock.calls[0][0] as any)).not.toHaveProperty('dropStorage');
    });

    it('empty package → deletedCount 0, success false', async () => {
        const { protocol, deleteMetaItem } = makeProtocol([]);
        const res = await protocol.deletePackage({ packageId: 'app.empty' });
        expect(deleteMetaItem).not.toHaveBeenCalled();
        expect(res).toMatchObject({ success: false, deletedCount: 0 });
    });
});

describe('protocol.duplicatePackage (ADR-0070 D4)', () => {
    function makeProtocol() {
        const rows = [
            {
                type: 'object', name: 'iojn_repair_ticket', state: 'active',
                metadata: JSON.stringify({
                    name: 'iojn_repair_ticket', label: 'Ticket',
                    fields: { title: { type: 'text' }, customer: { type: 'lookup', reference: 'iojn_customer' } },
                }),
            },
            {
                type: 'object', name: 'iojn_customer', state: 'active',
                metadata: JSON.stringify({ name: 'iojn_customer', label: 'Customer', fields: { full_name: { type: 'text' } } }),
            },
            {
                type: 'view', name: 'iojn_repair_ticket.all', state: 'active',
                metadata: JSON.stringify({ name: 'iojn_repair_ticket.all', object: 'iojn_repair_ticket', viewKind: 'list' }),
            },
        ];
        const installPackage = vi.fn();
        const engine = {
            find: vi.fn(async () => rows),
            registry: {
                getPackage: vi.fn(() => ({
                    manifest: { id: 'app.iojn', name: 'Repair', namespace: 'iojn', version: '1.0.0', type: 'application', scope: 'environment' },
                })),
                installPackage,
            },
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem' as never);
        (saveMetaItem as any).mockResolvedValue({ success: true } as never);
        return { protocol, saveMetaItem, installPackage };
    }

    it('clones items into a new package, re-namespacing names AND rewriting references', async () => {
        const { protocol, saveMetaItem, installPackage } = makeProtocol();
        const res = await protocol.duplicatePackage({
            sourcePackageId: 'app.iojn', targetPackageId: 'app.iojn2', targetNamespace: 'iojn2',
        });

        // target package installed as a writable copy (new id + namespace, scope kept)
        expect(installPackage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'app.iojn2', namespace: 'iojn2', scope: 'environment' }),
        );

        const calls = (saveMetaItem as any).mock.calls.map((c: any) => c[0]);
        const ticket = calls.find((c: any) => c.name === 'iojn2_repair_ticket');
        const customer = calls.find((c: any) => c.name === 'iojn2_customer');
        const view = calls.find((c: any) => c.name === 'iojn2_repair_ticket.all');

        expect(ticket).toBeTruthy();
        expect(ticket.packageId).toBe('app.iojn2');
        expect(ticket.mode).toBe('publish');
        // the lookup reference was rewritten to the cloned object's new name
        expect(ticket.item.fields.customer.reference).toBe('iojn2_customer');
        expect(ticket.item.name).toBe('iojn2_repair_ticket');
        expect(customer).toBeTruthy();
        // the view's object binding + name were re-namespaced too
        expect(view.item.object).toBe('iojn2_repair_ticket');

        expect(res).toMatchObject({ success: true, copiedCount: 3, failedCount: 0, targetPackageId: 'app.iojn2' });
    });

    it('does NOT rewrite a same-prefix-but-distinct token incorrectly (boundary-safe)', async () => {
        const { protocol, saveMetaItem } = makeProtocol();
        await protocol.duplicatePackage({ sourcePackageId: 'app.iojn', targetPackageId: 'app.iojn2', targetNamespace: 'iojn2' });
        const calls = (saveMetaItem as any).mock.calls.map((c: any) => c[0]);
        // iojn_customer → iojn2_customer (exact), never iojn2_customer-with-leftover
        expect(calls.some((c: any) => c.name === 'iojn2_customer')).toBe(true);
        expect(calls.some((c: any) => /iojn_/.test(c.name))).toBe(false); // no un-renamed leftovers
    });
});

describe('protocol.reassignOrphanedMetadata (ADR-0070 D5)', () => {
    it('rebinds package-less orphans (null / "" / sys_metadata) into the target base; leaves owned rows', async () => {
        const rows = [
            { id: 'r1', type: 'object', name: 'loose_a', package_id: null },
            { id: 'r2', type: 'view', name: 'loose_v', package_id: 'sys_metadata' },
            { id: 'r3', type: 'object', name: 'blank', package_id: '' },
            { id: 'r4', type: 'object', name: 'owned', package_id: 'app.existing' },
        ];
        const update = vi.fn(async () => ({ id: 'x' }));
        const engine = { find: vi.fn(async () => rows), update };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.home' });

        expect(res).toMatchObject({ success: true, reassignedCount: 3, targetPackageId: 'app.home' });
        const movedIds = update.mock.calls.map((c: any) => c[2].where.id);
        expect(movedIds).toEqual(['r1', 'r2', 'r3']); // the 3 orphans, not the owned r4
        expect(update).toHaveBeenCalledWith('sys_metadata', { package_id: 'app.home' }, { where: { id: 'r1' } });
        expect(res.reassigned.some((x) => x.name === 'owned')).toBe(false);
    });

    it('no orphans → reassignedCount 0, success false', async () => {
        const engine = { find: vi.fn(async () => [{ id: 'r1', type: 'object', name: 'x', package_id: 'app.a' }]), update: vi.fn() };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.home' });
        expect(res).toMatchObject({ success: false, reassignedCount: 0 });
        expect((engine.update as any)).not.toHaveBeenCalled();
    });
});
