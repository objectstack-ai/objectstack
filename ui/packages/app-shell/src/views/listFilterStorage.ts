/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Per-user, per-view persistence for a list's transient runtime filters —
 * the advanced FilterBuilder group and the search term.
 *
 * Unlike `userFilterUrlState` (which mirrors end-user quick-filter selections
 * into `uf_*` URL params so a filtered list is shareable), this cache lives in
 * `localStorage`. URL params only survive a reload or the browser Back button;
 * they are lost the moment the user leaves via an in-app nav link (that link
 * carries no query string) and returns. Mirroring the runtime filter into
 * `localStorage` makes it survive full SPA navigation too — the user's own
 * "remember what I was filtering" state, NOT a change to the shared view.
 *
 * The key embeds the user id so two accounts on the same browser never read
 * each other's filters (a filter value can be sensitive). Column state
 * (`grid-columns-*`) predates this and is deliberately NOT user-scoped —
 * column widths are cosmetic; filter values are not.
 */

const PREFIX = 'list-filters';

/** Loose shape of a FilterBuilder group — `{ id, logic, conditions[] }`. */
export interface ListFilterState {
  filters?: { id?: string; logic?: string; conditions?: unknown[] } | null;
  search?: string;
}

/**
 * Build the storage key for a given user + object + view. Returns undefined
 * when the caller can't scope it (no object/view yet) so we never write a key
 * that would collide across views. `userId` falls back to `anon` — a signed-out
 * or still-loading session gets its own bucket rather than leaking into a real
 * user's key.
 */
export function buildListFilterKey(
  userId: string | undefined,
  objectName: string | undefined,
  viewId: string | undefined,
): string | undefined {
  if (!objectName || !viewId) return undefined;
  return `${PREFIX}:${userId || 'anon'}:${objectName}:${viewId}`;
}

/** True when a filter group carries no active conditions. */
function isEmptyFilters(f: ListFilterState['filters']): boolean {
  return !f || !Array.isArray(f.conditions) || f.conditions.length === 0;
}

/** True when a whole state is effectively empty (nothing worth persisting). */
function isEmptyState(s: ListFilterState): boolean {
  return isEmptyFilters(s.filters) && !(s.search && s.search.length > 0);
}

/** Read the cached filter state for a key. Returns undefined when absent or unparsable. */
export function readListFilterState(key: string | undefined): ListFilterState | undefined {
  if (!key || typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as ListFilterState;
  } catch {
    return undefined;
  }
}

// Debounce writes so a burst of FilterBuilder edits / search keystrokes hits
// localStorage once, not on every character. Pending patches merge per key so
// a filter change and a search change in the same window both land.
const pending: Record<string, ListFilterState> = {};
const timers: Record<string, ReturnType<typeof setTimeout>> = {};

/**
 * Merge a patch into the cached state for a key and flush (debounced). Only the
 * keys present in `patch` are touched, so callers can persist `filters` and
 * `search` independently. When the merged result is empty the key is removed to
 * keep storage from filling with dead buckets.
 */
export function writeListFilterState(key: string | undefined, patch: ListFilterState): void {
  if (!key || typeof localStorage === 'undefined') return;
  const base = pending[key] ?? readListFilterState(key) ?? {};
  pending[key] = { ...base, ...patch };
  if (timers[key]) clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    const next = pending[key] ?? {};
    delete pending[key];
    delete timers[key];
    try {
      if (isEmptyState(next)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* quota / private-mode — restoring filters is best-effort, never fatal */
    }
  }, 300);
}

/** Drop any cached (and pending) state for a key. */
export function clearListFilterState(key: string | undefined): void {
  if (!key) return;
  if (timers[key]) { clearTimeout(timers[key]); delete timers[key]; }
  delete pending[key];
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
