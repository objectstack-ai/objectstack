/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve a REQUESTED view name against an object's actual view ids.
 *
 * Canonical view ids are fully qualified (`<object>.<viewKind>`, see app-shell's
 * MetadataProvider), but the surfaces that NAME a view emit the short form —
 * nav items write their `viewName` verbatim, `ElementDataSource.view` on a page
 * component is authored by hand, and legacy embedded `listViews` carry bare keys
 * (including the `'all'` fallback view). Accept both directions (#2217):
 *
 * 1. exact id match;
 * 2. short name (no `.`) → retry as `<objectName>.<name>`;
 * 3. qualified name → retry with the `<objectName>.` prefix stripped.
 *
 * Returns the matching view id, or `undefined` when nothing matches — the
 * caller decides how to fall back (and should report it rather than swallow it).
 *
 * Lives in `@object-ui/core` because it has two consumers in different layers:
 * app-shell's `ObjectView` (URL-requested view) and the page-component data
 * binding that resolves `dataSource.view` (objectstack#5576). A second copy at
 * the second call site is the drift AGENTS.md #0.1 forbids — one matcher, one
 * place, so a view name that resolves in the object page resolves identically
 * when a page component names it.
 */
export function resolveViewId(
  requested: string | undefined | null,
  viewIds: readonly string[],
  objectName: string,
): string | undefined {
  if (!requested) return undefined;
  const has = (id: string) => viewIds.includes(id);
  if (has(requested)) return requested;
  const prefix = `${objectName}.`;
  if (!requested.includes('.') && has(prefix + requested)) {
    return prefix + requested;
  }
  if (requested.startsWith(prefix) && has(requested.slice(prefix.length))) {
    return requested.slice(prefix.length);
  }
  return undefined;
}
