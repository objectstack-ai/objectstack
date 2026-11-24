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
    return { engine, rows, historyRows };
}


const skill = (label: string) => ({ name: 'helper', label, instructions: 'help', tools: ['query_records'] });

describe('[#37013] rollbackMetaItem writes a version back without the platform\'s mark', () => {
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
});
