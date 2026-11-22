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
import { ActiveOrganizationStorage, useAuth } from '@object-ui/auth';
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

export type UserStateKind = 'favorites' | 'recent' | 'flowPaletteRecents' | 'lastApp';

interface UserStateAdaptersValue {
  favorites: UserDataAdapter<any> | null;
  recent: UserDataAdapter<any> | null;
  flowPaletteRecents: UserDataAdapter<any> | null;
  /** objectstack#35881 — the person's last app (`ui.app.last`, `LastAppProvider`). */
  lastApp: UserDataAdapter<any> | null;
  /**
   * objectstack#25883 — the per-object record-page state (`ui.record.<object>`),
   * a key FAMILY rather than one list: one row per object, loaded together by
   * prefix in the same shared read as the slots above. Console-internal, so it
   * is not one of the public {@link UserStateKind}s.
   */
  recordState: UserPreferenceFamily<any> | null;
}

interface AttachApi {
  attach(kind: UserStateKind, adapter: UserDataAdapter<any> | null): void;
  attachRecordState(family: UserPreferenceFamily<any> | null): void;
}

// ---------------------------------------------------------------------------
// Contexts (split read / write so consumers don't re-render unnecessarily)
// ---------------------------------------------------------------------------

const ReadCtx = createContext<UserStateAdaptersValue>({
  favorites: null,
  recent: null,
  flowPaletteRecents: null,
  lastApp: null,
  recordState: null,
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
    lastApp: null,
    recordState: null,
  });

  // Stable attach API so bridge useEffect deps don't churn.
  const attachRef = useRef<AttachApi>({
    attach: (kind, adapter) => {
      setAdapters(prev => (prev[kind] === adapter ? prev : { ...prev, [kind]: adapter }));
    },
    attachRecordState: (family) => {
      setAdapters(prev => (prev.recordState === family ? prev : { ...prev, recordState: family }));
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

/** The attached per-object record-page family (objectstack#25883), or null. */
export function useRecordStateFamily<T>(): UserPreferenceFamily<T> | null {
  return useContext(ReadCtx).recordState as UserPreferenceFamily<T> | null;
}

/** Plug the record-page family in/out. Stable across re-renders. */
export function useAttachRecordStateFamily() {
  const ctx = useContext(WriteCtx);
  return useCallback(
    (family: UserPreferenceFamily<any> | null) => {
      ctx?.attachRecordState(family);
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
 *
 * With `orgId` the key also names the organization (`BASE:u:USER:o:ORG`): the
 * browser copy of a server row that is kept per organization
 * (`sys_user_preference`, ADR-0120 D1) is kept per organization too, so a
 * person in two organizations never reads or saves one organization's copy in
 * the other (objectstack#36244). Without one — no organization feature, a
 * preview, the boot before an organization is known — the key is the user's
 * alone, as before.
 */
export function scopedKey(base: string, userId?: string | null, orgId?: string | null): string {
  if (!userId) return base;
  return orgId ? `${base}:u:${userId}:o:${orgId}` : `${base}:u:${userId}`;
}

/**
 * The raw browser copy kept under `scopedKey(base, userId, orgId)`, or `null`.
 *
 * An organization that finds no copy of its own ADOPTS the copy kept before the
 * organization was part of the key (`scopedKey(base, userId)`): the value moves
 * under this organization's key and the user-only key is removed, so exactly
 * one organization — the first to read it — inherits it, and nothing the
 * person had is lost (objectstack#36244). The first reader is in practice the
 * organization that copy mirrors: every hydrate rewrote it with the active
 * organization's server row, and the first page-load on this code boots into
 * the organization the browser last held.
 */
export function readScopedCopy(base: string, userId?: string | null, orgId?: string | null): string | null {
  try {
    const key = scopedKey(base, userId, orgId);
    const own = localStorage.getItem(key);
    if (own !== null || !userId || !orgId) return own;
    const userOnlyKey = scopedKey(base, userId);
    const userOnly = localStorage.getItem(userOnlyKey);
    if (userOnly === null) return null;
    try {
      localStorage.setItem(key, userOnly);
      localStorage.removeItem(userOnlyKey);
    } catch {
      // Storage refused the move: the copy still answers this read.
    }
    return userOnly;
  } catch {
    return null;
  }
}

/**
 * The organization the browser copies of the signed-in person's state are kept
 * under, or `null` with none (objectstack#36244).
 *
 * It is `ActiveOrganizationStorage`'s id — the one `createAuthenticatedFetch`
 * stamps on the preference reads and writes as `X-Tenant-ID` — so the browser
 * copy and the server row it mirrors always name the same organization. It is
 * a synchronous read, so the first paint after an organization switch (which
 * reloads the console with the new id already stored) reads the new
 * organization's copy; and it is re-read on every render of a caller, which
 * the auth context re-renders whenever the active organization moves.
 */
export function useOrganizationScope(): string | null {
  // Subscribes the caller to the auth context: the stored id moves together
  // with the context's active organization (AuthProvider writes both).
  useAuth();
  return ActiveOrganizationStorage.get();
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
