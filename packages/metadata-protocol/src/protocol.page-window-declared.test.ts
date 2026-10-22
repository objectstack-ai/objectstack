// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25269 — the published schemas that describe a list door's page window
 * declare the accept set `findData` enforces (#25229), value for value.
 *
 * Before this, `FindDataRequestSchema` (the `POST /data/:object/query` body,
 * through `QueryWithTransportSchema`) declared `limit` / `offset` / `top` as any
 * number and `$top` / `$skip` / `skip` as any number or string, and
 * `HttpFindQueryParamsSchema` (the `GET /data/:object` querystring) declared
 * `top` / `skip` as `z.coerce.number()` — so `-1`, `1.5` and a blank `?top=`
 * validated against the published schema and were then refused by the door.
 *
 * ## The oracle is the door, not the spec
 *
 * Each value is first handed to the real `findData` normalizer (a recording
 * engine behind it): accepted iff the engine was reached, and the window it was
 * handed is the expected parse output. Every schema row is then held to that
 * verdict. The normalizer's own refusal table (`protocol.page-window.test.ts`)
 * is the seed of the value list below, widened at the edges the bound has
 * (`-0`, `Number.MAX_SAFE_INTEGER` and one past it, `Infinity`, the `Number`
 * spellings `'1e2'` / `'0x10'` / `' 5 '`).
 *
 * A member that declares only the NUMBER arm (the canonical `limit` / `offset`
 * / `top` of a JSON body) refuses every string — it did before this change
 * too, so the string arm there is asserted refused, never widened.
 */

import { describe, it, expect, vi } from 'vitest';
import { FindDataRequestSchema, HttpFindQueryParamsSchema } from '@objectstack/spec/api';
import { QueryPageWindowParamSchema, QueryPageWindowSchema, QueryWithTransportSchema } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    nameField: 'name',
    fields: { name: { name: 'name', type: 'text' } },
};

type Verdict = { accepted: true; window: number } | { accepted: false };

/** What `findData` does with `value` in the canonical `limit` slot. */
async function doorVerdict(value: unknown): Promise<Verdict> {
    const find = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        aggregate: vi.fn(async () => [] as unknown[]),
        count: vi.fn(async () => 0),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    try {
        await p.findData({ object: 'invoice', query: { limit: value } } as never);
    } catch (e) {
        expect((e as { code?: string }).code, `${String(value)}: refused with another code`).toBe('INVALID_REQUEST');
        expect(find).not.toHaveBeenCalled();
        return { accepted: false };
    }
    expect(find).toHaveBeenCalledTimes(1);
    return { accepted: true, window: ((find.mock.calls[0] as unknown[])[1] as { limit: number }).limit };
}

const NUMBERS: readonly number[] = [
    0, -0, 1, 5, 50, 5000, Number.MAX_SAFE_INTEGER,
    -1, -5, 0.5, 1.5, 100.5, -0.5, Number.MAX_SAFE_INTEGER + 1,
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
];

const STRINGS: readonly string[] = [
    '0', '5', '50', ' 5 ', '1e2', '0x10', '9007199254740991',
    '', '   ', 'abc', 'ten', '-1', '-5', '1.5', '100.5', 'Infinity', 'NaN', '9007199254740992',
];

const OTHERS: readonly unknown[] = [true, false, {}];

/**
 * schema · spelling · the arms the member declares · parse `value` through it
 * and return the window it produced (or `undefined` for a refusal).
 */
type Row = readonly [string, string, 'number' | 'both', (value: unknown) => number | undefined];

const viaQuery = (schema: typeof QueryWithTransportSchema, spelling: string) => (value: unknown) => {
    const parsed = schema.safeParse({ object: 'invoice', [spelling]: value });
    return parsed.success ? (parsed.data as { limit?: number; offset?: number }).limit
        ?? (parsed.data as { offset?: number }).offset : undefined;
};

const viaFindRequest = (spelling: string) => (value: unknown) => {
    const parsed = FindDataRequestSchema.safeParse({ object: 'invoice', query: { object: 'invoice', [spelling]: value } });
    if (!parsed.success) return undefined;
    const query = parsed.data.query as { limit?: number; offset?: number };
    return query.limit ?? query.offset;
};

const viaHttpParams = (spelling: 'top' | 'skip') => (value: unknown) => {
    const parsed = HttpFindQueryParamsSchema.safeParse({ [spelling]: value });
    return parsed.success ? parsed.data[spelling] : undefined;
};

const ROWS: readonly Row[] = [
    ['FindDataRequest', 'limit', 'number', viaFindRequest('limit')],
    ['FindDataRequest', 'offset', 'number', viaFindRequest('offset')],
    ['FindDataRequest', 'top', 'number', viaFindRequest('top')],
    ['FindDataRequest', '$top', 'both', viaFindRequest('$top')],
    ['FindDataRequest', '$skip', 'both', viaFindRequest('$skip')],
    ['FindDataRequest', 'skip', 'both', viaFindRequest('skip')],
    ['QueryWithTransport', 'limit', 'number', viaQuery(QueryWithTransportSchema, 'limit')],
    ['QueryWithTransport', '$top', 'both', viaQuery(QueryWithTransportSchema, '$top')],
    ['QueryWithTransport', '$skip', 'both', viaQuery(QueryWithTransportSchema, '$skip')],
    ['HttpFindQueryParams', 'top', 'both', viaHttpParams('top')],
    ['HttpFindQueryParams', 'skip', 'both', viaHttpParams('skip')],
    ['QueryPageWindowParam', '(value)', 'both', (v) => {
        const parsed = QueryPageWindowParamSchema.safeParse(v);
        return parsed.success ? parsed.data : undefined;
    }],
    ['QueryPageWindow', '(value)', 'number', (v) => {
        const parsed = QueryPageWindowSchema.safeParse(v);
        return parsed.success ? parsed.data : undefined;
    }],
];

describe('#25269 — every published window schema accepts exactly what the door accepts', () => {
    it('the value list covers both verdicts on both arms (no vacuous table)', async () => {
        const verdicts = await Promise.all([...NUMBERS, ...STRINGS].map(doorVerdict));
        const numberVerdicts = verdicts.slice(0, NUMBERS.length);
        const stringVerdicts = verdicts.slice(NUMBERS.length);
        expect(numberVerdicts.some((v) => v.accepted)).toBe(true);
        expect(numberVerdicts.some((v) => !v.accepted)).toBe(true);
        expect(stringVerdicts.some((v) => v.accepted)).toBe(true);
        expect(stringVerdicts.some((v) => !v.accepted)).toBe(true);
    });

    describe.each(ROWS)('%s · %s', (_schema, _spelling, arms, parse) => {
        it.each(NUMBERS.map((v) => [String(v), v] as const))('number %s — the door\'s verdict and window', async (_label, value) => {
            const verdict = await doorVerdict(value);
            const window = parse(value);
            if (verdict.accepted) {
                expect(window, 'the door accepts it; the schema must too').toBe(verdict.window);
            } else {
                expect(window, 'the door refuses it; the schema must too').toBeUndefined();
            }
        });

        it.each(STRINGS.map((v) => [JSON.stringify(v), v] as const))('string %s — the door\'s verdict and window', async (_label, value) => {
            const verdict = await doorVerdict(value);
            const window = parse(value);
            if (arms === 'number') {
                // A JSON body's canonical member declares the number arm only, as
                // it always has: no string is a window there.
                expect(window).toBeUndefined();
            } else if (verdict.accepted) {
                expect(window, 'the door accepts it; the schema must too').toBe(verdict.window);
            } else {
                expect(window, 'the door refuses it; the schema must too').toBeUndefined();
            }
        });

        it.each(OTHERS.map((v) => [JSON.stringify(v), v] as const))('%s is neither a count nor its digits — refused by both', async (_label, value) => {
            expect((await doorVerdict(value)).accepted).toBe(false);
            expect(parse(value)).toBeUndefined();
        });
    });
});
