// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flowPaletteRecents — tiny localStorage MRU of node types the author recently
 * inserted from the flow designer's add-node palette (#1943). Surfaced as a
 * "Recently used" group at the top of the palette when the search box is
 * empty, so frequent nodes stop needing a scroll or a search.
 *
 * Deliberately not user-scoped (node types are not sensitive — same call as
 * the `grid-columns-*` keys) and not debounced (writes happen once per pick).
 * Consumers intersect the stored types against the live palette, so types
 * from since-uninstalled plugins simply drop out of view; the storage itself
 * self-heals on the next pick.
 */

/**
 * localStorage key. Also the base key + legacy-migration source for the
 * cloud-synced {@link ../../../context/FlowPaletteRecentsProvider}.
 */
export const PALETTE_RECENTS_KEY = 'flow-palette-recents';
const KEY = PALETTE_RECENTS_KEY;

/** Most-recent-first cap — keeps the group glanceable, not a second palette. */
export const MAX_PALETTE_RECENTS = 5;
const MAX_RECENTS = MAX_PALETTE_RECENTS;

/** Read the MRU list. Returns `[]` on missing/corrupt storage or during SSR. */
export function readPaletteRecents(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Move `type` to the front of the MRU list (deduped, capped). */
export function recordPaletteRecent(type: string): void {
  if (!type) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const next = [type, ...readPaletteRecents().filter((t) => t !== type)].slice(0, MAX_RECENTS);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — recents are a nicety, never an error */
  }
}
