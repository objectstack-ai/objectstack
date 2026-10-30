// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The title a Setup list page takes from the app's own navigation
 * (objectstack#27356, row 5): the label of the entry that opens exactly this
 * page, so the page reads "Positions" as the sidebar row that opened it does,
 * in the served language, instead of the type registry's singular label.
 *
 * The entry is elected by `resolveActiveNavItem`, the one "which menu am I in"
 * matcher, and counts only when its own address is this page's path: an entry
 * that claims the page by prefix names a different page.
 */

import { resolveActiveNavItem, resolveHref, resolveNavItemLabel } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

export function navEntryTitle(
  app: unknown,
  basePath: string,
  pathname: string,
  search: string,
  t: (key: string, options?: any) => string,
  locale: string | undefined,
): string | undefined {
  const navigation = app && typeof app === 'object' ? (app as { navigation?: unknown }).navigation : undefined;
  if (!Array.isArray(navigation)) return undefined;
  const item = resolveActiveNavItem(navigation as NavigationItem[], pathname, search, basePath);
  if (!item || resolveHref(item, basePath).href.split(/[?#]/)[0] !== pathname) return undefined;
  const label = resolveNavItemLabel(item, t, undefined, locale);
  return label.trim() !== '' ? label : undefined;
}
