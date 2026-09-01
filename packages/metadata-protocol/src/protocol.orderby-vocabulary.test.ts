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
// rejected bad VALUES rather than unknown KEYS.
//
// ── #4721: the strip-era half of that last clause is RETIRED ─────────────────
//
// The sentence above used to end "— the schema is not `.strict()`, so
// `direction` was dropped rather than flagged", and that was a pin on the SILENT
// behaviour: a record of the hole, not a defence of it. #4720 (the two internal
// sites above) fixed the callers `tsc` covers; #4721 closes the hole itself, on
// both doors at once, so the pin is replaced by the rejection tests at the
// bottom of this file. Measured on `main` before the change:
//
//   SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
//     →  { field: 'updated_at', order: 'asc' }
//
// EXTERNAL callers (REST / RPC `orderBy`) were never covered by #4720 at all —
// they have no `tsc` — which is the gap #4721 exists for.

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
            // [#13216] `listItems: () => []` — the page sweep's registry read;
            // no pages here, sort vocabulary is the only thing under test.
            registry: { getObject: (n: string) => (n === 'contact' ? CONTACT : undefined), getAllObjects: () => [CONTACT], listItems: () => [] },
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

/**
 * #4721 — the same vocabulary mistake made by an EXTERNAL caller.
 *
 * #4720 restored the types on the two internal sites above, which is the right
 * cure for callers `tsc` can see. It does nothing for the other row of the
 * table: a REST/RPC client putting `direction` in `orderBy` has no type checker,
 * and got back an ordinary 200 over rows sorted the OTHER WAY — with `limit`,
 * a different set of rows entirely, with no signal in the response.
 *
 * The rejection lives in `normalizeSortNodes`, which every ingress funnels
 * through. Its schema-side twin is `SortNodeSchema`'s
 * `aliases: { direction: 'order' }` (`spec/src/data/query.zod.ts`, pinned in
 * `spec/src/data/query.test.ts`) — both closed in one change on purpose:
 * a guard on one door only is the asymmetry #1535 shipped and #4522 came back
 * for, and `SortNodeSchema.parse` is reachable by three paths the REST
 * normalizer never sees.
 */
describe('an external `orderBy` spelling the direction `direction` is refused (#4721)', () => {
    const CONTACT_ROWS = [
        { id: 'r1', name: 'A', updated_at: '2024-01-01T00:00:00.000Z' },
        { id: 'r2', name: 'B', updated_at: '2024-02-01T00:00:00.000Z' },
    ];
    const OBJECT = {
        name: 'contact',
        fields: {
            name: { name: 'name', type: 'text' },
            updated_at: { name: 'updated_at', type: 'datetime' },
            // A real column literally called `direction`, so the map-form case
            // below is not hypothetical.
            direction: { name: 'direction', type: 'text' },
        },
    };

    function makeProtocol() {
        const find = makeFind({ contact: CONTACT_ROWS });
        const engine = { registry: { getObject: (n: string) => (n === 'contact' ? OBJECT : undefined) }, find };
        return { p: new ObjectStackProtocolImplementation(engine as any), find };
    }

    it.each([
        ['array element', { orderBy: [{ field: 'updated_at', direction: 'desc' }] }],
        ['unwrapped single node', { orderBy: { field: 'updated_at', direction: 'desc' } }],
        ['OData spelling', { $orderby: [{ field: 'updated_at', direction: 'desc' }] }],
    ])('is a 400 INVALID_SORT, not an ascending 200 — %s', async (_label, query) => {
        const { p, find } = makeProtocol();
        await expect(p.findData({ object: 'contact', query })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_SORT',
        });
        // The point of refusing at the ingress: the engine is never reached, so
        // there is no "successful" wrong-direction page to mistake for an answer.
        expect(find).not.toHaveBeenCalled();
    });

    it('the rejection names `order` — a refusal without the translation is no better', async () => {
        const { p } = makeProtocol();
        // `direction` is not a typo of `order`; edit distance can never bridge
        // them, so a generic "unrecognized key" leaves the caller exactly where
        // the silent strip did.
        await expect(p.findData({
            object: 'contact', query: { orderBy: [{ field: 'updated_at', direction: 'desc' }] },
        })).rejects.toThrow(/`\{ field: 'updated_at', order: 'desc' \}`/);
    });

    it('rejects it even when `order` is also present', async () => {
        const { p } = makeProtocol();
        await expect(p.findData({
            object: 'contact',
            query: { orderBy: [{ field: 'updated_at', order: 'desc', direction: 'asc' }] },
        })).rejects.toMatchObject({ code: 'INVALID_SORT' });
    });

    it('leaves a COLUMN named `direction` alone in the map form', async () => {
        // `{ direction: 'desc' }` is the `{field: direction}` map — "sort by the
        // `direction` column" — not a sort node with the wrong key. Refusing it
        // would be the mirror-image bug: a legitimate query rejected because a
        // column shares a name with a foreign vocabulary.
        const { p, find } = makeProtocol();
        await p.findData({ object: 'contact', query: { orderBy: { direction: 'desc' } } });
        expect(optionsFrom(find).orderBy).toEqual([{ field: 'direction', order: 'desc' }]);
    });

    it('control — the canonical spelling still reaches the engine and sorts', async () => {
        const { p, find } = makeProtocol();
        const r: any = await p.findData({
            object: 'contact', query: { orderBy: [{ field: 'updated_at', order: 'desc' }], limit: 1 },
        });
        expect(optionsFrom(find).orderBy).toEqual([{ field: 'updated_at', order: 'desc' }]);
        expect(r.records.map((x: any) => x.id)).toEqual(['r2']);
    });
});
