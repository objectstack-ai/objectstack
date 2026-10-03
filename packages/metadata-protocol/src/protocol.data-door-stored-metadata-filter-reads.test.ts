// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21544] The stored-metadata family's ONE filter-field collector and ONE
 * default-search narrowing — the two module functions the generic data door
 * calls and exports, so the in-process reader-context seam
 * (`@objectstack/runtime`) calls the same two (the door / seam parity table
 * lives beside the seam, `stored-metadata-reader-seam.test.ts`).
 *
 * The door's collector used to be the ingress key collector, and the
 * measurement on this card found two shapes that READ a family column at the
 * generic data door without the family's refusal ever seeing it, on both
 * `sys_metadata` and `sys_metadata_history`, over HTTP and in-process alike:
 *
 *  - a cross-field comparand (`{ name: { $ne: { $field: 'metadata' } } }`),
 *    which the SQL drivers evaluate row by row — the comparison partitioned
 *    the rows by the stored body's value;
 *  - a direct predicate nested below the key collector's 32-level depth
 *    backstop, which ran as written: a body `$contains` of the stored
 *    credential answered the row and a wrong guess answered none, on
 *    driver-sqlite-wasm and driver-memory — a credential oracle.
 *
 * Both are refused now, before the engine is asked, in the family's envelope.
 */

import { describe, expect, it, vi } from 'vitest';
import { SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import {
    collectStoredMetadataFilterFields,
    narrowStoredMetadataSearch,
    ObjectStackProtocolImplementation,
} from './protocol.js';

/** `n` nested `$and` levels above `leaf`: the leaf sits at depth `n`. */
const deep = (n: number, leaf: Record<string, unknown>): Record<string, unknown> =>
    (n === 0 ? leaf : { $and: [deep(n - 1, leaf)] });

const sorted = (names: readonly string[]) => [...names].sort();

describe('[#21544] collectStoredMetadataFilterFields — every column a read query\'s filters read', () => {
    const cases: Array<[string, unknown, string[]]> = [
        ['a key', { where: { type: 'view' } }, ['type']],
        ['a dotted key reads its head', { where: { 'metadata.config': 'x' } }, ['metadata']],
        ['a cross-field comparand', { where: { name: { $eq: { $field: 'metadata' } } } }, ['metadata', 'name']],
        ['a reference as the implicit-equality comparand', { where: { name: { $field: 'checksum' } } }, ['checksum', 'name']],
        ['a reference in a list', { where: { name: { $in: [{ $field: 'checksum' }] } } }, ['checksum', 'name']],
        [
            'a reference in an addDays offset',
            { where: { created_at: { $lte: { $field: 'created_at', addDays: { $field: 'previous_checksum' } } } } },
            ['created_at', 'previous_checksum'],
        ],
        ['a dotted reference reads its head', { where: { name: { $ne: { $field: 'metadata.x' } } } }, ['metadata', 'name']],
        [
            'under $and / $or / $not',
            { where: { $or: [{ $not: { name: { $lt: { $field: 'change_note' } } } }, { $and: [{ type: 'x' }] }] } },
            ['change_note', 'name', 'type'],
        ],
        ['under an unrecognised $ key', { where: { $nor: [{ metadata: 'x' }] } }, ['metadata']],
        [
            'a nested-relation condition: its keys are another object\'s, a reference beneath it is read',
            { where: { organization_id: { metadata: 'x', name: { $eq: { $field: 'checksum' } } } } },
            ['checksum', 'organization_id'],
        ],
        ['at any depth: a key 40 levels down', { where: deep(40, { metadata: { $contains: 'z' } }) }, ['metadata']],
        ['at any depth: a reference 40 levels down', { where: deep(40, { name: { $ne: { $field: 'checksum' } } }) }, ['checksum', 'name']],
        ['a FilterArray is lowered first', { where: [['metadata', 'contains', 'z']] }, ['metadata']],
        ['the engine\'s `filter` alias', { filter: { checksum: 'x' } }, ['checksum']],
        [
            'each aggregation filter',
            { aggregations: [{ function: 'count', alias: 'n', filter: { name: { $ne: { $field: 'metadata' } } } }] },
            ['metadata', 'name'],
        ],
        [
            'not `having`: its names are the aggregated row\'s, an alias spelled like a family column included',
            { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'metadata' }], having: { metadata: { $gt: 0 } } },
            [],
        ],
    ];
    for (const [label, query, expected] of cases) {
        it(label, () => {
            expect(sorted(collectStoredMetadataFilterFields('sys_metadata', query))).toEqual(expected);
            expect(sorted(collectStoredMetadataFilterFields('sys_metadata_history', query))).toEqual(expected);
        });
    }

    it('[] for an object outside the family, and for a query that is not a record', () => {
        expect(collectStoredMetadataFilterFields('file_blob', { where: { metadata: 'x' } })).toEqual([]);
        expect(collectStoredMetadataFilterFields('sys_metadata', null)).toEqual([]);
        expect(collectStoredMetadataFilterFields('sys_metadata', [{ metadata: 'x' }])).toEqual([]);
    });

    it('terminates on a self-referential live object, and reads a node shared as a comparand and a condition both ways', () => {
        const cyclic: Record<string, unknown> = { type: 'x' };
        cyclic.$and = [cyclic];
        expect(collectStoredMetadataFilterFields('sys_metadata', { where: cyclic })).toEqual(['type']);
        const shared = { metadata: 'x' };
        expect(sorted(collectStoredMetadataFilterFields('sys_metadata', { where: { name: { $eq: shared }, $and: [shared] } })))
            .toEqual(['metadata', 'name']);
    });
});

describe('[#21544] narrowStoredMetadataSearch — the one default-search narrowing', () => {
    function refusalOf(run: () => unknown): any {
        try {
            run();
        } catch (e) {
            return e;
        }
        throw new Error('expected a refusal, but the search was not refused');
    }

    it('an explicit list naming the body or a hash column is refused, under the slot the caller used', () => {
        for (const [query, wire, param, field] of [
            [{ search: 'z', searchFields: ['name', 'metadata'] }, {}, 'searchFields', 'metadata'],
            [{ search: 'z', searchFields: 'name, checksum' }, {}, 'searchFields', 'checksum'],
            [{ search: { query: 'z', fields: ['previous_checksum'] } }, {}, 'search', 'previous_checksum'],
            [{ search: 'z', searchFields: 'change_note' }, { searchFields: '$searchFields' }, '$searchFields', 'change_note'],
        ] as const) {
            const err = refusalOf(() => narrowStoredMetadataSearch('sys_metadata_history', query, SysMetadataHistoryObject, wire));
            expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param, field, object: 'sys_metadata_history' });
        }
    });

    it('an explicit list that names neither runs as it is', () => {
        expect(narrowStoredMetadataSearch('sys_metadata', { search: 'z', searchFields: ['name'] }, SysMetadataObject)).toBeUndefined();
    });

    it('a default search is narrowed to the searchable set without the body and hash columns', () => {
        for (const [object, schema, unscannable] of [
            ['sys_metadata', SysMetadataObject, ['metadata', 'checksum']],
            ['sys_metadata_history', SysMetadataHistoryObject, ['metadata', 'checksum', 'previous_checksum', 'change_note']],
        ] as const) {
            const narrowed = narrowStoredMetadataSearch(object, { search: 'z' }, schema);
            expect(narrowed).toContain('name');
            for (const column of unscannable) expect(narrowed).not.toContain(column);
        }
    });

    it('a default search whose set narrows to nothing is refused, never handed on empty', () => {
        const onlyFamily = { ...SysMetadataObject, searchableFields: ['metadata', 'checksum'] };
        const err = refusalOf(() => narrowStoredMetadataSearch('sys_metadata', { search: 'z' }, onlyFamily, { search: '$search' }));
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: '$search', field: 'metadata' });
    });

    it('runs as it is outside the family, without a search, and without a readable field map', () => {
        expect(narrowStoredMetadataSearch('file_blob', { search: 'z', searchFields: ['metadata'] }, SysMetadataObject)).toBeUndefined();
        expect(narrowStoredMetadataSearch('sys_metadata', { where: { type: 'view' } }, SysMetadataObject)).toBeUndefined();
        for (const schema of [undefined, {}, { fields: [] }, { fields: {} }]) {
            expect(narrowStoredMetadataSearch('sys_metadata', { search: 'z' }, schema)).toBeUndefined();
        }
    });
});

describe('[#21544] data door — a filter that reads the body or a hash without naming it as a key is refused', () => {
    const SCHEMAS: Record<string, unknown> = {
        sys_metadata: SysMetadataObject,
        sys_metadata_history: SysMetadataHistoryObject,
        file_blob: { name: 'file_blob', fields: { name: { name: 'name', type: 'text' }, checksum: { name: 'checksum', type: 'text' } } },
    };

    function makeProtocol() {
        const find = vi.fn(async () => []);
        const aggregate = vi.fn(async () => []);
        const count = vi.fn(async () => 0);
        // `findData` reads through find / count / aggregate only — no `findOne`
        // on this double, so a door that started calling it would fail loudly.
        const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, count, aggregate };
        return { p: new ObjectStackProtocolImplementation(engine), find, aggregate, count };
    }

    async function refusal(run: () => Promise<unknown>): Promise<any> {
        try {
            await run();
        } catch (e) {
            return e;
        }
        throw new Error('expected a refusal, but the query ran');
    }

    const shapes: Array<[string, string, (column: string) => Record<string, unknown>]> = [
        ['a cross-field comparand in `where`', 'filter', (c) => ({ where: { name: { $ne: { $field: c } } } })],
        ['a cross-field comparand under $not', 'filter', (c) => ({ where: { $not: { type: { $lt: { $field: c } } } } })],
        ['a direct predicate 33 levels deep', 'filter', (c) => ({ where: deep(33, { [c]: { $contains: 'guess' } }) })],
        ['a cross-field comparand 33 levels deep', 'filter', (c) => ({ where: deep(33, { name: { $eq: { $field: c } } }) })],
        [
            'a cross-field comparand in an aggregation filter',
            'filter',
            (c) => ({ groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n', filter: { name: { $ne: { $field: c } } } }] }),
        ],
        [
            'a direct predicate 33 levels deep in an aggregation filter',
            'filter',
            (c) => ({ groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n', filter: deep(33, { [c]: { $contains: 'guess' } }) }] }),
        ],
    ];
    const columns: Array<[string, string]> = [
        ['sys_metadata', 'metadata'],
        ['sys_metadata', 'checksum'],
        ['sys_metadata_history', 'metadata'],
        ['sys_metadata_history', 'previous_checksum'],
        ['sys_metadata_history', 'change_note'],
    ];
    for (const [label, param, build] of shapes) {
        for (const [object, column] of columns) {
            it(`${label}, reading '${column}' on '${object}': INVALID_FIELD / 400, and the engine is never asked`, async () => {
                const { p, find, aggregate, count } = makeProtocol();
                const err = await refusal(() => p.findData({ object, query: build(column) }));
                expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param, field: column, object });
                expect(find).not.toHaveBeenCalled();
                expect(aggregate).not.toHaveBeenCalled();
                expect(count).not.toHaveBeenCalled();
            });
        }
    }

    it('control: the same shapes over scalar columns of a family table still run', async () => {
        const { p, find, aggregate } = makeProtocol();
        await p.findData({ object: 'sys_metadata', query: { where: { name: { $ne: { $field: 'type' } } } } });
        await p.findData({ object: 'sys_metadata', query: { where: deep(33, { type: 'view' }) } });
        expect(find).toHaveBeenCalledTimes(2);
        await p.findData({
            object: 'sys_metadata',
            query: { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n', filter: { name: { $ne: { $field: 'type' } } } }] },
        });
        expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('control: an object outside the family reads its own `checksum` through a comparand and at depth', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'file_blob', query: { where: { name: { $ne: { $field: 'checksum' } } } } });
        await p.findData({ object: 'file_blob', query: { where: deep(33, { checksum: 'sha256:0000' }) } });
        expect(find).toHaveBeenCalledTimes(2);
    });
});
