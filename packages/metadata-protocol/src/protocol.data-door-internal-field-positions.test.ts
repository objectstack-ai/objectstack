// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22646] The generic data door refuses every EVALUATE position that names a
 * field declared `internal: true`, before the engine is asked — the position
 * enumeration this card's fix is pinned by.
 *
 * A field declared `internal: true` is withheld from every generic exit
 * (#21197): the engine omits it from every row (a withhold — pinned on the row
 * position in objectql's `internal-fields.test.ts`). The EVALUATE positions do
 * NOT follow that by omission — a filter is a confirmation oracle, a sort leaks
 * the comparative value, a group key IS the value — so this door REFUSES them,
 * `INVALID_FIELD` / 400, the same envelope and caller-independence as the
 * stored-metadata body/hash family one axis over.
 *
 * Each refusal is paired with a CONTROL on an ordinary field of the SAME object
 * that must keep working and must reach the engine — a door that refused every
 * query would pass every "refused" assertion and serve nothing. The door binds
 * every caller (no context carve-out here); the member/admin end-to-end split
 * is pinned on a real stack in `@objectstack/dogfood`.
 *
 * The position enumeration is the load-bearing shape: a position added later
 * that does not pass through this door turns a case here red.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const VAULT: ServiceObject = {
    name: 'pv_vault',
    label: 'Vault',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        rank: { name: 'rank', label: 'Rank', type: 'number' },
        // The flagged column — a one-way digest in a `text` column, the shape
        // the flag exists for (#7728). Non-hidden, so nothing else withholds it.
        secret_hash: { name: 'secret_hash', label: 'Secret', type: 'text', internal: true },
    },
} as unknown as ServiceObject;

const HOLDER: ServiceObject = {
    name: 'pv_holder',
    label: 'Holder',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        vault_id: { name: 'vault_id', label: 'Vault', type: 'lookup', reference: 'pv_vault' },
    },
} as unknown as ServiceObject;

const SCHEMAS: Record<string, unknown> = { pv_vault: VAULT, pv_holder: HOLDER };
const ROWS: Record<string, Record<string, unknown>[]> = {
    pv_vault: [{ id: 'v1', name: 'alpha', rank: 1, secret_hash: 'h1' }],
    pv_holder: [{ id: 'o1', name: 'owner', vault_id: 'v1' }],
};

function makeProtocol() {
    const find = vi.fn(async (object: string, _o: any) => (ROWS[object] ?? []).map((r) => ({ ...r })));
    const findOne = vi.fn(async (object: string, o: any) => {
        assertEngineFindOnePredicate(object, o);
        return { ...(ROWS[object]?.[0] ?? {}) };
    });
    const aggregate = vi.fn(async () => [{ n: 1 }]);
    const count = vi.fn(async () => (ROWS.pv_vault?.length ?? 0));
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, findOne, count, aggregate };
    return { p: new ObjectStackProtocolImplementation(engine), find, aggregate, count };
}

async function refusal(run: () => Promise<unknown>): Promise<any> {
    let resolved = false;
    let caught: any;
    try { await run(); resolved = true; } catch (e) { caught = e; }
    expect(resolved, 'expected a refusal, but the query ran').toBe(false);
    return caught;
}

const F = 'secret_hash';

describe('[#22646] the data door refuses an `internal: true` field in every evaluate position', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['implicit filter', { [F]: 'h1' }],
        ['filter (OData param)', { filter: JSON.stringify({ [F]: 'h1' }) }],
        ['filter ($eq, POST body)', { where: { [F]: { $eq: 'h1' } } }],
        ['filter ($startsWith)', { where: { [F]: { $startsWith: 'h' } } }],
        ['filter (under $or)', { where: { $or: [{ [F]: 'h1' }, { name: '__none__' }] } }],
        ['filter (cross-field $field comparand)', { where: { name: { $eq: { $field: F } } } }],
        ['sort (wire param)', { sort: F }],
        ['sort (descending)', { sort: `-${F}` }],
        ['sort (orderBy node)', { orderBy: [{ field: F, order: 'asc' }] }],
        ['group-by (string)', { groupBy: [F], aggregations: [{ function: 'count', alias: 'n' }] }],
        ['group-by (object form)', { groupBy: [{ field: F }], aggregations: [{ function: 'count', alias: 'n' }] }],
        ['aggregate operand', { aggregations: [{ function: 'max', field: F, alias: 'm' }] }],
        ['aggregation filter', { aggregations: [{ function: 'count', alias: 'n', filter: { [F]: 'h1' } }] }],
        ['filter beside an aggregation (aggregate where)', { where: { [F]: 'h1' }, aggregations: [{ function: 'count', alias: 'n' }] }],
    ];
    for (const [label, query] of cases) {
        it(`${label} is refused (INVALID_FIELD / 400), engine never asked`, async () => {
            const { p, find, aggregate, count } = makeProtocol();
            const err = await refusal(() => p.findData({ object: 'pv_vault', query }));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe(F);
            expect(err.object).toBe('pv_vault');
            expect(find).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
            expect(count).not.toHaveBeenCalled();
        });
    }

    it('explicit $searchFields naming the internal field is refused (not silently widened)', async () => {
        const { p, find } = makeProtocol();
        const err = await refusal(() => p.findData({ object: 'pv_vault', query: { search: 'h', searchFields: F } }));
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.field).toBe(F);
        expect(find).not.toHaveBeenCalled();
    });

    it("a one-level expand's own filter/sort on the TARGET object's internal field is refused", async () => {
        for (const query of [
            { expand: { vault_id: { object: 'pv_vault', where: { [F]: 'h1' } } } },
            { expand: { vault_id: { object: 'pv_vault', orderBy: [{ field: F, order: 'asc' }] } } },
        ]) {
            const { p, find } = makeProtocol();
            const err = await refusal(() => p.findData({ object: 'pv_holder', query }));
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.field).toBe(F);
            expect(err.object).toBe('pv_vault');
            expect(find).not.toHaveBeenCalled();
        }
    });
});

describe('[#22646] CONTROL — an ordinary field of the same object is unchanged', () => {
    it('a filter on `name` is served and reaches the engine', async () => {
        const { p, find } = makeProtocol();
        const res: any = await p.findData({ object: 'pv_vault', query: { name: 'alpha' } });
        expect(find).toHaveBeenCalledTimes(1);
        expect((res.records ?? res.data ?? res).length).toBe(1);
    });
    it('a sort on `name` is served', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'pv_vault', query: { sort: 'name' } });
        expect(find).toHaveBeenCalledTimes(1);
    });
    it('a group-by on `name` is served and reaches the engine', async () => {
        const { p, aggregate } = makeProtocol();
        await p.findData({ object: 'pv_vault', query: { groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] } });
        expect(aggregate).toHaveBeenCalledTimes(1);
    });
    it('an aggregate operand over the non-internal numeric `rank` is served', async () => {
        const { p, aggregate } = makeProtocol();
        await p.findData({ object: 'pv_vault', query: { aggregations: [{ function: 'max', field: 'rank', alias: 'm' }] } });
        expect(aggregate).toHaveBeenCalledTimes(1);
    });
    it('a $searchFields on the ordinary `name` field is served', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'pv_vault', query: { search: 'al', searchFields: 'name' } });
        expect(find).toHaveBeenCalledTimes(1);
    });
});
