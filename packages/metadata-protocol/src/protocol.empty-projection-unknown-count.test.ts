// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26644 — the list normalizer read two malformed values as the absent default.
 *
 *  - **Projection.** A string `fields` (or its folded `select` / `$select`
 *    spellings) was `split(',').map(trim).filter(Boolean)`, so a blank or
 *    comma-only value became `[]` — and `assertProjectionFieldsExist` has
 *    nothing to refuse in an empty list, so an empty projection was served as
 *    NO projection: every column. An explicit `fields: []` took the same road.
 *    Absent means "every column"; an empty projection asks for none, so reading
 *    it as absent is the silent widening `pageWindowValue` already refuses on
 *    the row axis (a blank `$top`).
 *  - **Count.** The boolean step lowered only `'true'` / `'false'`; any other
 *    value stayed as it was, `countOptOut = options.count === false` was false,
 *    and the count ran — `?$count=maybe` reported a `total` like `?$count=true`.
 *
 * Both are now refused `400 VALIDATION_ERROR` naming the parameter the caller
 * wrote and the value, before the engine is asked. The accepted `count` values
 * are the spec's (`QueryTransportParamsSchema.count`): the boolean, or the two
 * strings a querystring carries it as.
 *
 * `getData` (`GET /data/:object/:id`) reads `select` against the same field
 * map, and its own comment promised "gated exactly as on the list path", so its
 * projection takes the same refusal: one rule for both routes.
 *
 * ## Two assertion classes
 *
 *  1. **REFUSAL** — `code`, `status` and `param` on the throw, and the engine
 *     never reached. The unfixed normalizer never threw for these, so a bare
 *     `toThrow()` would be half a pin.
 *  2. **PRESERVATION** — a well-formed projection reaches `engine.find` as the
 *     same list it always did, and `count` absent / `true` / `false` (either
 *     spelling, `null` as absent) counts or skips exactly as before.
 *
 * The door-level half (both REST list routes and the by-id route over a real
 * `SqlDriver`) is `packages/rest/src/data-empty-projection-count-door.test.ts`;
 * the runtime dispatcher's is
 * `packages/runtime/src/domains/data-empty-projection-count.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
    },
};

function makeProtocol() {
    const find = vi.fn(async () => [{ id: 'r1', name: 'a', status: 'open' }] as unknown[]);
    const findOne = vi.fn(async () => ({ id: 'r1', name: 'a', status: 'open' }));
    const count = vi.fn(async () => 7);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        findOne,
        count,
        aggregate: vi.fn(async () => [] as unknown[]),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, findOne, count };
}

type Refusal = { message: string; status?: number; code?: string; param?: string };

async function refusal(run: (p: any) => Promise<unknown>, reached: (m: ReturnType<typeof makeProtocol>) => unknown[]): Promise<Refusal> {
    const m = makeProtocol();
    let answered: unknown;
    try {
        answered = await run(m.p);
    } catch (e) {
        const err = e as Error & { status?: number; code?: string; param?: string };
        for (const spy of reached(m)) expect(spy, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        return { message: err.message, status: err.status, code: err.code, param: err.param };
    }
    throw new Error(`ACCEPTED (answered ${JSON.stringify(answered)}) instead of refused`);
}

const listRefusal = (query: Record<string, unknown>) =>
    refusal((p) => p.findData({ object: 'invoice', query }), (m) => [m.find, m.count]);
const getRefusal = (select: unknown) =>
    refusal((p) => p.getData({ object: 'invoice', id: 'r1', select }), (m) => [m.findOne]);

// ---------------------------------------------------------------------------
// 1. REFUSAL
// ---------------------------------------------------------------------------

describe('#26644 — an empty projection is refused, naming the spelling the caller wrote', () => {
    it.each<[string, Record<string, unknown>]>([
        ['$select', { $select: '' }],
        ['$select', { $select: '   ' }],
        ['$select', { $select: ',' }],
        ['$select', { $select: ' , ,' }],
        ['select', { select: '' }],
        ['fields', { fields: '' }],
        ['fields', { fields: [] }],
        ['select', { select: [] }],
    ])('list: %s in %j answers 400 VALIDATION_ERROR (was: every column)', async (param, query) => {
        const err = await listRefusal(query);

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.message).toContain(`Query parameter '${param}' names no field`);
    });

    it.each<[unknown]>([[''], ['  '], [','], [[]]])('by id: select %j answers 400 VALIDATION_ERROR (was: every column)', async (select) => {
        const err = await getRefusal(select);

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.param).toBe('select');
        expect(err.message).toContain("Query parameter 'select' names no field");
    });

    it('quotes the value it refused', async () => {
        const err = await listRefusal({ $select: ' , ' });

        expect(err.message).toContain('got " , "');
    });
});

describe('#26644 — a count flag that is not true or false is refused', () => {
    it.each<[string, Record<string, unknown>]>([
        ['$count', { $count: 'maybe' }],
        ['$count', { $count: '' }],
        ['$count', { $count: '1' }],
        ['$count', { $count: 'TRUE' }],
        ['count', { count: 'yes' }],
        ['count', { count: 0 }],
        ['count', { count: 1 }],
    ])('%s in %j answers 400 VALIDATION_ERROR (was: counted)', async (param, query) => {
        const err = await listRefusal(query);

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.message).toContain(`Query parameter '${param}' must be true or false`);
    });

    it('quotes the value it refused, bounded', async () => {
        const err = await listRefusal({ $count: 'x'.repeat(500) });

        expect(err.message).toContain('got "xxxx');
        expect(err.message.length).toBeLessThan(400);
    });
});

// ---------------------------------------------------------------------------
// 2. PRESERVATION
// ---------------------------------------------------------------------------

describe('#26644 — a well-formed projection and count flag answer exactly as before', () => {
    it.each<[Record<string, unknown>, unknown]>([
        [{ $select: 'name,status' }, ['name', 'status']],
        [{ $select: ' name , status ,' }, ['name', 'status']],
        [{ select: 'name' }, ['name']],
        [{ fields: ['name'] }, ['name']],
        [{}, undefined],
        [{ fields: null }, undefined],
    ])('list: %j → fields %j', async (query, fields) => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'invoice', query } as never);

        expect(find).toHaveBeenCalledTimes(1);
        expect(((find.mock.calls[0] as unknown[])[1] as Record<string, unknown>).fields).toEqual(fields);
    });

    it.each<[unknown, unknown]>([
        ['name,status', ['name', 'status']],
        [['name'], ['name']],
        [undefined, undefined],
        [null, undefined],
    ])('by id: select %j → fields %j', async (select, fields) => {
        const { p, findOne } = makeProtocol();
        await p.getData({ object: 'invoice', id: 'r1', select } as never);

        expect(findOne).toHaveBeenCalledTimes(1);
        expect(((findOne.mock.calls[0] as unknown[])[1] as Record<string, unknown>).fields).toEqual(fields);
    });

    it.each<[Record<string, unknown>, boolean]>([
        [{}, true],
        [{ $count: 'true' }, true],
        [{ count: true }, true],
        [{ count: null }, true],
        [{ $count: 'false' }, false],
        [{ count: false }, false],
    ])('%j with a window → counted: %s', async (query, counted) => {
        const { p, count } = makeProtocol();
        // The count runs only for a paged request: unpaged, the page IS the total.
        const res: any = await p.findData({ object: 'invoice', query: { $top: '1', ...query } } as never);

        expect(count).toHaveBeenCalledTimes(counted ? 1 : 0);
        expect('total' in res).toBe(counted);
    });
});
