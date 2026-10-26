/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3774 — the view-override read and write must share one key space.
 *
 * A view write persists a view row as `PUT /api/v1/meta/view/{viewId}`, i.e. a
 * `sys_metadata` row with `type='view'` — `createView` / `updateView` today,
 * and the toolbar's `updateViewConfig` for a personalization (density, column
 * widths, sort, hidden columns, inlineEdit …) until objectui#12504 retired it;
 * the rows it wrote are still at rest and still read here. `listViewOverrides` used to enumerate
 * `GET /api/v1/meta/{objectName}` — the OBJECT name in the metadata TYPE slot.
 * The two key spaces are disjoint, so the batch map came back empty for every
 * object forever and every saved preference read back as "setting didn't save".
 *
 * The measurement that picked the fix: `GET /meta/:type` accepts `?package=`
 * and `?preview=draft` and NOTHING else (framework
 * `packages/rest/src/rest-server.ts`, and `client.meta.getItems(type, {
 * packageId })`). There is no `?object=` to push the filter into, so the
 * correct route is the one `listViews()` already uses over the same rows:
 * enumerate `type='view'` once, narrow to the object client-side.
 *
 * The suite is written round-trip on purpose — a stub `sys_metadata` that the
 * adapter's own write path fills and its own read path drains. Asserting the
 * read against a hand-written fixture would have stayed green through the
 * entire bug, because the fixture is where the namespace mistake lived.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeMetaStore() {
  const rows = new Map<string, any>();
  const getItemsTypes: string[] = [];

  const meta = {
    getItems: vi.fn(async (type: string) => {
      getItemsTypes.push(type);
      const items = [...rows.entries()]
        .filter(([k]) => k.startsWith(`${type}::`))
        .map(([, v]) => v);
      return { type, items };
    }),
    getItem: vi.fn(async (type: string, name: string) => {
      const item = rows.get(`${type}::${name}`);
      if (!item) {
        const err: any = new Error(`Not found: ${type}/${name}`);
        err.status = 404;
        throw err;
      }
      return { type, name, item };
    }),
    saveItem: vi.fn(async (type: string, name: string, item: any) => {
      rows.set(`${type}::${name}`, { ...item });
      return { success: true, item: rows.get(`${type}::${name}`) };
    }),
  };

  return { meta, rows, getItemsTypes };
}

function makeDS(meta: any) {
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
  ds.client = { meta };
  return ds;
}

/**
 * What ObjectView's `persistViewPatch` USED TO send on a density toggle +
 * column sort: the view's raw config plus the personalization state. The
 * adapter's write stamps `object` / `name` on top (and the framework's overlay
 * heals the same identity fields onto rows that lack them — objectstack#2555).
 * Written below through `createView`, the adapter's surviving write into the
 * same key space.
 */
const PERSONALIZATION = {
  type: 'grid',
  data: { provider: 'object', object: 'crm_lead' },
  columns: ['name', 'status'],
  density: 'compact',
  sort: [{ field: 'created_at', order: 'desc' }],
};

describe('ObjectStackAdapter.listViewOverrides — read/write key space (#3774)', () => {
  it('round-trips: a config saved through createView comes back from listViewOverrides', async () => {
    const { meta, getItemsTypes } = makeMetaStore();
    const ds = makeDS(meta);

    await ds.createView('crm_lead', { ...PERSONALIZATION, name: 'crm_lead.all' });
    const map = await ds.listViewOverrides('crm_lead');

    // The bug in one assertion: pre-fix this was `{}`.
    expect(Object.keys(map)).toEqual(['crm_lead.all']);
    expect(map['crm_lead.all']).toMatchObject({
      name: 'crm_lead.all',
      object: 'crm_lead',
      density: 'compact',
      sort: [{ field: 'created_at', order: 'desc' }],
    });

    // …and the type slot itself, which is the actual defect. The write went to
    // `saveItem('view', …)`; the read must enumerate the SAME type.
    expect(meta.saveItem).toHaveBeenCalledWith('view', 'crm_lead.all', expect.any(Object));
    expect(getItemsTypes).toEqual(['view']);
    expect(getItemsTypes).not.toContain('crm_lead');
  });

  it('keys the map by the identity getView reads back by (drop-in for the per-view fetch)', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);

    await ds.createView('crm_lead', { ...PERSONALIZATION, name: 'crm_lead.all' });

    const batched = (await ds.listViewOverrides('crm_lead'))['crm_lead.all'];
    const perView = await ds.getView('crm_lead', 'crm_lead.all');

    // Same key space, same document — that equality is what lets a caller
    // substitute one call for N without changing what it renders.
    expect(batched).toEqual(perView);
  });

  it('finds an override whose only object association is the top-level `object` stamp', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeDS(meta);

    // A row with no `data.object` (e.g. a kanban personalization whose provider
    // block was never sent) — the `object` the retired `updateViewConfig`
    // stamped is the only association, and it must be enough. At rest, since
    // that write is gone (objectui#12504).
    rows.set('view::crm_lead.pipeline', {
      type: 'kanban', density: 'comfortable', object: 'crm_lead', name: 'crm_lead.pipeline',
    });
    const map = await ds.listViewOverrides('crm_lead');

    expect(map['crm_lead.pipeline']).toMatchObject({ object: 'crm_lead', density: 'comfortable' });
  });

  it('narrows the shared `type=view` enumeration to the requested object', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);

    await ds.createView('crm_lead', { ...PERSONALIZATION, name: 'crm_lead.all' });
    await ds.createView('crm_account', {
      name: 'crm_account.all', type: 'grid', data: { provider: 'object', object: 'crm_account' }, density: 'compact',
    });

    expect(Object.keys(await ds.listViewOverrides('crm_lead'))).toEqual(['crm_lead.all']);
    expect(Object.keys(await ds.listViewOverrides('crm_account'))).toEqual(['crm_account.all']);
  });

  it('skips rows the enumeration returns without a name (nothing can address them)', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeDS(meta);
    rows.set('view::anon', { object: 'crm_lead', density: 'compact' });

    expect(await ds.listViewOverrides('crm_lead')).toEqual({});
  });
});

describe('ObjectStackAdapter.listViewOverrides — empty vs unknown (#3774)', () => {
  it('an EMPTY successful enumeration resolves to {} — that answer is authoritative', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);

    // No overrides exist for this object. The caller may trust this and skip
    // the per-view reads; the batch optimization depends on it not throwing.
    await expect(ds.listViewOverrides('crm_lead')).resolves.toEqual({});
  });

  it('a FAILING enumeration rejects — it must not masquerade as an empty map', async () => {
    const { meta } = makeMetaStore();
    meta.getItems.mockRejectedValueOnce(new Error('503 metadata store unavailable'));
    const ds = makeDS(meta);

    // Pre-fix this resolved to `{}`, which is indistinguishable from the
    // authoritative "no overrides" above — that is what made ObjectView's
    // per-view getView fallback unreachable code.
    await expect(ds.listViewOverrides('crm_lead')).rejects.toThrow('503 metadata store unavailable');
  });

  it('a rejection is not cached — the next call re-reads instead of pinning the failure', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);
    await ds.createView('crm_lead', { ...PERSONALIZATION, name: 'crm_lead.all' });
    meta.getItems.mockRejectedValueOnce(new Error('transient'));

    await expect(ds.listViewOverrides('crm_lead')).rejects.toThrow('transient');
    // The store recovered; a cached failure would have starved the view of its
    // overrides for the whole TTL.
    expect(Object.keys(await ds.listViewOverrides('crm_lead'))).toEqual(['crm_lead.all']);
  });
});

describe('ObjectStackAdapter.listViewOverrides — wire route (#3774)', () => {
  /** Let the REAL `client.meta` run so the request URL is observed, not assumed. */
  function makeHttpDS(items: any[]) {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/meta/')) {
        return new Response(JSON.stringify({ type: 'view', items }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
    ds.connected = true;
    ds.connectionState = 'connected';
    return { ds, urls };
  }

  it('GETs the view TYPE, never a route built from the object name', async () => {
    const { ds, urls } = makeHttpDS([
      { name: 'crm_lead.all', object: 'crm_lead', ...PERSONALIZATION },
    ]);

    const map = await ds.listViewOverrides('crm_lead');
    expect(map['crm_lead.all']).toMatchObject({ density: 'compact' });

    const metaUrls = urls.filter((u) => u.includes('/meta/'));
    expect(metaUrls.length).toBeGreaterThan(0);
    for (const u of metaUrls) {
      expect(u).toMatch(/\/meta\/view(\?|$)/);
      // The pre-fix route. Pinned by shape so it cannot come back as
      // `/meta/crm_lead` under a different spelling of the same mistake.
      expect(u).not.toContain('/meta/crm_lead');
    }
  });
});
