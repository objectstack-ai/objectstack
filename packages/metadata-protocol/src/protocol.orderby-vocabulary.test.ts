// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two internal `engine.find` calls sorted by `direction`, a key nothing on that
// path reads (#4674).
//
// The QueryAST sort shape is `SortNodeSchema` = `{ field, order }`
// (`packages/spec/src/data/query.zod.ts`), and both real drivers normalize off
// `.order` with no fallback — `sql-driver` maps `item.order === 'desc'`,
// `mongodb-driver` the same. With `order` absent, `undefined === 'desc'` is
// false and both land on ASCENDING. `direction` is `IReportService`'s
// vocabulary; it is a genuinely different contract, which is how the wrong
// spelling looked plausible.
//
// Because both queries carry a `limit`, the wrong direction did not merely
// reorder a page — it changed WHICH ROWS CAME BACK. So these tests assert on
// identity, not sequence: with a limit smaller than the fixture, sorting the
// wrong way returns a disjoint set. An order-only assertion would have passed
// against a fake that ignored `orderBy` entirely.
//
// Nothing caught this because both sites erased their types (`} as any)` and
// `const opts: any`), the protocol's `INVALID_SORT` normalizer does not run on
// calls the protocol makes to `this.engine.find` directly, and that normalizer
// rejects bad VALUES rather than unknown KEYS — the schema is not `.strict()`,
// so `direction` was dropped rather than flagged.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * A `find` that honours the QueryAST contract for sort and limit, and nothing
 * else. Filtering is deliberately not implemented: what is under test is which
 * rows survive `orderBy` + `limit`, and a double that also filtered would let a
 * sort bug hide behind a `where` that happened to select the right rows.
 *
 * It reads `order` — the shape the drivers read. A double that read `direction`
 * would agree with the bug instead of catching it, which is exactly what the
 * publish-rollback double did until this change.
 */
function makeFind(rowsByObject: Record<string, any[]>) {
    return vi.fn(async (object: string, opts: any = {}) => {
        const rows = [...(rowsByObject[object] ?? [])];
        for (const { field, order } of [...(opts.orderBy ?? [])].reverse()) {
            rows.sort((a, b) => {
                const av = a[field], bv = b[field];
                if (av === bv) return 0;
                return (av < bv ? -1 : 1) * (order === 'desc' ? -1 : 1);
            });
        }
        return typeof opts.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    });
}

/** The options the protocol handed to `engine.find` on its first call. */
const optionsFrom = (find: any) => find.mock.calls[0][1];

const AUDIT_ROWS = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01'].map(
    (d, i) => ({
        id: `a${i + 1}`,
        occurred_at: `${d}T00:00:00.000Z`,
        actor: 'someone',
        operation: 'save',
        outcome: 'allowed',
        code: 'OK',
    }),
);

describe('auditMetaItem sorts newest-first (#4674)', () => {
    function makeProtocol() {
        const find = makeFind({ sys_metadata_audit: AUDIT_ROWS });
        const engine = { registry: { getObject: () => undefined }, find };
        return { p: new ObjectStackProtocolImplementation(engine as any), find };
    }

    it('returns the NEWEST `limit` events, not the oldest', async () => {
        const { p } = makeProtocol();
        const { events } = await p.auditMetaItem({ type: 'objects', name: 'invoice', limit: 2 });

        // The whole defect in one assertion: ascending returns a1/a2 here.
        expect(events.map(e => e.id)).toEqual(['a5', 'a4']);
    });

    it('asks for `order`, never `direction`', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'objects', name: 'invoice', limit: 2 });

        const sort = optionsFrom(find).orderBy;
        expect(sort).toEqual([{ field: 'occurred_at', order: 'desc' }]);
        // Named explicitly: `direction` reads as a well-formed "sort by
        // occurred_at, direction unspecified" and passes every existing check.
        expect(sort[0]).not.toHaveProperty('direction');
    });
});

const SEARCH_ROWS = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'].map((d, i) => ({
    id: `c${i + 1}`,
    name: `Acme ${i + 1}`,
    updated_at: `${d}T00:00:00.000Z`,
}));

const CONTACT = {
    name: 'contact',
    fields: { name: { name: 'name', type: 'text', searchable: true } },
};

describe('searchAll sorts newest-first (#4674)', () => {
    function makeProtocol() {
        const find = makeFind({ contact: SEARCH_ROWS });
        const engine = {
            registry: { getObject: (n: string) => (n === 'contact' ? CONTACT : undefined), getAllObjects: () => [CONTACT] },
            find,
        };
        return { p: new ObjectStackProtocolImplementation(engine as any), find };
    }

    it('returns the most recently updated matches, not the stalest', async () => {
        const { p } = makeProtocol();
        const { hits } = await p.searchAll({ q: 'Acme', perObject: 2 });

        // Ascending returned c1/c2 — the stalest rows, with the recently-edited
        // ones truncated away by `perObject`.
        expect(hits.map(h => h.id)).toEqual(['c4', 'c3']);
    });

    it('asks for `order`, never `direction`', async () => {
        const { p, find } = makeProtocol();
        await p.searchAll({ q: 'Acme', perObject: 2 });

        const sort = optionsFrom(find).orderBy;
        expect(sort).toEqual([{ field: 'updated_at', order: 'desc' }]);
        expect(sort[0]).not.toHaveProperty('direction');
    });
});
