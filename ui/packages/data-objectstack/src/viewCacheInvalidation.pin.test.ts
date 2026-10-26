/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/**
 * View metadata cache keys — invalidation matches the read keys (objectui#3778).
 *
 * `ObjectStackAdapter` caches exactly two view-shaped reads:
 *
 * | reader              | cache key                    |
 * |---------------------|------------------------------|
 * | `getView`           | `view:{object}:{viewId}`     |
 * | `listViewOverrides` | `view-overrides:{object}`    |
 *
 * `listViews` has no per-object key of its own. Five write paths used to invalidate a
 * `views:{object}` key that no read path has ever populated — five permanent
 * no-ops. They are gone (#3778); the surviving invalidations still name the
 * keys that DO have readers, so the deletion cannot be mistaken for "cache
 * invalidation was dropped".
 *
 * objectui#13044 lets `listViews`, `listViewOverrides` and the console's eager
 * view read JOIN one `GET /meta/view` already in flight, under the key
 * `list:view`. objectui#13057 stores that answer there, and `listViews` and
 * `listViewOverrides` read the stored list while it is held (settled within an
 * open), so every write path drops that key through the seam with the two keys
 * above: a read asked after a write is answered neither by the stored list nor
 * by a request sent before it. The console's own drops of it (a user refresh,
 * its `MetadataClient` view writes) are pinned in app-shell, where they live.
 *
 * ## objectui#4363 — every write path names BOTH keys
 *
 * Removing the dead key made the surviving asymmetry visible: only
 * `updateViewConfig` (retired since objectui#12504) invalidated
 * `view-overrides:{object}`, so `createView` /
 * `updateView` / `deleteView` left the batch map stale for the cache's
 * 5-minute TTL. It does not self-heal — `loadViewOverrides` (app-shell
 * `ObjectView`) treats a RESOLVED map as authoritative and deliberately does
 * not re-probe per view (#3774), so the per-view `getView` fallback that would
 * have masked a stale map is by design unreachable.
 *
 * So the rule these pins now enforce is uniform and per-METHOD, not
 * per-branch: **a write to a view row invalidates the per-view key and the
 * object's override map** — and, since objectui#13044, detaches the published
 * list request the map is derived from. Three paths (four call sites — `updateView` has a
 * draft half and a published half) emit the same ordered keys; a fourth path,
 * `updateViewConfig`, did too until objectui#12504 retired it. The sweep pin
 * stays an untouched control: no path names a `views:` key.
 */

interface Harness {
  ds: any;
  /** Every key passed to `metadataCache.invalidate`, in order. */
  invalidated: string[];
  /** Every key passed to `metadataCache.get`, in order. */
  cacheReads: string[];
  getItems: ReturnType<typeof vi.fn>;
  saveItem: ReturnType<typeof vi.fn>;
  deleteItem: ReturnType<typeof vi.fn>;
}

/**
 * Adapter with a recording metadata cache.
 *
 * @param opts.items      what `client.meta.getItems('view')` returns
 * @param opts.published  what `client.meta.getItem` answers (body, or an
 *                        Error to throw — a 404 means "no published overlay")
 * @param opts.draft      body served at `GET /meta/view/:name?state=draft`
 *                        (`null` → 404, i.e. nothing pending)
 */
function makeDS(opts: {
  items?: any[];
  published?: any | Error;
  draft?: any | null;
} = {}): Harness {
  const invalidated: string[] = [];
  const cacheReads: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/meta/view/')) {
      if ((init?.method ?? 'GET') === 'PUT') return json({ success: true, version: 2 });
      // #4479 — `deleteView` addresses BOTH homes over this wire, so the
      // harness has to answer DELETE. The framework never 404s a missing
      // home: it reports one with a 200 carrying `reset:false`. Modelled
      // faithfully (a home "has a row" exactly when this harness was told to
      // serve one) so the pins below stay pins on INVALIDATION rather than
      // becoming accidental assertions about the transport.
      if ((init?.method ?? 'GET') === 'DELETE') {
        const hasRow = url.includes('state=draft')
          ? opts.draft != null
          : opts.published != null && !(opts.published instanceof Error);
        return json({ success: true, reset: hasRow });
      }
      if (url.includes('state=draft')) {
        if (opts.draft == null) return json({ error: 'not found' }, 404);
        return json({ type: 'view', name: opts.draft.name, item: opts.draft });
      }
      return json({ error: 'not found' }, 404);
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });

  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  ds.connected = true;
  ds.connectionState = 'connected';

  // Recording stand-in for the real MetadataCache: `get` records the key and
  // always misses (runs the loader), `invalidate` records the key.
  ds.metadataCache = {
    get: async (key: string, loader: () => Promise<any>) => {
      cacheReads.push(key);
      return loader();
    },
    invalidate: (key: string) => {
      invalidated.push(key);
    },
    getCachedSync: () => undefined,
    getStats: () => ({}),
  };

  const getItems = vi.fn(async () => ({ items: opts.items ?? [] }));
  const saveItem = vi.fn(async () => ({ success: true }));
  const deleteItem = vi.fn(async () => ({ deleted: true }));
  ds.client = {
    meta: {
      getItems,
      saveItem,
      deleteItem,
      getItem: vi.fn(async () => {
        if (opts.published instanceof Error) throw opts.published;
        return { item: opts.published ?? { name: 'v1', object: 'account' } };
      }),
    },
  };

  return { ds, invalidated, cacheReads, getItems, saveItem, deleteItem };
}

/** A published read that 404s, decorated the way the SDK client decorates. */
function notFound(): Error {
  return Object.assign(new Error('Metadata item not found'), { httpStatus: 404 });
}

const VIEW = {
  name: 'account.all',
  object: 'account',
  viewKind: 'list',
  label: 'All Accounts',
  config: { type: 'grid', data: { object: 'account' } },
};

describe('view metadata cache — invalidation names only keys with readers (#3778)', () => {
  it('listViews reads the stored list:view while one is held, else the transport, and no other key (objectui#13057)', async () => {
    const { ds, getItems, cacheReads } = makeDS({ items: [VIEW] });
    const probed: string[] = [];
    const cache: { held?: unknown } = {};
    ds.metadataCache.getCachedSync = (key: string) => {
      probed.push(key);
      return cache.held;
    };

    // Nothing held: each call goes to the transport. Storing the answer is
    // the real client's (its `getItems` wrap); this stand-in client has none.
    await ds.listViews('account');
    await ds.listViews('account');
    expect(getItems).toHaveBeenCalledTimes(2);
    expect(getItems).toHaveBeenCalledWith('view');

    // A list held under `list:view` answers the read: no third round trip.
    cache.held = { items: [VIEW] };
    const views = await ds.listViews('account');
    expect(views.map((v: any) => v.name)).toEqual(['account.all']);
    expect(getItems).toHaveBeenCalledTimes(2);

    // The one key it consults is the list; no per-object key is read.
    expect(cacheReads).toEqual([]);
    expect(probed).toEqual(['list:view', 'list:view', 'list:view']);
  });

  it('listViewOverrides reads back under the key the write paths invalidate', async () => {
    // The pairing, not the string: every assertion below names
    // `view-overrides:account` because THIS is the key the batch reader caches
    // under. An invalidation that named anything else would be the `views:`
    // mistake again, one rename later.
    const { ds, cacheReads } = makeDS({ items: [VIEW] });

    await ds.listViewOverrides('account');

    expect(cacheReads).toEqual(['view-overrides:account']);
  });

  it('createView invalidates the per-view key and the override map (#4363)', async () => {
    const { ds, invalidated } = makeDS();

    await ds.createView('account', { name: 'account.mine', object: 'account' });

    // `view:{object}:{viewId}` → getView; `view-overrides:{object}` →
    // listViewOverrides. Nothing else is read back under a view-shaped key.
    // A created view is a new row in the batch map; nothing else notices.
    // `saveItem` is an upsert, so the per-view key is named too — an explicit
    // `name` that already exists overwrites a row `getView` may hold cached.
    expect(invalidated).toEqual(['view:account:account.mine', 'view-overrides:account', 'list:view']);
  });

  it('updateView (published overlay) invalidates both keys (#4363)', async () => {
    const { ds, invalidated } = makeDS({ published: { name: 'v1', object: 'account' } });

    await ds.updateView('account', 'v1', { label: 'Renamed' });

    expect(invalidated).toEqual(['view:account:v1', 'view-overrides:account', 'list:view']);
  });

  it('updateView (pending draft) invalidates both keys (#4363)', async () => {
    const { ds, invalidated } = makeDS({ draft: VIEW, published: notFound() });

    await ds.updateView('account', VIEW.name, { label: 'Renamed' });

    // Deliberate over-invalidation on this half: both readers enumerate
    // PUBLISHED rows, so a draft write stales neither — as was already true of
    // the per-view line this pairs with. Pinned so the uniform per-method rule
    // is a decision on the record, not an oversight the next reader "fixes".
    expect(invalidated).toEqual([
      `view:account:${VIEW.name}`,
      'view-overrides:account',
      'list:view',
    ]);
  });

  it('deleteView invalidates both keys (#4363)', async () => {
    const { ds, invalidated } = makeDS();

    await ds.deleteView('account', 'v1');

    // The deleted row leaves the override map too — a ghost entry there is what
    // the object page would keep applying for the rest of the TTL.
    expect(invalidated).toEqual(['view:account:v1', 'view-overrides:account', 'list:view']);
  });

  it('no write path invalidates a `views:` key — nothing populates one', async () => {
    // createView is the path whose ONLY invalidation was the dead key. #3778
    // asserted "no `views:` key" here rather than "no invalidation at all",
    // deliberately leaving the override-map question to its own card — and
    // #4363 answered it: createView now names both live keys (pinned above).
    // The ASSERTION is unchanged, which is the point of the slot: the dead key
    // stays dead however the live key set grows.
    const created = makeDS();
    await created.ds.createView('account', { name: 'account.mine', object: 'account' });

    const removed = makeDS();
    await removed.ds.deleteView('account', 'v1');

    for (const { invalidated } of [created, removed]) {
      expect(invalidated.filter((k) => k.startsWith('views:'))).toEqual([]);
    }
  });
});
