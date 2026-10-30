/**
 * objectstack#27504 — the ENVELOPE's `disabledActions` survives the unwrap.
 *
 * `GET /api/v1/meta/object/:name` serves the names of the object's actions the
 * installation switched off BESIDE `item` (never inside it: the action entries
 * are authored metadata). The adapter's unwrap returns `item` alone, so it
 * stamps those entries first — the same seam that once dropped #10235's
 * `sortability` in transit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isActionSwitchedOff } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const TASK = {
  name: 'showcase_task',
  actions: [
    { name: 'showcase_mark_done', label: 'Mark Done' },
    { name: 'showcase_log_time', label: 'Log Time' },
  ],
};

function adapterOver(body: unknown) {
  // A fresh object per response, as a real `res.json()` parses: the adapter
  // stamps in place, so a shared literal would leak one test's stamp.
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

describe('getObjectSchema carries the envelope disabledActions (objectstack#27504)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('stamps the served names onto their action entries', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'showcase_task', item: TASK, disabledActions: ['showcase_mark_done'] },
    }).getObjectSchema('showcase_task');
    expect(schema.name).toBe('showcase_task');
    expect(isActionSwitchedOff(schema.actions[0])).toBe(true);
    expect(isActionSwitchedOff(schema.actions[1])).toBe(false);
  });

  it('stamps nothing when the envelope carries no `disabledActions`', async () => {
    const schema: any = await adapterOver({
      success: true,
      data: { type: 'object', name: 'showcase_task', item: TASK },
    }).getObjectSchema('showcase_task');
    expect(schema.actions.some(isActionSwitchedOff)).toBe(false);
  });
});
