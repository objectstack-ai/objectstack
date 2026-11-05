// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30064 — `MetadataClient.references()` reads the answer
 * `GET /meta/:type/:name/references` declares
 * (`FindReferencesToMetaResponseSchema`: `{ references: [{ type, name, label?,
 * path, kind }] }`, served bare), named from the referring side.
 *
 * The reader used to take `data.items`, a key the route never serves, so every
 * read came back empty and both panels that render it (Setup's References tab,
 * Studio's item tools) said "Nothing in the metadata graph points at this item.
 * Safe to delete." for every item. An answer the declaration refuses is a
 * failed read now, never an empty one.
 */

import { describe, expect, it } from 'vitest';
import { FindReferencesToMetaResponseSchema } from '@objectstack/spec/api';
import { MetadataClient } from './metadata-client';

const BASE_URL = 'http://localhost:3000';

function clientAnswering(status: number, body: unknown): { client: MetadataClient; urls: string[] } {
  const urls: string[] = [];
  const client = new MetadataClient({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  return { client, urls };
}

/** The route's answer for the CRM dataset, as the server serves it. */
const SERVED = {
  references: [
    {
      type: 'dashboard',
      name: 'pipeline_dashboard',
      label: 'Pipeline Dashboard',
      path: 'widgets[].dataset',
      kind: 'dashboard dataset',
    },
    { type: 'report', name: 'won_by_stage', path: 'dataset', kind: 'report dataset' },
  ],
};

describe('MetadataClient.references reads the declared answer (objectstack#30064)', () => {
  it('the fixture is the declared shape', () => {
    expect(FindReferencesToMetaResponseSchema.safeParse(SERVED).success).toBe(true);
  });

  it('maps each served reference to the referring item, its label kept when served', async () => {
    const { client, urls } = clientAnswering(200, SERVED);
    const refs = await client.references('dataset', 'opportunity_metrics');
    expect(urls).toEqual([`${BASE_URL}/api/v1/meta/dataset/opportunity_metrics/references`]);
    expect(refs).toEqual([
      {
        fromType: 'dashboard',
        fromName: 'pipeline_dashboard',
        fromLabel: 'Pipeline Dashboard',
        path: 'widgets[].dataset',
        kind: 'dashboard dataset',
        value: 'opportunity_metrics',
      },
      { fromType: 'report', fromName: 'won_by_stage', path: 'dataset', kind: 'report dataset', value: 'opportunity_metrics' },
    ]);
  });

  it('the honest empty answer reads as no references', async () => {
    const { client } = clientAnswering(200, { references: [] });
    expect(await client.references('dataset', 'opportunity_metrics')).toEqual([]);
  });

  it('an answer the declaration refuses is a failed read, never an empty one', async () => {
    const { client } = clientAnswering(200, { items: [{ fromType: 'view', fromName: 'all_accounts', path: 'object' }] });
    await expect(client.references('object', 'account')).rejects.toThrow(/declaration refuses/);
  });
});
