/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's two drops of the adapter's stored published view list
 * (objectui#13057).
 *
 * `@object-ui/data-objectstack`'s `ObjectStackAdapter` stores the answer to
 * `GET /api/v1/meta/view` under one `MetadataCache` key, and answers its own
 * `listViews` and `listViewOverrides` from it, so one object-page open reads
 * that URL once. A stored list is only correct while every path that should see
 * a fresh one drops it first (objectui#13044 ruling 6268839381 (a) and (b)).
 * The adapter's own writers already do, through `invalidateViewKeys` and the
 * write wrap on its client. Two console paths cannot reach either:
 *
 * - a user refresh of an object page (`ObjectView`'s `refreshData`), which
 *   reads the list through `listViews` again and must not be answered by the
 *   stored one ({@link dropPublishedViewList});
 * - a view written through the console's own `MetadataClient`, which talks to
 *   `/api/v1/meta` with a transport the adapter never sees. Every such client
 *   comes from `useMetadataClient`, and that hook drops the list after each of
 *   the client's write doors that can change a published view
 *   ({@link installViewListDrop}).
 *
 * The drop goes through the adapter's public `invalidateCache(key)`. The key is
 * the adapter's (`VIEW_LIST_KEY` in `@object-ui/data-objectstack`) and is
 * spelled here once; `MetadataProvider.oneMetadataRead-13044.test.tsx` drives a
 * real adapter through each drop, so a renamed key turns those pins red rather
 * than leaving a drop that names nothing.
 */

import type { MetadataClient } from '@object-ui/data-objectstack';

/** The adapter's `MetadataCache` key for `GET /api/v1/meta/view`. */
const PUBLISHED_VIEW_LIST_KEY = 'list:view';

/**
 * Drop the adapter's stored published view list, so the next `listViews` /
 * `listViewOverrides` read asks the server.
 *
 * `dataSource` is the console's data source. Only an adapter that keeps a
 * metadata cache has the member, and only such an adapter has a stored list
 * to drop: an adapter without `invalidateCache` (another backend, a test
 * double) has nothing to drop, exactly as an adapter without `listViews` has
 * no saved views (`ObjectView` asks for that member the same way).
 */
export function dropPublishedViewList(dataSource: unknown): void {
  const invalidate = (dataSource as { invalidateCache?: unknown } | null | undefined)?.invalidateCache;
  if (typeof invalidate === 'function') invalidate.call(dataSource, PUBLISHED_VIEW_LIST_KEY);
}

/**
 * The `MetadataClient` doors that write an item addressed by `(type, name)`:
 * the type is the first argument, so a `view` write is told apart by it.
 * Together with {@link PACKAGE_WRITE_DOORS} this is every door of the client
 * that sends a write; `viewListDrop.test.ts` derives that set from the
 * client itself, so a new write door fails that pin until it is listed here.
 */
export const ITEM_WRITE_DOORS = ['save', 'publish', 'publishDraft', 'reset', 'rollback'] as const;

/**
 * The `MetadataClient` doors that write a whole package's items at once. A
 * package can carry views, so each call drops the list whatever it promoted.
 */
export const PACKAGE_WRITE_DOORS = ['publishPackageDrafts'] as const;

/**
 * Make `client` call `drop` once each write that can change a published view
 * settles, landed or refused: an item write whose type is `view`, and every
 * package-wide write. The write's own answer or error is passed through
 * untouched.
 *
 * A draft write is included on purpose, as `invalidateViewKeys` over-invalidates
 * on the adapter side: an unnecessary drop costs one read, a missed one serves
 * a stale list for the cache's lifetime.
 *
 * The client must be one the caller built and never shares (the doors are
 * replaced on the instance). `useMetadataClient` builds a fresh one.
 */
export function installViewListDrop(client: MetadataClient, drop: () => void): MetadataClient {
  const doors = client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const door of ITEM_WRITE_DOORS) {
    const write = doors[door].bind(client);
    doors[door] = (...args: unknown[]) => (args[0] === 'view' ? write(...args).finally(drop) : write(...args));
  }
  for (const door of PACKAGE_WRITE_DOORS) {
    const write = doors[door].bind(client);
    doors[door] = (...args: unknown[]) => write(...args).finally(drop);
  }
  return client;
}
