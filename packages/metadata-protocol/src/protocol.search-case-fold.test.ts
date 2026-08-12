// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7641] `searchAll` — the global-search palette — is the SECOND producer of
// search clauses, and it carried the same declared≠enforced defect as
// objectql's `search-filter.ts`: it built its AND-of-OR from `$contains` under
// a comment asserting that `$contains` was "case-insensitive substring
// matching". It is not — #4706 Q2 = A rules the `$contains` family case-
// SENSITIVE, and `$icontains` is the operator that folds.
//
// The two producers were found and fixed together, but they are NOT one code
// path: `search-filter.ts` serves per-object `find({ $search })` and this one
// serves `GET /api/v1/search`. `search.console-global-search`'s knownGaps had
// already recorded that the palette inherits the gap and that #7641 owns it.
//
// Why this asserts on the FILTER handed to `engine.find` rather than on matched
// rows: the fake below deliberately does not implement filtering, so a row
// assertion here would pass against any filter at all. The operator IS the
// contract this producer is responsible for — every backend that executes it is
// separately conformance-checked against `$icontains` (`FILTER_TEXT_CASES`).

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface SearchRow {
    id: string;
    name: string;
    updated_at: string;
}

/** The shape `searchAll` builds: `{$or:[…]}`, or `{$and:[{$or:[…]}, …]}`. */
type SearchFilter = Record<string, unknown>;

interface FindOptions {
    where?: SearchFilter;
    orderBy?: Array<{ field: string; order?: string }>;
    limit?: number;
}

const ROWS: SearchRow[] = [
    { id: 'c1', name: 'Acme Retail', updated_at: '2024-01-01T00:00:00.000Z' },
    { id: 'c2', name: 'Northwind', updated_at: '2024-02-01T00:00:00.000Z' },
];

const CONTACT = {
    name: 'contact',
    fields: { name: { name: 'name', type: 'text', searchable: true } },
};

function makeProtocol(): {
    p: ObjectStackProtocolImplementation;
    find: ReturnType<typeof vi.fn>;
} {
    // No filtering: see the header — what is under test is the filter this
    // producer EMITS, so the double must not be able to satisfy an assertion
    // by filtering correctly on its own.
    const find = vi.fn(async (_object: string, _opts: FindOptions = {}) => ROWS);
    const engine = {
        registry: {
            getObject: (n: string) => (n === 'contact' ? CONTACT : undefined),
            getAllObjects: () => [CONTACT],
        },
        find,
    };
    return { p: new ObjectStackProtocolImplementation(engine as never), find };
}

/** The filter the protocol handed to `engine.find` on its first call. */
function filterFrom(find: ReturnType<typeof vi.fn>): SearchFilter {
    const opts = find.mock.calls[0][1] as FindOptions;
    return opts.where as SearchFilter;
}

describe('[#7641] searchAll compiles to the case-folding operator', () => {
    it('emits $icontains — never the case-SENSITIVE $contains', async () => {
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'retail', perObject: 5 });

        expect(filterFrom(find)).toEqual({ $or: [{ name: { $icontains: 'retail' } }] });
        // Spelled separately so a regression reads as "went back to the
        // case-sensitive operator" rather than as an object-shape diff.
        expect(JSON.stringify(filterFrom(find))).not.toContain('$contains');
    });

    it('picks the operator by field type, not by the term\'s own casing', async () => {
        // The defect was invisible whenever the term's casing happened to match
        // the stored value. Both spellings must compile the same way — folding
        // is the operator's job, not the caller's.
        const lower = makeProtocol();
        await lower.p.searchAll({ q: 'retail', perObject: 5 });
        const upper = makeProtocol();
        await upper.p.searchAll({ q: 'Retail', perObject: 5 });

        expect(filterFrom(lower.find)).toEqual({ $or: [{ name: { $icontains: 'retail' } }] });
        expect(filterFrom(upper.find)).toEqual({ $or: [{ name: { $icontains: 'Retail' } }] });
    });

    it('folds every term of a multi-term query, which stays AND-of-OR', async () => {
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'acme retail', perObject: 5 });

        // Term semantics are untouched by #7641 — asserted here so the operator
        // change is pinned as operator-only.
        expect(filterFrom(find)).toEqual({
            $and: [
                { $or: [{ name: { $icontains: 'acme' } }] },
                { $or: [{ name: { $icontains: 'retail' } }] },
            ],
        });
    });
});
