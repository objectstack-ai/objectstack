// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0029 D9.9, ADR-0086 D3, #28776] The adopt-orphans door
 * (`reassignOrphanedMetadata`, REST `POST /api/v1/packages/:id/adopt-orphans`)
 * asks the save door's two owner judges, in the save door's order (before the
 * `__c` judge #28735 added), against the TARGET package, before the first
 * storage update, and refuses the adoption whole with each judge's envelope:
 *
 *  - an active orphan `object` whose name ANOTHER package owns in the registry:
 *    `OBJECT_OVERLAY_PACKAGE_MISMATCH` / 422 (D9.9);
 *  - an active orphan `permission` set whose body `packageId` disagrees with the
 *    target: `VALIDATION_ERROR` / 400, `issues[0].path = 'packageId'` (D3).
 *
 * The D9.9 arm skips the `'sys_metadata'` sentinel owner: an orphan object is
 * the sentinel's own registration, the owner the adoption hands over, so the
 * judge asked unchanged would refuse EVERY object adoption (measured on a real
 * CRM boot for #28776: `classifyObjectContribution` answers `mismatch` with the
 * sentinel for a package-less object saved through the real door). The plain
 * orphan below pins that.
 *
 * The namespace-prefix judge is not asked at this door (#28776's ruling), so
 * nothing here pins it either way.
 *
 * The engine double stores rows and answers the registry's owner lookups from a
 * table the test sets, the way `SchemaRegistry.getObjectOwner` answers them; the
 * write-through to the registry after a rebind is spied out, since what is
 * pinned is which rows the adoption moves.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decision, from
// `@objectstack/metadata-core` and NOT `@objectstack/objectql` (objectql
// depends on this package, so that import would close a cycle).
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const TARGET = 'app.probe-target';
const OTHER = 'app.probe-other';

interface Row {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    organization_id: string | null;
    state: string;
    metadata: string;
}

/** Rows stored package-less, and the registry's owner of each object name. */
function makeProtocol(rows: Array<Omit<Row, 'id' | 'package_id' | 'organization_id'>>, owners: Record<string, string>) {
    const store = new Map<string, Row>(rows.map((r, i) => [`r_${i + 1}`, {
        ...r, id: `r_${i + 1}`, package_id: null, organization_id: null,
    }]));
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            // The one shape the adoption reads: every environment row, no bound.
            if (opts?.limit !== undefined || Object.keys(opts?.where ?? {}).length !== 0) {
                throw new Error(`fake engine: unsupported read ${JSON.stringify(opts)}`);
            }
            return [...store.values()].map((r) => ({ ...r }));
        },
        async findOne() { return null; },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const row = store.get(String(opts.where.id));
            if (!row) return { id: null };
            Object.assign(row, data);
            return { id: row.id };
        },
        registry: {
            getObjectOwner: (name: string) => (owners[name] ? { packageId: owners[name] } : undefined),
            getArtifactItem: () => undefined,
            getPackage: () => undefined,
            registerObject: () => {},
            unregisterObject: () => true,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
    const update = vi.spyOn(engine, 'update');
    const writeThrough = vi.spyOn(protocol, 'applyRegistryWriteThrough').mockResolvedValue(undefined);
    const bindings = () => Object.fromEntries([...store.values()].map((r) => [`${r.type}/${r.name}`, r.package_id]));
    return { protocol, update, writeThrough, bindings };
}

const object = (name: string, ...fields: string[]) => ({
    type: 'object', name, state: 'active',
    metadata: JSON.stringify({
        name, label: name, sharingModel: 'private',
        fields: Object.fromEntries(['title', ...fields].map((f) => [f, { type: 'text', label: f }])),
    }),
});
const permissionSet = (name: string, packageId?: string) => ({
    type: 'permission', name, state: 'active',
    metadata: JSON.stringify({ name, label: name, objects: {}, ...(packageId !== undefined ? { packageId } : {}) }),
});

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

afterEach(() => vi.restoreAllMocks());

describe('[ADR-0029 D9.9, #28776] the adopt door refuses an orphan object whose name another package owns', () => {
    it('refused whole with OBJECT_OVERLAY_PACKAGE_MISMATCH / 422 naming the owner; no row moves, nothing is written through', async () => {
        const h = makeProtocol([object('probe_clean'), object('probe_taken')], { probe_clean: 'sys_metadata', probe_taken: OTHER });

        const { error } = await attempt(() => h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET }));

        expect(error).toBeInstanceOf(Error);
        expect({ code: error.code, status: error.status }).toEqual({ code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH', status: 422 });
        expect(error.message).toContain(
            `Cannot layer object 'probe_taken': the overlay is bound to package '${TARGET}', but the object is owned by package '${OTHER}'.`,
        );
        expect(h.update).not.toHaveBeenCalled();
        expect(h.writeThrough).not.toHaveBeenCalled();
        expect(h.bindings()).toEqual({ 'object/probe_clean': null, 'object/probe_taken': null });
    });

    it('is asked before the `__c` judge, in the save door\'s order: a row both judges refuse answers the owner refusal', async () => {
        const h = makeProtocol([object('probe_taken', 'x__c')], { probe_taken: OTHER });

        const { error } = await attempt(() => h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET }));

        expect({ code: error?.code, status: error?.status }).toEqual({ code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH', status: 422 });
        expect(h.bindings()).toEqual({ 'object/probe_taken': null });
    });

    it('CONTROL (the sentinel pin): a plain orphan the registry owns under the `sys_metadata` sentinel is admitted and moves; so does one nobody owns', async () => {
        const h = makeProtocol([object('probe_plain'), object('probe_unowned')], { probe_plain: 'sys_metadata' });

        const res = await h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET });

        expect(res).toMatchObject({ success: true, reassignedCount: 2, targetPackageId: TARGET });
        expect(h.bindings()).toEqual({ 'object/probe_plain': TARGET, 'object/probe_unowned': TARGET });
    });

    it('CONTROL: an orphan object the target itself owns is admitted', async () => {
        const h = makeProtocol([object('probe_mine')], { probe_mine: TARGET });

        const res = await h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET });

        expect(res.reassignedCount).toBe(1);
        expect(h.bindings()).toEqual({ 'object/probe_mine': TARGET });
    });
});

describe('[ADR-0086 D3, #28776] the adopt door refuses an orphan permission set whose body names another owner', () => {
    it('refused whole with VALIDATION_ERROR / 400, `issues` at `packageId`; no row moves', async () => {
        const h = makeProtocol([object('probe_clean'), permissionSet('probe_set', OTHER)], { probe_clean: 'sys_metadata' });

        const { error } = await attempt(() => h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET }));

        expect(error).toBeInstanceOf(Error);
        expect({ code: error.code, status: error.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect(error.issues).toEqual([expect.objectContaining({ path: 'packageId', code: 'custom' })]);
        expect(error.message).toContain(`Drop \`packageId\` from permission set 'probe_set'`);
        expect(h.update).not.toHaveBeenCalled();
        expect(h.bindings()).toEqual({ 'object/probe_clean': null, 'permission/probe_set': null });
    });

    it('CONTROL: a set whose body names the target, and one that names no owner, are admitted and move', async () => {
        const h = makeProtocol([permissionSet('probe_named', TARGET), permissionSet('probe_bare')], {});

        const res = await h.protocol.reassignOrphanedMetadata({ targetPackageId: TARGET });

        expect(res.reassignedCount).toBe(2);
        expect(h.bindings()).toEqual({ 'permission/probe_named': TARGET, 'permission/probe_bare': TARGET });
    });
});
