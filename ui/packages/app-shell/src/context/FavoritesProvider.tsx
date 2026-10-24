/**
 * FavoritesProvider
 *
 * React Context + Provider for shared favorites state across all consumers
 * (HomePage, AppCard, UnifiedSidebar, StarredApps).
 *
 * Persistence is **localStorage-first** with optional backend hydration:
 * - On mount we render synchronously from localStorage (no flash of empty UI).
 * - If a `UserDataAdapter<FavoriteItem>` is attached via `UserStateAdaptersProvider`
 *   (see `./UserStateAdapters`), the provider hydrates from the backend and
 *   writes-through every mutation through a debounced `adapter.save()`.
 * - localStorage stays in sync so offline / pre-auth sessions still work and
 *   gives an instant first paint after sign-in.
 * - The local key is scoped per `user.id` so different accounts on the same
 *   browser don't cross-contaminate.
 *
 * @module
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@object-ui/auth';
import {
  createDebouncedFlush,
  scopedKey,
  useStorageSync,
  useUserStateAdapter,
} from './UserStateAdapters.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FavoriteItem {
  /** Unique key, e.g. "object:contact" or "dashboard:sales_overview" or "nav:<navId>" */
  id: string;
  label: string;
  href: string;
  /**
   * Item kind.
   *
   * - `object` / `dashboard` / `page` / `report` / `record` — content favorites
   *   surfaced on Home (Starred Apps) and the sidebar Favorites section.
   * - `nav` — a sidebar navigation entry promoted to the "Pinned" position via
   *   the in-tree pin toggle (see `useNavPins`). Excluded from Home/Starred and
   *   from the generic sidebar Favorites list so it doesn't render twice.
   */
  type: 'object' | 'dashboard' | 'page' | 'report' | 'record' | 'nav';
  /** ISO timestamp of when the item was favorited */
  favoritedAt: string;
  /**
   * When true, the item is pinned to the top of the sidebar (Pinned section).
   * `nav`-type items are always pinned by construction; other types may also
   * carry this flag if the user explicitly promotes a content favorite — that
   * behaviour is reserved for a future iteration.
   */
  pinned?: boolean;
  /**
   * For `type === 'nav'` items: the originating `NavigationItem.id` in the
   * application's nav tree. Used by `useNavPins.applyPins` to flag the live
   * tree node without leaking the synthesized favorite into other UIs.
   */
  navId?: string;
}

interface FavoritesContextValue {
  favorites: FavoriteItem[];
  addFavorite: (item: Omit<FavoriteItem, 'favoritedAt'>) => void;
  removeFavorite: (id: string) => void;
  toggleFavorite: (item: Omit<FavoriteItem, 'favoritedAt'>) => void;
  isFavorite: (id: string) => boolean;
  clearFavorites: () => void;
  /**
   * Self-heal a stored label for an existing favorite without re-ordering
   * or resetting `favoritedAt`. Used by record pages once the human-readable
   * title resolves so stale "raw id" labels (e.g. saved before the title
   * loaded) get rewritten transparently on the next visit.
   */
  refreshLabel: (id: string, label: string) => void;
  /**
   * Flip the `pinned` flag on an existing favorite. No-op if the id is not
   * present. Used by `useNavPins` for nav-tree pin toggles backed by the
   * unified favorites store (same backend sync channel).
   */
  setPinned: (id: string, pinned: boolean) => void;
  /**
   * Returns true when a favorite with the given id is currently `pinned`.
   * Use `isFavorite` for membership-only queries.
   */
  isPinned: (id: string) => boolean;
  /**
   * Set of NavigationItem ids that are currently pinned via a `type === 'nav'`
   * favorite, in the user's pinned order (objectui#12059): the order of the
   * nav favorites in `favorites`. Memoised; safe to use as a dependency.
   */
  pinnedNavIds: Set<string>;
  /**
   * Put the named nav pins in this order (objectui#12059). `navIds` lists the
   * `navId`s of nav favorites as the user arranged them; they take the
   * positions those favorites already hold, in the order given, so a pin that
   * is not named (one another app's sidebar draws, say) and every content
   * favorite keep their places. An id with no nav favorite is ignored.
   */
  reorderNavPins: (navIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_BASE_KEY = 'objectui-favorites';
/** Legacy key used by the standalone `useNavPins` hook before it was merged
 * into Favorites. Migrated once at provider mount, then deleted. */
const LEGACY_NAV_PINS_KEY = 'objectui-nav-pins';
/** Cap for user-visible content favorites (object/dashboard/page/report/record). */
const MAX_FAVORITES = 20;
/** Independent cap for nav-pin favorites — they live in a separate bucket. */
const MAX_NAV_PINS = 20;

/**
 * Enforce per-bucket caps while preserving order within each bucket. Content
 * favorites (`type !== 'nav'`) cap at `MAX_FAVORITES`; nav-pin favorites
 * (`type === 'nav'`) cap at `MAX_NAV_PINS`. Returns the original array when
 * neither bucket overflows so memoized consumers aren't invalidated.
 */
function capByBucket(items: FavoriteItem[]): FavoriteItem[] {
  let contentCount = 0;
  let navCount = 0;
  let overflowed = false;
  for (const it of items) {
    if (it.type === 'nav') {
      navCount++;
      if (navCount > MAX_NAV_PINS) overflowed = true;
    } else {
      contentCount++;
      if (contentCount > MAX_FAVORITES) overflowed = true;
    }
  }
  if (!overflowed) return items;
  const result: FavoriteItem[] = [];
  let c = 0, n = 0;
  for (const it of items) {
    if (it.type === 'nav') {
      if (n < MAX_NAV_PINS) { result.push(it); n++; }
    } else {
      if (c < MAX_FAVORITES) { result.push(it); c++; }
    }
  }
  return result;
}

/**
 * `items` with `entry` added. A content favorite goes first (the most recent
 * star leads). A nav pin goes LAST: the nav favorites' order is the user's
 * pinned order, and a new pin joins it at the end (objectui#12059). When that
 * takes the nav bucket past its cap, the earliest-pinned nav favorite rolls
 * off, as the oldest did when pins were prepended.
 */
function withAddedFavorite(items: FavoriteItem[], entry: FavoriteItem): FavoriteItem[] {
  if (entry.type !== 'nav') return capByBucket([entry, ...items]);
  const next = [...items, entry];
  const navPins = next.filter(f => f.type === 'nav');
  if (navPins.length <= MAX_NAV_PINS) return capByBucket(next);
  const earliest = navPins
    .slice(0, -1)
    .reduce((a, b) => (b.favoritedAt < a.favoritedAt ? b : a));
  return capByBucket(next.filter(f => f !== earliest));
}

/**
 * `items` with the nav favorites named by `navIds` put in that order, in the
 * positions they already hold; `items` itself when nothing moves.
 */
function withNavPinOrder(items: FavoriteItem[], navIds: string[]): FavoriteItem[] {
  const byNavId = new Map<string, FavoriteItem>();
  for (const f of items) {
    if (f.type === 'nav' && f.navId && !byNavId.has(f.navId)) byNavId.set(f.navId, f);
  }
  const wanted: FavoriteItem[] = [];
  const seen = new Set<string>();
  for (const id of navIds) {
    const f = byNavId.get(id);
    if (f && !seen.has(id)) { wanted.push(f); seen.add(id); }
  }
  const moving = new Set(wanted);
  let k = 0;
  let changed = false;
  const next = items.map(f => {
    if (!moving.has(f)) return f;
    const placed = wanted[k++];
    if (placed !== f) changed = true;
    return placed;
  });
  return changed ? next : items;
}

function loadFavorites(userId?: string | null): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_BASE_KEY, userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(items: FavoriteItem[], userId?: string | null) {
  try {
    localStorage.setItem(scopedKey(STORAGE_BASE_KEY, userId), JSON.stringify(items));
  } catch {
    // Storage full — silently ignore
  }
}

/**
 * One-shot migration of legacy `objectui-nav-pins` (a `string[]` of
 * NavigationItem ids) into the unified favorites list as `type: 'nav'`
 * entries. The label/href fields are placeholders because at migration time
 * we only have the raw nav id — the live nav tree resolves the real label
 * when it renders the Pinned section (see `useNavPins.applyPins`).
 *
 * Idempotent: runs only when the legacy key exists. Once consumed, the
 * legacy key is removed so the next launch is a no-op. Existing nav-pinned
 * favorites (e.g. on a subsequent device after backend hydration) are not
 * duplicated.
 */
function migrateLegacyNavPins(current: FavoriteItem[]): {
  migrated: FavoriteItem[];
  didMigrate: boolean;
} {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LEGACY_NAV_PINS_KEY);
  } catch {
    return { migrated: current, didMigrate: false };
  }
  if (!raw) return { migrated: current, didMigrate: false };

  let legacyIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      legacyIds = parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    /* fall through — treat as empty */
  }

  // Always clear the legacy key, even on empty/corrupt payload, so we never
  // re-enter this branch on the next mount.
  try { localStorage.removeItem(LEGACY_NAV_PINS_KEY); } catch { /* noop */ }

  if (legacyIds.length === 0) return { migrated: current, didMigrate: false };

  const existingNavIds = new Set(
    current.filter(f => f.type === 'nav' && f.navId).map(f => f.navId!),
  );

  const now = new Date().toISOString();
  const additions: FavoriteItem[] = [];
  for (const navId of legacyIds) {
    if (existingNavIds.has(navId)) continue;
    additions.push({
      id: `nav:${navId}`,
      label: navId, // placeholder — sidebar uses live nav tree label
      href: '',     // placeholder — sidebar uses live nav tree href
      type: 'nav',
      navId,
      pinned: true,
      favoritedAt: now,
    });
  }
  if (additions.length === 0) return { migrated: current, didMigrate: true };

  // Nav pins do not count against the user-visible favorites cap — they are
  // a separate logical bucket. Append after content favorites so a user with
  // 20 stars keeps them all visible on Home/Starred.
  return { migrated: [...current, ...additions], didMigrate: true };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface FavoritesProviderProps {
  children: ReactNode;
}

export function FavoritesProvider({ children }: FavoritesProviderProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const adapter = useUserStateAdapter<FavoriteItem>('favorites');

  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites(userId));

  // Re-load from localStorage whenever the active user changes (sign-in /
  // account switch). Prevents one account from seeing another's favorites.
  useEffect(() => {
    setFavorites(loadFavorites(userId));
  }, [userId]);

  // Cross-tab sync: when another tab writes the same scoped key, mirror the
  // change locally. `storage` events do not fire in the tab that wrote them,
  // so this never echoes our own mutations.
  useStorageSync<FavoriteItem[]>(scopedKey(STORAGE_BASE_KEY, userId), value => {
    setFavorites(
      Array.isArray(value)
        ? capByBucket(value.filter(it => it && typeof (it as any).id === 'string'))
        : [],
    );
  });

  // Hydrate from backend whenever an adapter is attached (or user changes).
  // Backend is the baseline, but we *merge in* any locally-known nav-pin
  // favorites the backend doesn't have yet — this preserves pins added
  // offline / pre-auth, and pins recovered from the legacy `objectui-nav-pins`
  // key by the offline migration effect below. Legacy migration also runs
  // here as a safety net if the offline effect hasn't yet fired in time.
  const hydrationToken = useRef(0);
  useEffect(() => {
    if (!adapter) return;
    const token = ++hydrationToken.current;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await adapter.load();
        if (cancelled || token !== hydrationToken.current) return;
        // Defensive sanitize: drop unparseable shapes, enforce cap.
        const sane = capByBucket(
          (Array.isArray(remote) ? remote : []).filter(it => it && typeof (it as any).id === 'string'),
        );

        // Re-read the local snapshot — it may contain nav-pin favorites that
        // were added (or migrated) before the adapter arrived. Without this
        // merge, signing in would silently wipe a user's offline pins.
        const local = loadFavorites(userId);
        const remoteNavIds = new Set(
          sane.filter(f => f.type === 'nav' && f.navId).map(f => f.navId!),
        );
        const localNavExtras = local.filter(
          f => f.type === 'nav' && f.navId && !remoteNavIds.has(f.navId),
        );

        let merged = sane;
        let pushBack = false;
        if (localNavExtras.length > 0) {
          merged = capByBucket([...sane, ...localNavExtras]);
          pushBack = true;
        }

        const { migrated, didMigrate } = migrateLegacyNavPins(merged);
        if (didMigrate) {
          merged = capByBucket(migrated);
          pushBack = true;
        }

        setFavorites(merged);
        saveFavorites(merged, userId);
        if (pushBack) flusher.schedule(merged);
      } catch {
        // Keep localStorage state — adapter degrade-to-noop is acceptable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, userId]);

  // Offline / pre-auth migration: when there is no adapter to push to, fold
  // legacy nav-pins into the localStorage baseline immediately so the very
  // first render after upgrade already includes them. If an adapter later
  // attaches, the hydrate effect above merges these into the backend.
  useEffect(() => {
    if (adapter) return; // adapter path handles migration above
    setFavorites(prev => {
      const { migrated, didMigrate } = migrateLegacyNavPins(prev);
      if (!didMigrate) return prev;
      const next = capByBucket(migrated);
      saveFavorites(next, userId);
      return next;
    });
  }, [adapter, userId]);

  // Debounced write-through to backend.
  const flusher = useMemo(
    () => createDebouncedFlush<FavoriteItem[]>(async items => {
      if (adapter) await adapter.save(items);
    }, 500),
    [adapter],
  );
  // Flush pending writes when the adapter detaches / user changes.
  useEffect(() => () => { void flusher.flush(); }, [flusher]);

  const commit = useCallback(
    (next: FavoriteItem[]) => {
      saveFavorites(next, userId);
      if (adapter) flusher.schedule(next);
    },
    [userId, adapter, flusher],
  );

  const addFavorite = useCallback(
    (item: Omit<FavoriteItem, 'favoritedAt'>) => {
      setFavorites(prev => {
        if (prev.some(f => f.id === item.id)) return prev;
        const updated = withAddedFavorite(prev, { ...item, favoritedAt: new Date().toISOString() });
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const removeFavorite = useCallback(
    (id: string) => {
      setFavorites(prev => {
        const updated = prev.filter(f => f.id !== id);
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const toggleFavorite = useCallback(
    (item: Omit<FavoriteItem, 'favoritedAt'>) => {
      setFavorites(prev => {
        const exists = prev.some(f => f.id === item.id);
        const updated = exists
          ? prev.filter(f => f.id !== item.id)
          : withAddedFavorite(prev, { ...item, favoritedAt: new Date().toISOString() });
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const clearFavorites = useCallback(() => {
    setFavorites([]);
    commit([]);
  }, [commit]);

  const refreshLabel = useCallback(
    (id: string, label: string) => {
      if (!id || !label) return;
      setFavorites(prev => {
        let changed = false;
        const updated = prev.map(f => {
          if (f.id === id && f.label !== label) {
            changed = true;
            return { ...f, label };
          }
          return f;
        });
        if (!changed) return prev;
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const setPinned = useCallback(
    (id: string, pinned: boolean) => {
      setFavorites(prev => {
        let changed = false;
        const updated = prev.map(f => {
          if (f.id !== id) return f;
          const cur = !!f.pinned;
          if (cur === pinned) return f;
          changed = true;
          return { ...f, pinned };
        });
        if (!changed) return prev;
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const reorderNavPins = useCallback(
    (navIds: string[]) => {
      setFavorites(prev => {
        const updated = withNavPinOrder(prev, navIds);
        if (updated === prev) return prev;
        commit(updated);
        return updated;
      });
    },
    [commit],
  );

  const value = useMemo<FavoritesContextValue>(() => {
    const pinnedNavIds = new Set<string>();
    for (const f of favorites) {
      if (f.pinned && f.type === 'nav' && f.navId) pinnedNavIds.add(f.navId);
    }
    return {
      favorites,
      addFavorite,
      removeFavorite,
      toggleFavorite,
      isFavorite: (id: string) => favorites.some(f => f.id === id),
      clearFavorites,
      refreshLabel,
      setPinned,
      isPinned: (id: string) => favorites.some(f => f.id === id && !!f.pinned),
      pinnedNavIds,
      reorderNavPins,
    };
  }, [favorites, addFavorite, removeFavorite, toggleFavorite, clearFavorites, refreshLabel, setPinned, reorderNavPins]);

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access shared favorites state.
 *
 * Must be used inside `<FavoritesProvider>`.
 */
export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    // Graceful fallback: when a consumer is rendered outside a
    // FavoritesProvider — common in unit tests that only need to assert on
    // navigation rendering — return a no-op implementation rather than crash.
    return {
      favorites: [],
      addFavorite: () => {},
      removeFavorite: () => {},
      toggleFavorite: () => {},
      isFavorite: () => false,
      clearFavorites: () => {},
      refreshLabel: () => {},
      setPinned: () => {},
      isPinned: () => false,
      pinnedNavIds: new Set<string>(),
      reorderNavPins: () => {},
    };
  }
  return ctx;
}

