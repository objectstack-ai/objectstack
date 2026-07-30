// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `$filter` that looks like a filter AST but is not one is rejected at the
 * protocol, not handed to the driver as an opaque `where` (#4121).
 *
 * `isFilterAST` was being read as a *conversion* gate: an array it refused was
 * assigned to `options.where` unconverted, leaving each backend to make sense of
 * it. #3948 made the drivers throw rather than skip, so rejecting here buys
 * (a) one error instead of a different one per backend, (b) a message in the
 * *request's* vocabulary rather than a builder's internal state, and (c) the one
 * shape the driver-side fix could not reach.
 *
 * That shape is a lone `['and']`: the driver sets its join mode, matches no
 * element, emits no predicate, and returns **every row** — silently. It is the
 * last survivor of the class #3948 closed, which makes this a correctness fix
 * and not only an ergonomic one.
 *
 * The regression this change could plausibly cause is rejecting a filter that
 * IS valid, so the accepted shapes are pinned at least as hard as the rejected
 * ones. `isFilterAST` accepts nested arrays, and a naive "arrays are suspect"
 * rule would have broken `[[a,'=',1],[b,'=',2]]`.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    fields: {
        status: { name: 'status', type: 'text' },
        close_date: { name: 'close_date', type: 'date' },
        amount: { name: 'amount', type: 'number' },
        stage: { name: 'stage', type: 'text' },
        a: { name: 'a', type: 'number' },
        b: { name: 'b', type: 'number' },
        c: { name: 'c', type: 'number' },
    },
};

function makeProtocol() {
    const find = vi.fn(async () => []);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        count: vi.fn(async () => 0),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** Run a `$filter` through the real `findData` normalisation. */
async function whereFor(filter: unknown): Promise<unknown> {
    const { p, find } = makeProtocol();
    await p.findData({ object: 'invoice', query: { $filter: filter } } as never);
    return (find.mock.calls[0] as unknown[])[1] as unknown;
}

async function errorFor(filter: unknown): Promise<{ message: string; status?: number; code?: string }> {
    const { p } = makeProtocol();
    try {
        await p.findData({ object: 'invoice', query: { $filter: filter } } as never);
    } catch (e) {
        const err = e as Error & { status?: number; code?: string };
        return { message: err.message, status: err.status, code: err.code };
    }
    throw new Error(`expected ${JSON.stringify(filter)} to be rejected`);
}

describe('filters that must keep working', () => {
    it('converts a bare comparison triple', async () => {
        expect(await whereFor(['status', '=', 'active'])).toMatchObject({ where: { status: 'active' } });
    });

    it('converts a flat list of conditions — the shape a naive rule would break', async () => {
        const opts = await whereFor([['a', '=', 1], ['b', '=', 2]]) as { where: unknown };
        expect(opts.where).toBeDefined();
        expect(Array.isArray(opts.where)).toBe(false);
    });

    it('converts logical nodes, including nested ones', async () => {
        for (const f of [
            ['and', ['a', '=', 1], ['b', '=', 2]],
            ['or', ['a', '=', 1], ['b', '=', 2]],
            ['and', ['a', '=', 1], ['or', ['b', '=', 2], ['c', '=', 3]]],
        ]) {
            const opts = await whereFor(f) as { where: unknown };
            expect(Array.isArray(opts.where), JSON.stringify(f)).toBe(false);
        }
    });

    it('converts the date operators #3948 added to the AST vocabulary', async () => {
        for (const op of ['before', 'after']) {
            const opts = await whereFor(['close_date', op, '2024-01-01']) as { where: unknown };
            expect(Array.isArray(opts.where), op).toBe(false);
        }
    });

    it('leaves an empty filter alone — it means "no filter"', async () => {
        const opts = await whereFor([]) as { where: unknown };
        expect(opts.where).toEqual([]);
    });

    it('never touches a `where` object; only arrays are in scope', async () => {
        for (const f of [{ status: 'active' }, { $and: [{ a: 1 }, { b: 2 }] }, { amount: { $gte: 100 } }]) {
            const opts = await whereFor(f) as { where: unknown };
            expect(opts.where).toEqual(f);
        }
    });
});

describe('filters that must be rejected', () => {
    it('rejects a lone logical keyword — the remaining silent-unfiltered shape', async () => {
        // The driver sets its join mode, matches nothing, emits no predicate,
        // and returns every row. Nothing downstream can catch this.
        for (const f of [['and'], ['or']]) {
            const err = await errorFor(f);
            expect(err.message).toContain('has no conditions to join');
            expect(err.status).toBe(400);
            expect(err.code).toBe('INVALID_FILTER');
        }
    });

    it('rejects a triple whose operator is outside the AST vocabulary, and names it', async () => {
        const err = await errorFor(['status', 'bogusop', 'x']);
        expect(err.message).toContain('unrecognised operator "bogusop"');
        expect(err.status).toBe(400);
    });

    it('rejects the space-spelled `not in`, which no vocabulary defines', async () => {
        const err = await errorFor(['stage', 'not in', ['won', 'lost']]);
        expect(err.message).toContain('unrecognised operator "not in"');
    });

    it('rejects an array of condition OBJECTS — a different filter dialect', async () => {
        const err = await errorFor([{ field: 'a', operator: '=', value: 1 }]);
        expect(err.status).toBe(400);
    });

    it('rejects a mixed array with a non-condition element, naming its position', async () => {
        expect((await errorFor([['a', '=', 1], 42])).message).toContain('element 1 is number');
        expect((await errorFor([['a', '=', 1], null])).message).toContain('element 1 is null');
    });

    it('quotes the recognised vocabulary, so the fix is in the error', async () => {
        const err = await errorFor(['status', 'bogusop', 'x']);
        expect(err.message).toContain('Recognised operators:');
        expect(err.message).toContain('not_in');
        expect(err.message).toContain('starts_with');
    });
});
