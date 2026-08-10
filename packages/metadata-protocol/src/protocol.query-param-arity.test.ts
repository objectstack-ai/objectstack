// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7321 — `findData`'s list-query normalizer coerces repeated query parameters
 * without checking arity.
 *
 * `IHttpRequest.query` is `Record< string, string | string[] >`
 * (`packages/spec/src/contracts/http-server.ts`) and the array arm is produced
 * by a real first-party adapter: `NodeHttpServer` hands `?x=1&x=2` through as
 * `['1','2']`, measured over a socket on #6878. Every coercion in this
 * normalizer was written for the string arm, so the array arm was coerced
 * blind — `Number(['1','2'])` is `NaN`, and `?$top=1&$top=2` reached the driver
 * as `limit: NaN`. That is the one MEASURED line the card was filed on; the
 * work is the survey around it, and the survey found the same shape on the
 * leftover-key bucket (`?status=open&status=won` lowers to
 * `where: {status: ['open','won']}`, which `matches-filter.ts` answers with a
 * bare `if (Array.isArray(spec)) return false` — an empty page under a 200).
 *
 * ## Three assertion classes, labelled, because only one of them is evidence
 *
 *  1. **REFUSAL** — a repeated single-valued parameter answers `400`
 *     `INVALID_REQUEST` and the engine is never reached. Both `code` AND
 *     `status` are asserted on every one of these: a bare `toThrow()` here
 *     would be a permanently-green test for half the cases, because the
 *     unfixed normalizer ALSO throws for some of them (a repeated `?filter=`
 *     hits `malformedFilterArrayError` — a true refusal with a false
 *     diagnosis), and would be blind for the other half, where the unfixed
 *     normalizer answers 200 with the wrong rows.
 *
 *  2. **PRESERVATION of the legitimately-multi parameters** — `$select`,
 *     `$expand`, `$searchFields`, `$orderby` and `$filter`'s AST array accept
 *     the array arm ON PURPOSE. These assertions are GREEN IN BOTH DIRECTIONS
 *     against the fix (they pass on `origin/main` unchanged), so on their own
 *     they are GUARDS, not evidence. What makes them evidence is the VARIANT
 *     measured on the PR: emptying `ARRAY_VALUED_QUERY_SLOTS` — i.e. replacing
 *     the per-parameter disposition with a blanket "no parameter may repeat" —
 *     turns this whole block red while block 1 stays green. That is the
 *     damage case the card was filed to prevent, and it is what makes the
 *     disposition table NECESSARY rather than merely sufficient.
 *
 *  3. **PRESERVATION of the ordinary single-valued request** — one occurrence,
 *     as a bare string, is untouched. Also green in both directions, also a
 *     guard: it is what a refusal is cheapest to break.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    nameField: 'name',
    searchableFields: ['name', 'status'],
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
        account_id: { name: 'account_id', type: 'lookup', reference: 'account' },
    },
};

function makeProtocol() {
    const find = vi.fn(async () => [] as unknown[]);
    const aggregate = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        aggregate,
        count: vi.fn(async () => 0),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, aggregate };
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
    const { p, find, aggregate } = makeProtocol();
    let answered: unknown;
    try {
        answered = await p.findData({ object: 'invoice', query } as never);
    } catch (e) {
        const err = e as Error & { status?: number; code?: string; param?: string };
        expect(find, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        expect(aggregate, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        return { message: err.message, status: err.status, code: err.code, param: err.param };
    }
    throw new Error(
        `${JSON.stringify(query)} was ACCEPTED (answered ${JSON.stringify(answered)}) instead of refused`,
    );
}

// ---------------------------------------------------------------------------
// 1. REFUSAL — the parameters whose declared type is a scalar
// ---------------------------------------------------------------------------

describe('#7321 — a repeated single-valued parameter is refused, not coerced', () => {
    it.each<[string, Record<string, unknown>, string]>([
        // [wire spelling the caller wrote, the query, what it used to become]
        ['$top', { $top: ['1', '2'] }, 'limit: NaN'],
        ['top', { top: ['1', '2'] }, 'limit: NaN'],
        ['limit', { limit: ['1', '2'] }, 'limit: NaN'],
        ['$skip', { $skip: ['10', '20'] }, 'offset: NaN'],
        ['skip', { skip: ['10', '20'] }, 'offset: NaN'],
        ['offset', { offset: ['10', '20'] }, 'offset: NaN'],
        ['$search', { $search: ['a', 'b'] }, 'a two-element search term'],
        ['search', { search: ['a', 'b'] }, 'a two-element search term'],
        ['$count', { $count: ['true', 'false'] }, 'neither true nor false'],
        ['count', { count: ['true', 'false'] }, 'neither true nor false'],
        ['object', { object: ['invoice', 'account'] }, 'a bogus object mismatch'],
        ['having', { having: [{ a: 1 }, { b: 2 }], groupBy: ['status'] }, 'AST junk on aggregate'],
    ])('refuses a repeated %s with 400 INVALID_REQUEST (was: %s)', async (param, query) => {
        const err = await refusalFor(query);

        // The ADR-0112 envelope, not merely the throw: `code` AND `status`.
        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
        // #4226 discipline — the message names the spelling the caller WROTE,
        // not the canonical key the fold would have rewritten it to.
        expect(err.param).toBe(param);
        expect(err.message).toContain(`'${param}' query parameter was supplied 2 times`);
    });

    it('refuses TWO IDENTICAL values too — the rule counts occurrences, not distinct values', async () => {
        // "At most one DISTINCT value" would be a de-duplication rule no caller
        // can predict; "supply it at most once" is checkable client-side
        // (#6877). `?$count=true&$count=true` is still two occurrences.
        const err = await refusalFor({ $count: ['true', 'true'] });

        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
        expect(err.message).toContain('supplied 2 times');
    });

    it('reports the real count, not just "more than one"', async () => {
        const err = await refusalFor({ $top: ['1', '2', '3', '4'] });

        expect(err.message).toContain('supplied 4 times');
    });

    it('refuses a repeated LEFTOVER key — the implicit field-filter bucket', async () => {
        // `?status=open&status=won` lowered to `where: {status: ['open','won']}`.
        // A bare array is not a valid field spec (`{ $in: [...] }` is), so
        // `matches-filter.ts` answers `false` for every row: an empty page under
        // a 200, which is the #4134 failure exactly.
        const err = await refusalFor({ status: ['open', 'won'] });

        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
        expect(err.param).toBe('status');
    });

    it('refuses the repeated parameter BEFORE the alias fold mis-diagnoses it', async () => {
        // `?top=1&top=2&limit=1` reaches the #3795 fold as `['1','2']` vs `'1'`,
        // which `JSON.stringify` calls two different values for one slot — a
        // true refusal (`Conflicting query parameters`) with a false diagnosis.
        // Arity runs first, so the caller is told what is actually wrong.
        const err = await refusalFor({ top: ['1', '2'], limit: '1' });

        expect(err.message).toContain("'top' query parameter was supplied 2 times");
        expect(err.message).not.toContain('Conflicting query parameters');
    });
});

// ---------------------------------------------------------------------------
// 2. PRESERVATION — GUARDS. Green in both directions; see the variant file.
// ---------------------------------------------------------------------------

describe('#7321 [GUARD — green in both directions] the legitimately-multi parameters keep their array arm', () => {
    it('$select repeated IS the projection list', async () => {
        const options = await optionsFor({ $select: ['name', 'status'] });

        expect(options.fields).toEqual(['name', 'status']);
    });

    it('select / fields repeated are the same projection under their other spellings', async () => {
        expect((await optionsFor({ select: ['name', 'status'] })).fields).toEqual(['name', 'status']);
        expect((await optionsFor({ fields: ['name', 'status'] })).fields).toEqual(['name', 'status']);
    });

    it('$expand repeated IS the relation list', async () => {
        const options = await optionsFor({ $expand: ['owner_id', 'account_id'] });

        expect(options.expand).toEqual({
            owner_id: { object: 'owner_id' },
            account_id: { object: 'account_id' },
        });
    });

    it('$searchFields repeated IS the narrowed search set', async () => {
        const options = await optionsFor({ $search: 'acme', $searchFields: ['name', 'status'] });

        expect(options.searchFields).toEqual(['name', 'status']);
    });

    it('$orderby repeated COMPOSES into a multi-key sort', async () => {
        // Repetition on a list-valued slot concatenates; it does not conflict.
        // `normalizeSortNodes` has had an explicit `string[]` arm since #4226.
        const options = await optionsFor({ $orderby: ['name', '-amount'] });

        expect(options.orderBy).toEqual([
            { field: 'name', order: 'asc' },
            { field: 'amount', order: 'desc' },
        ]);
    });

    it('a filter AST stays readable — `where`\'s array arm is a FILTER, not a repetition', async () => {
        // The single most expensive thing a blanket arity rule would break:
        // `['status','=','open']` is a three-element array that IS one filter.
        const options = await optionsFor({ $filter: ['status', '=', 'open'] });

        expect(options.where).toEqual({ status: 'open' });
    });

    it.each<[string, Record<string, unknown>]>([
        // Every WIRE spelling that folds into an array-valued slot, with a
        // two-element value that is otherwise valid for that slot. The source's
        // set is DERIVED from the same alias tables the fold uses, so a new
        // alias inherits its array arm automatically — this case is the
        // behavioural half of that derivation, and a new alias belongs here too.
        ['$select', { $select: ['name', 'status'] }],
        ['select', { select: ['name', 'status'] }],
        ['fields', { fields: ['name', 'status'] }],
        ['$orderby', { $orderby: ['name', '-amount'] }],
        ['sort', { sort: ['name', '-amount'] }],
        ['orderBy', { orderBy: ['name', '-amount'] }],
        ['$expand', { $expand: ['owner_id', 'account_id'] }],
        ['populate', { populate: ['owner_id', 'account_id'] }],
        ['expand', { expand: ['owner_id', 'account_id'] }],
        ['$searchFields', { $search: 'acme', $searchFields: ['name', 'status'] }],
        ['searchFields', { search: 'acme', searchFields: ['name', 'status'] }],
        ['$filter', { $filter: ['status', '=', 'open'] }],
        ['filter', { filter: ['status', '=', 'open'] }],
        ['filters', { filters: ['status', '=', 'open'] }],
        ['where', { where: ['status', '=', 'open'] }],
        ['groupBy', { groupBy: ['status', 'name'] }],
        ['aggregations', { aggregations: [
            { function: 'sum', field: 'amount', alias: 'total' },
            { function: 'count', field: 'amount', alias: 'n' },
        ] }],
    ])('%s accepts a two-element array without a 400', async (_param, query) => {
        // Asserted as "not refused" rather than "reached engine.find", because
        // `groupBy` / `aggregations` legitimately route to `engine.aggregate`.
        const { p } = makeProtocol();

        await expect(p.findData({ object: 'invoice', query } as never)).resolves.toBeDefined();
    });

    it('groupBy / aggregations keep their array arms', async () => {
        const { p, aggregate } = makeProtocol();
        await p.findData({
            object: 'invoice',
            query: { groupBy: ['status'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] },
        } as never);

        expect(aggregate).toHaveBeenCalledTimes(1);
        const opts = (aggregate.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
        expect(opts.groupBy).toEqual(['status']);
    });
});

describe('#7321 [GUARD — green in both directions] an ordinary single-valued request is untouched', () => {
    it('?$top=5&$skip=10 still normalizes to limit/offset numbers', async () => {
        const options = await optionsFor({ $top: '5', $skip: '10' });

        expect(options.limit).toBe(5);
        expect(options.offset).toBe(10);
    });

    it('a single leftover key is still an implicit equality predicate', async () => {
        expect((await optionsFor({ status: 'open' })).where).toEqual({ status: 'open' });
    });

    it('a comma-list projection is still split, not treated as multi-valued', async () => {
        expect((await optionsFor({ $select: 'name,status' })).fields).toEqual(['name', 'status']);
    });
});

// ---------------------------------------------------------------------------
// 3. The one-occurrence array arm — an adapter's encoding, not a repetition
// ---------------------------------------------------------------------------

describe('#7321 — a ONE-element array is one occurrence, unwrapped rather than refused', () => {
    it('unwraps a leftover key, which used to match nothing at all', async () => {
        // The signal case. `{status: ['open']}` is a bare array field spec, so
        // `matches-filter.ts` answered `false` for every row: the query looked
        // served and returned an empty page.
        expect((await optionsFor({ status: ['open'] })).where).toEqual({ status: 'open' });
    });

    it('[GUARD] unwraps a one-element window, which `Number()` already got right', async () => {
        // Green in both directions on purpose: `Number(['5'])` is 5, because a
        // one-element array stringifies to its element. Pinned so the unwrap
        // cannot silently start producing something else.
        expect((await optionsFor({ $top: ['5'] })).limit).toBe(5);
    });

    it('treats an EMPTY array as not supplied, rather than as a value', async () => {
        // `Number([])` is 0, so an empty `limit` used to become `limit: 0`; and
        // a key left behind carrying `undefined` would be lowered into an
        // implicit `{status: undefined}` predicate by the leftover bucket.
        const options = await optionsFor({ limit: [], status: [] });

        expect(options).not.toHaveProperty('limit');
        expect(options).not.toHaveProperty('status');
        expect(options.where).toBeUndefined();
    });
});
