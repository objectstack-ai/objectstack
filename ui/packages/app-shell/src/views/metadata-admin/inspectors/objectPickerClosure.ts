// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package closure the object picker offers inside (objectstack#28240).
 *
 * A package may reference only the objects inside its closure: its own, its
 * declared dependencies' (transitively) and the platform's. The publish gate
 * judges every write against that closure, so an object outside it is refused
 * only after the author has built on it. The picker therefore asks the SAME
 * two functions the gate runs, from `@objectstack/lint`:
 *
 *  - `resolvePackageClosure` — the dependency walk, here over the manifests
 *    `GET /api/v1/packages` serves (the server walks the registry that list is
 *    read from);
 *  - `narrowObjectsToPackageClosure` — which objects that closure admits, over
 *    the `_packageId` / `isSystem` the object list serves.
 *
 * ⛔ Neither rule is restated here. If the two disagree with the gate, the fix
 * is in `@objectstack/lint`, where both callers get it.
 *
 * ## When nothing is narrowed
 *
 * No package is being edited, the package list cannot be read, or the walk
 * answers no closure (the package is not listed). Then every object is offered,
 * as before, and the server judges the pick — the gate's own failure
 * direction: an unreadable declaration narrows nothing.
 *
 * The lint module is imported lazily, as the other in-browser lint callers in
 * this package do, so the Console's first chunk does not carry it.
 */

import * as React from 'react';
import {
  fetchListedPackageManifests,
  type ListedPackageManifest,
} from '../../studio-design/packages-io.js';

/** The closure, resolved, with the package row the picker names beside it. */
export interface PackageObjectClosure {
  /** The edited package's listed row: its name, writability and manifest. */
  pkg: ListedPackageManifest;
  /** Which of `objects` (served list entries) the closure admits, by name. */
  admittedNames: (objects: ReadonlyArray<{ name: string; isSystem: boolean; packageId?: string }>) => ReadonlySet<string>;
}

type LintClosureModule = Pick<typeof import('@objectstack/lint'), 'resolvePackageClosure' | 'narrowObjectsToPackageClosure'>;

/** Resolve the closure of `packageId`, or `null` where nothing is narrowed (see the module doc). */
export async function loadPackageObjectClosure(
  packageId: string,
  deps: {
    fetchManifests?: () => Promise<ReadonlyMap<string, ListedPackageManifest>>;
    loadLint?: () => Promise<LintClosureModule>;
  } = {},
): Promise<PackageObjectClosure | null> {
  const fetchManifests = deps.fetchManifests ?? fetchListedPackageManifests;
  const loadLint = deps.loadLint ?? (() => import('@objectstack/lint'));
  let listed: ReadonlyMap<string, ListedPackageManifest>;
  let lint: LintClosureModule;
  try {
    [listed, lint] = await Promise.all([fetchManifests(), loadLint()]);
  } catch {
    return null;
  }
  const pkg = listed.get(packageId);
  const scope = lint.resolvePackageClosure(packageId, (id) => listed.get(id));
  if (!pkg || !scope) return null;
  return {
    pkg,
    admittedNames: (objects) => {
      const kept = lint.narrowObjectsToPackageClosure(
        objects.map((o) => ({ name: o.name, isSystem: o.isSystem, ...(o.packageId ? { _packageId: o.packageId } : {}) })),
        scope,
      ) as ReadonlyArray<{ name: string }>;
      return new Set(kept.map((o) => o.name));
    },
  };
}

/** The window event the package dialogs announce a create or an edit on. */
const PACKAGES_CHANGED_EVENT = 'objectui:packages-changed';

/**
 * {@link loadPackageObjectClosure} for the package being edited, read again
 * whenever a package is created or edited (a dependency just declared), so an
 * object the new declaration admits becomes pickable without a reload.
 */
export function usePackageObjectClosure(packageId: string | undefined): PackageObjectClosure | null {
  const [closure, setClosure] = React.useState<PackageObjectClosure | null>(null);
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setNonce((n) => n + 1);
    window.addEventListener(PACKAGES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(PACKAGES_CHANGED_EVENT, bump);
  }, []);
  React.useEffect(() => {
    if (!packageId) {
      setClosure(null);
      return;
    }
    let cancelled = false;
    void loadPackageObjectClosure(packageId).then((next) => {
      if (!cancelled) setClosure(next);
    });
    return () => {
      cancelled = true;
    };
  }, [packageId, nonce]);
  return closure;
}
