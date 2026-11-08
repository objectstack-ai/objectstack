// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `listMarketplacePackages` spells the catalog list read the way
 * `GET /api/v1/marketplace/packages` reads it (objectstack#31267): the spec's
 * plural facet keys, each ONE comma-joined parameter, `maturity` as one value,
 * and a filter that selects nothing left out. The door refuses an empty facet,
 * a repeated facet key and the retired `category` with 400
 * `VALIDATION_ERROR`, so the read must send none of them.
 *
 * The page's own reads go through `MarketplacePage.facets-31011.test.tsx`;
 * this file holds `maturity`, which the page selects nowhere.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMarketplacePackages } from '../marketplaceApi';

let requested: URL[] = [];

function stubCatalog() {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      requested.push(new URL(String(input), 'http://console.test'));
      return new Response(JSON.stringify({ success: true, data: { items: [], total: 0, limit: 24, offset: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

const sent = () => requested.map((url) => `${url.pathname}${url.search}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listMarketplacePackages — the list read (objectstack#31267)', () => {
  it('sends each facet as one comma-joined parameter, and maturity as one value', async () => {
    stubCatalog();
    await listMarketplacePackages({
      q: 'crm',
      businessFunctions: ['sales', 'marketing'],
      industries: ['retail'],
      solutionTypes: ['app', 'template'],
      maturity: 'beta',
      limit: 24,
      offset: 48,
    });
    expect(sent()).toEqual([
      '/api/v1/marketplace/packages?q=crm&businessFunctions=sales%2Cmarketing&industries=retail'
        + '&solutionTypes=app%2Ctemplate&maturity=beta&limit=24&offset=48',
    ]);
    const query = requested[0]!.searchParams;
    expect(query.getAll('businessFunctions')).toEqual(['sales,marketing']);
    expect(query.getAll('solutionTypes')).toEqual(['app,template']);
  });

  it('leaves out a filter that selects nothing, and never sends category', async () => {
    stubCatalog();
    await listMarketplacePackages({ businessFunctions: [], industries: [], solutionTypes: [], limit: 24, offset: 0 });
    expect(sent()).toEqual(['/api/v1/marketplace/packages?limit=24&offset=0']);
    await listMarketplacePackages();
    expect(sent()[1]).toBe('/api/v1/marketplace/packages');
    for (const url of requested) expect(url.searchParams.has('category')).toBe(false);
  });
});
