/**
 * [#5729] The ENVELOPE's per-column sortability projection survives the unwrap.
 *
 * This file guards the seam that made objectstack#10235's signal invisible to
 * every UI consumer. `GET /api/v1/meta/object/:name` serves `sortability`
 * BESIDE `item` — deliberately, since the document is parsed `strict`
 * server-side and the key must stay un-authorable — and this adapter's unwrap
 * returned `item` alone. The signal was therefore not "never sent": it was
 * dropped in transit, one line before the only consumer that needs it, with
 * nothing failing.
 *
 * Both directions are pinned, because the fallback is the dangerous half: a
 * response with NO `sortability` key must leave the schema carrying no
 * projection at all (`undefined`), never an empty one — an empty projection
 * reads as "no column on this object is sortable" and would blank every sort
 * affordance in the product against a backend older than the upstream change.
 *
 * AGREEMENT over hardcoding: the served value is produced by the platform's
 * own `resolveObjectSortability` from `@objectstack/spec/api` — the resolver
 * the REST layer computes this projection with — so the pin follows the
 * runtime's predicate instead of a copied verdict table.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { readObjectSortability, isPlatformSortableField } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

/** The #10235 oracle object: a formula column beside persisted siblings. */
const OPPORTUNITY = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text' },
    amount: { type: 'currency' },
    expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
  },
};

function makeFetch(body: unknown) {
  // A real `res.json()` parses a fresh object per response. The mock must too:
  // the adapter STAMPS the projection onto the document it is handed, so a
  // shared fixture literal would carry a previous test's stamp into the next
  // one — and the "no signal served" cells would pass while measuring nothing.
  const fresh = () => JSON.parse(JSON.stringify(body));
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/meta/object/')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => fresh() } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as any;
  });
  return fetchImpl;
}

const adapterOver = (body: unknown) =>
  new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000',
    autoReconnect: false,
    fetch: makeFetch(body) as any,
  });

describe('getObjectSchema carries the envelope sortability projection (#5729)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('survives the `{ item }` unwrap that used to discard it', async () => {
    const served = resolveObjectSortability(OPPORTUNITY);
    const schema: any = await adapterOver({
      type: 'object',
      name: 'crm_opportunity',
      item: OPPORTUNITY,
      sortability: served,
    }).getObjectSchema('crm_opportunity');

    // The document still unwraps exactly as before — the counter-probe that
    // this change did not start returning the envelope instead of the item.
    expect(schema.name).toBe('crm_opportunity');
    expect(schema.fields.amount.type).toBe('currency');
    expect('sortability' in schema).toBe(false);

    const projection = readObjectSortability(schema);
    expect(projection).toBeDefined();
    expect(projection!.fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
    expect(isPlatformSortableField(projection!, 'expected_revenue')).toBe(false);
    expect(isPlatformSortableField(projection!, 'amount')).toBe(true);
  });

  it('survives the `{ success, data }` envelope spelling too', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'crm_opportunity', item: OPPORTUNITY, sortability: resolveObjectSortability(OPPORTUNITY) },
    }).getObjectSchema('crm_opportunity');

    const projection = readObjectSortability(schema);
    expect(isPlatformSortableField(projection!, 'expected_revenue')).toBe(false);
    expect(isPlatformSortableField(projection!, 'name')).toBe(true);
  });

  it('leaves NO projection when the response carried no `sortability` key', async () => {
    // The compatibility direction. `undefined` here is what lets the grid tell
    // "the platform refuses this column" apart from "this deployment never
    // sent the signal" — collapsing the two is how a correct-looking change
    // would blank every sort arrow against an older backend.
    const schema: any = await adapterOver({
      type: 'object', name: 'crm_opportunity', item: OPPORTUNITY,
    }).getObjectSchema('crm_opportunity');

    expect(schema.fields.expected_revenue.type).toBe('formula');
    expect(readObjectSortability(schema)).toBeUndefined();
  });

  it('leaves no projection for a bare-item response body (no envelope at all)', async () => {
    const schema: any = await adapterOver(OPPORTUNITY).getObjectSchema('crm_opportunity');
    expect(schema.fields.name.type).toBe('text');
    expect(readObjectSortability(schema)).toBeUndefined();
  });

  it('never carries the projection into a body a write endpoint would parse', async () => {
    // `FieldSchema` is a strict object server-side: an undeclared key on a
    // document handed back at a metadata write is rejected BY NAME. The
    // projection rides on a symbol precisely so a round-trip through
    // `JSON.stringify` cannot take it there.
    const schema: any = await adapterOver({
      type: 'object', name: 'crm_opportunity', item: OPPORTUNITY,
      sortability: resolveObjectSortability(OPPORTUNITY),
    }).getObjectSchema('crm_opportunity');

    const serialized = JSON.parse(JSON.stringify(schema));
    expect('sortability' in serialized).toBe(false);
    expect(Object.keys(serialized).some((k) => k.toLowerCase().includes('sortab'))).toBe(false);
    // Counter-probe: the projection IS on the live object, so the two
    // assertions above measure invisibility rather than a failed attach.
    expect(readObjectSortability(schema)).toBeDefined();
  });
});
