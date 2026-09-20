// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18977] `$orderby` is declared TWICE, and the two declarations are
 * COMPLEMENTARY REFUSALS — each accepts exactly what the other rejects.
 *
 * | declaration | accepts | refuses |
 * |:---|:---|:---|
 * | `ODataQuerySchema.$orderby` (`api/odata.zod.ts`) | `string`, `string[]` | the record maps, `SortNode[]` |
 * | `QueryTransportParamsSchema.$orderby` = `DataEngineSortSchema` (`data/data-engine.zod.ts`) | the record maps, `SortNode[]` | `string`, `string[]` — deliberately, #18704 |
 *
 * Neither file pointed at the other, so reading one of them carefully and
 * completely still produced the wrong answer about the other — measured, at a
 * price: objectui#9554 was filed, triaged, graded and dispatched against a
 * shipped `object-grid` producer that had been sending the canonical shape all
 * along, because the filing seat read the OData declaration and correctly
 * quoted it. The cross-references landed in both files with this card; this
 * file is their MECHANICAL half.
 *
 * ## What this pins, and what it deliberately does not
 *
 * It pins the two accept sets AS THEY ARE, and their disjointness. It is not
 * an argument that either set is right:
 *
 *  - §1/§2 hold each side's accept set, so widening or narrowing either one
 *    turns this red and lands the author on the cross-reference that explains
 *    why the gap is a decision rather than a defect. Widening the TRANSPORT
 *    side is the one the source argues against in its own words — lowering a
 *    sort expression means PARSING, and a second parser beside the door's is
 *    how one rule gets two implementations that disagree.
 *  - §3 is the disjointness itself: no value parses under both. That is the
 *    property a reader cannot get from either file alone, and the one that
 *    makes "I read the declaration" insufficient.
 *  - §4 says which of the two grades a query bag, through the slot the REST
 *    door actually parses (`FindDataRequestSchema.query`).
 *
 * ⛔ It pins nothing about what the RUNTIME serves. The OData string forms are
 * not unserved — `normalizeSortNodes` (`@objectstack/metadata-protocol`) reads
 * them at the GET querystring ingress and for in-process `findData`. What this
 * file measures is the two SCHEMAS, which is where the card's trap lives.
 */

import { describe, it, expect } from 'vitest';
import { ODataQuerySchema } from './odata.zod';
import { FindDataRequestSchema } from './protocol.zod';
import { DataEngineSortSchema, QueryTransportParamsSchema } from '../data/data-engine.zod';

/** The two shapes `ODataQuerySchema` declares and the transport schema refuses. */
const ODATA_SPELLINGS: ReadonlyArray<readonly [string, unknown]> = [
  ["the 'field direction' expression", 'name desc'],
  ["the '-field' shorthand", '-created_at'],
  ['the expression array', ['name desc', 'email asc']],
  ['a single-element expression array', ['name']],
];

/** The three shapes `DataEngineSortSchema` declares and the OData schema refuses. */
const TRANSPORT_SPELLINGS: ReadonlyArray<readonly [string, unknown]> = [
  ['the asc/desc record map', { name: 'desc' }],
  ['the 1/-1 record map', { name: 1 }],
  ['the SortNode array', [{ field: 'name', order: 'desc' }]],
];

describe('[#18977] $orderby is declared twice — the two accept sets', () => {
  describe('§1 ODataQuerySchema.$orderby — the OData URL-convention vocabulary', () => {
    it.each(ODATA_SPELLINGS)('accepts %s', (_label, value) => {
      const parsed = ODataQuerySchema.safeParse({ $orderby: value });
      expect(parsed.success).toBe(true);
    });

    it.each(TRANSPORT_SPELLINGS)('refuses %s, at the $orderby member', (_label, value) => {
      const parsed = ODataQuerySchema.safeParse({ $orderby: value });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('$orderby');
    });
  });

  describe('§2 DataEngineSortSchema — what QueryTransportParamsSchema.$orderby is', () => {
    it.each(TRANSPORT_SPELLINGS)('accepts %s', (_label, value) => {
      expect(DataEngineSortSchema.safeParse(value).success).toBe(true);
      expect(QueryTransportParamsSchema.safeParse({ $orderby: value }).success).toBe(true);
    });

    it.each(ODATA_SPELLINGS)('refuses %s, at the $orderby member', (_label, value) => {
      expect(DataEngineSortSchema.safeParse(value).success).toBe(false);
      const parsed = QueryTransportParamsSchema.safeParse({ $orderby: value });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('$orderby');
    });

    it('refuses the OData spelling on `sort` too — the bare transport alias of the same slot', () => {
      // A reader who works around the `$orderby` refusal by re-spelling the key
      // gets the same answer: the refusal is on the VALUE, not on the spelling.
      for (const [, value] of ODATA_SPELLINGS) {
        expect(QueryTransportParamsSchema.safeParse({ sort: value }).success).toBe(false);
      }
    });
  });

  describe('§3 the two accept sets are DISJOINT — this is the trap', () => {
    it('no declared $orderby value parses under both', () => {
      const every = [...ODATA_SPELLINGS, ...TRANSPORT_SPELLINGS];
      const bothAccept = every.filter(([, value]) =>
        ODataQuerySchema.safeParse({ $orderby: value }).success
        && DataEngineSortSchema.safeParse(value).success);
      expect(bothAccept.map(([label]) => label)).toEqual([]);
    });

    it('every declared $orderby value parses under exactly one of them — neither set is empty', () => {
      // The lit control for the emptiness above: a disjointness assertion is
      // also satisfied by two schemas that accept nothing at all.
      const every = [...ODATA_SPELLINGS, ...TRANSPORT_SPELLINGS];
      const accepted = every.map(([, value]) =>
        Number(ODataQuerySchema.safeParse({ $orderby: value }).success)
        + Number(DataEngineSortSchema.safeParse(value).success));
      expect(accepted).toEqual(every.map(() => 1));
    });
  });

  describe('§4 which one grades a query bag', () => {
    // `POST /data/:object/query` parses its body through this schema and answers
    // `400 VALIDATION_FAILED` on a refusal (`rest-server.ts`), so this is the
    // declaration an author's stored query bag is actually judged against.
    const findInput = (query: Record<string, unknown>) => ({ object: 't', query: { ...query, object: 't' } });

    it.each(TRANSPORT_SPELLINGS)('FindDataRequest.query accepts %s on $orderby', (_label, value) => {
      expect(FindDataRequestSchema.safeParse(findInput({ $orderby: value })).success).toBe(true);
    });

    it.each(ODATA_SPELLINGS)('FindDataRequest.query refuses %s on $orderby', (_label, value) => {
      const parsed = FindDataRequestSchema.safeParse(findInput({ $orderby: value }));
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('query.$orderby');
    });

    it('ODataQuerySchema grades nothing here — it is not on any path into FindDataRequest', () => {
      // The canonical AST key is the one the output carries, whichever declared
      // spelling arrived: the transport spelling folds onto `orderBy`.
      const parsed = FindDataRequestSchema.safeParse(findInput({ $orderby: { created_at: 'desc' } }));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect((parsed.data as { query: { orderBy?: unknown } }).query.orderBy)
        .toEqual([{ field: 'created_at', order: 'desc' }]);
      expect((parsed.data as { query: Record<string, unknown> }).query.$orderby).toBeUndefined();
    });
  });
});
