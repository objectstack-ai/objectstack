/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4227 — a system view's personalization row must never read back
 * from `listViews()` as a saved view. Toggling density/sort/hiddenFields/
 * columnState/inlineEdit on a code-defined view stamped `type='view'` /
 * `name=<viewId>` rows that `listViews()` could not tell apart from a
 * genuine user-created view, so the switcher tab lost its readonly lock and
 * gained Rename/Delete/Set-default/Pin against a view that lives in code.
 *
 * The fix had two layers:
 *
 *   1. `updateViewConfig` — the ONLY production writer of personalization
 *      rows — stamped an explicit `_isOverride` marker on every row it saved
 *      for a system view.
 *   2. `listViews()` excludes any row carrying that marker — and, since
 *      objectui#10210, ONLY such a row.
 *
 * objectui#12504 retired the writer (`updateViewConfig`, with the console's
 * toolbar write that was its one caller): no new overlay is written. The rows
 * it marked are at rest in every install that toggled a system view, so layer
 * 2 still runs and is pinned here end-to-end against a fake `sys_metadata`
 * store, with each overlay put in the store in the shape the retired write
 * stored it. So is the other half of layer 1 that survives: the adapter's
 * remaining view writer, `createView`, never stamps the marker.
 *
 * The second layer used to be wider. For rows persisted before the marker
 * shipped it also excluded a best-effort legacy SHAPE: a flat body plus a
 * `viewKind` the platform backfills from a REGISTRY baseline (objectstack#2555 /
 * #7741). That guess was retired by the maintainer's ruling B on objectui#10210
 * (comment 5824008636): "Edit view config → Save" on a code-defined view wrote
 * the same shape, so the guess dropped the user's own view out of `listViews()`
 * and turned it read-only for good once published. An overlay is now a row
 * carrying `_isOverride`, nothing else. Every case in this file already turned
 * on the marker rather than on the shape (measured: all of them stay green
 * with the guess removed), so this rewrite is to this header only; the retired
 * shape is pinned as ruled in `viewOverlayMarkerOnly-10210.test.ts`.
 *
 * `listViewOverrides` (the batch personalization reader `ObjectView` merges
 * for DISPLAY) is a separate, unchanged consumer of the same rows — it is
 * supposed to see overlay rows, so this fix must not touch it.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeMetaStore() {
  const rows = new Map<string, any>();
  const meta = {
    getItems: vi.fn(async (type: string) => {
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
  return { meta, rows };
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

describe('the surviving writer never stamps the overlay marker (objectui#4227)', () => {
  it('createView does NOT stamp the marker — it is a genuine saved view', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);

    await ds.createView('crm_lead', { name: 'crm_lead.custom', label: 'Custom', type: 'grid' });

    const [, , saved] = meta.saveItem.mock.calls[0]!;
    expect(saved._isOverride).toBeUndefined();
  });

  it('the adapter has no overlay writer left (objectui#12504)', () => {
    expect('updateViewConfig' in ObjectStackAdapter.prototype).toBe(false);
  });
});

describe('end-to-end: a system-view overlay at rest never masquerades as saved (objectui#4227)', () => {
  it('read through the real adapter: excluded from listViews, still present in listViewOverrides', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeDS(meta);

    // The row the exact user action the issue reports left behind: a density
    // toggle on a code-defined view, stored the way the retired
    // `updateViewConfig` stored it (the body, `object`, `name`, the marker).
    rows.set('view::crm_lead.default', {
      type: 'grid',
      data: { provider: 'object', object: 'crm_lead' },
      columns: ['name', 'status'],
      rowHeight: 40,
      object: 'crm_lead',
      name: 'crm_lead.default',
      _isOverride: true,
    });

    // `listViews()` — feeds `savedViews` / the switcher's mutability gate —
    // must NOT return the override as a saved view.
    const savedViews = await ds.listViews('crm_lead');
    expect(savedViews).toEqual([]);

    // `listViewOverrides()` — feeds the DISPLAY merge (viewOverrides) — is a
    // different, legitimate reader of the SAME row and must still see it.
    const overrides = await ds.listViewOverrides('crm_lead');
    expect(overrides['crm_lead.default']).toMatchObject({ rowHeight: 40 });
  });

  it('a genuinely created view survives the same round trip as fully manageable', async () => {
    const { meta } = makeMetaStore();
    const ds = makeDS(meta);

    await ds.createView('crm_lead', {
      name: 'crm_lead.my_pipeline',
      label: 'My Pipeline',
      type: 'kanban',
    });

    const savedViews = await ds.listViews('crm_lead');
    expect(savedViews.map((v: any) => v.name)).toEqual(['crm_lead.my_pipeline']);
  });
});
