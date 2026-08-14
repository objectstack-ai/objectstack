// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7641 → #7643] `searchAll` — the global-search palette — used to be the
// SECOND producer of search clauses, and it carried the same declared≠enforced
// defect as objectql's `search-filter.ts`: it built its AND-of-OR from
// `$contains` under a comment asserting that `$contains` was "case-insensitive
// substring matching". It is not — #4706 Q2 = A rules the `$contains` family
// case-SENSITIVE, and `$icontains` is the operator that folds. #7641 fixed the
// operator in both producers.
//
// #7643 removed the second producer instead: the palette now hands the engine
// `search: <q>` and the ADR-0061 expansion resolves the fields and compiles the
// clause, so there is one definition of recall rather than two that agreed by
// maintenance. That moves what THIS file can honestly assert.
//
// ## What moved, and where it went
//
// The operator pin — "$icontains on source columns, never $contains" — is now a
// claim about a filter the ENGINE produces, so it cannot be observed here: this
// suite's fake engine has no expansion, and asserting on the options bag would
// only re-state the delegation. It is pinned end-to-end, over a real `ObjectQL`
// and a real driver, in `objectql/src/global-search-palette-recall.test.ts`
// ("source columns still compile to $icontains"), alongside the companion-recall
// parity that was #7643's actual defect.
//
// ## What is pinned HERE
//
// The DELEGATION itself, which is this package's own contract surface and is
// invisible from the engine side: `searchAll` must hand the engine the query
// TEXT and no filter of its own. A regression that rebuilt a local `where` —
// the exact shape of the #7643 defect — would restore a second producer, and
// every parity test one package over would keep passing right up until the two
// definitions drifted again. That is what this file exists to catch, and why it
// was rewritten rather than deleted.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface SearchRow {
    id: string;
    name: string;
    updated_at: string;
}

interface FindOptions {
    where?: Record<string, unknown>;
    search?: unknown;
    searchFields?: unknown;
    orderBy?: Array<{ field: string; order?: string }>;
    limit?: number;
}

const ROWS: SearchRow[] = [
    { id: 'c1', name: 'Acme Retail', updated_at: '2024-01-01T00:00:00.000Z' },
    { id: 'c2', name: 'Northwind', updated_at: '2024-02-01T00:00:00.000Z' },
];

const CONTACT = {
    name: 'contact',
    fields: { name: { name: 'name', type: 'text' } },
};

function makeProtocol(): {
    p: ObjectStackProtocolImplementation;
    find: ReturnType<typeof vi.fn>;
} {
    // No filtering and no `$search` expansion: this double stands in for the
    // engine BOUNDARY, not for the engine. What is under test is what the
    // protocol hands across it.
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

/** The options bag the protocol handed to `engine.find` on its first call. */
function optionsFrom(find: ReturnType<typeof vi.fn>): FindOptions {
    return find.mock.calls[0][1] as FindOptions;
}

describe('[#7643] searchAll delegates recall to the engine', () => {
    it('sends the query TEXT and builds no filter of its own', async () => {
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'retail', perObject: 5 });

        const opts = optionsFrom(find);
        expect(opts.search).toBe('retail');
        // The whole point: a locally compiled predicate is what #7643 removed.
        expect(opts.where).toBeUndefined();
    });

    it('passes the query verbatim — no pre-tokenising, no per-field fan-out', async () => {
        // A multi-term query used to become `{$and:[{$or:[…]},{$or:[…]}]}` here.
        // Term semantics are unchanged, but they are now the engine's to apply;
        // splitting the text before handing it over would be a second
        // definition of "what a term is" in the very place this card merged.
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'acme retail', perObject: 5 });

        const opts = optionsFrom(find);
        expect(opts.search).toBe('acme retail');
        expect(opts.where).toBeUndefined();
    });

    it('sends no searchFields — the palette wants the object\'s full default reach', async () => {
        // `searchFields` can only NARROW the resolved set (ADR-0061). Sending
        // one would reintroduce a palette-specific field policy through the
        // back door, which is the same defect wearing the engine's key.
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'retail', perObject: 5 });

        expect(optionsFrom(find).searchFields).toBeUndefined();
    });

    it('still caps and orders per object', async () => {
        // Unchanged by #7643 and asserted so the delegation cannot quietly take
        // the cross-object half — the one part that IS this method's own — with
        // it. `order`, not `direction` (#4674).
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'retail', perObject: 3 });

        const opts = optionsFrom(find);
        expect(opts.limit).toBe(3);
        expect(opts.orderBy).toEqual([{ field: 'updated_at', order: 'desc' }]);
    });
});
