// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/studio` — Studio's entry, which draws no page of its own (objectstack#36908,
 * epic #36890 decision 9).
 *
 * Studio is the development surface of a package, entered from an app or from
 * Setup → Packages (objectstack#36834); the package-card home that bare
 * `/studio` used to draw had no door and was removed. The address still
 * answers, by sending the author where they would go next:
 *
 *  1. a package the author was last in — the newest `package` entry of the
 *     recent items the Studio route records (`StudioRoute`), still named by
 *     the package list — opens in Studio;
 *  2. otherwise the package list: Setup → Packages for a principal who may
 *     open it, and Studio's "All metadata" area across packages
 *     (`/studio/~all/metadata`) for one who may enter Studio and not that
 *     Setup page (`studioEntryFallbackPath`).
 *
 * The retired `/studio?new=package` bookmark is forwarded to Setup's New
 * Package (`studioNewPackage.ts`) for a principal who may open Setup →
 * Packages, and to the same fallback as (2) for anyone else
 * (`studioNewPackageEntryPath`): a Studio-only author is never sent to a
 * Setup page that refuses them.
 *
 * A package deleted since the visit is passed over: the recent store is the
 * user's, the list the active organization's, so an entry the list no longer
 * names is not a package to open. When the list cannot be read, the newest
 * entry opens anyway, and Studio reports the read itself.
 */

import * as React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useRecentItems, type RecentNamedItem } from '../../context/RecentItemsProvider.js';
import { fetchListedPackageIds } from './packages-io.js';
import { studioPackagePath } from './studioAddress.js';
import { studioEntryFallbackPath, studioNewPackageEntryPath } from './studioEntryPermissions.js';
import { STUDIO_NEW_PACKAGE_VALUE, STUDIO_NEW_PARAM } from './studioNewPackage.js';

export function StudioEntryRedirect({
  systemPermissions,
  pending = null,
}: {
  /** The principal's capability set, as Studio's entry gate read it. */
  systemPermissions: readonly string[] | undefined;
  /** What is drawn while the package list is read. */
  pending?: React.ReactNode;
}): React.ReactElement | null {
  const [searchParams] = useSearchParams();
  const { recentItems } = useRecentItems();
  // Newest first, as the store keeps them; a package once, at its newest.
  const remembered = recentItems
    .filter((item): item is RecentNamedItem => item.type === 'package')
    .map((item) => item.name);
  const rememberedKey = remembered.join('\n');
  const [target, setTarget] = React.useState<string | null>(null);
  const fallback = studioEntryFallbackPath(systemPermissions);
  const forwardNew = searchParams.get(STUDIO_NEW_PARAM) === STUDIO_NEW_PACKAGE_VALUE;

  React.useEffect(() => {
    if (forwardNew || !rememberedKey) return;
    let cancelled = false;
    const ids = rememberedKey.split('\n');
    fetchListedPackageIds().then(
      (listed) => {
        const open = ids.find((id) => listed.has(id));
        if (!cancelled) setTarget(open ? studioPackagePath(open) : fallback);
      },
      () => {
        if (!cancelled) setTarget(studioPackagePath(ids[0]));
      },
    );
    return () => {
      cancelled = true;
    };
    // Keyed on the primitives it reads (ui/AGENTS.md #10).
  }, [forwardNew, rememberedKey, fallback]);

  if (forwardNew) return <Navigate to={studioNewPackageEntryPath(systemPermissions)} replace />;
  if (!rememberedKey) return <Navigate to={fallback} replace />;
  if (target === null) return <>{pending}</>;
  return <Navigate to={target} replace />;
}
