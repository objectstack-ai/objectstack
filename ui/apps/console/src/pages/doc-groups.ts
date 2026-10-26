/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface DocListItem {
  name: string;
  label?: string;
  description?: string;
  /** Owning package id (`_packageId`), used to build `/apps/:packageId/docs/:name`. */
  packageId?: string;
}

export interface DocGroup {
  /** Namespace prefix (the package), derived from the doc name. */
  pkg: string;
  docs: DocListItem[];
}

/**
 * Group docs by their namespace prefix (everything before the first `_`).
 *
 * Doc names are namespace-prefixed by build-time convention (ADR-0046) —
 * `crm_user_guide` belongs to package `crm`. The spec carries no explicit
 * `namespace` field, so the package is derived from the name; a bare name
 * with no underscore groups under itself. Groups and the docs within each
 * are returned in stable alphabetical order. Malformed items (missing
 * name) are dropped.
 */
export function groupDocsByPackage(items: DocListItem[]): DocGroup[] {
  const byPkg = new Map<string, DocListItem[]>();
  for (const item of items) {
    if (!item || typeof item.name !== 'string' || !item.name) continue;
    const underscore = item.name.indexOf('_');
    const pkg = underscore > 0 ? item.name.slice(0, underscore) : item.name;
    const bucket = byPkg.get(pkg);
    if (bucket) bucket.push(item);
    else byPkg.set(pkg, [item]);
  }
  return Array.from(byPkg.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((pkg) => ({
      pkg,
      docs: byPkg
        .get(pkg)!
        .slice()
        .sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name)),
    }));
}
