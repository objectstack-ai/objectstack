// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * recentItemTypeLabel
 *
 * The ONE place the `home.recentApps.itemType.*` label is resolved.
 *
 * Three Home surfaces render a label for the same item kind — the rail
 * (`HomeRail.HomeContinue`), the Recently-Accessed cards (`RecentApps`) and
 * the Starred cards (`StarredApps`). Each used to spell the lookup itself,
 * and they drifted: the two card surfaces fell back to
 * `capitalizeFirst(type)` while the rail fell back to the bare `type`, so any
 * kind without a translation key rendered as `Report` on the cards and
 * `report` in the rail — on the same screen (objectui#6165).
 *
 * The duplication is what allowed the drift, so the fix removes the
 * duplication rather than only re-spelling the odd one out. A fourth surface
 * gets the agreed behaviour by construction.
 *
 * ⚠️ `type` is deliberately `string`, not a union. The three call sites do
 * NOT share one union: the rail and `RecentApps` take `RecentItem['type']`
 * (`… | 'metadata'`) while `StarredApps` takes `FavoriteItem['type']`
 * (`… | 'nav'`). They share the KEY NAMESPACE, not the type — narrowing this
 * parameter to either union would reject a legitimate caller.
 *
 * @module
 */

import { capitalizeFirst } from '../../utils/index.js';
import type { RecentItem } from '../../hooks/useRecentItems.js';

type TFn = (key: string, opts?: any) => string;

/**
 * Resolve the display label for a Home item kind.
 *
 * Falls back to the capitalized kind (`report` -> `Report`) when the locale
 * carries no `home.recentApps.itemType.<type>` key, matching what the card
 * surfaces have always rendered.
 */
export function recentItemTypeLabel(t: TFn, type: string): string {
  return t(`home.recentApps.itemType.${type}`, { defaultValue: capitalizeFirst(type) });
}

/**
 * The object a Home "Recently accessed" entry is about (objectui#12604), or
 * `undefined` for a kind that has none (a dashboard, a page, a report).
 *
 * An object entry is its object; a list view names its object; a record is
 * stored at the address the record page recorded it under,
 * `/apps/APP/OBJECT/record/ID` (`RecordDetailView`), so its object is that
 * address's third segment. The row's trail names this object for a record, and
 * the row's icon tile draws its icon.
 */
export function recentItemObject(item: RecentItem): string | undefined {
  if (item.type === 'object') return item.name;
  if (item.type === 'view') return item.object;
  if (item.type !== 'record') return undefined;
  const parts = item.href.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (parts[0] !== 'apps' || parts[3] !== 'record' || !parts[2]) return undefined;
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return parts[2];
  }
}
