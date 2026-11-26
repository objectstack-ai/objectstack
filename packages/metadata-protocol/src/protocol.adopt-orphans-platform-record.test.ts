// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37604 item 2] `reassignOrphanedMetadata` (`POST /api/v1/packages/:id/adopt-orphans`)
 * never rebinds the platform's own record: a package-less row whose body
 * carries the platform's mark is the record the platform registers at every
 * boot, not an orphan an author left behind. The one reader of that fact is
 * `isPlatformRecordRow` (`@objectstack/metadata`), the reader the restore
 * refusal and the overlay census ask.
 *
 * BASE (main 4e10d4bf): the adoption rebound that row to the target package,
 * so the platform's record became the package's item, mark and all.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
// Pay the source's dynamic `@objectstack/lint` load during collection, never inside a case.
import '@objectstack/lint';

type Row = { id: string; type: string; name: string; state: string; package_id: string | null; metadata: string };

/** `sys_metadata` alone, the empty filter the adoption reads with, the producer's own update dispatch. */
function makeEngine(rows: Row[]) {
    const store = new Map(rows.map((r) => [r.id, { ...r }]));
    const engine = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            if (opts?.limit !== undefined || Object.keys(opts?.where ?? {}).length !== 0) {
                throw new Error(`fake engine: unsupported read ${JSON.stringify(opts)}`);
            }
            return [...store.values()];
        },
        async update(_table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const row = store.get(String(opts.where.id));
            if (!row) return { id: null };
            Object.assign(row, data);
            return { id: row.id };
        },
    };
    return { engine, store };
}

const skillRow = (id: string, name: string, body: Record<string, unknown>, packageId: string | null = null): Row => ({
    id, type: 'skill', name, state: 'active', package_id: packageId,
    metadata: JSON.stringify({ name, label: name, instructions: 'help', ...body }),
});

describe('[#37604] adopt-orphans leaves the platform\'s own record where the platform keeps it', () => {
    it('the platform\'s package-less row is not rebound; the environment\'s own orphan beside it is (BASE: both rebound)', async () => {
        const { engine, store } = makeEngine([
            skillRow('platform', 'helper', { _provenance: 'platform' }),
            skillRow('orphan', 'notes', {}),
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        expect(store.get('platform')!.package_id).toBeNull();
        expect(store.get('orphan')!.package_id).toBe('app.base');
        expect(res.reassigned).toEqual([{ type: 'skill', name: 'notes' }]);
        expect(res.reassignedCount).toBe(1);
    });

    it('control: a package-less row whose body names a package is no platform record, and is adopted', async () => {
        const { engine, store } = makeEngine([
            skillRow('named', 'helper', { _provenance: 'platform', _packageId: 'com.acme.crm' }),
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        expect(store.get('named')!.package_id).toBe('app.base');
        expect(res.reassignedCount).toBe(1);
    });
});
