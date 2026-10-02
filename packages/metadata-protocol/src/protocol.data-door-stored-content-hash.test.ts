// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21207] Exit two at the generic data door — the two stored content-hash
 * columns of `sys_metadata` / `sys_metadata_history` (`checksum`, and the
 * history table's `previous_checksum`).
 *
 * A stored content hash is computed over the WHOLE stored body, withheld
 * credential material included. Served raw beside the projected body, it is an
 * offline verifier: a guess at the withheld material, hashed with the rest of
 * the served body, either reproduces it or not. Evaluated as a predicate it is
 * an online one. So, per the maintainer's ruling on this card:
 *
 *  - SERVED: each column is the crypto provider's keyed digest of the stored
 *    value — neither the stored value nor a recomputation, stable across reads,
 *    moving on any body change including a credential-only one; a `null` stays
 *    `null`; with no provider the key is the process-scoped ephemeral one;
 *  - EVALUATED: a filter, sort or grouping on either column is refused before
 *    the engine is asked — `INVALID_FIELD` / 400, the shape the body column's
 *    refusals already answer — and a search never scans them (nor the body
 *    column): an explicit `searchFields` naming one is refused, an implicit one
 *    is narrowed to the other columns.
 *
 * Every other object — including one with its own `checksum` column — is served
 * and evaluated exactly as before.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, hashSpec, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const keyedDigest = async (plain: string): Promise<string> =>
    `hmac-sha256:${createHmac('sha256', 'data-door-test-key').update(plain, 'utf8').digest('hex')}`;
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;

const CRED_A = 'data-door-cred-a';
const CRED_B = 'data-door-cred-b';
const dsBody = (cred: string) => ({
    name: 'edge_cache',
    label: 'Edge Cache',
    driver: 'turso',
    config: { url: 'file:/var/data/edge.db', encryptionKey: cred },
});
const viewBody = { name: 'all_tasks', label: 'All Tasks', type: 'grid' };

const SYS_METADATA_ROWS = [
    { id: 'm_a', type: 'datasource', name: 'edge_cache', state: 'active', metadata: JSON.stringify(dsBody(CRED_A)), checksum: hashSpec(dsBody(CRED_A)) },
    { id: 'm_b', type: 'datasource', name: 'edge_cache_b', state: 'active', metadata: JSON.stringify(dsBody(CRED_B)), checksum: hashSpec(dsBody(CRED_B)) },
    { id: 'm_view', type: 'view', name: 'all_tasks', state: 'active', metadata: JSON.stringify(viewBody), checksum: hashSpec(viewBody) },
];
const HISTORY_ROWS = [
    { id: 'h_1', type: 'view', name: 'all_tasks', version: 1, operation_type: 'create', metadata: JSON.stringify(viewBody), checksum: hashSpec(viewBody), previous_checksum: null },
    { id: 'h_2', type: 'view', name: 'all_tasks', version: 2, operation_type: 'update', metadata: JSON.stringify(viewBody), checksum: hashSpec({ ...viewBody, label: 'x' }), previous_checksum: hashSpec(viewBody) },
];
/** An ordinary object with a `checksum` column of its own — not a stored metadata body. */
const FILE_SCHEMA = {
    name: 'file_blob',
    fields: { name: { name: 'name', type: 'text' }, checksum: { name: 'checksum', type: 'text' } },
};
const FILE_ROWS = [{ id: 'f_1', name: 'blob', checksum: 'sha256:0000' }];

const ROWS: Record<string, Record<string, unknown>[]> = {
    sys_metadata: SYS_METADATA_ROWS,
    sys_metadata_history: HISTORY_ROWS,
    file_blob: FILE_ROWS,
};
const SCHEMAS: Record<string, unknown> = {
    sys_metadata: SysMetadataObject,
    sys_metadata_history: SysMetadataHistoryObject,
    file_blob: FILE_SCHEMA,
};

function matches(row: Record<string, unknown>, where: unknown): boolean {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`stub engine: combinator '${k}' is not implemented`);
        if (v !== null && typeof v === 'object') throw new Error(`stub engine: operator value on '${k}' is not implemented`);
        return row[k] === v;
    });
}

function makeProtocol(opts: { provider?: boolean } = {}) {
    const find = vi.fn(async (object: string, o: any) => (ROWS[object] ?? []).filter((r) => matches(r, o?.where)).map((r) => ({ ...r })));
    const findOne = vi.fn(async (object: string, o: any) => {
        assertEngineFindOnePredicate(object, o);
        const hit = (ROWS[object] ?? []).find((r) => matches(r, o?.where));
        return hit ? { ...hit } : null;
    });
    const aggregate = vi.fn(async () => [{ type: 'datasource', n: 2 }]);
    const count = vi.fn(async () => 0);
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, findOne, count, aggregate };
    if (opts.provider !== false) engine.getKeyedDigest = () => keyedDigest;
    return { p: new ObjectStackProtocolImplementation(engine), find, findOne, aggregate, count };
}

const byId = (records: any[], id: string) => records.find((r) => r.id === id);

async function refusal(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
    let resolved = false;
    try {
        await run();
        resolved = true;
    } catch (e) {
        caught = e;
    }
    expect(resolved, 'expected a refusal, but the query ran').toBe(false);
    return caught;
}

describe('[#21207] data door — the content-hash columns are served keyed', () => {
    it('list read: keyed, not stored, not a recomputation from the served body; stable across reads', async () => {
        const { p } = makeProtocol();
        const first: any = await p.findData({ object: 'sys_metadata', query: {} });
        const second: any = await p.findData({ object: 'sys_metadata', query: {} });

        for (const row of SYS_METADATA_ROWS) {
            const served = byId(first.records, row.id);
            expect(served.checksum).toMatch(KEYED);
            expect(served.checksum).not.toBe(row.checksum);
            const servedBody = JSON.parse(served.metadata);
            expect(served.checksum).not.toBe(hashSpec(servedBody));
            expect(served.checksum).toBe(await keyedDigest(row.checksum));
            expect(byId(second.records, row.id).checksum).toBe(served.checksum);
        }
    });

    it('a credential-only difference: the served bodies are identical, the served hashes are not', async () => {
        const { p } = makeProtocol();
        const res: any = await p.findData({ object: 'sys_metadata', query: { type: 'datasource' } });
        const a = byId(res.records, 'm_a');
        const b = byId(res.records, 'm_b');
        const { name: _na, ...bodyA } = JSON.parse(a.metadata);
        const { name: _nb, ...bodyB } = JSON.parse(b.metadata);
        expect(bodyA).toEqual(bodyB);
        expect(a.checksum).not.toBe(b.checksum);
        expect(JSON.stringify(res.records)).not.toContain(CRED_A);
    });

    it('by-id read: keyed, equal to the list read', async () => {
        const { p } = makeProtocol();
        const got: any = await p.getData({ object: 'sys_metadata', id: 'm_a' });
        const listed: any = await p.findData({ object: 'sys_metadata', query: {} });
        expect(got.record.checksum).toMatch(KEYED);
        expect(got.record.checksum).toBe(byId(listed.records, 'm_a').checksum);
    });

    it('history table: both columns keyed, a null parent stays null', async () => {
        const { p } = makeProtocol();
        const res: any = await p.findData({ object: 'sys_metadata_history', query: {} });
        expect(byId(res.records, 'h_1').previous_checksum).toBeNull();
        expect(byId(res.records, 'h_2').previous_checksum).toBe(await keyedDigest(HISTORY_ROWS[1]!.previous_checksum as string));
        for (const row of res.records) expect(row.checksum).toMatch(KEYED);
        const got: any = await p.getData({ object: 'sys_metadata_history', id: 'h_2' });
        expect(got.record.previous_checksum).toMatch(KEYED);
    });

    it('no provider: both columns keyed under the process key, never stored, stable across reads', async () => {
        const { p } = makeProtocol({ provider: false });
        const list: any = await p.findData({ object: 'sys_metadata', query: {} });
        const again: any = await p.findData({ object: 'sys_metadata', query: {} });
        for (const row of SYS_METADATA_ROWS) {
            const served = byId(list.records, row.id);
            expect(served.checksum).toMatch(KEYED);
            expect(served.checksum).not.toBe(row.checksum);
            expect(served.checksum).not.toBe(await keyedDigest(row.checksum));
            expect(byId(again.records, row.id).checksum).toBe(served.checksum);
            expect(typeof served.name).toBe('string');
        }
        const hist: any = await p.findData({ object: 'sys_metadata_history', query: {} });
        expect(byId(hist.records, 'h_1').previous_checksum).toBeNull();
        for (const row of hist.records) expect(row.checksum).toMatch(KEYED);
        const got: any = await p.getData({ object: 'sys_metadata', id: 'm_view' });
        expect(got.record.checksum).toBe(byId(list.records, 'm_view').checksum);
        expect(got.record.name).toBe('all_tasks');
    });

    it('control: an object outside the family keeps its own checksum column, raw', async () => {
        const { p } = makeProtocol();
        const res: any = await p.findData({ object: 'file_blob', query: {} });
        expect(res.records[0].checksum).toBe('sha256:0000');
    });
});

describe('[#21207] data door — the content-hash columns are never evaluated', () => {
    const cases: Array<[string, string, Record<string, unknown>, string]> = [
        ['filter', 'sys_metadata', { filter: JSON.stringify({ checksum: SYS_METADATA_ROWS[0]!.checksum }) }, 'checksum'],
        ['implicit filter', 'sys_metadata', { checksum: SYS_METADATA_ROWS[0]!.checksum }, 'checksum'],
        ['parent-hash filter', 'sys_metadata_history', { filter: JSON.stringify({ previous_checksum: 'x' }) }, 'previous_checksum'],
        ['sort', 'sys_metadata', { sort: 'checksum' }, 'checksum'],
        ['descending sort', 'sys_metadata_history', { sort: '-previous_checksum' }, 'previous_checksum'],
        ['group', 'sys_metadata', { groupBy: ['checksum'], aggregations: [{ function: 'count', alias: 'n' }] }, 'checksum'],
        ['group (object form)', 'sys_metadata_history', { groupBy: [{ field: 'previous_checksum' }], aggregations: [{ function: 'count', alias: 'n' }] }, 'previous_checksum'],
        ['aggregation filter', 'sys_metadata', { aggregations: [{ function: 'count', alias: 'n', filter: { checksum: 'x' } }] }, 'checksum'],
    ];
    for (const [label, object, query, field] of cases) {
        it(`${label} on '${field}' is refused (INVALID_FIELD / 400) and the engine is never asked`, async () => {
            const { p, find, aggregate, count } = makeProtocol();
            const err = await refusal(() => p.findData({ object, query }));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe(field);
            expect(err.object).toBe(object);
            expect(find).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
            expect(count).not.toHaveBeenCalled();
        });
    }

    it('the refusal names the usable columns', async () => {
        const { p } = makeProtocol();
        const err = await refusal(() => p.findData({ object: 'sys_metadata', query: { sort: 'checksum' } }));
        expect(err.message).toContain("'type'");
        expect(err.message).toContain("'name'");
    });

    it('control: filter, sort and group by a scalar column still run', async () => {
        const { p, find, aggregate } = makeProtocol();
        await p.findData({ object: 'sys_metadata', query: { type: 'view', sort: 'name' } });
        expect(find).toHaveBeenCalledTimes(1);
        await p.findData({ object: 'sys_metadata', query: { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n' }] } });
        expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('control: an object outside the family is filterable by its own checksum column', async () => {
        const { p, find } = makeProtocol();
        const res: any = await p.findData({ object: 'file_blob', query: { checksum: 'sha256:0000' } });
        expect(find).toHaveBeenCalledTimes(1);
        expect(res.records).toHaveLength(1);
    });
});

describe('[#21207] data door — a search never scans the hash or body columns of a stored-metadata table', () => {
    for (const field of ['checksum', 'metadata']) {
        it(`an explicit searchFields naming '${field}' is refused (INVALID_FIELD / 400)`, async () => {
            const { p, find } = makeProtocol();
            const err = await refusal(() => p.findData({ object: 'sys_metadata', query: { search: 'abc', searchFields: field } }));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe(field);
            expect(find).not.toHaveBeenCalled();
        });
    }

    it('an implicit search is narrowed: the engine is handed a field set without them', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'sys_metadata_history', query: { search: 'abc' } });
        const handed = find.mock.calls[0]![1].searchFields as string[];
        expect(Array.isArray(handed)).toBe(true);
        expect(handed.length).toBeGreaterThan(0);
        for (const refused of ['checksum', 'previous_checksum', 'metadata']) expect(handed).not.toContain(refused);
        expect(handed).toContain('name');
    });

    it('control: a search outside the family is handed on unchanged', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'file_blob', query: { search: 'abc' } });
        expect(find.mock.calls[0]![1].searchFields).toBeUndefined();
    });
});

describe('[#21207] data door — the history change note that quotes a stored hash', () => {
    const QUOTED = hashSpec({ quoted: true });
    const NOTE_ROWS = [{ id: 'h_note', type: 'view', name: 'all_tasks', version: 3, operation_type: 'publish', metadata: '{}', checksum: QUOTED, previous_checksum: null, change_note: `publish draft (hash ${QUOTED})` }];

    it('is served with the quote keyed, under the provider\'s key or the process key', async () => {
        const saved = [...HISTORY_ROWS];
        HISTORY_ROWS.push(...(NOTE_ROWS as any));
        try {
            const { p } = makeProtocol();
            const got: any = await p.getData({ object: 'sys_metadata_history', id: 'h_note' });
            expect(got.record.change_note).toBe(`publish draft (hash ${await keyedDigest(QUOTED)})`);
            const bare = makeProtocol({ provider: false });
            const keyed: any = await bare.p.findData({ object: 'sys_metadata_history', query: {} });
            const note = byId(keyed.records, 'h_note');
            // The quote is served as the row's own served hash column.
            expect(note.change_note).toBe(`publish draft (hash ${note.checksum})`);
            expect(note.checksum).toMatch(KEYED);
            expect(JSON.stringify(keyed.records)).not.toContain(QUOTED);
        } finally {
            HISTORY_ROWS.length = 0;
            HISTORY_ROWS.push(...saved);
        }
    });

    for (const [label, query] of [
        ['filter', { filter: JSON.stringify({ change_note: 'x' }) }],
        ['sort', { sort: 'change_note' }],
        ['group', { groupBy: ['change_note'], aggregations: [{ function: 'count', alias: 'n' }] }],
        ['explicit search fields', { search: 'abc', searchFields: 'change_note' }],
    ] as const) {
        it(`${label} on the change note is refused (INVALID_FIELD / 400)`, async () => {
            const { p, find, aggregate } = makeProtocol();
            const err = await refusal(() => p.findData({ object: 'sys_metadata_history', query: query as any }));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe('change_note');
            expect(find).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
        });
    }

    it('an implicit search does not scan the change note', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'sys_metadata_history', query: { search: 'abc' } });
        expect(find.mock.calls[0]![1].searchFields).not.toContain('change_note');
    });
});
