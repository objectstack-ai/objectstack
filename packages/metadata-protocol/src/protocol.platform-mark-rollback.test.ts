// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37013] A restore is never the platform's registration: the per-item
 * rollback (and `revertCommit`'s restore limb, through the same body writer)
 * writes a history version back without the platform's mark, whatever the
 * version held, read at the one place the metadata service reads it.
 */

import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { DatabaseLoader, MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from './protocol.js';
// Pay the source's dynamic `@objectstack/lint` load during collection, never inside a case.
import '@objectstack/lint';

type Row = Record<string, unknown>;

/** Exact-equality WHERE matching; an operator this stand-in does not implement is refused, never read as a field. */
function matchesWhere(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
        return v === undefined || row[k] === v;
    });
}

/** Rows AND history rows, exact-equality predicates, the producer's own write-verb dispatch. */
function makeEngine() {
    const rows: Row[] = [];
    const historyRows: Row[] = [];
    /** Every other table: reads find nothing, as the stand-in has none. */
    const others: Row[] = [];
    let next = 1;
    /** The one `sys_metadata_commit` row a revert reads, when a case serves one. */
    let commit: Row | null = null;
    const tableOf = (t: string) => (t === 'sys_metadata_history' ? historyRows : t === 'sys_metadata' ? rows : null);
    const matches = matchesWhere;
    const engine: any = {
        async find(t: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
            const table = t === 'sys_metadata_history' ? historyRows : t === 'sys_metadata' ? rows : others;
            const hits = table.filter((r) => matchesWhere(r, opts.where));
            return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
        },
        async findOne(t: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, opts);
            if (t === 'sys_metadata_commit') return commit;
            return (tableOf(t) ?? []).find((r) => matches(r, opts.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            const table = tableOf(t);
            const id = (data.id as string | undefined) ?? `r_${next++}`;
            table?.push({ ...data, id });
            return { id };
        },
        async update(t: string, data: Row, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const row = (tableOf(t) ?? []).find((r) => matches(r, opts.where));
            if (row) Object.assign(row, data);
            return { id: row?.id ?? null };
        },
        async delete(t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const table = tableOf(t);
            const idx = table ? table.findIndex((r) => matches(r, opts.where)) : -1;
            if (table && idx >= 0) table.splice(idx, 1);
            return { deleted: idx >= 0 ? 1 : 0 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() {},
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows, serveCommit: (c: Row) => { commit = c; } };
}


const skill = (label: string) => ({ name: 'helper', label, instructions: 'help', tools: ['query_records'] });

describe('[#37013] the protocol\'s save and restore doors write a body without the platform\'s mark', () => {
    it('a version that held the mark is restored without it (BASE: the row was marked again)', async () => {
        const { engine, rows, historyRows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'skill', name: 'helper', item: skill('v1') });
        // The version as the platform's own registration stored it.
        const v1 = historyRows.find((r) => r.name === 'helper')!;
        v1.metadata = JSON.stringify({ ...JSON.parse(String(v1.metadata)), _provenance: 'platform' });
        await protocol.saveMetaItem({ type: 'skill', name: 'helper', item: skill('v2') });

        await protocol.rollbackMetaItem({ type: 'skill', name: 'helper', toVersion: 1 });

        const stored = JSON.parse(String(rows.find((r) => r.name === 'helper')!.metadata));
        expect(stored.label).toBe('v1');
        expect(stored._provenance).not.toBe('platform');
    });

    it('the save door stores a body that carried the mark without it (BASE: stored as sent)', async () => {
        const { engine, rows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'skill', name: 'helper', item: { ...skill('v1'), _provenance: 'platform' } });
        const stored = JSON.parse(String(rows.find((r) => r.name === 'helper')!.metadata));
        expect(stored.label).toBe('v1');
        expect(stored._provenance).not.toBe('platform');
    });

    it('revertCommit\'s restore limb writes a version that held the mark back without it (BASE: the row was marked again)', async () => {
        const { engine, rows, historyRows, serveCommit } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'skill', name: 'helper', item: skill('v1') });
        const v1 = historyRows.find((r) => r.name === 'helper')!;
        v1.metadata = JSON.stringify({ ...JSON.parse(String(v1.metadata)), _provenance: 'platform' });
        await protocol.saveMetaItem({ type: 'skill', name: 'helper', item: skill('v2') });
        serveCommit({
            id: 'c1', commit_id: 'c1', organization_id: null, operation: 'apply', message: 'the commit under revert', created_at: '2026-01-01T00:00:00Z',
            items: JSON.stringify([{ type: 'skill', name: 'helper', existedBefore: true, prevVersion: 1 }]),
        });

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.failed).toEqual([]);
        expect(res.revertedCount).toBe(1);
        const stored = JSON.parse(String(rows.find((r) => r.name === 'helper')!.metadata));
        expect(stored.label).toBe('v1');
        expect(stored._provenance).not.toBe('platform');
    });
});

/**
 * [#37130] A restore whose row is the platform's own record is refused at the
 * protocol's two restore doors, as the metadata service's `rollback` refuses
 * it (`refusePlatformRecordRestore`, `@objectstack/metadata`): `409
 * RESOURCE_CONFLICT`, nothing written. `revertCommit` reports the item in
 * `failed[]` and reverts the commit's other items (ADR-0067 D3).
 *
 * BASE (main 5bf72422): both doors wrote the platform's row back without the
 * mark, so the row stopped being the platform's record, and a process primed
 * from the rows answered a read naming the name's one holder with the
 * platform's old body (ADR-0150 D4: a package-less row at a held name is its
 * one holder's customization) until the platform registered again.
 */
describe('[#37130] the protocol\'s restore doors refuse a restore whose row is the platform\'s own record', () => {
    const PKG = 'com.acme.crm';

    /** The name's package-less row as the platform's registration wrote it: v1 and v2 in history, v2 the row. */
    async function platformRecord(name = 'helper') {
        const harness = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(harness.engine);
        await protocol.saveMetaItem({ type: 'skill', name, item: { ...skill('platform v1'), name } });
        await protocol.saveMetaItem({ type: 'skill', name, item: { ...skill('platform v2'), name } });
        const mark = (row: Row) => { row.metadata = JSON.stringify({ ...JSON.parse(String(row.metadata)), _provenance: 'platform' }); };
        for (const row of harness.historyRows.filter((r) => r.name === name)) mark(row);
        mark(harness.rows.find((r) => r.name === name)!);
        return { ...harness, protocol };
    }

    it('rollbackMetaItem: refused 409 RESOURCE_CONFLICT, the row byte-identical (BASE: the platform\'s row was written back without the mark)', async () => {
        const { protocol, rows } = await platformRecord();
        const before = JSON.stringify(rows);

        const refused = await protocol.rollbackMetaItem({ type: 'skill', name: 'helper', toVersion: 1 }).catch((error) => error);

        expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(String(refused.message)).toContain('platform\'s own record');
        expect(JSON.stringify(rows)).toBe(before);
    });

    it('revertCommit\'s restore limb: the item lands in failed[] 409-coded, nothing written, and the commit\'s other item still reverts (BASE: written back without the mark)', async () => {
        const { protocol, rows, serveCommit } = await platformRecord();
        await protocol.saveMetaItem({ type: 'skill', name: 'other', item: { ...skill('other v1'), name: 'other' } });
        await protocol.saveMetaItem({ type: 'skill', name: 'other', item: { ...skill('other v2'), name: 'other' } });
        const helperBefore = JSON.stringify(rows.find((r) => r.name === 'helper'));
        serveCommit({
            id: 'c1', commit_id: 'c1', organization_id: null, operation: 'apply', message: 'the commit under revert', created_at: '2026-01-01T00:00:00Z',
            items: JSON.stringify([
                { type: 'skill', name: 'helper', existedBefore: true, prevVersion: 1 },
                { type: 'skill', name: 'other', existedBefore: true, prevVersion: 1 },
            ]),
        });

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'skill', name: 'helper', code: 'RESOURCE_CONFLICT' });
        expect(res.failed[0]!.error).toContain('platform\'s own record');
        expect(res.reverted.map((entry: { name: string }) => entry.name)).toEqual(['other']);
        expect(JSON.stringify(rows.find((r) => r.name === 'helper'))).toBe(helperBefore);
        expect(JSON.parse(String(rows.find((r) => r.name === 'other')!.metadata)).label).toBe('other v1');
    });

    it('RESTART: a process primed from the rows answers a read naming the name\'s one holder with that holder\'s item, never the platform\'s old body (BASE: the platform\'s v1)', async () => {
        const { protocol, engine, rows, serveCommit } = await platformRecord();
        // The name's one package holder, its row bound by the package column as the protocol binds it, read
        // first: a package-less row the boot pass registers after it is folded into its slot (ADR-0150 D4).
        rows.unshift({
            id: 'row_pkg', type: 'skill', name: 'helper', state: 'active', organization_id: null, package_id: PKG,
            version: 3, checksum: 'pkg', source: 'database',
            metadata: JSON.stringify({ ...skill('package rules'), _packageId: PKG }),
        });
        serveCommit({
            id: 'c1', commit_id: 'c1', organization_id: null, operation: 'apply', message: 'the commit under revert', created_at: '2026-01-01T00:00:00Z',
            items: JSON.stringify([{ type: 'skill', name: 'helper', existedBefore: true, prevVersion: 1 }]),
        });
        await protocol.revertCommit({ commitId: 'c1' });

        // A process that starts over the rows, primed as the boot pass primes it (`MetadataPlugin`).
        const primed = new MetadataManager({ formats: ['json'], loaders: [new DatabaseLoader({ engine })] });
        for (const item of await primed.loadMany<Record<string, unknown>>('skill')) {
            await primed.register('skill', item.name as string, item, { notify: false, skipSourceLoader: true });
        }
        expect(((await primed.get('skill', 'helper', PKG)) as { label?: string } | undefined)?.label).toBe('package rules');
        expect(((await primed.getPlatformItem('skill', 'helper')) as { label?: string } | undefined)?.label).toBe('platform v2');
    });
});
