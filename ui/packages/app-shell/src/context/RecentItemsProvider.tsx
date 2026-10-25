/**
 * RecentItemsProvider
 *
 * Shared "recently-accessed" state with optional backend persistence. Mirrors
 * the design of `FavoritesProvider`:
 *
 * - localStorage-first: instant first paint, works offline / pre-auth.
 * - Hydrates from `UserDataAdapter<RecentItem>` when one is attached via
 *   `UserStateAdaptersProvider` (typically by `ConnectedShell`'s bridge).
 * - Writes are debounced and pushed to the adapter; localStorage stays in
 *   sync as a cold-start cache.
 * - Storage key is scoped by `user.id` to avoid cross-account leakage.
 * - An object, dashboard, page, report or Studio package entry is stored by
 *   IDENTITY — its `type` and `name` — never by display text; its label is
 *   resolved when it is rendered (`useRecentItemLabel`), in the language of
 *   that render (objectui#11678; the package kind, objectui#11863). A list
 *   view is stored the same way, by its object and its view name
 *   (objectui#12604).
 * - It keeps the last {@link MAX_RECENT} entries, one per target: one per
 *   record, one per object view (objectui#12604).
 * - A list equal to the one already persisted is not written again: a visit
 *   that does not change the list writes nothing, whoever reported the visit.
 *
 * The legacy `useRecentItems()` import path (`hooks/useRecentItems`) is
 * preserved via a re-export shim so existing call sites keep working.
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

/**
 * Every kind of recent entry. Spelled as one literal union because the
 * `home.recentApps.itemType.*` key family is checked against exactly these
 * members (`pnpm check:i18n-keys`); the two entry shapes below take their arms
 * from it.
 */
export type RecentItemType = 'object' | 'dashboard' | 'page' | 'report' | 'package' | 'view' | 'record' | 'metadata';

interface RecentItemBase {
  /** Unique key, e.g. "object:contact" or "dashboard:sales_overview" */
  id: string;
  href: string;
  /** ISO timestamp of the visit that made this entry the most recent one */
  visitedAt: string;
}

/**
 * An object, dashboard, page, report or Studio package — stored by its
 * identity, `type` and `name`, and by no display text (objectui#11678).
 *
 * Its label is resolved every time it is rendered, from the item's own
 * metadata in the current language (`useRecentItemLabel`). A label stored at
 * visit time is frozen in the language and the spelling of that moment, and
 * the route the tracker reads offers nothing to make one from but the machine
 * name — which is how "Showcase Ops Dashboard" came to stand for a dashboard
 * labelled "Delivery Operations".
 */
export interface RecentNamedItem extends RecentItemBase {
  type: Exclude<RecentItemType, 'view' | 'record' | 'metadata'>;
  /**
   * The item's machine name: the object's, dashboard's, page's or report's
   * `name`, or a package's `id` (objectui#11863). A package is the one kind
   * with no metadata cache behind it: its label comes from the package list
   * the rendering surface has loaded (`useRecentItemLabel`'s `packages`).
   */
  name: string;
}

/**
 * One list view of an object — the page `/apps/APP/OBJECT/view/VIEW` draws
 * (objectui#12604). Stored by identity, as a {@link RecentNamedItem} is: the
 * object and the view's name, both required, and no display text; its label is
 * the view's, resolved when it is rendered (`useRecentItemLabel`).
 *
 * Its own kind rather than an `object` entry with an optional view: an `object`
 * entry is the object's list as the object opens it, labelled with the
 * object's name, while this one is a named view of it, labelled with the
 * view's — and a view whose object is optional would name nothing to open.
 */
export interface RecentViewItem extends RecentItemBase {
  type: Extract<RecentItemType, 'view'>;
  /** The object whose list the view draws. */
  object: string;
  /** The view's name, as its route carries it (`crm_account.all_accounts`). */
  name: string;
}

/**
 * A record, or a Studio metadata item. Neither has a metadata label to resolve
 * when rendered, so the entry carries the text it was visited under: a record's
 * display title (data read off the record), a metadata item's name.
 */
export interface RecentTextItem extends RecentItemBase {
  type: Extract<RecentItemType, 'record' | 'metadata'>;
  label: string;
}

export type RecentItem = RecentNamedItem | RecentViewItem | RecentTextItem;

/** What `addRecentItem` takes: an entry without its visit time, each kind with its own members. */
export type RecentItemInput =
  | Omit<RecentNamedItem, 'visitedAt'>
  | Omit<RecentViewItem, 'visitedAt'>
  | Omit<RecentTextItem, 'visitedAt'>;

interface RecentItemsContextValue {
  recentItems: RecentItem[];
  addRecentItem: (item: RecentItemInput) => void;
  clearRecentItems: () => void;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_BASE_KEY = 'objectui-recent-items';
/** How many entries the store keeps (objectui#12604; Home shows six of them, the sidebar five). */
const MAX_RECENT = 20;

const NAMED_TYPES: ReadonlySet<string> = new Set(['object', 'dashboard', 'page', 'report', 'package']);
const TEXT_TYPES: ReadonlySet<string> = new Set(['record', 'metadata']);

/**
 * One stored entry in the shape this provider keeps, or `null` when it is not
 * an entry.
 *
 * Every list this provider holds comes through here — localStorage, the
 * adapter's `load()`, another tab's write, and `addRecentItem`'s argument — so
 * the persisted shape has one reader, and what is written back is always the
 * identity shape.
 *
 * ⚠️ The lists already in users' `ui.recent` rows and localStorage predate that
 * shape: an object, dashboard, page or report entry there carries a `label`
 * minted at visit time and no `name` (objectui#11678). That label is NOT read.
 * The identity was always in `id` — `<type>:<name>`, the only id the console's
 * tracker ever wrote for those four kinds — so the name is read from there and
 * the minted text is dropped, which puts the item's current label in its place
 * on the next render. An entry of those kinds whose `id` carries no `<type>:`
 * prefix names nothing that can be resolved, and is dropped.
 */
function readEntry(raw: unknown): RecentItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const { id, type, href } = entry;
  if (typeof id !== 'string' || typeof type !== 'string' || typeof href !== 'string') return null;
  const visitedAt = typeof entry.visitedAt === 'string' ? entry.visitedAt : '';
  if (NAMED_TYPES.has(type)) {
    const prefix = `${type}:`;
    const name =
      typeof entry.name === 'string'
        ? entry.name
        : id.startsWith(prefix)
          ? id.slice(prefix.length)
          : '';
    if (name === '') return null;
    return { id, type: type as RecentNamedItem['type'], name, href, visitedAt };
  }
  if (type === 'view') {
    const { object, name } = entry;
    if (typeof object !== 'string' || object === '' || typeof name !== 'string' || name === '') return null;
    return { id, type, object, name, href, visitedAt };
  }
  if (TEXT_TYPES.has(type) && typeof entry.label === 'string') {
    return { id, type: type as RecentTextItem['type'], label: entry.label, href, visitedAt };
  }
  return null;
}

/** A stored list, read entry by entry through {@link readEntry} and capped. */
function readList(raw: unknown): RecentItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RecentItem[] = [];
  for (const value of raw) {
    const item = readEntry(value);
    if (item) items.push(item);
  }
  return items.slice(0, MAX_RECENT);
}

/** What makes an entry this entry — everything but its visit time. */
function contentOf(item: RecentItem): string {
  switch (item.type) {
    case 'record':
    case 'metadata':
      return JSON.stringify([item.id, item.type, item.href, item.label]);
    case 'view':
      return JSON.stringify([item.id, item.type, item.href, item.object, item.name]);
    default:
      return JSON.stringify([item.id, item.type, item.href, item.name]);
  }
}

function loadRecent(userId?: string | null): RecentItem[] {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_BASE_KEY, userId));
    return raw ? readList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: RecentItem[], userId?: string | null) {
  try {
    localStorage.setItem(scopedKey(STORAGE_BASE_KEY, userId), JSON.stringify(items));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RecentItemsContext = createContext<RecentItemsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function RecentItemsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const adapter = useUserStateAdapter<RecentItem>('recent');

  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => loadRecent(userId));

  // The list as last installed — always the one the persisted copies hold,
  // since every list arrives either FROM storage (`adopt`) or is written TO it
  // (`commit`). Decisions read it outside any state updater: an updater may run
  // more than once for one update (React StrictMode does it on purpose), and a
  // write made inside one runs again with it.
  const itemsRef = useRef(recentItems);

  /** Install a list that was just read from storage, so it is already persisted. */
  const adopt = useCallback((items: RecentItem[]) => {
    itemsRef.current = items;
    setRecentItems(items);
  }, []);

  useEffect(() => {
    adopt(loadRecent(userId));
  }, [userId, adopt]);

  // Cross-tab sync — see FavoritesProvider for the rationale.
  useStorageSync<RecentItem[]>(scopedKey(STORAGE_BASE_KEY, userId), value => {
    adopt(readList(value));
  });

  const hydrationToken = useRef(0);
  useEffect(() => {
    if (!adapter) return;
    const token = ++hydrationToken.current;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await adapter.load();
        if (cancelled || token !== hydrationToken.current) return;
        const sane = readList(remote);
        adopt(sane);
        saveRecent(sane, userId);
      } catch {
        // ignore — degrade to localStorage
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, adopt]);

  const flusher = useMemo(
    () => createDebouncedFlush<RecentItem[]>(async items => {
      if (adapter) await adapter.save(items);
    }, 500),
    [adapter],
  );
  useEffect(() => () => { void flusher.flush(); }, [flusher]);

  // The store's own guard (objectui#11678): whoever asks for the write, a list
  // equal to the one already held — and so already persisted — changes no
  // state, writes no localStorage and calls no `adapter.save()`: no
  // `sys_user_preference` PATCH, and so no audit row for one.
  const commit = useCallback(
    (next: RecentItem[]) => {
      if (JSON.stringify(next) === JSON.stringify(itemsRef.current)) return;
      itemsRef.current = next;
      setRecentItems(next);
      saveRecent(next, userId);
      if (adapter) flusher.schedule(next);
    },
    [userId, adapter, flusher],
  );

  const addRecentItem = useCallback(
    (input: RecentItemInput) => {
      const item = readEntry({ ...input, visitedAt: new Date().toISOString() });
      if (!item) return;
      const prev = itemsRef.current;
      // Revisiting the entry already at the head changes nothing, so it records
      // nothing — not even a fresher `visitedAt`, which would be a write
      // carrying no information. The head's `visitedAt` is when it BECAME the
      // most recent entry.
      if (prev.length > 0 && contentOf(prev[0]) === contentOf(item)) return;
      commit([item, ...prev.filter(r => r.id !== item.id)].slice(0, MAX_RECENT));
    },
    [commit],
  );

  const clearRecentItems = useCallback(() => {
    commit([]);
  }, [commit]);

  const value = useMemo<RecentItemsContextValue>(
    () => ({ recentItems, addRecentItem, clearRecentItems }),
    [recentItems, addRecentItem, clearRecentItems],
  );

  return (
    <RecentItemsContext.Provider value={value}>
      {children}
    </RecentItemsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access shared "recently-accessed" state.
 *
 * Falls back to a no-op implementation when used outside a
 * `<RecentItemsProvider>` (e.g. unit tests that only render presentational
 * components).
 */
export function useRecentItems(): RecentItemsContextValue {
  const ctx = useContext(RecentItemsContext);
  if (!ctx) {
    return {
      recentItems: [],
      addRecentItem: () => {},
      clearRecentItems: () => {},
    };
  }
  return ctx;
}
