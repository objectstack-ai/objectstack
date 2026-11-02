/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28645 — what `MetadataProvider` answers from the app bundle, for
 * readers that must answer in render. Its own module, beside the provider, so
 * a test that stands in for the provider module leaves these readers on their
 * no-provider answer (a miss: every read reads its list).
 */

import { createContext, useContext } from 'react';

/**
 * One bundle-first read: `pending` while the app bundle that may hold it has
 * not answered yet; `hit` with what the bundle holds; `miss` when no bundle
 * can answer it — none was entered, draft preview, a host adapter without the
 * bundle, or an item outside it. On a miss the reader reads its list exactly
 * as it did before the bundle, so an item the bundle lacks is answered by the
 * same read, prefer-local resolution (ADR-0048) included.
 */
export type BundledRead<T = unknown> =
  | { readonly state: 'pending' }
  | { readonly state: 'hit'; readonly value: T }
  | { readonly state: 'miss' };

export const BUNDLE_PENDING: BundledRead<never> = Object.freeze({ state: 'pending' as const });
export const BUNDLE_MISS: BundledRead<never> = Object.freeze({ state: 'miss' as const });

/** What this provider answers from the app bundle, for readers that must answer in render. */
export interface BundledReads {
  /**
   * The `type` / `name` item the active app bundle holds. With
   * `ownerPackageId`, an item another package owns is a miss: the list's
   * prefer-local pick (`preferLocal`) decides between same-named items.
   */
  item(type: string, name: string, ownerPackageId?: unknown): BundledRead<any>;
  /**
   * The view documents to compose `objectNames` with: the bundle's, when it
   * holds every one of those objects (it holds every view bound to an object
   * it holds); a miss otherwise, and the `/meta/view` list composes them.
   */
  viewsFor(objectNames: readonly string[]): BundledRead<unknown[]>;
}

export const BundledReadsCtx = createContext<BundledReads | null>(null);

/** The provider's {@link BundledReads}, or `null` outside a `MetadataProvider` (every read then reads its list). */
export function useBundledReads(): BundledReads | null {
  return useContext(BundledReadsCtx);
}

/** {@link BundledReads.item} as a hook; a miss outside a `MetadataProvider` or with no name. */
export function useBundledItem(type: string, name: string | undefined | null, ownerPackageId?: unknown): BundledRead<any> {
  const reads = useBundledReads();
  return reads && name ? reads.item(type, name, ownerPackageId) : BUNDLE_MISS;
}

/**
 * A by-name read in a reader that answers in render (a label resolver): the
 * item the bundle holds; nothing while the bundle is on the wire; else the
 * first item named `name` in `list()`, which is read only then — exactly the
 * lookup the reader made before the bundle.
 */
export function bundledFirst(
  reads: BundledReads | null,
  type: string,
  name: string,
  list: () => readonly unknown[] | undefined,
): any {
  const bundled = reads ? reads.item(type, name) : BUNDLE_MISS;
  if (bundled.state === 'hit') return bundled.value;
  if (bundled.state === 'pending') return undefined;
  return (list() ?? []).find(
    (item) => !!item && typeof item === 'object' && (item as { name?: unknown }).name === name,
  );
}
