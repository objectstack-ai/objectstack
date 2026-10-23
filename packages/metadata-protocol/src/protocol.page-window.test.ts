// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25229 — `findData`'s list-query normalizer coerced the page window with a
 * bare `Number(...)` and no range check.
 *
 * Every list door reaches that one statement with the window unvalidated:
 * `GET /data/:object` hands its querystring over as strings, `POST
 * /data/:object/query`'s body schema checks that `limit` / `offset` are
 * numbers but not their sign, and the runtime dispatcher forwards both. So a
 * `NaN` (`?$top=abc`) or a negative limit reached the driver, which drops a
 * window it cannot read — every row, under a 200 — and a negative offset
 * reached knex's `QueryBuilder.offset`, which throws: a 500.
 *
 * ## Two assertion classes
 *
 *  1. **REFUSAL** — each malformed window, in every spelling, answers `400`
 *     `INVALID_REQUEST` naming the spelling the caller wrote, and the engine is
 *     never reached. `code` AND `status` are asserted: the unfixed normalizer
 *     never threw for these, so a bare `toThrow()` would only be half a pin.
 *  2. **PRESERVATION** — a well-formed window reaches `engine.find` as the
 *     integers it always did, `0` included. Green in both directions, so a
 *     guard, not evidence: it is what a refusal is cheapest to break.
 *
 * The door-level half (both REST routes over a real `SqlDriver`) is
 * `packages/rest/src/data-page-window-door.test.ts`.
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
    const find = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        aggregate: vi.fn(async () => [] as unknown[]),
        count: vi.fn(async () => 0),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** The option bag `engine.find` was actually handed, for an accepted query. */
async function optionsFor(query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { p, find } = makeProtocol();
    await p.findData({ object: 'invoice', query } as never);
    expect(find, `${JSON.stringify(query)} never reached engine.find`).toHaveBeenCalledTimes(1);
    return (find.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
}

/** The refusal a rejected query produced, plus proof the engine was not reached. */
async function refusalFor(query: Record<string, unknown>): Promise<{
    message: string; status?: number; code?: string; param?: string;
}> {
    const { p, find } = makeProtocol();
    let answered: unknown;
    try {
        answered = await p.findData({ object: 'invoice', query } as never);
    } catch (e) {
        const err = e as Error & { status?: number; code?: string; param?: string };
        expect(find, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        return { message: err.message, status: err.status, code: err.code, param: err.param };
    }
    throw new Error(
        `${JSON.stringify(query)} was ACCEPTED (answered ${JSON.stringify(answered)}) instead of refused`,
    );
}

// ---------------------------------------------------------------------------
// 1. REFUSAL
// ---------------------------------------------------------------------------

describe('#25229 — a malformed page window is refused, naming the spelling the caller wrote', () => {
    it.each<[string, Record<string, unknown>, string]>([
        // [wire spelling, the query, what it used to become]
        ['$skip', { $skip: '-5' }, 'a knex throw, answered 500'],
        ['$skip', { $skip: '-1', $top: '3' }, 'a knex throw, answered 500'],
        ['$skip', { $skip: 'abc' }, 'offset: NaN'],
        ['skip', { skip: '-1' }, 'a knex throw, answered 500'],
        ['offset', { offset: -5 }, 'a knex throw, answered 500'],
        ['offset', { offset: 1.5 }, 'a fractional offset'],
        ['offset', { offset: '' }, 'offset: 0'],
        ['$top', { $top: 'abc' }, 'limit: NaN, every row'],
        ['$top', { $top: '-1' }, 'a dropped window, every row'],
        ['$top', { $top: '' }, 'limit: 0, an empty page'],
        ['$top', { $top: '   ' }, 'limit: 0, an empty page'],
        ['$top', { $top: '1.5' }, 'a fractional limit'],
        ['top', { top: 'abc' }, 'limit: NaN, every row'],
        ['limit', { limit: -1 }, 'a dropped window, every row'],
        ['limit', { limit: 'ten' }, 'limit: NaN, every row'],
        ['limit', { limit: true }, 'limit: 1'],
        ['limit', { limit: Number.POSITIVE_INFINITY }, 'an unbounded limit'],
    ])('refuses %s in %j with 400 INVALID_REQUEST (was: %s)', async (param, query) => {
        const err = await refusalFor(query);

        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.message).toContain(`Query parameter '${param}' must be a non-negative integer`);
    });

    it('quotes the value it refused, bounded', async () => {
        const err = await refusalFor({ $top: 'x'.repeat(500) });

        expect(err.message).toContain('got "xxxx');
        expect(err.message.length).toBeLessThan(400);
    });
});

// ---------------------------------------------------------------------------
// 2. PRESERVATION
// ---------------------------------------------------------------------------

describe('#25229 — a well-formed page window reaches the engine unchanged', () => {
    it.each<[Record<string, unknown>, number | undefined, number | undefined]>([
        [{ $top: '5', $skip: '2' }, 5, 2],
        [{ top: '5', skip: '2' }, 5, 2],
        [{ limit: 5, offset: 2 }, 5, 2],
        [{ limit: '5', offset: '2' }, 5, 2],
        [{ $top: '0' }, 0, undefined],
        [{ $skip: '0' }, undefined, 0],
        [{}, undefined, undefined],
    ])('%j → limit %s, offset %s', async (query, limit, offset) => {
        const options = await optionsFor(query);

        expect(options.limit).toBe(limit);
        expect(options.offset).toBe(offset);
        // No window spelling leaks into the implicit-filter bucket.
        expect(options.where).toBeUndefined();
    });
});
