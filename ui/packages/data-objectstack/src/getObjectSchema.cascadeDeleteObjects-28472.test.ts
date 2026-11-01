/**
 * objectstack#28472 — the ENVELOPE's `cascadeDeleteObjects` survives the unwrap.
 *
 * `GET /api/v1/meta/object/:name` serves the objects a delete of this object
 * also deletes BESIDE `item`. The adapter's unwrap returns `item` alone, so it
 * re-attaches the list under a symbol first, the seam `sortability` and
 * `disabledActions` cross the same way. Absent stays absent: it means no
 * engine answered, never that nothing cascades.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCascadeDeleteObjects } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const LEAD = { name: 'crm_lead', fields: { name: { type: 'text' } } };

function adapterOver(body: unknown) {
  // A fresh object per response, as a real `res.json()` parses.
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
  return new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
}

describe('getObjectSchema carries the envelope cascadeDeleteObjects (objectstack#28472)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('carries the served list onto the schema, off its enumerable keys', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'crm_lead', item: LEAD, cascadeDeleteObjects: ['crm_campaign_member'] },
    }).getObjectSchema('crm_lead');
    expect(schema.name).toBe('crm_lead');
    expect(readCascadeDeleteObjects(schema)).toEqual(['crm_campaign_member']);
    // Never a document property: a schema written back carries no such key.
    expect(Object.keys(schema)).not.toContain('cascadeDeleteObjects');
    expect(JSON.stringify(schema)).not.toContain('crm_campaign_member');
  });

  it('carries an empty list as empty: nothing cascades', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'crm_lead', item: LEAD, cascadeDeleteObjects: [] },
    }).getObjectSchema('crm_lead');
    expect(readCascadeDeleteObjects(schema)).toEqual([]);
  });

  it('carries nothing when the envelope has no `cascadeDeleteObjects`', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'crm_lead', item: LEAD },
    }).getObjectSchema('crm_lead');
    expect(readCascadeDeleteObjects(schema)).toBeUndefined();
  });
});
