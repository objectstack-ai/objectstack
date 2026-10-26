/**
 * UserStateAdapters
 *
 * Injection point for backend persistence of per-user UI state (favorites,
 * recently-accessed items, …). Keeps `FavoritesProvider` / `RecentItemsProvider`
 * decoupled from any specific backend (REST, ObjectQL, GraphQL).
 *
 * The provider is stateful: a bridge component mounted lower in the tree
 * (where the data adapter + authenticated user are available) calls
 * `useAttachUserStateAdapters()` to inject adapters at runtime. While no
 * adapter is attached, hosting providers transparently fall back to
 * localStorage-only behaviour.
 *
 * @module
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UserDataAdapter, UserPreferenceFamily } from '@object-ui/data-objectstack';

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

// `UserDataAdapter` is `@object-ui/data-objectstack`'s, the one authority:
// `createObjectStackUserStateAdapter` returns exactly the contract this
// registry injects, so this module re-exports it rather than declaring a
// second copy. Its contract notes (never throw; degrade to localStorage) live
// on that declaration (objectui#6349, batch 9).
export type { UserDataAdapter };

export type UserStateKind = 'favorites' | 'recent' | 'flowPaletteRecents';

interface UserStateAdaptersValue {
  favorites: UserDataAdapter<any> | null;
  recent: UserDataAdapter<any> | null;
  flowPaletteRecents: UserDataAdapter<any> | null;
  /**
   * objectui#12418 — the per-object list state (`ui.list.<object>`), a key
   * FAMILY rather than one list: one row per object, loaded together by prefix
   * in the same shared read as the three slots above. Console-internal, so it
   * is not one of the public {@link UserStateKind}s.
   */
  listState: UserPreferenceFamily<any> | null;
}

interface AttachApi {
  attach(kind: UserStateKind, adapter: UserDataAdapter<any> | null): void;
  attachListState(family: UserPreferenceFamily<any> | null): void;
}

// ---------------------------------------------------------------------------
// Contexts (split read / write so consumers don't re-render unnecessarily)
// ---------------------------------------------------------------------------

const ReadCtx = createContext<UserStateAdaptersValue>({
  favorites: null,
  recent: null,
  flowPaletteRecents: null,
  listState: null,
});
const WriteCtx = createContext<AttachApi | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function UserStateAdaptersProvider({ children }: { children: ReactNode }) {
  const [adapters, setAdapters] = useState<UserStateAdaptersValue>({
    favorites: null,
    recent: null,
    flowPaletteRecents: null,
    listState: null,
  });

  // Stable attach API so bridge useEffect deps don't churn.
  const attachRef = useRef<AttachApi>({
    attach: (kind, adapter) => {
      setAdapters(prev => (prev[kind] === adapter ? prev : { ...prev, [kind]: adapter }));
    },
    attachListState: (family) => {
      setAdapters(prev => (prev.listState === family ? prev : { ...prev, listState: family }));
    },
  });

  return (
    <WriteCtx.Provider value={attachRef.current}>
      <ReadCtx.Provider value={adapters}>{children}</ReadCtx.Provider>
    </WriteCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Read the currently-attached adapter for a given kind. */
export function useUserStateAdapter<T>(kind: UserStateKind): UserDataAdapter<T> | null {
  return useContext(ReadCtx)[kind] as UserDataAdapter<T> | null;
}

/**
 * Imperative API used by bridge components to plug an adapter in/out.
 * Returns a stable function across re-renders.
 */
export function useAttachUserStateAdapters() {
  const ctx = useContext(WriteCtx);
  return useCallback(
    (kind: UserStateKind, adapter: UserDataAdapter<any> | null) => {
      ctx?.attach(kind, adapter);
    },
    [ctx],
  );
}

/** The attached per-object list-state family (objectui#12418), or null. */
export function useListStateFamily<T>(): UserPreferenceFamily<T> | null {
  return useContext(ReadCtx).listState as UserPreferenceFamily<T> | null;
}

/** Plug the list-state family in/out. Stable across re-renders. */
export function useAttachListStateFamily() {
  const ctx = useContext(WriteCtx);
  return useCallback(
    (family: UserPreferenceFamily<any> | null) => {
      ctx?.attachListState(family);
    },
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// Shared helpers (used by FavoritesProvider / RecentItemsProvider)
// ---------------------------------------------------------------------------

/**
 * Build a user-scoped localStorage key. Falls back to the unscoped key for
 * unauthenticated / preview sessions to preserve current behaviour.
 */
export function scopedKey(base: string, userId?: string | null): string {
  return userId ? `${base}:u:${userId}` : base;
}

/**
 * Subscribe to cross-tab updates of a specific localStorage key. The browser
 * fires `storage` events only in *other* tabs, so we never echo our own
 * writes. `onValue` receives the parsed JSON payload (or null if the key was
 * removed / unparseable).
 */
export function useStorageSync<T>(
  key: string,
  onValue: (value: T | null) => void,
): void {
  // Keep the latest callback in a ref so re-renders of the caller don't
  // tear down and re-add the window listener.
  const cbRef = useRef(onValue);
  cbRef.current = onValue;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== localStorage) return;
      if (e.newValue == null) {
        cbRef.current(null);
        return;
      }
      try {
        cbRef.current(JSON.parse(e.newValue) as T);
      } catch {
        cbRef.current(null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);
}

/**
 * Tiny debounced flush helper. Returns `{ schedule, flush, cancel }`.
 * Designed for the "save full list to backend" pattern.
 */
export function createDebouncedFlush<T>(
  fn: (value: T) => Promise<void> | void,
  delayMs = 500,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  let hasPending = false;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!hasPending) return;
    const payload = pending as T;
    hasPending = false;
    pending = null;
    try {
      await fn(payload);
    } catch {
      // Swallow — adapter is responsible for its own error handling.
    }
  };

  const schedule = (value: T) => {
    pending = value;
    hasPending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    hasPending = false;
    pending = null;
  };

  return { schedule, flush, cancel };
}
