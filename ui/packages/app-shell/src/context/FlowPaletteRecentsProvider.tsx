/**
 * FlowPaletteRecentsProvider
 *
 * Per-user "recently used" node types for the flow designer's add-node palette
 * (objectui#1943). Upgrades the original localStorage-only MRU
 * (`previews/flowPaletteRecents.ts`) to cloud-synced-per-user state, mirroring
 * `RecentItemsProvider` / `FavoritesProvider`:
 *
 * - localStorage-first: instant first paint, works offline / pre-auth.
 * - Hydrates from `UserDataAdapter<string>` when one is attached (by
 *   `ConsoleShell`'s bridge); remote is cross-device truth when present.
 * - Writes are debounced and pushed to the adapter; localStorage stays in
 *   sync as a cold-start cache; storage key is scoped by `user.id`.
 * - One-shot migration folds the legacy unscoped `flow-palette-recents` key
 *   (written by the localStorage-only version) into the synced list.
 *
 * `NodePalette` consumes this via {@link useFlowPaletteRecents}, which falls
 * back to the localStorage module when rendered outside a provider (unit
 * tests, the dev preview gallery) — preserving the pre-cloud-sync behaviour.
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
import {
  readPaletteRecents,
  recordPaletteRecent,
  MAX_PALETTE_RECENTS,
  PALETTE_RECENTS_KEY,
} from '../views/metadata-admin/previews/flowPaletteRecents.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlowPaletteRecentsValue {
  /** Node types, most-recent-first (already capped). */
  recents: string[];
  /** Record a node type as just-used (dedupes to the front, caps the list). */
  recordRecent: (type: string) => void;
}

// ---------------------------------------------------------------------------
// Storage helpers (the base key matches the legacy localStorage-only module,
// so an unauthenticated session shares one store with the fallback path).
// ---------------------------------------------------------------------------

const STORAGE_BASE_KEY = PALETTE_RECENTS_KEY;

function sanitize(list: unknown): string[] {
  return Array.isArray(list)
    ? list.filter((t): t is string => typeof t === 'string').slice(0, MAX_PALETTE_RECENTS)
    : [];
}

function loadLocal(userId?: string | null): string[] {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_BASE_KEY, userId));
    return raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveLocal(list: string[], userId?: string | null) {
  try {
    localStorage.setItem(scopedKey(STORAGE_BASE_KEY, userId), JSON.stringify(list));
  } catch {
    // storage full / privacy mode — recents are a nicety, never an error
  }
}

/**
 * One-shot fold of the legacy *unscoped* `flow-palette-recents` key (the
 * localStorage-only version, and the no-provider fallback's store) into a
 * signed-in user's scoped list. Idempotent: the legacy key is removed once
 * consumed. No-op for anonymous sessions, whose scoped key *is* the unscoped
 * key — there is nothing to migrate.
 */
function migrateLegacy(
  current: string[],
  userId?: string | null,
): { list: string[]; didMigrate: boolean } {
  if (!userId) return { list: current, didMigrate: false };
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_BASE_KEY);
  } catch {
    return { list: current, didMigrate: false };
  }
  if (raw == null) return { list: current, didMigrate: false };
  let legacy: string[] = [];
  try {
    legacy = sanitize(JSON.parse(raw));
  } catch {
    /* corrupt — treat as empty, still clear below */
  }
  try {
    localStorage.removeItem(STORAGE_BASE_KEY);
  } catch {
    /* noop */
  }
  if (legacy.length === 0) return { list: current, didMigrate: true };
  const merged = [...current];
  for (const t of legacy) if (!merged.includes(t)) merged.push(t);
  return { list: merged.slice(0, MAX_PALETTE_RECENTS), didMigrate: true };
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const FlowPaletteRecentsContext = createContext<FlowPaletteRecentsValue | null>(null);

export function FlowPaletteRecentsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const adapter = useUserStateAdapter<string>('flowPaletteRecents');

  const [recents, setRecents] = useState<string[]>(() => loadLocal(userId));

  // Cross-tab sync — see FavoritesProvider for the rationale.
  useStorageSync<string[]>(scopedKey(STORAGE_BASE_KEY, userId), (value) => {
    setRecents(sanitize(value));
  });

  const flusher = useMemo(
    () =>
      createDebouncedFlush<string[]>(async (items) => {
        if (adapter) await adapter.save(items);
      }, 500),
    [adapter],
  );
  useEffect(() => () => void flusher.flush(), [flusher]);

  const commit = useCallback(
    (next: string[]) => {
      saveLocal(next, userId);
      if (adapter) flusher.schedule(next);
    },
    [userId, adapter, flusher],
  );

  // Hydrate (and fold legacy) on mount and whenever the user or attached
  // adapter changes. Runs even without an adapter so offline/pre-auth sessions
  // still migrate + read localStorage; when the adapter attaches it re-runs and
  // remote wins as cross-device truth.
  const hydrationToken = useRef(0);
  useEffect(() => {
    const token = ++hydrationToken.current;
    let cancelled = false;
    void (async () => {
      const local = loadLocal(userId);
      const remote = adapter ? sanitize(await adapter.load().catch(() => [])) : [];
      if (cancelled || token !== hydrationToken.current) return;
      const base = remote.length ? remote : local;
      const { list, didMigrate } = migrateLegacy(base, userId);
      setRecents(list);
      saveLocal(list, userId);
      if (didMigrate && adapter) flusher.schedule(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, flusher]);

  const recordRecent = useCallback(
    (type: string) => {
      if (!type) return;
      setRecents((prev) => {
        const next = [type, ...prev.filter((t) => t !== type)].slice(0, MAX_PALETTE_RECENTS);
        commit(next);
        return next;
      });
    },
    [commit],
  );

  const value = useMemo<FlowPaletteRecentsValue>(
    () => ({ recents, recordRecent }),
    [recents, recordRecent],
  );

  return (
    <FlowPaletteRecentsContext.Provider value={value}>
      {children}
    </FlowPaletteRecentsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the flow-palette "recently used" list.
 *
 * Outside a `<FlowPaletteRecentsProvider>` (unit tests, the dev preview
 * gallery), falls back to the localStorage-only module so the palette keeps
 * its pre-cloud-sync behaviour without any provider wiring.
 */
export function useFlowPaletteRecents(): FlowPaletteRecentsValue {
  const ctx = useContext(FlowPaletteRecentsContext);
  // Fallback state is always declared (rules of hooks) but only used when no
  // provider is present.
  const [fallback, setFallback] = useState<string[]>(() => readPaletteRecents());
  const recordFallback = useCallback((type: string) => {
    recordPaletteRecent(type);
    setFallback(readPaletteRecents());
  }, []);
  if (ctx) return ctx;
  return { recents: fallback, recordRecent: recordFallback };
}
