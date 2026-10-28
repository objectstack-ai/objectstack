/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26711 — the platform's `view` write door refuses a top-level key
 * the body's shape does not declare. `createView` defaulted a top-level `data`
 * onto every spec it sent. On a flat list view `data` is declared; on a
 * ViewItem envelope (`{ name, object, viewKind, config }`) it is declared only
 * inside `config`, so the save was refused with `unrecognized_keys` naming
 * `data` (before, the door dropped it unread). Each body the adapter sends is
 * judged here by the platform's own `ViewMetadataSchema`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { ObjectStackAdapter } from './index';

function makeDS() {
  const saveItem = vi.fn(async (_type: string, _name: string, item: any) => ({ success: true, item }));
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta: { saveItem } };
  return { ds, saveItem };
}

const sent = (saveItem: ReturnType<typeof vi.fn>) => saveItem.mock.calls[0]![2] as Record<string, unknown>;

describe('createView sends a body the view write door accepts (objectstack#26711)', () => {
  it('a ViewItem envelope is sent without a top-level `data`, and the write door accepts it', async () => {
    const { ds, saveItem } = makeDS();
    await ds.createView('crm_lead', {
      name: 'crm_lead.probe',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'Probe',
      config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
    });
    const body = sent(saveItem);
    expect(body).not.toHaveProperty('data');
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it('CONTROL: the envelope WITH the old top-level `data` is refused, naming the key', () => {
    const parsed = ViewMetadataSchema.safeParse({
      name: 'crm_lead.probe',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'Probe',
      config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
      data: { provider: 'object', object: 'crm_lead' },
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? [] : parsed.error.issues)).toContain('"keys":["data"]');
  });

  it('a flat list view still gets its default `data`, where the flat shape declares it', async () => {
    const { ds, saveItem } = makeDS();
    await ds.createView('crm_lead', { name: 'crm_lead.custom', viewKind: 'list', label: 'Custom', type: 'grid', columns: ['name'] });
    const body = sent(saveItem);
    expect(body.data).toEqual({ provider: 'object', object: 'crm_lead' });
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });
});
