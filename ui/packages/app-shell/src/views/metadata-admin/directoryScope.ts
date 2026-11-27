// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which metadata types a package's directory lists: one rule, read by the
 * type directory (`DirectoryPage`) and by Studio's left menu (`StudioMenu`),
 * so the menu and the directory never disagree on what a package holds.
 */

import { ENVIRONMENT_AREA_TYPES } from './metadataAreaHost.js';

/**
 * Types never listed. `field` is edited inside its object; `package` is the
 * scope container itself, with its own management surface. `form` (ADR-0159
 * card ②, objectstack#37086) has no designer, menu placement or ADR-0084 row
 * yet: card ③ (objectstack#37087) brings all three and takes it off this set.
 * Its forms are still served and judged; only Studio's directory and menu
 * leave the type out.
 */
export const HIDDEN_DIRECTORY_TYPES: ReadonlySet<string> = new Set(['field', 'package', 'form']);

/**
 * The served type entries a directory lists, in served order:
 *  - the environment scope (Studio's cross-package leg): the environment
 *    catalog's types;
 *  - a package: the types the diagnostics sweep says that package contributes
 *    to (`packagesByType`), plus `always` — types listed even before the
 *    package holds one;
 *  - no package known yet: nothing (fail closed).
 */
export function scopeDirectoryEntries<T extends { type: string }>(
  entries: readonly T[],
  scope: {
    environment: boolean;
    packageId: string | null;
    packagesByType: Readonly<Record<string, readonly string[]>>;
    always?: readonly string[];
  },
): T[] {
  return entries.filter((e) => {
    if (HIDDEN_DIRECTORY_TYPES.has(e.type)) return false;
    if (scope.environment) return ENVIRONMENT_AREA_TYPES.includes(e.type);
    if (!scope.packageId) return false;
    if (scope.always?.includes(e.type)) return true;
    return (scope.packagesByType[e.type] ?? []).includes(scope.packageId);
  });
}
